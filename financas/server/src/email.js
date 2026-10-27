// Lê a caixa de e-mail por IMAP (somente leitura) atrás de faturas de cartão.
// Nada é marcado, movido ou apagado no e-mail: o add-on só lê.
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectarBanco, extrairResumo, extrairComIa, contaDoBanco, conciliarFaturas } from './faturas.js';
import { importar } from './servico.js';

export const estadoEmail = { configurado: false, rodando: false, ultima: null, erro: null, vistos: 0, novas: 0 };

const slugArq = s => String(s || 'fatura').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '-').slice(0, 60);

// cfg: { servidor, porta, usuario, senha, pasta, dias, senhasPdf, pastaPdf }, ia: { entidade, reserva, gerarTexto } | null
export async function verificarEmail(db, cfg, { ia = null, log, aoMudar } = {}) {
  estadoEmail.configurado = Boolean(cfg.usuario && cfg.senha);
  if (!estadoEmail.configurado) { estadoEmail.erro = null; return estadoEmail; }
  if (estadoEmail.rodando) return estadoEmail;
  estadoEmail.rodando = true;
  estadoEmail.novas = 0;
  const cliente = new ImapFlow({
    host: cfg.servidor || 'imap.gmail.com', port: Number(cfg.porta) || 993, secure: cfg.seguro !== false,
    auth: { user: cfg.usuario, pass: cfg.senha }, logger: false, socketTimeout: 60000,
  });
  const visto = db.prepare('SELECT 1 FROM emails_vistos WHERE mensagem_id = ? UNION SELECT 1 FROM faturas WHERE mensagem_id = ?');
  const marcarVisto = db.prepare('INSERT OR IGNORE INTO emails_vistos (mensagem_id) VALUES (?)');
  const ins = db.prepare(`INSERT OR IGNORE INTO faturas (mensagem_id, banco, remetente, assunto, recebido_em, valor, vencimento, cartao_final, origem_valor, conta_id, importacao_id, pdf, erro)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  try {
    await cliente.connect();
    const lock = await cliente.getMailboxLock(cfg.pasta || 'INBOX', { readOnly: true });
    try {
      const desde = new Date(Date.now() - (Number(cfg.dias) || 60) * 864e5);
      const uids = await cliente.search({ since: desde, subject: 'fatura' }, { uid: true }) || [];
      for (const uid of uids) {
        const env = await cliente.fetchOne(uid, { envelope: true }, { uid: true });
        const mid = env?.envelope?.messageId || `uid:${uid}`;
        if (visto.get(mid, mid)) continue;
        estadoEmail.vistos++;
        const remetente = (env.envelope.from || []).map(f => `${f.name || ''} <${f.address || ''}>`).join(', ');
        const assunto = env.envelope.subject || '';
        const banco = detectarBanco({ remetente, assunto });
        if (!banco) { marcarVisto.run(mid); continue; }

        const { content } = await cliente.download(uid, undefined, { uid: true });
        const msg = await simpleParser(content);
        const recebido = (msg.date || env.envelope.date || new Date()).toISOString();
        const texto = msg.text || (msg.html ? msg.html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ') : '');
        let { valor, vencimento, cartao_final } = extrairResumo(`${assunto}\n${texto}`, recebido);
        let origem = valor && vencimento ? 'regra' : null;
        let conta_id = contaDoBanco(db, banco), importacao_id = null, pdfSalvo = null, erro = null;

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
            if (!valor && r.total) { valor = r.total; origem = 'pdf'; }
            if (!vencimento && r.vencimento) { vencimento = r.vencimento; origem = origem || 'pdf'; }
            if (!cartao_final && r.cartao) cartao_final = r.cartao;
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
            if (!vencimento && r.vencimento) { vencimento = r.vencimento; origem = origem || 'ia'; }
          } catch (e) { log?.warn({ err: e.message }, 'IA: não leu a fatura'); }
        }
        if (!valor && !vencimento && !erro) erro = 'não achei valor nem vencimento no e-mail';
        ins.run(mid, banco.nome, remetente, assunto, recebido, valor, vencimento, cartao_final, origem, conta_id, importacao_id, pdfSalvo, erro);
        estadoEmail.novas++;
        aoMudar?.({ banco: banco.nome, valor, vencimento, cartao_final, importada: Boolean(importacao_id) });
      }
    } finally { lock.release(); }
    await cliente.logout();
    estadoEmail.erro = null;
  } catch (e) {
    estadoEmail.erro = e.authenticationFailed || /auth/i.test(e.message) ? 'o e-mail recusou o login: confira o usuário e a senha de app' : e.message;
    log?.warn({ err: e.message }, 'falha ao ler o e-mail');
    try { cliente.close(); } catch { /* já fechado */ }
  } finally {
    conciliarFaturas(db);
    estadoEmail.rodando = false;
    estadoEmail.ultima = new Date().toISOString();
  }
  return estadoEmail;
}
