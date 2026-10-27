import { useEffect, useState } from 'react';
import { api, type Categoria, type Regra } from '../api';
import type { Ctx } from '../App';
import { Cabecalho, Chip, Icone } from '../ui';

export function Categorias({ ctx }: { ctx: Ctx }) {
  const [regras, setRegras] = useState<Regra[]>([]);
  const [nova, setNova] = useState({ nome: '', grupo: '', cor: '#7fb2ff' });
  const [novaRegra, setNovaRegra] = useState({ padrao: '', categoria_id: ctx.categorias[0]?.id ?? 0 });
  const [aviso, setAviso] = useState<string | null>(null);

  const carregar = () => api.get<Regra[]>('regras').then(setRegras);
  useEffect(() => { carregar(); }, []);

  async function criarCategoria(e: React.FormEvent) {
    e.preventDefault();
    await api.post('categorias', nova);
    setNova({ nome: '', grupo: '', cor: '#7fb2ff' }); ctx.recarregar();
  }
  async function alternarTotal(k: Categoria) { await api.patch(`categorias/${k.id}`, { fora_do_total: k.fora_do_total ? 0 : 1 }); ctx.recarregar(); }
  async function excluirCategoria(k: Categoria) {
    if (!confirm(`Excluir a categoria ${k.nome}? ${k.usos} lançamentos ficam sem categoria.`)) return;
    await api.del(`categorias/${k.id}`); ctx.recarregar(); carregar();
  }
  async function criarRegra(e: React.FormEvent) {
    e.preventDefault();
    const r = await api.post<{ aplicadas: number }>('regras', novaRegra);
    setAviso(`${r.aplicadas} lançamentos sem categoria foram categorizados.`);
    setNovaRegra({ ...novaRegra, padrao: '' }); carregar();
  }

  const grupos = [...new Set(ctx.categorias.map(k => k.grupo || 'Outros'))];
  return (
    <>
      <Cabecalho titulo="Categorias e regras" sub="Regras categorizam sozinhas tudo que entra. Ganha a que aparece primeiro na descrição; no empate, a de texto mais longo." />
      {aviso && <div className="banner ciano"><Icone nome="ok" /><div className="banner-txt"><b>{aviso}</b></div><button className="btn fantasma" onClick={() => setAviso(null)}>Ok</button></div>}

      <div className="grade-2">
        <section className="card">
          <div className="sh"><h2>Categorias</h2><span className="m">“fora do total” = não conta como gasto</span></div>
          <form className="form-linha" onSubmit={criarCategoria}>
            <input required placeholder="Nova categoria" value={nova.nome} onChange={e => setNova({ ...nova, nome: e.target.value })} />
            <input placeholder="Grupo" list="grupos" value={nova.grupo} onChange={e => setNova({ ...nova, grupo: e.target.value })} />
            <datalist id="grupos">{grupos.map(g => <option key={g} value={g} />)}</datalist>
            <input type="color" value={nova.cor} onChange={e => setNova({ ...nova, cor: e.target.value })} aria-label="Cor" />
            <button className="btn" type="submit"><Icone nome="mais" /></button>
          </form>
          {grupos.map(g => (
            <div key={g} className="grupo">
              <h3>{g}</h3>
              <ul className="linhas">
                {ctx.categorias.filter(k => (k.grupo || 'Outros') === g).map(k => (
                  <li key={k.id}>
                    <span><Chip cor={k.cor}>{k.nome}</Chip> <span className="mudo pequeno">{k.usos} usos</span></span>
                    <span className="lin-dir">
                      <label className="check pequeno"><input type="checkbox" checked={!!k.fora_do_total} onChange={() => alternarTotal(k)} /> fora do total</label>
                      <button className="icone-btn" title="Excluir" onClick={() => excluirCategoria(k)}><Icone nome="lixo" tamanho={16} /></button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        <section className="card">
          <div className="sh"><h2>Regras</h2><span className="m">{regras.length}</span></div>
          <form className="form-linha" onSubmit={criarRegra}>
            <input required minLength={3} placeholder="Descrição contém…" value={novaRegra.padrao} onChange={e => setNovaRegra({ ...novaRegra, padrao: e.target.value })} />
            <select value={novaRegra.categoria_id} onChange={e => setNovaRegra({ ...novaRegra, categoria_id: Number(e.target.value) })}>
              {ctx.categorias.map(k => <option key={k.id} value={k.id}>{k.nome}</option>)}
            </select>
            <button className="btn" type="submit"><Icone nome="mais" /></button>
          </form>
          <ul className="linhas">
            {regras.map(r => (
              <li key={r.id}>
                <span className="mono pequeno">“{r.padrao}”</span>
                <span className="lin-dir"><Chip cor={r.cor}>{r.categoria}</Chip>
                  <button className="icone-btn" title="Excluir regra" onClick={async () => { await api.del(`regras/${r.id}`); carregar(); }}><Icone nome="lixo" tamanho={16} /></button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
