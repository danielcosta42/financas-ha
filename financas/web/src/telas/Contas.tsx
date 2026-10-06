import { useState } from 'react';
import { api, diasDesde, type Conta } from '../api';
import type { Ctx } from '../App';
import { Cabecalho, Chip, Icone } from '../ui';

const TIPOS = { corrente: 'Conta corrente', cartao: 'Cartão de crédito', outro: 'Outro' } as const;

export function Contas({ ctx }: { ctx: Ctx }) {
  const [nova, setNova] = useState({ nome: '', tipo: 'corrente', dono: ctx.estado.pessoas[0], banco: '' });
  const [erro, setErro] = useState<string | null>(null);

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.post('contas', nova);
      setNova({ ...nova, nome: '', banco: '' }); setErro(null); ctx.recarregar();
    } catch (x) { setErro((x as Error).message); }
  }
  async function arquivar(c: Conta) { await api.patch(`contas/${c.id}`, { arquivada: c.arquivada ? 0 : 1 }); ctx.recarregar(); }
  async function excluir(c: Conta) {
    if (!confirm(`Excluir ${c.nome} e os ${c.lancamentos} lançamentos dela? Isso não tem volta.`)) return;
    await api.del(`contas/${c.id}`); ctx.recarregar();
  }

  return (
    <>
      <Cabecalho titulo="Contas" sub="Uma conta por extrato exportado: conta corrente, cada cartão, a conta da Ferion." />
      <section className="card">
        <form className="form-linha" onSubmit={criar}>
          <label className="campo"><span>Nome</span><input required placeholder="ex.: Nubank cartão" value={nova.nome} onChange={e => setNova({ ...nova, nome: e.target.value })} /></label>
          <label className="campo"><span>Tipo</span>
            <select value={nova.tipo} onChange={e => setNova({ ...nova, tipo: e.target.value })}>
              {Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="campo"><span>Dono</span>
            <select value={nova.dono} onChange={e => setNova({ ...nova, dono: e.target.value })}>
              {ctx.estado.donos.map(d => <option key={d}>{d}</option>)}
            </select>
          </label>
          <label className="campo"><span>Banco</span><input placeholder="opcional" value={nova.banco} onChange={e => setNova({ ...nova, banco: e.target.value })} /></label>
          <button className="btn" type="submit"><Icone nome="mais" />Adicionar</button>
        </form>
        {erro && <p className="txt-vermelho">{erro}</p>}
      </section>

      <section className="card sem-pad">
        <table className="tabela">
          <thead><tr><th>Conta</th><th>Dono</th><th className="esconde-cel">Tipo</th><th className="esconde-cel">Mapeamento</th><th>Extrato</th><th /></tr></thead>
          <tbody>
            {ctx.contas.map(c => {
              const d = diasDesde(c.ultima_importacao);
              return (
                <tr key={c.id} className={c.arquivada ? 'apagada' : ''}>
                  <td><b>{c.nome}</b>{c.banco && <div className="mudo pequeno">{c.banco}</div>}</td>
                  <td>{c.dono}</td>
                  <td className="esconde-cel">{TIPOS[c.tipo]}</td>
                  <td className="esconde-cel">{c.perfil ? <Chip cor="#4ff0c9">{c.perfil.presetNome || 'salvo'}</Chip> : <span className="mudo">na 1ª importação</span>}</td>
                  <td className={d === null || d > 8 ? 'txt-laranja' : 'mudo'}>{d === null ? 'nunca' : d === 0 ? 'hoje' : `há ${d} d`} · {c.lancamentos}</td>
                  <td className="dir nowrap">
                    <button className="btn fantasma pequeno" onClick={() => arquivar(c)}>{c.arquivada ? 'Reativar' : 'Arquivar'}</button>
                    <button className="icone-btn" title="Excluir conta" onClick={() => excluir(c)}><Icone nome="lixo" tamanho={16} /></button>
                  </td>
                </tr>
              );
            })}
            {ctx.contas.length === 0 && <tr><td colSpan={6} className="mudo centro">Nenhuma conta ainda.</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}
