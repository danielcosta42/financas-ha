import { useEffect, useState } from 'react';
import { api, brl, dataBr, diasDesde, mesAnterior, mesAtual, nomeMes, type Resumo as R } from '../api';
import type { Ctx } from '../App';
import { Cabecalho, Icone, Stat, Vazio } from '../ui';

export function Resumo({ ctx }: { ctx: Ctx }) {
  const [mes, setMes] = useState(mesAtual());
  const [r, setR] = useState<R | null>(null);
  useEffect(() => { api.get<R>(`resumo?mes=${mes}`).then(setR); }, [mes]);

  if (!ctx.contas.length) {
    return (
      <>
        <Cabecalho titulo="Resumo" />
        <Vazio titulo="Comece cadastrando as contas">
          <p>Uma conta por extrato que vocês exportam: conta corrente, cada cartão, a conta da Ferion.</p>
          <button className="btn" onClick={() => ctx.ir('contas')}><Icone nome="mais" />Cadastrar contas</button>
        </Vazio>
      </>
    );
  }
  if (!r) return <Cabecalho titulo="Resumo" sub="carregando…" />;

  const max = Math.max(1, ...r.porCategoria.map(c => c.total));
  const saidas = r.saidas + r.carteiraPendente.total;
  const atrasadas = r.contas.filter(c => { const d = diasDesde(c.ultima_importacao); return d === null || d > 8; });

  return (
    <>
      <Cabecalho
        titulo="Resumo"
        sub={nomeMes(mes)}
        acoes={<div className="seg">
          <button onClick={() => setMes(mesAnterior(mes))} aria-label="mês anterior"><Icone nome="voltar" /></button>
          <button onClick={() => setMes(mesAtual())} className={mes === mesAtual() ? 'on' : ''}>Este mês</button>
          <button onClick={() => setMes(mesAnterior(mes, 1))} aria-label="próximo mês"><Icone nome="avancar" /></button>
        </div>}
      />

      {atrasadas.length > 0 && mes === mesAtual() && (
        <div className="banner laranja">
          <Icone nome="alerta" />
          <div className="banner-txt">
            <b>{atrasadas.length === 1 ? '1 conta' : `${atrasadas.length} contas`} sem extrato há mais de uma semana</b>
            <span>{atrasadas.map(c => `${c.dono} · ${c.nome}`).join(', ')}</span>
          </div>
          <button className="btn laranja" onClick={() => ctx.ir('importar')}>Importar</button>
        </div>
      )}

      <section className="stats">
        <Stat rotulo="Saídas" valor={brl(saidas)} tom="rosa" sub={r.carteiraPendente.n ? `inclui ${brl(r.carteiraPendente.total)} da Carteira ainda sem extrato` : `${r.n} lançamentos`} />
        <Stat rotulo="Entradas" valor={brl(r.entradas)} tom="ciano" />
        <Stat rotulo="Resultado" valor={brl(r.entradas - saidas)} tom={r.entradas - saidas >= 0 ? 'ciano' : 'vermelho'} />
        <button className={`stat clicavel ${r.semCategoria ? 'amarelo' : ''}`} onClick={() => ctx.ir('lancamentos', { categoria: 'sem' })}>
          <div className="stat-l">Sem categoria</div>
          <div className="stat-v mono">{r.semCategoria}</div>
          <div className="stat-s">{r.semCategoria ? 'toque para categorizar' : 'tudo categorizado'}</div>
        </button>
      </section>

      <div className="grade-2">
        <section className="card">
          <div className="sh"><h2>Para onde foi</h2><span className="m">{r.porCategoria.length} categorias</span></div>
          {r.porCategoria.length === 0 && <p className="mudo">Nenhuma saída neste mês.</p>}
          <ul className="barras">
            {r.porCategoria.map(c => (
              <li key={c.categoria}>
                <button onClick={() => ctx.ir('lancamentos', { mes, categoria: c.categoria_id ? String(c.categoria_id) : 'sem' })}>
                  <span className="b-nome">{c.categoria}</span>
                  <span className="b-trilho"><i style={{ width: `${(c.total / max) * 100}%`, background: c.cor || '#8089a7' }} /></span>
                  <span className="b-val mono">{brl(c.total)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <div className="coluna">
          <section className="card">
            <div className="sh"><h2>Por dono</h2></div>
            <ul className="linhas">
              {r.porDono.map(d => <li key={d.dono}><span>{d.dono}</span><span className="mono">{brl(d.total)}</span></li>)}
              {r.porDono.length === 0 && <li className="mudo">—</li>}
            </ul>
          </section>
          <section className="card">
            <div className="sh"><h2>Extratos</h2><span className="m">última importação</span></div>
            <ul className="linhas">
              {r.contas.map(c => {
                const d = diasDesde(c.ultima_importacao);
                return (
                  <li key={c.id}>
                    <span><b>{c.nome}</b> <span className="mudo">· {c.dono}</span></span>
                    <span className={d === null || d > 8 ? 'txt-laranja' : 'mudo'}>{d === null ? 'nunca' : d === 0 ? 'hoje' : `há ${d} d`}{c.ultimo_lancamento ? ` · até ${dataBr(c.ultimo_lancamento)}` : ''}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
