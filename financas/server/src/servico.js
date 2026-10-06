import { transacao } from './db.js';
import { atribuirChaves, normaliza } from './parsers.js';

export function categorizar(db, descricao) {
  const regras = db.prepare('SELECT padrao, categoria_id FROM regras ORDER BY length(padrao) DESC').all();
  const d = normaliza(descricao);
  const r = regras.find(x => d.includes(normaliza(x.padrao)));
  return r ? r.categoria_id : null;
}

// Concilia compras da Carteira ainda soltas com lançamentos do extrato:
// mesmo valor (saída) e data até 3 dias depois da compra.
export function conciliarCarteira(db) {
  const pend = db.prepare('SELECT * FROM carteira WHERE lancamento_id IS NULL').all();
  const busca = db.prepare(`
    SELECT l.id FROM lancamentos l
    WHERE l.origem = 'import' AND abs(l.valor + ?) < 0.005
      AND l.data BETWEEN date(?, '-1 day') AND date(?, '+3 day')
      AND l.id NOT IN (SELECT lancamento_id FROM carteira WHERE lancamento_id IS NOT NULL)
    ORDER BY abs(julianday(l.data) - julianday(?)) LIMIT 1`);
  const marca = db.prepare('UPDATE carteira SET lancamento_id = ? WHERE id = ?');
  let n = 0;
  for (const c of pend) {
    const dia = c.quando.slice(0, 10);
    const achou = busca.get(c.valor, dia, dia, dia);
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
    const ins = db.prepare(`INSERT OR IGNORE INTO lancamentos (conta_id, data, descricao, valor, categoria_id, chave, id_externo, origem, importacao_id)
      VALUES (?,?,?,?,?,?,?,'import',?)`);
    let novos = 0, duplicados = 0;
    for (const l of comChave) {
      const r = ins.run(contaId, l.data, l.descricao, Math.round(l.valor * 100) / 100, categorizar(db, l.descricao), l.chave, l.id_externo ?? null, impId);
      if (r.changes) novos++; else duplicados++;
    }
    db.prepare('UPDATE importacoes SET novos = ?, duplicados = ? WHERE id = ?').run(novos, duplicados, impId);
    const conciliados = conciliarCarteira(db);
    return { importacaoId: impId, novos, duplicados, conciliados, de: datas[0] || null, ate: datas.at(-1) || null };
  });
}

export function registrarCarteira(db, ev) {
  const valor = Number(String(ev.valor ?? '').replace(',', '.'));
  if (!(valor > 0)) return null;
  const r = db.prepare('INSERT INTO carteira (valor, loja, cartao, quando) VALUES (?,?,?,?)')
    .run(valor, ev.loja || null, ev.cartao || null, ev.quando || new Date().toISOString());
  conciliarCarteira(db);
  return Number(r.lastInsertRowid);
}

export function aplicarRegrasSemCategoria(db) {
  const sem = db.prepare('SELECT id, descricao FROM lancamentos WHERE categoria_id IS NULL').all();
  const up = db.prepare('UPDATE lancamentos SET categoria_id = ? WHERE id = ?');
  let n = 0;
  transacao(db, () => { for (const l of sem) { const c = categorizar(db, l.descricao); if (c) { up.run(c, l.id); n++; } } });
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
  const carteira = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(valor),0) AS total FROM carteira
      WHERE lancamento_id IS NULL AND substr(quando,1,10) >= ? AND substr(quando,1,10) < ?`).get(ini, fim);
  const contas = db.prepare(`SELECT c.id, c.nome, c.dono, c.tipo, c.banco,
      (SELECT MAX(criado_em) FROM importacoes i WHERE i.conta_id = c.id) AS ultima_importacao,
      (SELECT MAX(data) FROM lancamentos x WHERE x.conta_id = c.id) AS ultimo_lancamento
      FROM contas c WHERE c.arquivada = 0 ORDER BY c.dono, c.nome`).all();
  return { mes, ...tot, rendaDeclarada: renda, porCategoria, porDono, semCategoria, carteiraPendente: carteira, contas };
}
