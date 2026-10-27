// Lê a caixa de e-mail por IMAP (somente leitura): faturas de cartão e avisos de transação dos bancos.
// Nada é marcado, movido ou apagado no e-mail: o add-on só lê.
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bancoDoRemetente, detectarBanco, extrairResumo, extrairComIa, contaDoBanco, conciliarFaturas, hojeLocal } from './faturas.js';
import { ehTransacao, extrairTransacao, extrairTransacaoComIa } from './transacoes.js';
import { importar, registrarCarteira } from './servico.js';

export const estadoEmail = { configurado: false, rodando: false, historico: false, ultima: null, ultimaOk: null, erro: null, vistos: 0, novas: 0, transacoes: 0, feitos: 0, total: 0 };

// Carga do histórico: filtra pelo assunto no servidor para não baixar o envelope da caixa inteira.
// Palavras inteiras (o Gmail não acha pedaço de palavra), com e sem acento; o resto quem decide são as regras.
const PALAVRAS_ASSUNTO = ['fatura', 'faturas', 'compra', 'compras', 'pix', 'transferência', 'transferencia', 'transferências', 'ted', 'saque',
  'transação', 'transacao', 'débito', 'debito', 'pagamento', 'pagamentos', 'boleto', 'comprovante', 'recebeu', 'enviou', 'pagou',
  'estorno', 'reembolso', 'depósito', 'deposito'];

const slugArq = s => String(s || 'fatura').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '-').slice(0, 60);

// Sem parte em texto puro: quebra de linha nos blocos e tab entre células, para as regras acharem "Rótulo: valor".
export function textoDoEmail(msg) {
  if (msg.text?.trim()) return msg.text;
  return String(msg.html || '')
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(?:p|div|tr|li|h\d|table)>/gi, '\n').replace(/<\/t[dh]>/gi, '\t').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/ {2,}/g, ' ');
}

// cfg: { servidor, porta, usuario, senha, pasta, dias, senhasPdf, pastaPdf }, ia: { entidade, reserva, gerarTexto } | null
// historico: carga inicial — a caixa inteira, sem limite de dias.
export async function verificarEmail(db, cfg, { ia = null, log, aoMudar, historico = false } = {}) {
  estadoEmail.configurado = Boolean(cfg.usuario && cfg.senha);
  if (!estadoEmail.configurado) { estadoEmail.erro = null; return estadoEmail; }
  if (estadoEmail.rodando) return estadoEmail;
  Object.assign(estadoEmail, { rodando: true, historico, novas: 0, transacoes: 0, feitos: 0, total: 0 });
  const inicioDaCarga = db.prepare("SELECT datetime('now') AS t").get().t;
  const cliente = new ImapFlow({
    host: cfg.servidor || 'imap.gmail.com', port: Number(cfg.porta) || 993, secure: cfg.seguro !== false,
    auth: { user: cfg.usuario, pass: cfg.senha }, logger: false, socketTimeout: 60000,
  });
  const visto = db.prepare('SELECT 1 FROM emails_vistos WHERE mensagem_id = ? UNION SELECT 1 FROM faturas WHERE mensagem_id = ?');
  const marcarVisto = db.prepare('INSERT OR IGNORE INTO emails_vistos (mensagem_id) VALUES (?)');
  try {
    await cliente.connect();
    const lock = await cliente.getMailboxLock(cfg.pasta || 'INBOX', { readOnly: true });
    try {
      // Na primeira leitura olha email_dias para trás; depois, só desde a última leitura (com folga). Histórico: tudo.
      const inicio = Date.now() - (Number(cfg.dias) || 60) * 864e5;
      const desde = new Date(estadoEmail.ultimaOk ? Math.max(inicio, Date.parse(estadoEmail.ultimaOk) - 2 * 864e5) : inicio);
      const busca = historico ? { or: PALAVRAS_ASSUNTO.map(subject => ({ subject })) } : { since: desde };
      const uids = await cliente.search(busca, { uid: true }) || [];
      // Envelopes em lote (o fetch precisa terminar antes de baixar qualquer corpo); só e-mail de banco segue.
      const deBanco = [];
      if (uids.length) {
        for await (const m of cliente.fetch(uids, { envelope: true }, { uid: true })) {
          const remetente = (m.envelope?.from || []).map(f => `${f.name || ''} <${f.address || ''}>`).join(', ');
          const banco = bancoDoRemetente(remetente);
          if (banco) deBanco.push({ uid: m.uid, env: m.envelope, remetente, banco });
        }
      }
      estadoEmail.total = deBanco.length;
      for (const { uid, env, remetente, banco } of deBanco) {
        estadoEmail.feitos++;
        const mid = env.messageId || `uid:${uid}`;
        if (visto.get(mid, mid)) continue;
        estadoEmail.vistos++;
        const assunto = env.subject || '';
        const fatura = Boolean(detectarBanco({ remetente, assunto }));
        if (!fatura && !ehTransacao(assunto)) { marcarVisto.run(mid); continue; }

        const { content } = await cliente.download(uid, undefined, { uid: true });
        const msg = await simpleParser(content);
        const recebido = (msg.date || env.date || new Date()).toISOString();
        const texto = textoDoEmail(msg);
        // No histórico a IA fica só para faturas: centenas de avisos antigos levariam horas no modelo local.
        const lido = { db, cfg, ia: historico && !fatura ? null : ia, log, banco, assunto, texto, recebido, mid, remetente, msg };
        if (fatura) {
          const f = await lerFatura(lido);
          estadoEmail.novas++;
          aoMudar?.(f);
        } else if (await lerTransacao(lido)) estadoEmail.transacoes++;
        marcarVisto.run(mid);
      }
    } finally { lock.release(); }
    await cliente.logout();
    estadoEmail.erro = null;
    estadoEmail.ultimaOk = new Date().toISOString();
  } catch (e) {
    estadoEmail.erro = e.authenticationFailed || /auth/i.test(e.message) ? 'o e-mail recusou o login: confira o usuário e a senha de app' : e.message;
    log?.warn({ err: e.message }, 'falha ao ler o e-mail');
    try { cliente.close(); } catch { /* já fechado */ }
  } finally {
    conciliarFaturas(db);
    // Fatura antiga que veio da carga e não achou o pagamento no extrato: já foi paga, não é dívida em aberto.
    if (historico) {
      db.prepare(`UPDATE faturas SET status = 'paga' WHERE status = 'aberta' AND criado_em >= ? AND vencimento < date(?, '-5 day')`)
        .run(inicioDaCarga, hojeLocal());
    }
    estadoEmail.rodando = false;
    estadoEmail.ultima = new Date().toISOString();
  }
  return estadoEmail;
}

async function lerFatura({ db, cfg, ia, log, banco, assunto, texto, recebido, mid, remetente, msg }) {
  let { valor, vencimento, cartao_final } = extrairResumo(`${assunto}\n${texto}`, recebido);
  let origem = valor ? 'regra' : null;
  const conta_id = contaDoBanco(db, banco);
  let importacao_id = null, pdfSalvo = null, erro = null;

  // PDF anexo: guarda uma cópia e, se for um banco que eu sei ler, importa os lançamentos.
  for (const a of msg.attachments || []) {
    if (!/pdf/i.test(a.contentType) && !/\.pdf$/i.test(a.filename || '')) continue;
    if (cfg.pastaPdf) {
      try {
        mkdirSync(cfg.pastaPdf, { recursive: true });
        pdfSalvo = join(cfg.pastaPdf, `${recebido.slice(0, 10)}_${slugArq(banco.id)}_${slugArq(a.filename)}`);
        writeFileSync(pdfSalvo, a.content);
      } catch (e) { log?.warn({ err: e.message }, 'não consegui guardar o PDF da fatura'); pdfSalvo = null; }
    }
    try {
      const { lerPdf } = await import('./pdf.js');
      const r = await lerPdf(a.content, { senhas: cfg.senhasPdf || [] });
      // O total impresso no PDF ganha do valor achado no texto do e-mail; a estimativa só tapa buraco.
      if (r.total && (r.totalImpresso || !valor)) { valor = r.total; origem = 'pdf'; }
      if (!vencimento && r.vencimento) vencimento = r.vencimento;
      if (!cartao_final && r.cartao) cartao_final = r.cartao;
      if (r.avisos?.length) erro = r.avisos.join('; ');
      if (conta_id && r.linhas?.length) {
        importacao_id = importar(db, { contaId: conta_id, linhas: r.linhas, arquivo: a.filename || 'fatura.pdf', formato: 'pdf', quem: 'e-mail' }).importacaoId;
      }
    } catch (e) { if (!e.desconhecido) erro = e.message; }
  }

  // Ainda faltando valor ou vencimento: pergunta para a IA local.
  if ((!valor || !vencimento) && ia && texto.trim()) {
    try {
      const r = await extrairComIa(`${assunto}\n${texto}`, recebido, ia.gerarTexto, ia);
      if (!valor && r.valor) { valor = r.valor; origem = 'ia'; }
      if (!vencimento && r.vencimento) vencimento = r.vencimento;
    } catch (e) { log?.warn({ err: e.message }, 'IA: não leu a fatura'); }
  }
  if (!valor && !vencimento && !erro) erro = 'não achei valor nem vencimento no e-mail';
  db.prepare(`INSERT OR IGNORE INTO faturas (mensagem_id, banco, remetente, assunto, recebido_em, valor, vencimento, cartao_final, origem_valor, conta_id, importacao_id, pdf, erro)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(mid, banco.nome, remetente, assunto, recebido, valor, vencimento, cartao_final, origem, conta_id, importacao_id, pdfSalvo, erro);
  return { banco: banco.nome, valor, vencimento, cartao_final, conta_id, importada: Boolean(importacao_id) };
}

// Aviso de transação → pendente na carteira. Devolve true se registrou.
async function lerTransacao({ db, ia, log, banco, assunto, texto, recebido }) {
  let t = extrairTransacao(assunto, texto, recebido);
  if (!t.valor && ia && texto.trim()) {
    try {
      const r = await extrairTransacaoComIa(`${assunto}\n${texto}`, ia.gerarTexto, ia);
      if (r.valor) t = { ...t, valor: r.valor, entrada: r.entrada, descricao: r.descricao || t.descricao };
    } catch (e) { log?.warn({ err: e.message }, 'IA: não leu o aviso de transação'); }
  }
  if (!t.valor) { log?.info({ assunto }, 'aviso de transação sem valor reconhecível'); return false; }
  return Boolean(registrarCarteira(db, { valor: t.valor, entrada: t.entrada, loja: t.descricao, cartao: t.cartao_final, quando: t.quando, origem: 'email', banco: banco.nome }));
}
