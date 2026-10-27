// Avisos de transação que os bancos mandam por e-mail (compra aprovada, Pix, transferência, pagamento).
// Viram registros pendentes na carteira até o extrato chegar. Regras primeiro; IA só quando falta o valor.
import { lerValor, valorNoTexto } from './parsers.js';

const RE_TRANSACAO = /compra|\bpix\b|transfer[eê]ncia|\bted\b|\bdoc\b|saque|transa[cç][aã]o|d[eé]bito autom[aá]tico|pagamento|boleto|comprovante|voc[eê] (?:recebeu|enviou|fez|pagou)|estorn|reembolso|devolu|devolvid|dep[oó]sito/i;
// Banco também manda propaganda com essas palavras ("Pix no crédito: pague em 12x"): o assunto tem que dizer que aconteceu.
const RE_FEITO = /aprovad|realizad|enviad|recebid|efetuad|conclu[ií]d|confirmad|\bpag[oa]\b|estornad|estorno|devolvid|reembolsad|comprovante|voc[eê] (?:recebeu|enviou|fez|pagou)/i;
// Propaganda, fatura (tem fluxo próprio) e o que não chegou a acontecer.
const RE_NAO = /fatura|oferta|promo|cashback|desconto|limite|convite|novidade|empr[eé]stimo|pr[eé]-aprovad|investi|cupom|pontos|parcele|parcelamento|agendad|agendament|antecip|cancelad|recusad|negad|bloquead|suspeit|insuficiente|ganhe|fgts|anivers|n[aã]o (?:foi )?(?:aprovad|autorizad|realizad|conclu[ií]d|efetuad|enviad|processad)|recebemos (?:o |seu )?pagamento/i;

export const ehTransacao = assunto => RE_TRANSACAO.test(assunto) && RE_FEITO.test(assunto) && !RE_NAO.test(assunto);

const RS = 'R\\$\\s?-?\\s?([\\d.]+,\\d{2})';
const RE_ENTRADA = /recebeu|recebid[oa]|recebimento|cr[eé]dito em (?:sua )?conta|caiu na (?:sua )?conta|estorn|devolu[cç][aã]o|devolvid|reembolso|dep[oó]sito/i;
const RE_SAIDA = /envi(?:ad|ou)|compra|pagamento|pagou|saque|d[eé]bito|transfer[eê]ncia realizada|voc[eê] fez/i;

// Rótulos do comprovante; a contraparte depende do sentido (quem recebeu numa saída, quem pagou numa entrada).
const ROTULOS_SAIDA = ['estabelecimento', 'loja', 'local', 'comerciante', 'destinat[aá]rio', 'favorecido', 'recebedor', 'nome do recebedor', 'benefici[aá]rio', 'quem recebeu', 'para'];
const ROTULOS_ENTRADA = ['pagador', 'remetente', 'origem', 'quem enviou', 'quem pagou', 'de'];

const isoLocal = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 19);
const limpa = s => s.replace(/\s{2,}/g, ' ').replace(/[\s.,;:-]+$/, '').trim().slice(0, 60);

// Texto (assunto + corpo) → { valor, entrada, descricao, cartao_final, quando }. valor null quando não achou.
export function extrairTransacao(assunto, texto, recebidoEm) {
  const corpo = String(texto || '').replace(/ /g, ' ');
  const plano = `${assunto}\n${corpo}`.replace(/\s+/g, ' ');

  let valor = null, fim = 0; // fim: onde termina o valor achado, para ler o parcelamento colado nele
  const preferidos = [
    new RegExp(`(?:valor(?: da compra| do pix| da transfer[eê]ncia| do pagamento| da transa[cç][aã]o| total)?|no valor de|quantia)\\s*:?\\s*(?:de\\s*)?${RS}`, 'i'),
    new RegExp(`(?:compra|pix|transfer[eê]ncia|pagamento|saque|ted|d[eé]bito|recebeu|enviou|fez|pagou)(?:(?!R\\$|limite|saldo|dispon).){0,60}${RS}`, 'i'),
  ];
  for (const re of preferidos) { const m = plano.match(re); if (m) { valor = lerValor(m[1], ','); fim = m.index + m[0].length; break; } }
  if (valor === null) {
    for (const m of plano.matchAll(new RegExp(RS, 'gi'))) {
      if (/limite|saldo|dispon[ií]vel|cashback|tarifa|anuidade/i.test(plano.slice(Math.max(0, m.index - 40), m.index))) continue;
      valor = lerValor(m[1], ','); fim = m.index + m[0].length; break;
    }
  }
  // Parcelada: o extrato/fatura só mostra a parcela, então é ela que fica pendente (senão o total nunca concilia).
  // Só o parcelamento colado no valor ("R$ 1.200,00 em 10x de R$ 120,00", "(10x de …)", "dividida em 10x") ou
  // o rótulo do comprovante ("Parcelas: 10x de R$ 120,00"); rodapé de propaganda não conta.
  // Sem flag i de propósito: "em 3X SPORTS" é nome de loja (maiúsculas depois do X), "10x de R$" é parcela.
  const parc = !/\bpix\b|transfer|\bted\b/i.test(assunto) && valor && (
    plano.slice(fim, fim + 50).match(new RegExp(`^[\\s,(:–-]*(?:[Pp]arcelad[ao]\\s+|[Dd]ividid[ao]\\s+)?(?:[Ee][Mm]\\s+)?(\\d{1,2})\\s?(?:[xX]|[Vv]ezes|VEZES|[Pp]arcelas|PARCELAS)\\b(?![ \\t]+(?!(?:DE|NO|NA|SEM|COM|EM|PARA|PELO)\\b)[A-Z]{2})(?:\\s?(?:[Dd][Ee]\\s?)?${RS})?`))
    // "Parcela: 3/10" ou "3 de 10" diz qual parcela é, não quantas: fica de fora.
    || corpo.match(new RegExp(`^[ \\t]*parcelas[ \\t]*[:\\t]?[ \\t]*(\\d{1,2})(?![ \\t]*(?:\\/|de[ \\t]*\\d))[ \\t]?x?\\b(?:[ \\t]*de[ \\t]*${RS})?`, 'im')));
  if (parc && Number(parc[1]) > 1) valor = parc[2] ? lerValor(parc[2], ',') : Math.round(valor / Number(parc[1]) * 100) / 100;
  if (!(valor > 0)) valor = null;

  // Sentido: o assunto decide; corpo só quando o assunto é neutro ("Comprovante").
  const entrada = RE_ENTRADA.test(assunto) || (!RE_SAIDA.test(assunto) && RE_ENTRADA.test(corpo.slice(0, 400)) && !RE_SAIDA.test(corpo.slice(0, 400)));

  let descricao = null;
  for (const r of entrada ? ROTULOS_ENTRADA : ROTULOS_SAIDA) {
    const m = corpo.match(new RegExp(`^[ \\t]*${r}[ \\t]*(?::|\\t)[ \\t]*([^\\t\\n]{2,60}?)[ \\t]*$`, 'im'))
      || corpo.match(new RegExp(`^[ \\t]*${r}[ \\t]*:?[ \\t]*\\n[ \\t]*([^\\t\\n]{2,60}?)[ \\t]*$`, 'im'));
    if (m && /[a-z]{2}/i.test(m[1])) { descricao = limpa(m[1]); break; }
  }
  if (!descricao) {
    // "compra de R$ 50,00 em PADARIA X" (nome em maiúsculas) · "Pix para Fulano" · "Pix de Fulano"
    const m = plano.match(/\bem (?!\d{1,2}\/)([A-Z0-9][A-Z0-9 *&.'/-]{2,40}?)(?= em| no dia | dia | às | as |, |\. | foi | aprovad|$)/)
      || plano.match(entrada ? /\b(?:de|por) ([A-ZÀ-Ú][\wÀ-ú.' -]{2,50}?)(?= no valor| de R\$| em \d| às|, |\. | foi |$)/ : /\bpara ([A-ZÀ-Ú][\wÀ-ú.' -]{2,50}?)(?= no valor| de R\$| em \d| às|, |\. | foi |$)/);
    if (m) descricao = limpa(m[1]);
  }

  const fin = plano.match(/(?:final|terminado em|\*{2,})\s?(\d{4})\b/i);

  // Data/hora da transação; sem ano usa o do e-mail. Fora de [-10 dias, +1 dia] do recebimento, vale o recebimento.
  const recebido = new Date(recebidoEm || Date.now());
  let quando = isoLocal(recebido);
  const dh = plano.match(/\b(\d{2})\/(\d{2})(?:\/(\d{4}|\d{2}))?(?:,?\s*(?:às|as|-)?\s*(\d{1,2})[:h](\d{2}))?/);
  if (dh) {
    const [, d, m, a, h, mi] = dh;
    let ano = a ? (a.length === 2 ? 2000 + Number(a) : Number(a)) : recebido.getFullYear();
    if (!a && new Date(ano, m - 1, d) > recebido.getTime() + 864e5) ano--;
    const t = new Date(ano, m - 1, d, h ? Number(h) : 12, mi ? Number(mi) : 0);
    if (t.getDate() === Number(d) && t >= recebido.getTime() - 10 * 864e5 && t <= recebido.getTime() + 864e5) quando = isoLocal(t);
  }

  return { valor, entrada, descricao: descricao || limpa(assunto) || null, cartao_final: fin ? fin[1] : null, quando };
}

// IA só para o valor (e sentido/descrição de quebra); o valor só vale se o número aparecer no e-mail.
export async function extrairTransacaoComIa(texto, gerarTexto, opcoes) {
  const trecho = String(texto || '').replace(/\s+/g, ' ').slice(0, 1800);
  const instr = 'Este é um e-mail de banco avisando de uma transação. Responda APENAS com JSON no formato '
    + '{"valor":"123,45","sentido":"saida","descricao":"nome da loja ou da pessoa"}. sentido é "entrada" quando o dinheiro entrou na conta. '
    + 'Use null no que não estiver escrito. Não invente números.\nE-mail: ' + trecho;
  const { texto: resp } = await gerarTexto(instr, { entidade: opcoes.entidade, reserva: opcoes.reserva, tarefa: 'financas_transacao', timeoutMs: 60000 });
  const j = resp.match(/\{[\s\S]*\}/);
  let o = {};
  try { o = j ? JSON.parse(j[0]) : {}; } catch { /* resposta fora do formato */ }
  const bruto = String(o.valor ?? '').replace(/[^\d.,]/g, '');
  const v = bruto ? lerValor(bruto.includes(',') ? bruto : bruto.replace('.', ','), ',') : null;
  const valor = v > 0 && v < 1e6 && valorNoTexto(v, trecho) ? v : null;
  return { valor, entrada: o.sentido === 'entrada', descricao: typeof o.descricao === 'string' && o.descricao.trim() ? limpa(o.descricao) : null };
}
