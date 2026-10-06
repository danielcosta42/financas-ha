import { useEffect, useState } from 'react';
import { api, brl, mesAtual, nomeMes, type Pessoa } from '../api';
import type { Ctx } from '../App';
import { Cabecalho, Chip, Icone } from '../ui';

const TIPOS = { pessoa: 'Pessoa', casa: 'Casa (compartilhado)', empresa: 'Empresa' } as const;
const REGIMES = ['CLT', 'PJ', 'Pró-labore', 'Autônomo', 'Outro'];
const VAZIA: Partial<Pessoa> = { nome: '', tipo: 'pessoa', cor: '#7fb2ff', renda_mensal: null, dia_recebimento: null, regime: null, meta_poupanca: null, notificar: null };

export function Pessoas({ ctx }: { ctx: Ctx }) {
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [notificadores, setNotificadores] = useState<string[]>([]);
  const [editando, setEditando] = useState<Partial<Pessoa> | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = () => api.get<Pessoa[]>(`pessoas?mes=${mesAtual()}`).then(setPessoas);
  useEffect(() => { carregar(); api.get<string[]>('notificadores').then(setNotificadores).catch(() => {}); }, []);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!editando) return;
    try {
      if (editando.id) await api.patch(`pessoas/${editando.id}`, editando);
      else await api.post('pessoas', editando);
      setEditando(null); setErro(null); carregar(); ctx.recarregar();
    } catch (x) { setErro((x as Error).message); }
  }
  async function excluir(p: Pessoa) {
    if (!confirm(`Excluir o perfil ${p.nome}?`)) return;
    try { await api.del(`pessoas/${p.id}`); carregar(); ctx.recarregar(); } catch (x) { setErro((x as Error).message); }
  }
  const set = (k: keyof Pessoa, v: unknown) => setEditando(x => ({ ...x, [k]: v }));
  const num = (v: string) => (v === '' ? null : Number(v));

  const ativas = pessoas.filter(p => !p.arquivada);
  const rendaCasa = ativas.filter(p => p.tipo === 'pessoa').reduce((s, p) => s + (p.renda_mensal || 0), 0);

  return (
    <>
      <Cabecalho
        titulo="Pessoas"
        sub={rendaCasa ? `Renda declarada da casa: ${brl(rendaCasa)} por mês` : 'Cada conta pertence a um perfil. A renda declarada alimenta o resumo, a divisão da casa e a previsão.'}
        acoes={<button className="btn" onClick={() => setEditando({ ...VAZIA })}><Icone nome="mais" />Novo perfil</button>}
      />
      {erro && <div className="banner vermelho"><Icone nome="alerta" /><div className="banner-txt"><b>{erro}</b></div><button className="btn fantasma" onClick={() => setErro(null)}>Ok</button></div>}

      {editando && (
        <section className="card">
          <div className="sh"><h2>{editando.id ? `Editar ${editando.nome}` : 'Novo perfil'}</h2></div>
          <form className="mapa" onSubmit={salvar}>
            <label className="campo"><span>Nome</span><input required value={editando.nome || ''} onChange={e => set('nome', e.target.value)} /></label>
            <label className="campo"><span>Tipo</span>
              <select value={editando.tipo} onChange={e => set('tipo', e.target.value)}>
                {Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            {editando.tipo !== 'casa' && <>
              <label className="campo"><span>{editando.tipo === 'empresa' ? 'Faturamento médio (R$/mês)' : 'Renda líquida (R$/mês)'}</span>
                <input type="number" min="0" step="0.01" inputMode="decimal" value={editando.renda_mensal ?? ''} onChange={e => set('renda_mensal', num(e.target.value))} placeholder="opcional" />
              </label>
              <label className="campo"><span>Dia do recebimento</span>
                <input type="number" min="1" max="31" value={editando.dia_recebimento ?? ''} onChange={e => set('dia_recebimento', num(e.target.value))} placeholder="ex.: 5" />
              </label>
              <label className="campo"><span>Regime</span>
                <select value={editando.regime || ''} onChange={e => set('regime', e.target.value || null)}>
                  <option value="">—</option>{REGIMES.map(r => <option key={r}>{r}</option>)}
                </select>
              </label>
            </>}
            <label className="campo"><span>Meta de poupança (% da renda)</span>
              <input type="number" min="0" max="100" step="1" value={editando.meta_poupanca ?? ''} onChange={e => set('meta_poupanca', num(e.target.value))} placeholder="ex.: 20" />
            </label>
            <label className="campo"><span>Avisos no celular</span>
              <select value={editando.notificar || ''} onChange={e => set('notificar', e.target.value || null)}>
                <option value="">Nenhum</option>
                {[...new Set([...(editando.notificar ? [editando.notificar] : []), ...notificadores])].map(n => <option key={n} value={n}>{n.replace('mobile_app_', '').replace(/_/g, ' ')}</option>)}
              </select>
            </label>
            <label className="campo"><span>Cor</span><input type="color" value={editando.cor || '#7fb2ff'} onChange={e => set('cor', e.target.value)} /></label>
            <div className="acoes" style={{ gridColumn: '1 / -1', marginTop: 4 }}>
              <button type="button" className="btn fantasma" onClick={() => setEditando(null)}>Cancelar</button>
              <button type="submit" className="btn">Salvar</button>
            </div>
          </form>
        </section>
      )}

      <section className="perfis">
        {pessoas.map(p => {
          const cor = p.cor || '#8089a7';
          const renda = p.renda_mensal || 0;
          const pct = renda ? Math.min(100, (p.saidas_mes / renda) * 100) : 0;
          const sobra = renda - p.saidas_mes;
          const metaValor = renda && p.meta_poupanca ? renda * p.meta_poupanca / 100 : 0;
          return (
            <article key={p.id} className={`card perfil ${p.arquivada ? 'apagada' : ''}`} style={{ ['--pc' as string]: cor }}>
              <header className="perfil-cab">
                <span className="avatar" style={{ background: `${cor}22`, color: cor, borderColor: `${cor}66` }}>{p.nome.slice(0, 1).toUpperCase()}</span>
                <div className="perfil-nome">
                  <b>{p.nome}</b>
                  <span className="mudo pequeno">{TIPOS[p.tipo]}{p.regime ? ` · ${p.regime}` : ''}{p.dia_recebimento ? ` · recebe dia ${p.dia_recebimento}` : ''}</span>
                </div>
                <button className="icone-btn" title="Editar" onClick={() => setEditando({ ...p })}><Icone nome="lapis" tamanho={16} /></button>
              </header>

              {p.tipo !== 'casa' && renda > 0 ? (
                <>
                  <div className="perfil-num">
                    <div><span className="mudo pequeno">{p.tipo === 'empresa' ? 'Faturamento' : 'Renda'}</span><b className="mono">{brl(renda)}</b></div>
                    <div><span className="mudo pequeno">Saídas em {nomeMes(mesAtual()).split(' ')[0].toLowerCase()}</span><b className="mono">{brl(p.saidas_mes)}</b></div>
                  </div>
                  <div className="perfil-barra"><i style={{ width: `${pct}%`, background: pct >= 100 ? 'var(--vermelho)' : pct >= 80 ? 'var(--laranja)' : cor }} /></div>
                  <p className="pequeno mudo">
                    {sobra >= 0 ? `Sobram ${brl(sobra)}` : `Passou ${brl(-sobra)}`} ({Math.round(pct)}% da renda)
                    {metaValor ? ` · meta de guardar ${brl(metaValor)}${sobra >= metaValor ? ' ✓' : ''}` : ''}
                  </p>
                </>
              ) : (
                <div className="perfil-num">
                  <div><span className="mudo pequeno">Saídas no mês</span><b className="mono">{brl(p.saidas_mes)}</b></div>
                  <div><span className="mudo pequeno">Entradas no mês</span><b className="mono">{brl(p.entradas_mes)}</b></div>
                </div>
              )}

              <footer className="perfil-pe">
                <Chip cor={cor}>{p.contas} {p.contas === 1 ? 'conta' : 'contas'}</Chip>
                {p.notificar ? <span className="mudo pequeno"><Icone nome="celular" tamanho={13} /> {p.notificar.replace('mobile_app_', '').replace(/_/g, ' ')}</span> : null}
                <span style={{ flex: 1 }} />
                {p.contas === 0 && <button className="icone-btn" title="Excluir perfil" onClick={() => excluir(p)}><Icone nome="lixo" tamanho={16} /></button>}
                <button className="btn fantasma pequeno" onClick={() => api.patch(`pessoas/${p.id}`, { arquivada: p.arquivada ? 0 : 1 }).then(() => { carregar(); ctx.recarregar(); })}>{p.arquivada ? 'Reativar' : 'Arquivar'}</button>
              </footer>
            </article>
          );
        })}
      </section>
    </>
  );
}
