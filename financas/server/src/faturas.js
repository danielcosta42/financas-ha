// Faturas de cartão achadas no e-mail: reconhece o banco, tira valor e vencimento do texto
// (regras primeiro, IA só quando as regras não acham) e concilia com o pagamento no extrato.
import { normaliza } from './parsers.js';

// remetente: domínio/nome que o banco usa; o assunto precisa falar de fatura.
export const BANCOS = [
  { id: 'inter', nome: 'Inter', remetente: /inter\.co\b|bancointer|banco inter/i },
  { id: 'nubank', nome: 'Nubank', remetente: /nubank/i },
  { id: 'itau', nome: 'Itaú', remetente: /itau|ita[uú] ?card|iti\b/i },
  { id: 'bradesco', nome: 'Bradesco', remetente: /bradesco/i },
  { id: 'santander', nome: 'Santander', remetente: /santander/i },
  { id: 'c6', nome: 'C6 Bank', remetente: /c6bank|c6 bank/i },
  { id: 'btg', nome: 'BTG', remetente: /btg/i },
  { id: 'xp', nome: 'XP', remetente: /\bxp(inc|investimentos|\.com)|cartaoxp/i },
  { id: 'mercadopago', nome: 'Mercado Pago', remetente: /mercadopago|mercado pago/i },
  { id: 'picpay', nome: 'PicPay', remetente: /picpay/i },
  { id: 'caixa', nome: 'Caixa', remetente: /caixa\.gov|caixa econ/i },
  { id: 'bb', nome: 'Banco do Brasil', remetente: /bb\.com\.br|banco do brasil/i },
  { id: 'porto', nome: 'Porto Bank', remetente: /portoseguro|porto bank|portobank/i },
  { id: 'neon', nome: 'Neon', remetente: /neon\.com|banco neon/i },
  { id: 'will', nome: 'Will Bank', remetente: /willbank|will bank/i },
  { id: 'pan', nome: 'Banco Pan', remetente: /bancopan|banco pan/i },
  { id: 'sicredi', nome: 'Sicredi', remetente: /sicredi/i },
  { id: 'nomad', nome: 'Nomad', remetente: /nomad/i },
];

const RE_ASSUNTO_FATURA = /fatura/i;
// Assuntos que falam de fatura mas não são a fatura (propaganda, parcelamento, confirmação de pagamento).
const RE_ASSUNTO_NAO = /parcel(e|ar|amento)|antecip|desconto|cashback|oferta|empr[eé]stimo|pagamento (foi )?(recebido|confirmado|realizado)|recebemos (o )?(seu )?pagamento|limite/i;

export function detectarBanco({ remetente = '', assunto = '' }) {
  if (!RE_ASSUNTO_FATURA.test(assunto) || RE_ASSUNTO_NAO.test(assunto)) return null;
  return BANCOS.find(b => b.remetente.test(remetente)) || null;
}

const MESES = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };
const valorBr = s => Number(String(s).replace(/\./g, '').replace(',', '.'));
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

// Sem ano no texto: o vencimento é o próximo dia/mês (aceita até ~45 dias antes do e-mail).
export function completarAno(d, m, ano, recebidoEm) {
  if (ano) return iso(ano < 100 ? 2000 + ano : ano, m, d);
  const ref = new Date(recebidoEm || Date.now());
  let y = ref.getUTCFullYear();
  if (Date.UTC(y, m - 1, d) < ref.getTime() - 45 * 864e5) y++;
  return iso(y, m, d);
}

function dataValida(isoData, recebidoEm) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoData || '')) return false;
  const t = Date.parse(isoData + 'T12:00:00Z');
  if (Number.isNaN(t)) return false;
  const ref = new Date(recebidoEm || Date.now()).getTime();
  return t >= ref - 20 * 864e5 && t <= ref + 70 * 864e5;
}

// Texto do e-mail (corpo em texto puro) → { valor, vencimento, cartao_final }. null onde não achou.
export function extrairResumo(texto, recebidoEm) {
  const plano = String(texto || '').replace(/ /g, ' ').replace(/\s+/g, ' ');
  let valor = null, vencimento = null, cartao_final = null;

  const RS = 'R\\$\\s?([\\d.]+,\\d{2})';
  const padroesValor = [
    new RegExp(`(?:valor|total)(?: total)? (?:da|desta|de sua|da sua|de) fatura(?:(?!R\\$)\\D){0,40}${RS}`, 'i'),
    new RegExp(`fatura(?: atual| fechada| do (?:seu )?cart[aã]o(?:(?!R\\$)\\D){0,30})?(?:(?!R\\$)\\D){0,50}(?:no valor de|é de|e de|total de|de|:)\\s*${RS}`, 'i'),
    new RegExp(`(?:valor a pagar|total a pagar|pagamento total|valor total)(?:(?!R\\$)\\D){0,30}${RS}`, 'i'),
    new RegExp(`fatura(?:(?!R\\$).){0,80}${RS}`, 'i'),
  ];
  for (const re of padroesValor) {
    const m = plano.match(re);
    if (m) { const v = valorBr(m[1]); if (v > 0 && v < 1e6) { valor = v; break; } }
  }

  const venc = plano.match(/venc(?:imento|e|er[aá]|endo|em)?[^0-9]{0,40}?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/i);
  if (venc) vencimento = completarAno(Number(venc[1]), Number(venc[2]), venc[3] ? Number(venc[3]) : null, recebidoEm);
  if (!vencimento || !dataValida(vencimento, recebidoEm)) {
    vencimento = null;
    const ext = normaliza(plano).match(/venc\w*[^0-9]{0,40}?(\d{1,2}) de (jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\w*(?: de (\d{4}))?/);
    if (ext) vencimento = completarAno(Number(ext[1]), MESES[ext[2]], ext[3] ? Number(ext[3]) : null, recebidoEm);
  }
  if (vencimento && !dataValida(vencimento, recebidoEm)) vencimento = null;

  const fin = plano.match(/(?:final|terminado em|\*{2,})\s?(\d{4})\b/i);
  if (fin) cartao_final = fin[1];
  return { valor, vencimento, cartao_final };
}

// Pede para a IA só o que as regras não acharam. Resposta validada; se vier lixo, fica null.
export async function extrairComIa(texto, recebidoEm, gerarTexto, opcoes) {
  const trecho = String(texto || '').replace(/\s+/g, ' ').slice(0, 1800);
  const instr = 'Este é um e-mail de fatura de cartão de crédito. Responda APENAS com JSON no formato '
    + '{"valor":"1234,56","vencimento":"dd/mm/aaaa"}. Use null no que não estiver escrito no e-mail. '
    + 'Não invente números. valor = total a pagar da fatura.\nE-mail: ' + trecho;
  const { texto: resp, origem } = await gerarTexto(instr, { entidade: opcoes.entidade, reserva: opcoes.reserva, tarefa: 'financas_fatura', timeoutMs: 60000 });
  const j = resp.match(/\{[\s\S]*\}/);
  if (!j) return { valor: null, vencimento: null, origem };
  let o; try { o = JSON.parse(j[0]); } catch { return { valor: null, vencimento: null, origem }; }
  // O valor só vale se o número aparecer de fato no e-mail (evita alucinação do modelo pequeno).
  let valor = null;
  const bruto = String(o.valor ?? '').replace(/[^\d.,]/g, '');
  if (bruto) {
    const v = valorBr(bruto.includes(',') ? bruto : bruto.replace('.', ','));
    if (v > 0 && v < 1e6 && trecho.replace(/\./g, '').includes(String(Math.floor(v)))) valor = v;
  }
  let vencimento = null;
  const d = String(o.vencimento || '').match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (d) { vencimento = completarAno(Number(d[1]), Number(d[2]), d[3] ? Number(d[3]) : null, recebidoEm); if (!dataValida(vencimento, recebidoEm)) vencimento = null; }
  return { valor, vencimento, origem };
}

// Conta de cartão que recebe a fatura: tipo cartão, banco (ou nome) bate com o banco do e-mail. Só se houver uma.
export function contaDoBanco(db, banco) {
  if (!banco) return null;
  const alvos = [normaliza(banco.nome), banco.id];
  const cands = db.prepare("SELECT id, nome, banco FROM contas WHERE arquivada = 0 AND tipo = 'cartao'").all()
    .filter(c => { const t = normaliza(`${c.banco || ''} ${c.nome}`); return alvos.some(a => t.includes(a)); });
  return cands.length === 1 ? cands[0].id : null;
}

// Fatura aberta vira paga quando aparece no extrato um pagamento de fatura com o mesmo valor (±1%)
// entre 3 dias antes do e-mail e 7 dias depois do vencimento.
export function conciliarFaturas(db) {
  const abertas = db.prepare("SELECT * FROM faturas WHERE status = 'aberta' AND valor IS NOT NULL").all();
  const busca = db.prepare(`SELECT l.id FROM lancamentos l LEFT JOIN categorias k ON k.id = l.categoria_id
    WHERE l.valor < 0 AND abs(-l.valor - ?) <= ? * 0.01 + 0.01
      AND l.data BETWEEN date(?, '-3 day') AND date(?, '+7 day')
      AND (k.nome = 'Pagamento de fatura' OR lower(l.descricao) LIKE '%fatura%')
      AND l.id NOT IN (SELECT paga_por FROM faturas WHERE paga_por IS NOT NULL)
    ORDER BY l.data LIMIT 1`);
  const marca = db.prepare("UPDATE faturas SET status = 'paga', paga_por = ? WHERE id = ?");
  let n = 0;
  for (const f of abertas) {
    const ini = (f.recebido_em || f.criado_em).slice(0, 10);
    const l = busca.get(f.valor, f.valor, ini, f.vencimento || ini);
    if (l) { marca.run(l.id, f.id); n++; }
  }
  return n;
}

export function listarFaturas(db, { todas = false } = {}) {
  return db.prepare(`SELECT f.*, c.nome AS conta, c.dono FROM faturas f LEFT JOIN contas c ON c.id = f.conta_id
    ${todas ? '' : "WHERE f.status != 'ignorada' AND (f.status = 'aberta' OR f.criado_em >= datetime('now','-120 day'))"}
    ORDER BY CASE f.status WHEN 'aberta' THEN 0 ELSE 1 END, CASE WHEN f.status = 'aberta' THEN COALESCE(f.vencimento, '9999') END, COALESCE(f.vencimento, f.recebido_em) DESC LIMIT 200`).all();
}

// Para o sensor do HA: a próxima a vencer e o total em aberto.
export function resumoFaturas(db, hoje = new Date().toISOString().slice(0, 10)) {
  const abertas = db.prepare("SELECT f.*, c.nome AS conta FROM faturas f LEFT JOIN contas c ON c.id = f.conta_id WHERE f.status = 'aberta' ORDER BY COALESCE(f.vencimento, '9999') , f.recebido_em").all();
  const dias = v => (v ? Math.round((Date.parse(v + 'T12:00:00Z') - Date.parse(hoje + 'T12:00:00Z')) / 864e5) : null);
  const itens = abertas.map(f => ({ id: f.id, banco: f.banco, conta: f.conta, cartao_final: f.cartao_final, valor: f.valor, vencimento: f.vencimento, dias: dias(f.vencimento) }));
  const proxima = itens.find(f => f.dias === null || f.dias >= -5) || null;
  return { proxima, abertas: itens, total: Math.round(itens.reduce((s, f) => s + (f.valor || 0), 0) * 100) / 100 };
}
