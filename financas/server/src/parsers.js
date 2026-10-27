// Leitura de extratos: OFX e CSV, com detecção de formato, colunas e presets de bancos.

export function decodificar(buf) {
  let txt = new TextDecoder('utf-8').decode(buf);
  if (txt.includes('�')) txt = new TextDecoder('latin1').decode(buf);
  return txt.replace(/^﻿/, '');
}

export function ehOfx(txt) {
  return /<OFX>/i.test(txt) || /OFXHEADER/i.test(txt.slice(0, 400));
}

// ---------- OFX ----------
function tag(bloco, nome) {
  const m = bloco.match(new RegExp(`<${nome}>([^<\\r\\n]*)`, 'i'));
  return m ? m[1].trim() : '';
}

export function lerOfx(txt) {
  const linhas = [];
  const blocos = txt.split(/<STMTTRN>/i).slice(1);
  for (const b0 of blocos) {
    const b = b0.split(/<\/STMTTRN>/i)[0];
    const dt = tag(b, 'DTPOSTED');
    const valor = Number(tag(b, 'TRNAMT').replace(',', '.'));
    const memo = tag(b, 'MEMO');
    const nome = tag(b, 'NAME');
    const descricao = [nome, memo].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' — ') || 'Sem descrição';
    if (!dt || Number.isNaN(valor)) continue;
    linhas.push({
      data: `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}`,
      descricao,
      valor,
      id_externo: tag(b, 'FITID') || null,
    });
  }
  return linhas;
}

// ---------- CSV ----------
export function detectarDelimitador(txt) {
  const amostra = txt.split(/\r?\n/).slice(0, 10).join('\n');
  const conta = d => (amostra.match(new RegExp(d === '|' ? '\\|' : d, 'g')) || []).length;
  return [';', ',', '\t', '|'].sort((a, b) => conta(b) - conta(a))[0];
}

export function lerCsvBruto(txt, delim) {
  const linhas = [];
  let campo = '', linha = [], aspas = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (aspas) {
      if (c === '"' && txt[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === delim) { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && txt[i + 1] === '\n') i++;
      linha.push(campo); campo = '';
      if (linha.some(v => v.trim() !== '')) linhas.push(linha.map(v => v.trim()));
      linha = [];
    } else campo += c;
  }
  linha.push(campo);
  if (linha.some(v => v.trim() !== '')) linhas.push(linha.map(v => v.trim()));
  return linhas;
}

const normaliza = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Presets reconhecidos pelo cabeçalho. Colunas por nome normalizado.
export const PRESETS = [
  {
    id: 'nubank-cartao', nome: 'Nubank · cartão',
    casa: h => h.join(',') === 'date,title,amount',
    perfil: { colData: 'date', colDescricao: 'title', colValor: 'amount', formatoData: 'yyyy-mm-dd', decimal: '.', inverterSinal: true },
  },
  {
    id: 'nubank-conta', nome: 'Nubank · conta',
    casa: h => h.includes('identificador') && h.includes('descricao') && h.includes('valor') && h.includes('data'),
    perfil: { colData: 'data', colDescricao: 'descricao', colValor: 'valor', colId: 'identificador', formatoData: 'dd/mm/yyyy', decimal: 'auto', inverterSinal: false },
  },
  {
    // Inter conta: "Data Lançamento;Histórico;Descrição;Valor;Saldo" (cabeçalho na linha 5).
    id: 'inter-conta', nome: 'Inter · conta',
    casa: h => h.includes('data lancamento') && h.includes('historico') && h.includes('descricao') && h.includes('valor'),
    perfil: { colData: 'data lancamento', colDescricao: 'descricao', colDetalhe: 'historico', colValor: 'valor', formatoData: 'dd/mm/yyyy', decimal: ',', inverterSinal: false },
  },
  {
    // Inter cartão: "Data;Lançamento;Categoria;Tipo;Valor" — compra vem positiva.
    id: 'inter-cartao', nome: 'Inter · cartão',
    casa: h => h.includes('data') && h.includes('lancamento') && h.includes('tipo') && h.includes('valor'),
    perfil: { colData: 'data', colDescricao: 'lancamento', colDetalhe: 'tipo', colValor: 'valor', formatoData: 'dd/mm/yyyy', decimal: ',', inverterSinal: true },
  },
];

const PALAVRAS = {
  data: ['data lancamento', 'data de lancamento', 'data', 'date', 'dt'],
  descricao: ['descricao', 'historico', 'lancamento', 'estabelecimento', 'title', 'description', 'memo'],
  valor: ['valor (r$)', 'valor', 'amount', 'value', 'quantia'],
  debito: ['debito', 'saida', 'valor debito'],
  credito: ['credito', 'entrada', 'valor credito'],
  id: ['identificador', 'id', 'documento', 'fitid'],
};

function achaColuna(cab, lista, usadas = []) {
  for (const p of lista) {
    const i = cab.findIndex((h, idx) => !usadas.includes(idx) && h === p);
    if (i >= 0) return i;
  }
  for (const p of lista) {
    const i = cab.findIndex((h, idx) => !usadas.includes(idx) && h.includes(p));
    if (i >= 0) return i;
  }
  return -1;
}

export function sugerirPerfil(linhas) {
  // acha a linha de cabeçalho: a primeira com pelo menos 2 palavras-chave
  let iCab = 0;
  for (let i = 0; i < Math.min(linhas.length, 15); i++) {
    const h = linhas[i].map(normaliza);
    const hits = ['data', 'valor', 'descricao', 'historico', 'date', 'amount', 'title'].filter(p => h.some(x => x.includes(p))).length;
    if (hits >= 2) { iCab = i; break; }
  }
  const cab = linhas[iCab].map(normaliza);
  for (const p of PRESETS) {
    if (p.casa(cab)) {
      const idx = n => cab.indexOf(n);
      return {
        preset: p.id, presetNome: p.nome, linhaCabecalho: iCab,
        colData: idx(p.perfil.colData), colDescricao: idx(p.perfil.colDescricao), colValor: idx(p.perfil.colValor),
        colDebito: -1, colCredito: -1, colId: p.perfil.colId ? idx(p.perfil.colId) : -1,
        colDetalhe: p.perfil.colDetalhe ? idx(p.perfil.colDetalhe) : -1,
        formatoData: p.perfil.formatoData, decimal: p.perfil.decimal, inverterSinal: p.perfil.inverterSinal,
      };
    }
  }
  const colData = achaColuna(cab, PALAVRAS.data);
  const colDescricao = achaColuna(cab, PALAVRAS.descricao, [colData]);
  let colValor = achaColuna(cab, PALAVRAS.valor, [colData, colDescricao]);
  const colDebito = colValor < 0 ? achaColuna(cab, PALAVRAS.debito) : -1;
  const colCredito = colValor < 0 ? achaColuna(cab, PALAVRAS.credito) : -1;
  const colId = cab.findIndex((h, i) => ![colData, colDescricao, colValor].includes(i) && PALAVRAS.id.includes(h));
  // "Histórico" ao lado de "Descrição" = tipo do movimento (Pix enviado, Compra no débito…)
  const colDetalhe = cab[colDescricao] === 'descricao' ? cab.findIndex((h, i) => i !== colDescricao && h === 'historico') : -1;
  const amostras = linhas.slice(iCab + 1, iCab + 30).map(l => l[colData]).filter(Boolean);
  return {
    preset: null, presetNome: null, linhaCabecalho: iCab,
    colData, colDescricao, colValor, colDebito, colCredito, colId, colDetalhe,
    formatoData: detectarFormatoData(amostras), decimal: 'auto', inverterSinal: false,
  };
}

export function detectarFormatoData(amostras) {
  const s = amostras.find(Boolean) || '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return 'yyyy-mm-dd';
  if (/^\d{2}\/\d{2}\/\d{4}/.test(s)) return 'dd/mm/yyyy';
  if (/^\d{2}\/\d{2}\/\d{2}$/.test(s)) return 'dd/mm/yy';
  if (/^\d{2}-\d{2}-\d{4}/.test(s)) return 'dd-mm-yyyy';
  if (/^\d{2}\.\d{2}\.\d{4}/.test(s)) return 'dd.mm.yyyy';
  return 'dd/mm/yyyy';
}

export function lerData(s, formato) {
  s = String(s || '').trim();
  let d, m, y;
  if (formato === 'yyyy-mm-dd') [y, m, d] = s.slice(0, 10).split('-');
  else {
    const p = s.split(/[\/.\-\s]/);
    [d, m, y] = p;
    if (formato === 'dd/mm/yy' || (y && y.length === 2)) y = '20' + y;
  }
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) && !Number.isNaN(Date.parse(iso)) ? iso : null;
}

export function lerValor(s, decimal = 'auto') {
  let t = String(s ?? '').trim();
  if (!t) return null;
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  if (/\bD$/i.test(t)) { neg = true; t = t.replace(/\s*D$/i, ''); }
  t = t.replace(/\s*C$/i, '');
  t = t.replace(/R\$|\s| /g, '');
  if (t.startsWith('-')) { neg = !neg; t = t.slice(1); }
  if (t.endsWith('-')) { neg = !neg; t = t.slice(0, -1); }
  t = t.replace(/^\+/, '');
  let dec = decimal;
  if (dec === 'auto') {
    const ultV = t.lastIndexOf(','), ultP = t.lastIndexOf('.');
    if (ultV >= 0 && ultP >= 0) dec = ultV > ultP ? ',' : '.';
    else if (ultV >= 0) dec = ',';
    else if (ultP >= 0) dec = /^\d{1,3}(\.\d{3})+$/.test(t) ? ',' : '.';
    else dec = '.';
  }
  t = dec === ',' ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  const n = Number(t);
  if (Number.isNaN(n)) return null;
  return neg ? -n : n;
}

// Valor dito pela IA só vale se aparecer no texto com os centavos ("1.234,56" ou "1234,56"),
// não só a parte inteira (que bate com ano, protocolo, qualquer número).
export const valorNoTexto = (v, texto) => String(texto).replace(/\./g, '').includes(v.toFixed(2).replace('.', ','));

export function aplicarPerfil(linhas, perfil) {
  const saida = [], erros = [];
  const corpo = linhas.slice((perfil.linhaCabecalho ?? 0) + 1);
  corpo.forEach((l, i) => {
    const data = lerData(l[perfil.colData], perfil.formatoData);
    let valor;
    if (perfil.colValor >= 0) valor = lerValor(l[perfil.colValor], perfil.decimal);
    else {
      const deb = lerValor(l[perfil.colDebito], perfil.decimal) || 0;
      const cre = lerValor(l[perfil.colCredito], perfil.decimal) || 0;
      valor = cre - Math.abs(deb);
      if (!l[perfil.colDebito] && !l[perfil.colCredito]) valor = null;
    }
    const descricao = (l[perfil.colDescricao] || '').trim();
    if (/^saldo\b/i.test(descricao)) return;
    if (!data || valor === null || valor === undefined) {
      // linhas de saldo/rodapé são comuns: só reporta se parece lançamento
      if (l.filter(Boolean).length >= 2) erros.push({ linha: i + (perfil.linhaCabecalho ?? 0) + 2, conteudo: l.join(' | ') });
      return;
    }
    const detalhe = perfil.colDetalhe >= 0 ? (l[perfil.colDetalhe] || '').trim() || null : null;
    saida.push({
      data,
      descricao: descricao || 'Sem descrição',
      detalhe,
      valor: perfil.inverterSinal ? -valor : valor,
      id_externo: perfil.colId >= 0 ? (l[perfil.colId] || null) : null,
    });
  });
  return { linhas: saida, erros };
}

export function chaveBase(l) {
  return `${l.data}|${l.valor.toFixed(2)}|${normaliza(l.descricao).replace(/\s+/g, ' ')}`;
}

// Chave estável: id externo quando existe; senão data+valor+descrição+ocorrência no arquivo.
// A ocorrência resolve dois lançamentos idênticos legítimos (dois cafés iguais no mesmo dia).
export function atribuirChaves(linhas) {
  const vistos = new Map();
  return linhas.map(l => {
    if (l.id_externo) return { ...l, chave: `id:${l.id_externo}` };
    const b = chaveBase(l);
    const n = (vistos.get(b) || 0) + 1;
    vistos.set(b, n);
    return { ...l, chave: `h:${b}#${n}` };
  });
}

export { normaliza };
