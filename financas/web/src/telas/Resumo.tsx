import { useEffect, useState } from 'react';
import { api, brl, dataBr, diasDesde, mesAnterior, mesAtual, nomeMes, type Resumo as R } from '../api';
import type { Ctx } from '../App';
import { Cabecalho, Icone, Stat, Vazio } from '../ui';

export function Resumo({ ctx }: { ctx: Ctx }) {
  const [mes, setMes] = useState(mesAtual());
  const [r, setR] = useState<R | null>(null);
  const [comentando, setComentando] = useState(false);
  const [erroIa, setErroIa] = useState<string | null>(null);
  useEffect(() => { api.get<R>(`resumo?mes=${mes}`).then(setR); }, [mes]);

  async function comentar() {
    setComentando(true); setErroIa(null);
    try {
      const c = await api.post<{ texto: string; origem: string }>('ia/comentario', { mes });
      setR(x => x && { ...x, comentario: { texto: c.texto, origem: c.origem, criado_em: new Date().toISOString().replace('T', ' ').slice(0, 19) } });
    } catch (e) { setErroIa((e as Error).message); }
    setComentando(false);
  }

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
  const entradas = r.entradas + r.entradasPendentes.total;
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
        <Stat rotulo="Saídas" valor={brl(saidas)} tom="rosa" sub={r.carteiraPendente.n ? `inclui ${brl(r.carteiraPendente.total)} avisados ainda sem extrato` : `${r.n} lançamentos`} />
        <Stat rotulo="Entradas" valor={brl(entradas)} tom="ciano" sub={r.entradasPendentes.n ? `inclui ${brl(r.entradasPendentes.total)} avisados ainda sem extrato` : undefined} />
        <Stat rotulo="Resultado" valor={brl(entradas - saidas)} tom={entradas - saidas >= 0 ? 'ciano' : 'vermelho'} sub={r.rendaDeclarada ? `renda declarada ${brl(r.rendaDeclarada)} · gastou ${Math.round((saidas / r.rendaDeclarada) * 100)}%` : undefined} />
        <button className={`stat clicavel ${r.semCategoria ? 'amarelo' : ''}`} onClick={() => ctx.ir('lancamentos', { categoria: 'sem' })}>
          <div className="stat-l">Sem categoria</div>
          <div className="stat-v mono">{r.semCategoria}</div>
          <div className="stat-s">{r.semCategoria ? (r.sugestoes ? `${r.sugestoes} com sugestão da IA` : 'toque para categorizar') : 'tudo categorizado'}</div>
        </button>
      </section>

      {ctx.estado.ia && (
        <section className="card">
          <div className="sh"><h2><Icone nome="estrela" tamanho={16} /> Comentário do mês</h2><span className="m">IA local</span></div>
          {r.comentario
            ? <p className="comentario">{r.comentario.texto}</p>
            : <p className="mudo">{comentando ? 'A IA está lendo o mês…' : 'Ainda sem comentário pra este mês.'}</p>}
          <div className="comentario-rodape">
            <span>{erroIa ? <span className="txt-laranja">{erroIa}</span> : r.comentario ? `gerado em ${dataBr(r.comentario.criado_em)} · ${(r.comentario.origem || '').replace('ai_task.', '')}` : 'gera sozinho depois de cada importação'}</span>
            <button className="btn pequeno roxo" disabled={comentando} onClick={comentar}>{comentando ? 'Pensando…' : r.comentario ? 'Gerar de novo' : 'Gerar agora'}</button>
          </div>
        </section>
      )}

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
            <div className="sh"><h2>Por dono</h2><button className="m link" onClick={() => ctx.ir('pessoas')}>perfis</button></div>
            <ul className="linhas">
              {r.porDono.map(d => (
                <li key={d.dono}>
                  <span><span className="ponto" style={{ background: d.cor || '#8089a7' }} />{d.dono}</span>
                  <span className="lin-dir">
                    {d.renda_mensal ? <span className="mudo pequeno">{Math.round((d.total / d.renda_mensal) * 100)}% da renda</span> : null}
                    <span className="mono">{brl(d.total)}</span>
                  </span>
                </li>
              ))}
              {r.porDono.length === 0 && <li className="mudo">—</li>}
            </ul>
          </section>
          {r.recorrentes.length > 0 && (
            <section className="card">
              <div className="sh"><h2><Icone nome="repetir" tamanho={16} /> Cobranças que se repetem</h2><span className="m">últimos 90 dias</span></div>
              <ul className="linhas">
                {r.recorrentes.map(x => (
                  <li key={x.descricao + x.valor}>
                    <span><b>{x.descricao}</b><br /><span className="recorrente-sub">{x.vezes}x de {brl(x.valor)} · última {dataBr(x.ultima)}{x.categoria ? ` · ${x.categoria}` : ''}</span></span>
                    <span className="mono">{brl(x.total)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
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
