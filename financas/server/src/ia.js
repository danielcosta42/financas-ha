// IA pelo Home Assistant (ai_task): categorização sugerida e comentário do mês.
// Usa o Ollama local por padrão; a IA só sugere, quem decide é a pessoa.
import { transacao } from './db.js';
import { normaliza } from './parsers.js';
import { estabelecimento, resumo } from './servico.js';

const TOKEN = process.env.SUPERVISOR_TOKEN;
const API = process.env.FINANCAS_HA_API || 'http://supervisor/core/api';

export const iaDisponivel = () => Boolean(TOKEN);

export async function gerarTexto(instrucoes, { entidade, reserva, tarefa = 'financas', timeoutMs = 120000 } = {}) {
  if (!TOKEN) throw new Error('sem acesso ao Home Assistant');
  const tentar = async entity_id => {
    const r = await fetch(`${API}/services/ai_task/generate_data?return_response`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_name: tarefa, entity_id, instructions: instrucoes }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) throw new Error(`ai_task ${entity_id}: HTTP ${r.status}`);
    const j = await r.json();
    const txt = j?.service_response?.data;
    if (typeof txt !== 'string' || !txt.trim()) throw new Error(`ai_task ${entity_id}: resposta vazia`);
    return { texto: txt.trim().replace(/^["']|["']$/g, '').replace(/\*/g, ''), origem: entity_id };
  };
  try { return await tentar(entidade); }
  catch (e) { if (reserva) return tentar(reserva); throw e; }
}

// ---------- categorização ----------
export const estadoIa = { rodando: false, feitos: 0, total: 0, sugeridos: 0, erro: null, fim: null };

function escolher(resposta, categorias) {
  const r = normaliza(resposta).replace(/[.\s]+$/, '');
  if (!r || r.startsWith('?') || r.includes('nao sei')) return null;
  const exata = categorias.find(c => normaliza(c.nome) === r);
  if (exata) return exata;
  // a mais longa contida na resposta ("Categoria: Mercado" → Mercado)
  return categorias.filter(c => r.includes(normaliza(c.nome))).sort((a, b) => b.nome.length - a.nome.length)[0] || null;
}

export async function sugerirCategorias(db, opcoes, log) {
  if (estadoIa.rodando) return estadoIa;
  const grupos = new Map();
  const sem = db.prepare(`SELECT id, descricao, detalhe, valor FROM lancamentos
    WHERE categoria_id IS NULL AND sugestao_categoria_id IS NULL ORDER BY data DESC LIMIT 400`).all();
  for (const l of sem) {
    const k = `${estabelecimento(l.descricao)}|${normaliza(l.detalhe || '')}|${l.valor < 0 ? 's' : 'e'}`;
    const g = grupos.get(k) || { ids: [], exemplo: l };
    g.ids.push(l.id); grupos.set(k, g);
  }
  const lista = [...grupos.values()].slice(0, Number(opcoes.limite) || 40);
  Object.assign(estadoIa, { rodando: true, feitos: 0, total: lista.length, sugeridos: 0, erro: null, fim: null });
  if (!lista.length) { Object.assign(estadoIa, { rodando: false, fim: new Date().toISOString() }); return estadoIa; }

  const cats = db.prepare('SELECT id, nome, grupo, fora_do_total FROM categorias').all();
  const deEntrada = cats.filter(c => c.grupo === 'Entradas' || c.fora_do_total);
  const deSaida = cats.filter(c => c.grupo !== 'Entradas');
  // exemplos tirados das escolhas da própria casa: a IA aprende o jeito de vocês
  const exemplos = db.prepare(`SELECT l.descricao, l.detalhe, l.valor, k.nome AS categoria FROM lancamentos l JOIN categorias k ON k.id = l.categoria_id
    GROUP BY k.id, lower(substr(l.descricao, 1, 18)) ORDER BY max(l.data) DESC LIMIT 18`).all()
    .map(e => `- ${[e.detalhe, e.descricao.replace(/\s{2,}/g, ' ')].filter(Boolean).join(': ')} (${e.valor < 0 ? 'saída' : 'entrada'}) → ${e.categoria}`).join('\n');
  const marca = db.prepare('UPDATE lancamentos SET sugestao_categoria_id = ?, sugestao_de = ? WHERE id = ? AND categoria_id IS NULL');

  (async () => {
    for (const g of lista) {
      const l = g.exemplo;
      const opcoesCat = l.valor < 0 ? deSaida : deEntrada;
      const desc = [l.detalhe, l.descricao.replace(/\s{2,}/g, ' ')].filter(Boolean).join(': ');
      const instr = `Você categoriza lançamentos de extrato bancário de uma casa em São Paulo (Daniel e Naomi). `
        + `Responda APENAS com o nome exato de uma categoria da lista, ou "?" se não der pra saber com segurança. `
        + `Pix para pessoa física sem contexto: responda "?". Transferência entre contas é só quando o dinheiro vai para conta do próprio dono (Daniel Costa Ferreira Dutra).\n`
        + `Categorias: ${opcoesCat.map(c => c.nome).join(', ')}.\n`
        + (exemplos ? `Exemplos de como esta casa categoriza:\n${exemplos}\n` : '')
        + `Lançamento: ${desc} (${l.valor < 0 ? 'saída' : 'entrada'} de R$ ${Math.abs(l.valor).toFixed(2).replace('.', ',')})`;
      try {
        const { texto, origem } = await gerarTexto(instr, { entidade: opcoes.entidade, reserva: opcoes.reserva, tarefa: 'financas_categorizar', timeoutMs: 90000 });
        const c = escolher(texto.split('\n')[0], opcoesCat);
        if (c) { transacao(db, () => g.ids.forEach(id => marca.run(c.id, origem, id))); estadoIa.sugeridos += g.ids.length; }
      } catch (e) {
        estadoIa.erro = e.message;
        log?.warn({ err: e.message }, 'IA: falha ao sugerir');
        if (/HTTP 4|sem acesso/.test(e.message)) break;
      }
      estadoIa.feitos++;
    }
    Object.assign(estadoIa, { rodando: false, fim: new Date().toISOString() });
    opcoes.aoTerminar?.();
  })();
  return estadoIa;
}

// Aceita sugestões (todas ou alguns ids). Com criarRegras, vira regra o estabelecimento que aparece 2+ vezes.
export function aceitarSugestoes(db, { ids, criarRegras = true } = {}) {
  const onde = ids?.length ? `AND id IN (${ids.map(Number).join(',')})` : '';
  const itens = db.prepare(`SELECT id, descricao, sugestao_categoria_id AS cat FROM lancamentos
    WHERE categoria_id IS NULL AND sugestao_categoria_id IS NOT NULL ${onde}`).all();
  const up = db.prepare('UPDATE lancamentos SET categoria_id = sugestao_categoria_id, sugestao_categoria_id = NULL, sugestao_de = NULL WHERE id = ?');
  const regrasExistentes = new Set(db.prepare('SELECT padrao FROM regras').all().map(r => r.padrao));
  const insRegra = db.prepare('INSERT INTO regras (padrao, categoria_id) VALUES (?,?)');
  let regras = 0;
  transacao(db, () => {
    itens.forEach(i => up.run(i.id));
    if (!criarRegras) return;
    const cont = new Map();
    for (const i of itens) {
      const p = estabelecimento(i.descricao);
      if (p.length < 4 || p === 'sem descricao' || /^\d+$/.test(p)) continue;
      const k = `${p}|${i.cat}`;
      cont.set(k, (cont.get(k) || 0) + 1);
    }
    for (const [k, n] of cont) {
      const [p, cat] = k.split('|');
      if (n >= 2 && !regrasExistentes.has(p)) { insRegra.run(p, Number(cat)); regrasExistentes.add(p); regras++; }
    }
  });
  return { aceitos: itens.length, regras };
}

export function recusarSugestao(db, id) {
  db.prepare('UPDATE lancamentos SET sugestao_categoria_id = NULL, sugestao_de = ? WHERE id = ?').run('recusada', id);
}

// ---------- comentário do mês ----------
const brl = v => `R$ ${Math.round(v).toLocaleString('pt-BR')}`;

export async function comentarMes(db, mes, opcoes) {
  const r = resumo(db, mes);
  const [y, m] = mes.split('-').map(Number);
  const ant = new Date(y, m - 2, 15);
  const mesAnt = `${ant.getFullYear()}-${String(ant.getMonth() + 1).padStart(2, '0')}`;
  const a = resumo(db, mesAnt);
  const catAnt = Object.fromEntries(a.porCategoria.map(c => [c.categoria, c.total]));
  const hoje = new Date();
  const corrente = mes === `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
  const fatos = [
    `Mês: ${mes}${corrente ? ` (em andamento, dia ${hoje.getDate()})` : ''}.`,
    `Saídas: ${brl(r.saidas)} (mês anterior: ${brl(a.saidas)}). Entradas: ${brl(r.entradas)}.`,
    r.rendaDeclarada ? `Renda declarada da casa: ${brl(r.rendaDeclarada)}.` : '',
    `Maiores categorias: ${r.porCategoria.slice(0, 5).map(c => `${c.categoria} ${brl(c.total)}${catAnt[c.categoria] ? ` (antes ${brl(catAnt[c.categoria])})` : ''}`).join('; ')}.`,
    r.semCategoria ? `${r.semCategoria} lançamentos ainda sem categoria.` : '',
    r.recorrentes.length ? `Cobranças repetidas nos últimos 90 dias: ${r.recorrentes.slice(0, 3).map(x => `${x.descricao} ${brl(x.valor)} x${x.vezes}`).join('; ')}.` : '',
  ].filter(Boolean).join(' ');
  const instr = `Você é o assistente financeiro da casa do Daniel e da Naomi. Com base só nos fatos abaixo, escreva um comentário curto sobre o mês `
    + `em português do Brasil: 2 ou 3 frases, tom direto e amigável, destacando o que mudou e uma sugestão prática. `
    + `Não invente números nem fatos. Sem emojis, sem listas, sem markdown. Fatos: ${fatos}`;
  const { texto, origem } = await gerarTexto(instr, { entidade: opcoes.entidade, reserva: opcoes.reserva, tarefa: 'financas_comentario' });
  db.prepare(`INSERT INTO comentarios (mes, texto, origem) VALUES (?,?,?)
    ON CONFLICT(mes) DO UPDATE SET texto = excluded.texto, origem = excluded.origem, criado_em = datetime('now')`).run(mes, texto, origem);
  return { mes, texto, origem };
}
