import { useEffect, useMemo, useState } from 'react';
import { api, brl, dataBr, mesAtual, nomeMes, type EstadoIa, type Lancamento } from '../api';
import type { Ctx } from '../App';
import { Cabecalho, Icone } from '../ui';

const sugerirPadrao = (d: string) => d.toLowerCase().replace(/[*#\d]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 2).join(' ');

export function Lancamentos({ ctx }: { ctx: Ctx }) {
  const [f, setF] = useState<Record<string, string>>({ mes: ctx.filtro.categoria === 'sem' && !ctx.filtro.mes ? '' : mesAtual(), ...ctx.filtro });
  const [itens, setItens] = useState<Lancamento[]>([]);
  const [meses, setMeses] = useState<string[]>([]);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [regra, setRegra] = useState<{ l: Lancamento; categoria_id: number; padrao: string } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ia, setIa] = useState<EstadoIa | null>(null);

  const carregar = () => {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    api.get<Lancamento[]>(`lancamentos?${q}`).then(setItens);
  };
  useEffect(carregar, [f]);
  useEffect(() => { api.get<string[]>('meses').then(setMeses); }, []);

  // Acompanha a IA enquanto ela sugere; ao terminar, recarrega a lista.
  useEffect(() => {
    let vivo = true, t: number | undefined;
    const ver = () => api.get<EstadoIa>('ia/estado').then(e => {
      if (!vivo) return;
      setIa(old => { if (old?.rodando && !e.rodando) carregar(); return e; });
      if (e.rodando) t = window.setTimeout(ver, 3000);
    }).catch(() => {});
    ver();
    return () => { vivo = false; clearTimeout(t); };
  }, [ia?.rodando]);

  const nSugestoes = itens.filter(l => !l.categoria_id && l.sugestao_categoria_id).length;

  async function sugerirComIa() {
    try { setIa(await api.post<EstadoIa>('ia/sugerir', {})); } catch (e) { setAviso((e as Error).message); }
  }
  async function aceitar(ids?: number[]) {
    const r = await api.post<{ aceitos: number; regras: number }>('ia/aceitar', { ids, criarRegras: true });
    setAviso(`${r.aceitos} sugestões aceitas${r.regras ? ` · ${r.regras} regras novas criadas` : ''}.`);
    carregar();
  }
  async function recusar(l: Lancamento) {
    await api.post(`ia/recusar/${l.id}`);
    setItens(xs => xs.map(x => x.id === l.id ? { ...x, sugestao_categoria_id: null, sugestao: null, sugestao_cor: null } : x));
  }

  const totais = useMemo(() => ({
    saidas: itens.filter(l => l.valor < 0 && !l.fora_do_total).reduce((s, l) => s - l.valor, 0),
    entradas: itens.filter(l => l.valor > 0 && !l.fora_do_total).reduce((s, l) => s + l.valor, 0),
  }), [itens]);

  async function categorizar(l: Lancamento, categoria_id: number | null) {
    await api.patch(`lancamentos/${l.id}`, { categoria_id });
    setItens(xs => xs.map(x => x.id === l.id ? { ...x, fora_do_total: ctx.categorias.find(k => k.id === categoria_id)?.fora_do_total || 0, categoria_id, categoria: ctx.categorias.find(k => k.id === categoria_id)?.nome || null, cor: ctx.categorias.find(k => k.id === categoria_id)?.cor || null } : x));
    if (categoria_id) setRegra({ l, categoria_id, padrao: sugerirPadrao(l.descricao) });
  }

  async function criarRegra() {
    if (!regra) return;
    const r = await api.post<{ aplicadas: number }>('regras', { padrao: regra.padrao, categoria_id: regra.categoria_id });
    setAviso(`Regra criada: “${regra.padrao}”. ${r.aplicadas} outros lançamentos categorizados.`);
    setRegra(null); carregar();
  }

  async function emLote(categoria_id: number) {
    await api.patch('lancamentos', { ids: [...sel], categoria_id });
    setSel(new Set()); carregar();
  }

  const mudar = (k: string, v: string) => setF(x => ({ ...x, [k]: v }));
  const todosSel = itens.length > 0 && sel.size === itens.length;

  return (
    <>
      <Cabecalho titulo="Lançamentos" sub={`${itens.length} lançamentos · saídas ${brl(totais.saidas)} · entradas ${brl(totais.entradas)}`} />

      <section className="filtros">
        <select value={f.mes || ''} onChange={e => mudar('mes', e.target.value)}>
          <option value="">Todos os meses</option>
          {[...new Set([mesAtual(), ...meses])].map(m => <option key={m} value={m}>{nomeMes(m)}</option>)}
        </select>
        <select value={f.conta || ''} onChange={e => mudar('conta', e.target.value)}>
          <option value="">Todas as contas</option>
          {ctx.contas.map(c => <option key={c.id} value={c.id}>{c.dono} · {c.nome}</option>)}
        </select>
        <select value={f.dono || ''} onChange={e => mudar('dono', e.target.value)}>
          <option value="">Todos os donos</option>
          {ctx.estado.donos.map(d => <option key={d}>{d}</option>)}
        </select>
        <select value={f.categoria || ''} onChange={e => mudar('categoria', e.target.value)}>
          <option value="">Todas as categorias</option>
          <option value="sem">Sem categoria</option>
          <option value="sugestao">Com sugestão da IA</option>
          {ctx.categorias.map(k => <option key={k.id} value={k.id}>{k.nome}</option>)}
        </select>
        <input type="search" placeholder="Buscar descrição" value={f.busca || ''} onChange={e => mudar('busca', e.target.value)} />
      </section>

      {ctx.estado.ia && (
        <div className="banner roxo">
          <Icone nome="estrela" />
          <div className="banner-txt">
            {ia?.rodando
              ? <><b>IA local categorizando… {ia.feitos}/{ia.total}</b><span>{ia.sugeridos} sugestões até agora · pode continuar usando o app</span></>
              : nSugestoes
                ? <><b>{nSugestoes} sugestões da IA esperando você</b><span>Confira na coluna Categoria. Aceitar cria regras pros estabelecimentos que se repetem.</span></>
                : <><b>Categorizar com a IA local</b><span>A IA ({ctx.estado.ia.replace('ai_task.', '')}) olha os lançamentos sem categoria e sugere. Você confirma.{ia?.erro ? ` Último erro: ${ia.erro}` : ''}</span></>}
          </div>
          {!ia?.rodando && nSugestoes > 0 && <button className="btn roxo" onClick={() => aceitar()}>Aceitar todas</button>}
          {!ia?.rodando && <button className={nSugestoes ? 'btn fantasma' : 'btn roxo'} onClick={sugerirComIa}>Sugerir</button>}
        </div>
      )}

      {aviso && <div className="banner ciano"><Icone nome="ok" /><div className="banner-txt"><b>{aviso}</b></div><button className="btn fantasma" onClick={() => setAviso(null)}>Ok</button></div>}

      {regra && (
        <div className="banner roxo">
          <Icone nome="etiqueta" />
          <div className="banner-txt">
            <b>Criar regra pra próximas vezes?</b>
            <span>Descrição contém <input className="inline" value={regra.padrao} onChange={e => setRegra({ ...regra, padrao: e.target.value })} /> → {ctx.categorias.find(k => k.id === regra.categoria_id)?.nome}</span>
          </div>
          <button className="btn roxo" disabled={regra.padrao.trim().length < 3} onClick={criarRegra}>Criar regra</button>
          <button className="btn fantasma" onClick={() => setRegra(null)}>Agora não</button>
        </div>
      )}

      {sel.size > 0 && (
        <div className="lote">
          <b>{sel.size} selecionados</b>
          <select defaultValue="" onChange={e => e.target.value && emLote(Number(e.target.value))}>
            <option value="" disabled>Mover para categoria…</option>
            {ctx.categorias.map(k => <option key={k.id} value={k.id}>{k.nome}</option>)}
          </select>
          <button className="btn fantasma" onClick={() => setSel(new Set())}>Limpar</button>
        </div>
      )}

      <section className="card sem-pad">
        <table className="tabela lanc">
          <thead>
            <tr>
              <th className="col-sel"><input type="checkbox" checked={todosSel} onChange={() => setSel(todosSel ? new Set() : new Set(itens.map(l => l.id)))} /></th>
              <th>Data</th><th>Descrição</th><th className="esconde-cel">Conta</th><th>Categoria</th><th className="dir">Valor</th>
            </tr>
          </thead>
          <tbody>
            {itens.map(l => (
              <tr key={l.id} className={sel.has(l.id) ? 'sel' : ''}>
                <td className="col-sel"><input type="checkbox" checked={sel.has(l.id)} onChange={() => setSel(s => { const n = new Set(s); n.has(l.id) ? n.delete(l.id) : n.add(l.id); return n; })} /></td>
                <td className="mono c-data">{dataBr(l.data)}</td>
                <td className="desc">{l.descricao === 'Sem descrição' && l.detalhe ? l.detalhe : l.descricao}{l.detalhe && l.descricao !== 'Sem descrição' ? <span className="detalhe"> · {l.detalhe}</span> : null}{l.veio_da_carteira ? <span title="Também registrada pela Carteira do iPhone" className="tag-carteira"><Icone nome="celular" tamanho={13} /></span> : null}<div className="cel-conta">{l.dono} · {l.conta}</div></td>
                <td className="esconde-cel mudo">{l.dono} · {l.conta}</td>
                <td className="c-cat">
                  <select className={`sel-cat ${l.categoria_id ? '' : 'vazia'}`} style={l.cor ? { borderColor: `${l.cor}88`, color: l.cor } : undefined} value={l.categoria_id ?? ''} onChange={e => categorizar(l, e.target.value ? Number(e.target.value) : null)}>
                    <option value="">Sem categoria</option>
                    {ctx.categorias.map(k => <option key={k.id} value={k.id}>{k.nome}</option>)}
                  </select>
                  {!l.categoria_id && l.sugestao_categoria_id && (
                    <div className="sugestao">
                      <span style={l.sugestao_cor ? { color: l.sugestao_cor } : undefined}>IA: {l.sugestao}</span>
                      <button className="mini ok" title="Aceitar" onClick={() => aceitar([l.id])}><Icone nome="ok" tamanho={13} /></button>
                      <button className="mini" title="Recusar" onClick={() => recusar(l)}>×</button>
                    </div>
                  )}
                </td>
                <td className={`dir mono c-val ${l.valor < 0 ? 'neg' : 'pos'}`}>{brl(l.valor)}</td>
              </tr>
            ))}
            {itens.length === 0 && <tr><td colSpan={6} className="mudo centro">Nada com esses filtros.</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}
