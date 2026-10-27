import { useCallback, useEffect, useState } from 'react';
import { api, type Categoria, type Conta, type Estado } from './api';
import { Resumo } from './telas/Resumo';
import { Importar } from './telas/Importar';
import { Lancamentos } from './telas/Lancamentos';
import { Contas } from './telas/Contas';
import { Categorias } from './telas/Categorias';
import { Pessoas } from './telas/Pessoas';
import { Faturas } from './telas/Faturas';
import { Icone } from './ui';

export type Aba = 'resumo' | 'faturas' | 'importar' | 'lancamentos' | 'contas' | 'pessoas' | 'categorias';
export interface Ctx {
  estado: Estado; contas: Conta[]; categorias: Categoria[];
  recarregar: () => Promise<void>; ir: (a: Aba, filtro?: Record<string, string>) => void; filtro: Record<string, string>;
}

const ABAS: { id: Aba; nome: string; icone: string }[] = [
  { id: 'resumo', nome: 'Resumo', icone: 'grafico' },
  { id: 'faturas', nome: 'Faturas', icone: 'cartao' },
  { id: 'importar', nome: 'Importar', icone: 'upload' },
  { id: 'lancamentos', nome: 'Lançamentos', icone: 'lista' },
  { id: 'contas', nome: 'Contas', icone: 'carteira' },
  { id: 'pessoas', nome: 'Pessoas', icone: 'pessoa' },
  { id: 'categorias', nome: 'Categorias', icone: 'etiqueta' },
];

export function App() {
  const [aba, setAba] = useState<Aba>(() => (location.hash.slice(1) as Aba) || 'resumo');
  const [filtro, setFiltro] = useState<Record<string, string>>({});
  const [estado, setEstado] = useState<Estado | null>(null);
  const [contas, setContas] = useState<Conta[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  const recarregar = useCallback(async () => {
    try {
      const [e, c, k] = await Promise.all([api.get<Estado>('estado'), api.get<Conta[]>('contas'), api.get<Categoria[]>('categorias')]);
      setEstado(e); setContas(c); setCategorias(k); setErro(null);
    } catch (e) { setErro((e as Error).message); }
  }, []);
  useEffect(() => { recarregar(); }, [recarregar]);

  const ir = (a: Aba, f: Record<string, string> = {}) => { setFiltro(f); setAba(a); history.replaceState(null, '', `#${a}`); window.scrollTo(0, 0); };

  if (erro) return <div className="vazio-tela"><h2>Não consegui falar com o servidor</h2><p>{erro}</p><button className="btn" onClick={recarregar}>Tentar de novo</button></div>;
  if (!estado) return <div className="vazio-tela"><p>Carregando…</p></div>;

  const ctx: Ctx = { estado, contas, categorias, recarregar, ir, filtro };
  return (
    <div className="app">
      <nav className="nav">
        <div className="marca"><span className="logo">R$</span><span>Finanças</span></div>
        {ABAS.map(a => (
          <button key={a.id} className={`nav-item ${aba === a.id ? 'on' : ''}`} onClick={() => ir(a.id)}>
            <Icone nome={a.icone} /><span>{a.nome}</span>
          </button>
        ))}
      </nav>
      <main className="conteudo">
        {aba === 'resumo' && <Resumo ctx={ctx} />}
        {aba === 'faturas' && <Faturas ctx={ctx} />}
        {aba === 'importar' && <Importar ctx={ctx} />}
        {aba === 'lancamentos' && <Lancamentos ctx={ctx} />}
        {aba === 'contas' && <Contas ctx={ctx} />}
        {aba === 'pessoas' && <Pessoas ctx={ctx} />}
        {aba === 'categorias' && <Categorias ctx={ctx} />}
      </main>
    </div>
  );
}
