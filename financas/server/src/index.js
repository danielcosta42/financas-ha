import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import fstatic from '@fastify/static';
import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirBanco, transacao, semearPessoas } from './db.js';
import { decodificar, ehOfx, lerOfx, detectarDelimitador, lerCsvBruto, sugerirPerfil, aplicarPerfil, PRESETS } from './parsers.js';
import { importar, registrarCarteira, aplicarRegrasSemCategoria, resumo } from './servico.js';
import { escutarEvento, publicarResumo, haDisponivel, listarNotificadores } from './ha.js';
import { iaDisponivel, estadoIa, sugerirCategorias, aceitarSugestoes, recusarSugestao, comentarMes } from './ia.js';

const DEV = Boolean(process.env.FINANCAS_DEV);
const DADOS = process.env.FINANCAS_DATA || '/data';
const opcoes = (() => {
  try { return JSON.parse(readFileSync(join(DADOS, 'options.json'), 'utf8')); } catch { return {}; }
})();
const PESSOAS = opcoes.pessoas?.length ? opcoes.pessoas : ['Daniel', 'Naomi'];
const PASTA = opcoes.pasta_de_entrada || null;
const IA = {
  entidade: opcoes.ia_entidade || 'ai_task.ollama_casa',
  reserva: opcoes.ia_reserva || null,
  automatica: opcoes.ia_automatica !== false,
};

const db = abrirBanco(DADOS);
semearPessoas(db, PESSOAS);
const donos = () => db.prepare("SELECT nome FROM pessoas WHERE arquivada = 0 ORDER BY CASE tipo WHEN 'pessoa' THEN 0 WHEN 'casa' THEN 1 ELSE 2 END, id").all().map(p => p.nome);
const app = Fastify({ logger: { level: DEV ? 'info' : 'warn' }, bodyLimit: 2 * 1024 * 1024 });
await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

// Só o ingress do HA fala com o app (ele já exige login do HA).
app.addHook('onRequest', async (req, reply) => {
  if (DEV) return;
  if (req.ip !== '172.30.32.2' && req.ip !== '127.0.0.1' && req.ip !== '::1') reply.code(403).send({ erro: 'acesso só pelo Home Assistant' });
});

const mesAtual = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 7);
const quem = req => req.headers['x-remote-user-display-name'] || req.headers['x-remote-user-name'] || null;
let publicando = null;
const atualizarHa = () => {
  clearTimeout(publicando);
  publicando = setTimeout(() => publicarResumo(resumo(db, mesAtual()), app.log), 1500);
};

// ---------- leitura de arquivo ----------
async function ler(buf, nome) {
  // pdfjs só é carregado quando chega um PDF: se algo nele falhar, o resto do app segue de pé.
  if (buf.length > 4 && buf.subarray(0, 5).toString('latin1') === '%PDF-') {
    const { lerPdf } = await import('./pdf.js');
    return { ...(await lerPdf(buf)), nome };
  }
  const txt = decodificar(buf);
  if (ehOfx(txt)) return { formato: 'ofx', linhas: lerOfx(txt), nome };
  const delim = detectarDelimitador(txt);
  const bruto = lerCsvBruto(txt, delim);
  if (!bruto.length) throw new Error('arquivo vazio');
  return { formato: 'csv', bruto, delim, nome };
}

function previa(arq, perfil) {
  if (arq.formato !== 'csv') return { formato: arq.formato, linhas: arq.linhas, erros: arq.erros || [] };
  const r = aplicarPerfil(arq.bruto, perfil);
  return { formato: 'csv', ...r };
}

const uploads = new Map(); // token → { arq, criado }
setInterval(() => { for (const [k, v] of uploads) if (Date.now() - v.criado > 30 * 6e4) uploads.delete(k); }, 6e4).unref();

// ---------- API ----------
app.get('/api/estado', async () => ({ pessoas: donos(), donos: donos(), ha: haDisponivel(), ia: iaDisponivel() ? IA.entidade : null, presets: PRESETS.map(p => ({ id: p.id, nome: p.nome })), pasta: PASTA }));

// ---------- IA ----------
let comentando = null;
async function comentarAgora(mes) {
  if (comentando) return comentando;
  comentando = comentarMes(db, mes, IA).finally(() => { comentando = null; atualizarHa(); });
  return comentando;
}
function iaDepoisDeImportar() {
  if (!iaDisponivel() || !IA.automatica) return;
  sugerirCategorias(db, { ...IA, aoTerminar: () => { atualizarHa(); comentarAgora(mesAtual()).catch(e => app.log.warn({ err: e.message }, 'IA: comentário falhou')); } }, app.log);
}
app.get('/api/ia/estado', async () => ({ disponivel: iaDisponivel(), entidade: IA.entidade, ...estadoIa }));
app.post('/api/ia/sugerir', async (req, reply) => {
  if (!iaDisponivel()) return reply.code(400).send({ erro: 'IA indisponível: o add-on precisa do Home Assistant' });
  return sugerirCategorias(db, { ...IA, limite: req.body?.limite, aoTerminar: atualizarHa }, app.log);
});
app.post('/api/ia/aceitar', async req => { const r = aceitarSugestoes(db, req.body || {}); aplicarRegrasSemCategoria(db); atualizarHa(); return r; });
app.post('/api/ia/recusar/:id', async req => { recusarSugestao(db, req.params.id); atualizarHa(); return { ok: true }; });
app.post('/api/ia/comentario', async (req, reply) => {
  if (!iaDisponivel()) return reply.code(400).send({ erro: 'IA indisponível' });
  try { return await comentarAgora(req.body?.mes || mesAtual()); }
  catch (e) { return reply.code(502).send({ erro: `a IA não respondeu: ${e.message}` }); }
});


// ---------- perfis ----------
app.get('/api/notificadores', async () => listarNotificadores());
const CAMPOS_PESSOA = ['nome', 'tipo', 'cor', 'renda_mensal', 'dia_recebimento', 'regime', 'meta_poupanca', 'notificar', 'arquivada'];
app.get('/api/pessoas', async req => {
  const mes = req.query?.mes || mesAtual();
  const ini = `${mes}-01`;
  return db.prepare(`SELECT p.*,
      (SELECT COUNT(*) FROM contas c WHERE c.dono = p.nome AND c.arquivada = 0) AS contas,
      (SELECT COALESCE(SUM(-l.valor),0) FROM lancamentos l JOIN contas c ON c.id = l.conta_id LEFT JOIN categorias k ON k.id = l.categoria_id
         WHERE c.dono = p.nome AND l.valor < 0 AND COALESCE(k.fora_do_total,0) = 0 AND l.data >= ? AND l.data < date(?, '+1 month')) AS saidas_mes,
      (SELECT COALESCE(SUM(l.valor),0) FROM lancamentos l JOIN contas c ON c.id = l.conta_id LEFT JOIN categorias k ON k.id = l.categoria_id
         WHERE c.dono = p.nome AND l.valor > 0 AND COALESCE(k.fora_do_total,0) = 0 AND l.data >= ? AND l.data < date(?, '+1 month')) AS entradas_mes
    FROM pessoas p ORDER BY p.arquivada, CASE p.tipo WHEN 'pessoa' THEN 0 WHEN 'casa' THEN 1 ELSE 2 END, p.id`).all(ini, ini, ini, ini);
});
app.post('/api/pessoas', async (req, reply) => {
  const b = req.body || {};
  if (!b.nome?.trim()) return reply.code(400).send({ erro: 'nome obrigatório' });
  try {
    const r = db.prepare(`INSERT INTO pessoas (nome, tipo, cor, renda_mensal, dia_recebimento, regime, meta_poupanca, notificar) VALUES (?,?,?,?,?,?,?,?)`)
      .run(b.nome.trim(), b.tipo || 'pessoa', b.cor || '#7fb2ff', b.renda_mensal ?? null, b.dia_recebimento ?? null, b.regime || null, b.meta_poupanca ?? null, b.notificar || null);
    return { id: Number(r.lastInsertRowid) };
  } catch { return reply.code(400).send({ erro: 'já existe um perfil com esse nome' }); }
});
app.patch('/api/pessoas/:id', async (req, reply) => {
  const p = db.prepare('SELECT * FROM pessoas WHERE id = ?').get(req.params.id);
  if (!p) return reply.code(404).send({ erro: 'perfil não encontrado' });
  const b = req.body || {};
  const novo = Object.fromEntries(CAMPOS_PESSOA.map(k => [k, b[k] === undefined ? p[k] : b[k] === '' ? null : b[k]]));
  if (!novo.nome?.trim()) return reply.code(400).send({ erro: 'nome obrigatório' });
  try {
    transacao(db, () => {
      db.prepare(`UPDATE pessoas SET ${CAMPOS_PESSOA.map(k => `${k} = ?`).join(', ')} WHERE id = ?`).run(...CAMPOS_PESSOA.map(k => novo[k]), p.id);
      if (novo.nome !== p.nome) db.prepare('UPDATE contas SET dono = ? WHERE dono = ?').run(novo.nome, p.nome);
    });
  } catch { return reply.code(400).send({ erro: 'já existe um perfil com esse nome' }); }
  atualizarHa();
  return { ok: true };
});
app.delete('/api/pessoas/:id', async (req, reply) => {
  const p = db.prepare('SELECT * FROM pessoas WHERE id = ?').get(req.params.id);
  if (!p) return { ok: true };
  const n = db.prepare('SELECT COUNT(*) AS n FROM contas WHERE dono = ?').get(p.nome).n;
  if (n) return reply.code(400).send({ erro: `${p.nome} tem ${n} conta(s); arquive o perfil ou mova as contas antes` });
  db.prepare('DELETE FROM pessoas WHERE id = ?').run(p.id);
  return { ok: true };
});

app.get('/api/contas', async () => db.prepare(`SELECT c.*, (SELECT MAX(criado_em) FROM importacoes i WHERE i.conta_id = c.id) AS ultima_importacao,
  (SELECT COUNT(*) FROM lancamentos l WHERE l.conta_id = c.id) AS lancamentos FROM contas c ORDER BY c.arquivada, c.dono, c.nome`).all()
  .map(c => ({ ...c, perfil: c.perfil_json ? JSON.parse(c.perfil_json) : null, perfil_json: undefined })));

app.post('/api/contas', async (req, reply) => {
  const { nome, tipo = 'corrente', dono, banco } = req.body || {};
  if (!nome || !donos().includes(dono)) return reply.code(400).send({ erro: 'nome e dono são obrigatórios' });
  const r = db.prepare('INSERT INTO contas (nome, tipo, dono, banco) VALUES (?,?,?,?)').run(nome.trim(), tipo, dono, banco || null);
  return { id: Number(r.lastInsertRowid) };
});

app.patch('/api/contas/:id', async req => {
  const c = db.prepare('SELECT * FROM contas WHERE id = ?').get(req.params.id);
  if (!c) return { ok: false };
  const b = req.body || {};
  db.prepare('UPDATE contas SET nome = ?, tipo = ?, dono = ?, banco = ?, arquivada = ? WHERE id = ?')
    .run(b.nome ?? c.nome, b.tipo ?? c.tipo, b.dono ?? c.dono, b.banco ?? c.banco, b.arquivada ?? c.arquivada, c.id);
  return { ok: true };
});

app.delete('/api/contas/:id', async req => { db.prepare('DELETE FROM contas WHERE id = ?').run(req.params.id); atualizarHa(); return { ok: true }; });

app.get('/api/categorias', async () => db.prepare(`SELECT k.*, (SELECT COUNT(*) FROM lancamentos l WHERE l.categoria_id = k.id) AS usos
  FROM categorias k ORDER BY k.grupo, k.nome`).all());
app.post('/api/categorias', async (req, reply) => {
  const { nome, grupo, cor, fora_do_total = 0 } = req.body || {};
  if (!nome) return reply.code(400).send({ erro: 'nome obrigatório' });
  const r = db.prepare('INSERT INTO categorias (nome, grupo, cor, fora_do_total) VALUES (?,?,?,?)').run(nome.trim(), grupo || null, cor || '#8089a7', fora_do_total ? 1 : 0);
  return { id: Number(r.lastInsertRowid) };
});
app.patch('/api/categorias/:id', async req => {
  const k = db.prepare('SELECT * FROM categorias WHERE id = ?').get(req.params.id);
  const b = req.body || {};
  db.prepare('UPDATE categorias SET nome = ?, grupo = ?, cor = ?, fora_do_total = ? WHERE id = ?')
    .run(b.nome ?? k.nome, b.grupo ?? k.grupo, b.cor ?? k.cor, (b.fora_do_total ?? k.fora_do_total) ? 1 : 0, k.id);
  atualizarHa();
  return { ok: true };
});
app.delete('/api/categorias/:id', async req => { db.prepare('DELETE FROM categorias WHERE id = ?').run(req.params.id); atualizarHa(); return { ok: true }; });

app.get('/api/regras', async () => db.prepare('SELECT r.*, k.nome AS categoria, k.cor FROM regras r JOIN categorias k ON k.id = r.categoria_id ORDER BY k.nome, r.padrao').all());
app.post('/api/regras', async (req, reply) => {
  const { padrao, categoria_id, aplicar = true } = req.body || {};
  if (!padrao?.trim() || !categoria_id) return reply.code(400).send({ erro: 'padrão e categoria são obrigatórios' });
  const r = db.prepare('INSERT INTO regras (padrao, categoria_id) VALUES (?,?)').run(padrao.trim().toLowerCase(), categoria_id);
  const aplicadas = aplicar ? aplicarRegrasSemCategoria(db) : 0;
  atualizarHa();
  return { id: Number(r.lastInsertRowid), aplicadas };
});
app.delete('/api/regras/:id', async req => { db.prepare('DELETE FROM regras WHERE id = ?').run(req.params.id); return { ok: true }; });
app.post('/api/regras/aplicar', async () => { const n = aplicarRegrasSemCategoria(db); atualizarHa(); return { aplicadas: n }; });

app.get('/api/lancamentos', async req => {
  const q = req.query || {};
  const onde = [], args = [];
  if (q.mes) { onde.push("l.data >= ? AND l.data < date(?, '+1 month')"); args.push(`${q.mes}-01`, `${q.mes}-01`); }
  if (q.conta) { onde.push('l.conta_id = ?'); args.push(Number(q.conta)); }
  if (q.dono) { onde.push('c.dono = ?'); args.push(q.dono); }
  if (q.categoria === 'sem') onde.push('l.categoria_id IS NULL');
  else if (q.categoria === 'sugestao') onde.push('l.categoria_id IS NULL AND l.sugestao_categoria_id IS NOT NULL');
  else if (q.categoria) { onde.push('l.categoria_id = ?'); args.push(Number(q.categoria)); }
  if (q.busca) { onde.push("(l.descricao LIKE ? OR COALESCE(l.detalhe,'') LIKE ?)"); args.push(`%${q.busca}%`, `%${q.busca}%`); }
  const where = onde.length ? `WHERE ${onde.join(' AND ')}` : '';
  return db.prepare(`SELECT l.id, l.data, l.descricao, l.detalhe, l.valor, l.categoria_id, l.nota, l.origem, l.conta_id,
      l.sugestao_categoria_id, s.nome AS sugestao, s.cor AS sugestao_cor,
      c.nome AS conta, c.dono, k.nome AS categoria, k.cor, COALESCE(k.fora_do_total, 0) AS fora_do_total,
      EXISTS(SELECT 1 FROM carteira w WHERE w.lancamento_id = l.id) AS veio_da_carteira
    FROM lancamentos l JOIN contas c ON c.id = l.conta_id LEFT JOIN categorias k ON k.id = l.categoria_id
    LEFT JOIN categorias s ON s.id = l.sugestao_categoria_id
    ${where} ORDER BY l.data DESC, l.id DESC LIMIT 2000`).all(...args);
});

app.patch('/api/lancamentos/:id', async req => {
  const l = db.prepare('SELECT * FROM lancamentos WHERE id = ?').get(req.params.id);
  if (!l) return { ok: false };
  const b = req.body || {};
  db.prepare('UPDATE lancamentos SET categoria_id = ?, nota = ?, sugestao_categoria_id = NULL WHERE id = ?')
    .run(b.categoria_id === undefined ? l.categoria_id : b.categoria_id, b.nota ?? l.nota, l.id);
  let aplicadas = 0;
  if (b.regra && b.categoria_id) {
    db.prepare('INSERT INTO regras (padrao, categoria_id) VALUES (?,?)').run(String(b.regra).trim().toLowerCase(), b.categoria_id);
    aplicadas = aplicarRegrasSemCategoria(db);
  }
  atualizarHa();
  return { ok: true, aplicadas };
});

app.patch('/api/lancamentos', async req => {
  const { ids = [], categoria_id } = req.body || {};
  const up = db.prepare('UPDATE lancamentos SET categoria_id = ?, sugestao_categoria_id = NULL WHERE id = ?');
  transacao(db, () => ids.forEach(id => up.run(categoria_id ?? null, id)));
  atualizarHa();
  return { ok: true, n: ids.length };
});

app.post('/api/importar/previa', async (req, reply) => {
  const f = await req.file();
  if (!f) return reply.code(400).send({ erro: 'envie um arquivo' });
  const buf = await f.toBuffer();
  let arq;
  try { arq = await ler(buf, f.filename); } catch (e) { return reply.code(400).send({ erro: `não consegui ler o arquivo: ${e.message}` }); }
  const token = randomUUID();
  uploads.set(token, { arq, criado: Date.now() });
  const contaId = Number(f.fields?.contaId?.value) || null;
  const conta = contaId ? db.prepare('SELECT perfil_json FROM contas WHERE id = ?').get(contaId) : null;
  let perfil = null, colunas = [], amostra = [];
  if (arq.formato === 'csv') {
    const sugerido = sugerirPerfil(arq.bruto);
    const salvo = conta?.perfil_json ? JSON.parse(conta.perfil_json) : null;
    perfil = salvo && salvo.assinatura === assinatura(arq.bruto, salvo.linhaCabecalho) ? completarPerfil(salvo, sugerido) : sugerido;
    colunas = arq.bruto[perfil.linhaCabecalho] || [];
    amostra = arq.bruto.slice(perfil.linhaCabecalho + 1, perfil.linhaCabecalho + 6);
  }
  const p = previa(arq, perfil);
  return { token, formato: arq.formato, banco: arq.banco || null, nome: arq.nome, perfil, colunas, amostra, bruto: arq.formato === 'csv' ? arq.bruto.slice(0, 15) : [], ...resumoPrevia(p) };
});

// Perfis salvos antes da v0.3 não têm a coluna de detalhe (ex.: Histórico do Inter).
function completarPerfil(salvo, sugerido) {
  if (salvo.colDetalhe === undefined && sugerido.linhaCabecalho === salvo.linhaCabecalho) return { ...salvo, colDetalhe: sugerido.colDetalhe ?? -1 };
  return salvo;
}

function assinatura(bruto, linhaCab) {
  return (bruto[linhaCab] || []).map(h => h.toLowerCase()).join('|');
}

function resumoPrevia(p) {
  const datas = p.linhas.map(l => l.data).sort();
  return {
    total: p.linhas.length,
    saidas: p.linhas.filter(l => l.valor < 0).reduce((s, l) => s - l.valor, 0),
    entradas: p.linhas.filter(l => l.valor > 0).reduce((s, l) => s + l.valor, 0),
    de: datas[0] || null, ate: datas.at(-1) || null,
    exemplos: p.linhas.slice(0, 8),
    erros: p.erros.slice(0, 10), nErros: p.erros.length,
  };
}

app.post('/api/importar/reprevia', async (req, reply) => {
  const { token, perfil } = req.body || {};
  const u = uploads.get(token);
  if (!u) return reply.code(410).send({ erro: 'o upload expirou, envie o arquivo de novo' });
  const p = previa(u.arq, perfil);
  return { colunas: u.arq.bruto?.[perfil.linhaCabecalho] || [], amostra: u.arq.bruto?.slice(perfil.linhaCabecalho + 1, perfil.linhaCabecalho + 6) || [], ...resumoPrevia(p) };
});

app.post('/api/importar/confirmar', async (req, reply) => {
  const { token, contaId, perfil } = req.body || {};
  const u = uploads.get(token);
  if (!u) return reply.code(410).send({ erro: 'o upload expirou, envie o arquivo de novo' });
  const conta = db.prepare('SELECT * FROM contas WHERE id = ?').get(contaId);
  if (!conta) return reply.code(400).send({ erro: 'escolha a conta' });
  const p = previa(u.arq, perfil);
  if (!p.linhas.length) return reply.code(400).send({ erro: 'nenhum lançamento reconhecido com esse mapeamento' });
  if (u.arq.formato === 'csv') {
    db.prepare('UPDATE contas SET perfil_json = ? WHERE id = ?').run(JSON.stringify({ ...perfil, assinatura: assinatura(u.arq.bruto, perfil.linhaCabecalho) }), conta.id);
  }
  const r = importar(db, { contaId: conta.id, linhas: p.linhas, arquivo: u.arq.nome, formato: u.arq.formato, quem: quem(req) });
  uploads.delete(token);
  atualizarHa();
  iaDepoisDeImportar();
  return { ...r, ia: iaDisponivel() && IA.automatica };
});

app.get('/api/importacoes', async () => db.prepare(`SELECT i.*, c.nome AS conta, c.dono FROM importacoes i JOIN contas c ON c.id = i.conta_id
  ORDER BY i.criado_em DESC LIMIT 100`).all());
app.delete('/api/importacoes/:id', async req => {
  const n = transacao(db, () => {
    db.prepare('UPDATE carteira SET lancamento_id = NULL WHERE lancamento_id IN (SELECT id FROM lancamentos WHERE importacao_id = ?)').run(req.params.id);
    const r = db.prepare('DELETE FROM lancamentos WHERE importacao_id = ?').run(req.params.id);
    db.prepare('DELETE FROM importacoes WHERE id = ?').run(req.params.id);
    return r.changes;
  });
  atualizarHa();
  return { removidos: n };
});

app.get('/api/resumo', async req => resumo(db, req.query?.mes || mesAtual()));
app.get('/api/carteira', async () => db.prepare('SELECT * FROM carteira ORDER BY quando DESC LIMIT 200').all());
app.get('/api/meses', async () => db.prepare("SELECT DISTINCT substr(data,1,7) AS mes FROM lancamentos ORDER BY mes DESC").all().map(r => r.mes));

// ---------- front ----------
const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
if (existsSync(PUBLIC)) {
  await app.register(fstatic, { root: PUBLIC, prefix: '/' });
  app.setNotFoundHandler((req, reply) => req.url.startsWith('/api/') ? reply.code(404).send({ erro: 'não encontrado' }) : reply.sendFile('index.html'));
}

// ---------- HA ----------
escutarEvento('financas_compra', ev => { registrarCarteira(db, ev); atualizarHa(); }, app.log);
setInterval(atualizarHa, 30 * 6e4).unref();
// No começo do mês, fecha o anterior com um comentário da IA (se ainda não tiver).
setInterval(() => {
  if (!iaDisponivel()) return;
  const d = new Date(); if (d.getDate() > 3) return;
  const ant = new Date(d.getFullYear(), d.getMonth() - 1, 15);
  const mes = `${ant.getFullYear()}-${String(ant.getMonth() + 1).padStart(2, '0')}`;
  if (db.prepare('SELECT 1 FROM comentarios WHERE mes = ?').get(mes)) return;
  if (!db.prepare('SELECT 1 FROM lancamentos WHERE substr(data,1,7) = ? LIMIT 1').get(mes)) return;
  comentarAgora(mes).catch(e => app.log.warn({ err: e.message }, 'IA: comentário do mês falhou'));
}, 60 * 6e4).unref();
atualizarHa();

// ---------- pasta de entrada ----------
// Cada conta ganha uma subpasta; um CSV/OFX solto ali é importado com o mapeamento salvo da conta.
const slug = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\- ]+/g, '').trim();
async function varrerPasta() {
  if (!PASTA) return;
  try {
    mkdirSync(PASTA, { recursive: true });
    for (const c of db.prepare('SELECT * FROM contas WHERE arquivada = 0').all()) {
      const dir = join(PASTA, slug(`${c.dono} - ${c.nome}`));
      mkdirSync(join(dir, 'importados'), { recursive: true });
      for (const f of readdirSync(dir)) {
        const caminho = join(dir, f);
        if (!/\.(csv|ofx|txt|pdf)$/i.test(f) || !statSync(caminho).isFile()) continue;
        try {
          const arq = await ler(readFileSync(caminho), f);
          const sug = arq.formato === 'csv' ? sugerirPerfil(arq.bruto) : null;
          const perfil = c.perfil_json ? completarPerfil(JSON.parse(c.perfil_json), sug || {}) : sug;
          if (arq.formato === 'csv' && !c.perfil_json && !perfil.preset) {
            app.log.warn(`${f}: conta ${c.nome} ainda sem mapeamento; importe uma vez pelo painel`);
            continue;
          }
          const p = previa(arq, perfil);
          if (p.linhas.length) { importar(db, { contaId: c.id, linhas: p.linhas, arquivo: f, formato: arq.formato, quem: 'pasta' }); iaDepoisDeImportar(); }
          renameSync(caminho, join(dir, 'importados', `${new Date().toISOString().slice(0, 10)}_${basename(f)}`));
          atualizarHa();
        } catch (e) { app.log.error({ err: e.message, f }, 'falha ao importar da pasta'); }
      }
    }
  } catch (e) { app.log.error({ err: e.message }, 'pasta de entrada indisponível'); }
}
setInterval(varrerPasta, 60e3).unref();
varrerPasta();

await app.listen({ port: Number(process.env.PORT || 8099), host: '0.0.0.0' });
