// Caminhos relativos: o ingress do HA serve o app sob /api/hassio_ingress/<token>/
async function req<T>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
  const init: RequestInit = { method: metodo, headers: {} };
  if (corpo instanceof FormData) init.body = corpo;
  else if (corpo !== undefined) {
    init.body = JSON.stringify(corpo);
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
  }
  const r = await fetch(`api/${caminho}`, init);
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(dados.erro || `erro ${r.status}`);
  return dados as T;
}

export const api = {
  get: <T,>(c: string) => req<T>('GET', c),
  post: <T,>(c: string, b?: unknown) => req<T>('POST', c, b),
  patch: <T,>(c: string, b?: unknown) => req<T>('PATCH', c, b),
  del: <T,>(c: string) => req<T>('DELETE', c),
};

export type Dono = string;
export interface Estado { pessoas: string[]; donos: string[]; ha: boolean; ia: string | null; presets: { id: string; nome: string }[]; pasta: string | null }
export interface Perfil {
  preset?: string | null; presetNome?: string | null; linhaCabecalho: number;
  colData: number; colDescricao: number; colValor: number; colDebito: number; colCredito: number; colId: number;
  formatoData: string; decimal: string; inverterSinal: boolean; colDetalhe?: number;
}
export interface Pessoa {
  id: number; nome: string; tipo: 'pessoa' | 'casa' | 'empresa'; cor: string | null; renda_mensal: number | null; dia_recebimento: number | null;
  regime: string | null; meta_poupanca: number | null; notificar: string | null; arquivada: number; contas: number; saidas_mes: number; entradas_mes: number;
}
export interface Conta { id: number; nome: string; tipo: 'corrente' | 'cartao' | 'outro'; dono: Dono; banco: string | null; arquivada: number; ultima_importacao: string | null; lancamentos: number; perfil: Perfil | null }
export interface Categoria { id: number; nome: string; grupo: string | null; cor: string | null; fora_do_total: number; usos: number }
export interface Regra { id: number; padrao: string; categoria_id: number; categoria: string; cor: string }
export interface Lancamento { id: number; data: string; descricao: string; detalhe: string | null; sugestao_categoria_id: number | null; sugestao: string | null; sugestao_cor: string | null; valor: number; categoria_id: number | null; categoria: string | null; cor: string | null; conta: string; conta_id: number; dono: string; nota: string | null; veio_da_carteira: number; fora_do_total: number }
export interface LinhaPrevia { data: string; descricao: string; valor: number; id_externo: string | null }
export interface Previa {
  token: string; formato: 'csv' | 'ofx'; nome: string; perfil: Perfil | null; colunas: string[]; amostra: string[][]; bruto: string[][];
  total: number; saidas: number; entradas: number; de: string | null; ate: string | null; exemplos: LinhaPrevia[]; erros: { linha: number; conteudo: string }[]; nErros: number;
}
export interface EstadoIa { disponivel: boolean; entidade: string; rodando: boolean; feitos: number; total: number; sugeridos: number; erro: string | null; fim: string | null }
export interface Importacao { id: number; conta: string; dono: string; arquivo: string; formato: string; novos: number; duplicados: number; de: string; ate: string; quem: string | null; criado_em: string }
export interface Resumo {
  mes: string; saidas: number; entradas: number; n: number; semCategoria: number; sugestoes: number;
  comentario: { texto: string; origem: string | null; criado_em: string } | null;
  recorrentes: { descricao: string; valor: number; vezes: number; total: number; ultima: string; categoria: string | null }[];
  porCategoria: { categoria: string; cor: string | null; categoria_id: number | null; total: number; n: number }[];
  porDono: { dono: string; total: number; cor: string | null; renda_mensal: number | null; tipo: string | null }[];
  rendaDeclarada: number;
  carteiraPendente: { n: number; total: number };
  contas: { id: number; nome: string; dono: string; tipo: string; banco: string | null; ultima_importacao: string | null; ultimo_lancamento: string | null }[];
}

const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const brl = (v: number) => fmt.format(v);
export const dataBr = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
export const diasDesde = (sqliteUtc: string | null) => (sqliteUtc ? Math.floor((Date.now() - Date.parse(sqliteUtc.replace(' ', 'T') + 'Z')) / 864e5) : null);
export const mesAtual = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 7);
export const nomeMes = (m: string) => { const t = new Date(`${m}-15T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }); return t.charAt(0).toUpperCase() + t.slice(1); };
export const mesAnterior = (m: string, d = -1) => { const [y, mm] = m.split('-').map(Number); const t = new Date(y, mm - 1 + d, 15); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`; };
