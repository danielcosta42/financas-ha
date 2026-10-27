import { transacao } from './db.js';
import { atribuirChaves, normaliza } from './parsers.js';

export function categorizar(db, descricao, detalhe = '') {
  const regras = db.prepare('SELECT padrao, categoria_id FROM regras ORDER BY length(padrao) DESC').all();
  const d = normaliza(`${descricao} ${detalhe || ''}`).replace(/\s+/g, ' ');
  // Vence a regra que aparece primeiro na descrição (o nome da loja costuma vir antes);
  // empate na posição fica com a mais longa (já ordenadas por tamanho).
  let melhor = null, pos = Infinity;
  for (const x of regras) {
    const i = d.indexOf(normaliza(x.padrao));
    if (i >= 0 && i < pos) { melhor = x; pos = i; }
  }
  return melhor ? melhor.categoria_id : null;
}

// Concilia o que está pendente na carteira (Carteira do iPhone, avisos por e-mail) com lançamentos do extrato:
// mesmo valor e sentido, data de 1 dia antes até 3 dias depois. Com id, só aquele registro (a carga do
// histórico insere milhares: conciliar todos a cada inserção seria quadrático).
export function conciliarCarteira(db, id = null) {
  const pend = id ? db.prepare('SELECT * FROM carteira WHERE id = ? AND lancamento_id IS NULL').all(id) : db.prepare('SELECT * FROM carteira WHERE lancamento_id IS NULL').all();
  const busca = db.prepare(`
    SELECT l.id FROM lancamentos l
    WHERE l.origem = 'import' AND abs(l.valor - ?) < 0.005
      AND l.data BETWEEN date(?, '-1 day') AND date(?, '+3 day')
      AND l.id NOT IN (SELECT lancamento_id FROM carteira WHERE lancamento_id IS NOT NULL)
    ORDER BY abs(julianday(l.data) - julianday(?)) LIMIT 1`);
  const marca = db.prepare('UPDATE carteira SET lancamento_id = ? WHERE id = ?');
  let n = 0;
  for (const c of pend) {
    const dia = c.quando.slice(0, 10);
    const achou = busca.get(c.entrada ? c.valor : -c.valor, dia, dia, dia);
    if (achou) { marca.run(achou.id, c.id); n++; }
  }
  return n;
}

export function importar(db, { contaId, linhas, arquivo, formato, quem }) {
  const comChave = atribuirChaves(linhas);
  return transacao(db, () => {
    const datas = comChave.map(l => l.data).sort();
    const imp = db.prepare('INSERT INTO importacoes (conta_id, arquivo, formato, de, ate, quem) VALUES (?,?,?,?,?,?)')
      .run(contaId, arquivo, formato, datas[0] || null, datas.at(-1) || null, quem || null);
    const impId = Number(imp.lastInsertRowid);
    const ins = db.prepare(`INSERT OR IGNORE INTO lancamentos (conta_id, data, descricao, detalhe, valor, categoria_id, chave, id_externo, origem, importacao_id)
      VALUES (?,?,?,?,?,?,?,?,'import',?)`);
    // Reimportar completa o detalhe de lançamentos antigos (importados antes da v0.3).
    const completa = db.prepare('UPDATE lancamentos SET detalhe = ? WHERE conta_id = ? AND chave = ? AND detalhe IS NULL');
    let novos = 0, duplicados = 0;
    for (const l of comChave) {
      const r = ins.run(contaId, l.data, l.descricao, l.detalhe ?? null, Math.round(l.valor * 100) / 100, categorizar(db, l.descricao, l.detalhe), l.chave, l.id_externo ?? null, impId);
      if (r.changes) novos++;
      else { duplicados++; if (l.detalhe) completa.run(l.detalhe, contaId, l.chave); }
    }
    db.prepare('UPDATE importacoes SET novos = ?, duplicados = ? WHERE id = ?').run(novos, duplicados, impId);
    const conciliados = conciliarCarteira(db);
    return { importacaoId: impId, novos, duplicados, conciliados, de: datas[0] || null, ate: datas.at(-1) || null };
  });
}

// ev: { valor (positivo), loja, cartao, quando, entrada?, origem? ('carteira' | 'email'), banco? }
export function registrarCarteira(db, ev) {
  const valor = Number(String(ev.valor ?? '').replace(',', '.'));
  if (!(valor > 0)) return null;
  const origem = ev.origem || 'carteira', entrada = ev.entrada ? 1 : 0, quando = ev.quando || new Date().toISOString();
  // A mesma compra avisada por dois caminhos (Carteira do iPhone e e-mail, ou dois bancos: Mercado Pago e o
  // cartão) entra uma vez só. Do mesmo caminho, valor igual no mesmo dia é compra repetida de verdade (dois cafés).
  const repetida = db.prepare(`SELECT 1 FROM carteira WHERE (origem != ? OR COALESCE(banco, '') != ?) AND entrada = ? AND abs(valor - ?) < 0.005
    AND abs(julianday(substr(quando,1,10)) - julianday(substr(?,1,10))) <= 1`).get(origem, ev.banco || '', entrada, valor, quando);
  if (repetida) return null;
  const r = db.prepare('INSERT INTO carteira (valor, loja, cartao, quando, origem, entrada, banco) VALUES (?,?,?,?,?,?,?)')
    .run(valor, ev.loja || null, ev.cartao || null, quando, origem, entrada, ev.banco || null);
  const id = Number(r.lastInsertRowid);
  conciliarCarteira(db, id);
  return id;
}

export function aplicarRegrasSemCategoria(db) {
  const sem = db.prepare('SELECT id, descricao, detalhe FROM lancamentos WHERE categoria_id IS NULL').all();
  const up = db.prepare('UPDATE lancamentos SET categoria_id = ?, sugestao_categoria_id = NULL, sugestao_de = NULL WHERE id = ?');
  let n = 0;
  transacao(db, () => { for (const l of sem) { const c = categorizar(db, l.descricao, l.detalhe); if (c) { up.run(c, l.id); n++; } } });
  return n;
}

export function resumo(db, mes) {
  const ini = `${mes}-01`;
  const fim = db.prepare("SELECT date(?, '+1 month') AS f").get(ini).f;
  const base = `FROM lancamentos l JOIN contas c ON c.id = l.conta_id LEFT JOIN categorias k ON k.id = l.categoria_id
    WHERE l.data >= ? AND l.data < ? AND COALESCE(k.fora_do_total, 0) = 0`;
  const tot = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN l.valor < 0 THEN -l.valor END), 0) AS saidas,
      COALESCE(SUM(CASE WHEN l.valor > 0 THEN l.valor END), 0) AS entradas,
      COUNT(*) AS n ${base}`).get(ini, fim);
  const porCategoria = db.prepare(`SELECT COALESCE(k.nome, 'Sem categoria') AS categoria, k.cor, k.id AS categoria_id,
      SUM(-l.valor) AS total, COUNT(*) AS n ${base} AND l.valor < 0 GROUP BY k.id ORDER BY total DESC`).all(ini, fim);
  const porDono = db.prepare(`SELECT c.dono, SUM(-l.valor) AS total, p.cor, p.renda_mensal, p.tipo ${base.replace('LEFT JOIN categorias k', 'LEFT JOIN pessoas p ON p.nome = c.dono LEFT JOIN categorias k')}
      AND l.valor < 0 GROUP BY c.dono ORDER BY total DESC`).all(ini, fim);
  const renda = db.prepare("SELECT COALESCE(SUM(renda_mensal),0) AS r FROM pessoas WHERE arquivada = 0 AND tipo = 'pessoa'").get().r;
  const semCategoria = db.prepare('SELECT COUNT(*) AS n FROM lancamentos WHERE categoria_id IS NULL').get().n;
  const pendentes = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(valor),0) AS total FROM carteira
      WHERE lancamento_id IS NULL AND entrada = ? AND substr(quando,1,10) >= ? AND substr(quando,1,10) < ?`);
  const carteira = pendentes.get(0, ini, fim), entradasPendentes = pendentes.get(1, ini, fim);
  const contas = db.prepare(`SELECT c.id, c.nome, c.dono, c.tipo, c.banco,
      (SELECT MAX(criado_em) FROM importacoes i WHERE i.conta_id = c.id) AS ultima_importacao,
      (SELECT MAX(data) FROM lancamentos x WHERE x.conta_id = c.id) AS ultimo_lancamento
      FROM contas c WHERE c.arquivada = 0 ORDER BY c.dono, c.nome`).all();
  const comentario = db.prepare('SELECT texto, origem, criado_em FROM comentarios WHERE mes = ?').get(mes) || null;
  const sugestoes = db.prepare('SELECT COUNT(*) AS n FROM lancamentos WHERE categoria_id IS NULL AND sugestao_categoria_id IS NOT NULL').get().n;
  return { mes, ...tot, rendaDeclarada: renda, porCategoria, porDono, semCategoria, sugestoes, carteiraPendente: carteira, entradasPendentes, contas, comentario, recorrentes: recorrentes(db, fim) };
}

// Nome "limpo" do estabelecimento: tira cidade/país do fim e códigos.
export const estabelecimento = d => normaliza(d)
  .replace(/\s+(sao paulo|osasco|ubatuba|rio de janeiro|barueri|santos|campinas)?\s*bra$/, '')
  .replace(/\*[\w-]+/g, '').replace(/\d{4,}/g, '').replace(/\s+/g, ' ').trim();

// Cobranças que se repetem: mesmo estabelecimento e mesmo valor 3+ vezes nos últimos 90 dias.
export function recorrentes(db, ate) {
  const linhas = db.prepare(`SELECT l.descricao, l.valor, l.data, k.nome AS categoria FROM lancamentos l LEFT JOIN categorias k ON k.id = l.categoria_id
    WHERE l.valor < 0 AND l.data >= date(?, '-90 day') AND l.data < ? AND COALESCE(k.fora_do_total,0) = 0`).all(ate, ate);
  const grupos = new Map();
  for (const l of linhas) {
    const nome = estabelecimento(l.descricao);
    if (!nome || nome === 'sem descricao') continue;
    const k = `${nome}|${l.valor.toFixed(2)}`;
    const g = grupos.get(k) || { descricao: l.descricao.replace(/\s{2,}.*$/, '').trim(), valor: -l.valor, vezes: 0, ultima: l.data, categoria: l.categoria };
    g.vezes++; if (l.data > g.ultima) g.ultima = l.data;
    grupos.set(k, g);
  }
  return [...grupos.values()].filter(g => g.vezes >= 3)
    .map(g => ({ ...g, total: Math.round(g.valor * g.vezes * 100) / 100 }))
    .sort((a, b) => b.total - a.total).slice(0, 8);
}
