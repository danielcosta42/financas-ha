import type { ReactNode } from 'react';

const PATHS: Record<string, string> = {
  grafico: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  upload: 'M12 16V4m0 0l-5 5m5-5l5 5M4 20h16',
  lista: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  carteira: 'M3 7h16a2 2 0 012 2v9a2 2 0 01-2 2H3zM3 7V5a2 2 0 012-2h11v4M16 13h2',
  etiqueta: 'M20 12l-8 8-9-9V3h8zM7.5 7.5h.01',
  alerta: 'M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
  ok: 'M20 6L9 17l-5-5',
  lixo: 'M3 6h18M8 6V4h8v2m-9 0l1 14h8l1-14',
  mais: 'M12 5v14M5 12h14',
  voltar: 'M15 18l-6-6 6-6',
  avancar: 'M9 18l6-6-6-6',
  arquivo: 'M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9zM14 3v6h6',
  pessoa: 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z',
  lapis: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z',
  celular: 'M7 2h10a2 2 0 012 2v16a2 2 0 01-2 2H7a2 2 0 01-2-2V4a2 2 0 012-2zM11 18h2',
  estrela: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z',
  cartao: 'M2 7a2 2 0 012-2h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2zM2 10h20M6 15h4',
  repetir: 'M17 2l4 4-4 4M3 11V9a3 3 0 013-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 01-3 3H3',
};

export function Icone({ nome, tamanho = 18 }: { nome: string; tamanho?: number }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[nome] || ''} />
    </svg>
  );
}

export function Cabecalho({ titulo, sub, acoes }: { titulo: string; sub?: ReactNode; acoes?: ReactNode }) {
  return (
    <header className="cab">
      <div><h1>{titulo}</h1>{sub && <p className="sub">{sub}</p>}</div>
      {acoes && <div className="cab-acoes">{acoes}</div>}
    </header>
  );
}

export function Stat({ rotulo, valor, sub, tom }: { rotulo: string; valor: ReactNode; sub?: ReactNode; tom?: string }) {
  return (
    <div className={`stat ${tom || ''}`}>
      <div className="stat-l">{rotulo}</div>
      <div className="stat-v mono">{valor}</div>
      {sub && <div className="stat-s">{sub}</div>}
    </div>
  );
}

export function Chip({ cor, children }: { cor?: string | null; children: ReactNode }) {
  return <span className="chip" style={cor ? { color: cor, borderColor: `${cor}66`, background: `${cor}1a` } : undefined}>{children}</span>;
}

export function Vazio({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return <div className="vazio"><h3>{titulo}</h3>{children}</div>;
}
