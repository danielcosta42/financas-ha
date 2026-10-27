// Faturas em PDF: extrai o texto em linhas (pdfjs) e lê o layout de cada banco.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

// Junta os pedaços de texto que estão na mesma altura; espaço grande vira "   " (separador de coluna).
// Faturas que vêm com senha (muitos bancos usam parte do CPF): tenta sem senha e depois cada senha configurada.
async function abrirPdf(buf, senhas = []) {
  const base = { useSystemFonts: false, isEvalSupported: false, disableFontFace: true, verbosity: 0 };
  let ultimoErro = null;
  for (const password of [undefined, ...senhas.filter(Boolean)]) {
    try { return await getDocument({ ...base, data: new Uint8Array(buf), ...(password ? { password } : {}) }).promise; }
    catch (e) {
      if (e?.name !== 'PasswordException') throw e;
      ultimoErro = e;
    }
  }
  const err = new Error(senhas.length ? 'o PDF tem senha e nenhuma das senhas configuradas abriu' : 'o PDF tem senha: configure em pdf_senhas no add-on');
  err.senha = true; err.causa = ultimoErro;
  throw err;
}

export async function linhasDoPdf(buf, senhas = []) {
  const doc = await abrirPdf(buf, senhas);
  const linhas = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const { items } = await page.getTextContent();
    const porY = [];
    for (const it of items) {
      if (!it.str || !it.str.trim()) continue;
      const y = it.transform[5], x = it.transform[4];
      let l = porY.find(r => Math.abs(r.y - y) < 2.5);
      if (!l) { l = { y, partes: [] }; porY.push(l); }
      l.partes.push({ x, fim: x + (it.width || 0), str: it.str, fs: Math.abs(it.transform[0]) || it.height || 8 });
    }
    porY.sort((a, b) => b.y - a.y);
    for (const l of porY) {
      l.partes.sort((a, b) => a.x - b.x);
      let txt = '', fim = null;
      for (const pt of l.partes) {
        // espaço entre palavras ≈ 0,25 do corpo da fonte; coluna = buraco bem maior
        if (fim !== null) { const gap = pt.x - fim; txt += gap > pt.fs * 1.6 ? '   ' : (gap > pt.fs * 0.12 && !txt.endsWith(' ') && !pt.str.startsWith(' ') ? ' ' : ''); }
        txt += pt.str; fim = pt.fim;
      }
      linhas.push(txt.trim());
    }
    page.cleanup();
  }
  await doc.destroy();
  return linhas;
}

const MESES = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };
const valorBr = s => Number(s.replace(/\./g, '').replace(',', '.'));
const somaMeses = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const ult = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, ult)).padStart(2, '0')}`;
};

// ---------- Inter: fatura do cartão ----------
export const ehFaturaInter = linhas => linhas.some(l => /Despesas da fatura/i.test(l)) && linhas.some(l => /bancointer|inter\.co|BANCO INTER/i.test(l));

// "15 de jun. 2026   APPLE.COM/BILL   -   R$ 29,90"  |  "... + R$ 6.939,18" (crédito)
const RE_LINHA = /^(\d{1,2}) de (jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\.? (\d{4})\s+(.+?)\s+(?:-\s+)?(\+\s*)?R\$\s*([\d.]+,\d{2})$/i;
const RE_PARCELA = /\(Parcela (\d+) de (\d+)\)/i;
const RS = 'R\\$\\s*([\\d.]+,\\d{2})';
// O crédito do pagamento da fatura anterior aparece na lista, mas não abate o total desta fatura.
const ehPagamento = d => /pagto|pagamento/i.test(d);
const brl = v => `R$ ${v.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+,)/g, '.')}`;
const centavos = v => Math.round(v * 100) / 100;

export function lerFaturaInter(linhas) {
  const saida = [], erros = [], avisos = [];
  let cartao = null, vencimento = null;
  // Totais impressos, do mais confiável para o menos; o primeiro que existir vale.
  const impresso = { cartoes: {}, cabecalho: null, fatura: null, despesas: null };
  const somas = {}; // por cartão: compras e créditos que não são pagamento
  linhas.forEach((l, i) => {
    const tc = l.match(new RegExp(`^Total CART[ÃA]O\\s+\\d{4}\\*+(\\d{4})\\s+${RS}`, 'i'));
    if (tc) { impresso.cartoes[tc[1]] = valorBr(tc[2]); return; }
    const c = l.match(/^CART[ÃA]O\s+\d{4}\*+(\d{4})/i);
    if (c) { cartao = c[1]; return; }
    if (!vencimento) { const v = l.match(/Data de Vencimento\s+(\d{2})\/(\d{2})\/(\d{4})/i) || l.match(/\*{4}\d{4}\s+(\d{2})\/(\d{2})\/(\d{4})/); if (v) vencimento = `${v[3]}-${v[2]}-${v[1]}`; }
    if (impresso.cabecalho === null) { const t = l.match(new RegExp(`\\*{4}\\d{4}\\s+\\d{2}/\\d{2}/\\d{4}\\s+${RS}`)); if (t) impresso.cabecalho = valorBr(t[1]); }
    // Só na mesma linha: no layout atual a linha de baixo é o limite de crédito, não o total.
    if (impresso.fatura === null) { const t = l.match(new RegExp(`total (?:da|desta) (?:sua )?fatura\\s+(?:-\\s+)?${RS}`, 'i')); if (t) impresso.fatura = valorBr(t[1]); }
    if (impresso.despesas === null) { const t = l.match(new RegExp(`^Despesas do m[êe]s\\s+${RS}`, 'i')); if (t) impresso.despesas = valorBr(t[1]); }
    const m = l.match(RE_LINHA);
    if (!m) {
      if (/^\d{1,2} de [a-z]{3}\.? \d{4}/i.test(l)) erros.push({ linha: i + 1, conteudo: l });
      return;
    }
    const [, d, mes, ano, desc0, credito, val] = m;
    let data = `${ano}-${String(MESES[mes.toLowerCase()]).padStart(2, '0')}-${d.padStart(2, '0')}`;
    const descricao = desc0.replace(/\s+-$/, '').replace(/\s{2,}/g, ' ').trim();
    // Parcelada: o PDF traz a data da compra; a parcela N cai N-1 meses depois (é quando pesa no caixa).
    const p = descricao.match(RE_PARCELA);
    if (p && Number(p[1]) > 1) data = somaMeses(data, Number(p[1]) - 1);
    const valor = credito ? valorBr(val) : -valorBr(val);
    const s = somas[cartao] ||= { compras: 0, creditos: 0 };
    if (!credito) s.compras += valorBr(val);
    else if (!ehPagamento(descricao)) s.creditos += valorBr(val);
    saida.push({ data, descricao, detalhe: [cartao ? `Cartão final ${cartao}` : null, p ? `parcela ${Number(p[1])}/${Number(p[2])}` : null].filter(Boolean).join(' · ') || null, valor, id_externo: null });
  });

  // Conferência: o que li de cada cartão tem que bater com o total que o banco imprimiu.
  for (const [final, total] of Object.entries(impresso.cartoes)) {
    const s = somas[final] || { compras: 0, creditos: 0 };
    if (Math.abs(s.compras - total) > 0.01 && Math.abs(s.compras - s.creditos - total) > 0.01) {
      avisos.push(`Cartão final ${final}: os lançamentos lidos somam ${brl(centavos(s.compras - s.creditos))}, mas a fatura diz ${brl(total)}`);
    }
  }
  // Cartão com lançamentos e sem "Total CARTÃO" lido: a soma dos totais por cartão ficaria incompleta.
  const semTotal = Object.keys(somas).filter(c => !(c in impresso.cartoes));
  if (Object.keys(impresso.cartoes).length) {
    for (const c of semTotal) avisos.push(`${c === 'null' ? 'Lançamentos sem cartão identificado' : `Cartão final ${c}`}: não achei o total impresso para conferir`);
  }
  if (erros.length) avisos.push(`${erros.length} linha(s) com data que não consegui ler`);

  const porCartao = Object.values(impresso.cartoes);
  const conferido = porCartao.length > 0 && !semTotal.length;
  let total = conferido ? centavos(porCartao.reduce((a, v) => a + v, 0)) : impresso.cabecalho ?? impresso.fatura ?? impresso.despesas;
  const totalImpresso = total != null;
  if (!totalImpresso && saida.length) {
    const todas = Object.values(somas);
    total = centavos(todas.reduce((a, s) => a + s.compras - s.creditos, 0));
  }
  return { linhas: saida, erros, avisos, vencimento, total: total ?? null, totalImpresso, conferido, cartao };
}

// Ponto de entrada: devolve { formato:'pdf', linhas, banco } ou lança erro legível.
export async function lerPdf(buf, { senhas = [] } = {}) {
  const linhas = await linhasDoPdf(buf, senhas);
  if (!linhas.length) throw new Error('o PDF não tem texto (é uma imagem escaneada?)');
  if (ehFaturaInter(linhas)) {
    const r = lerFaturaInter(linhas);
    if (!r.linhas.length) throw new Error('reconheci a fatura do Inter, mas não achei lançamentos');
    return { formato: 'pdf', banco: 'Inter · fatura do cartão', ...r };
  }
  const e = new Error('por enquanto só leio PDF da fatura do cartão Inter; para outros bancos use CSV ou OFX');
  e.desconhecido = true; e.texto = linhas.join('\n');
  throw e;
}
