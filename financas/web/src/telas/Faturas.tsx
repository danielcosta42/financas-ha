import { useCallback, useEffect, useState } from 'react';
import { api, brl, dataBr, type EstadoEmail, type Fatura } from '../api';
import type { Ctx } from '../App';
import { Cabecalho, Chip, Icone, Stat, Vazio } from '../ui';

const ORIGEM = { regra: 'lido do e-mail', pdf: 'lido do PDF', ia: 'lido pela IA' } as const;

const diasAte = (iso: string | null) => (iso ? Math.round((Date.parse(`${iso}T12:00:00`) - Date.now()) / 864e5) : null);
function prazo(f: Fatura) {
  if (f.status === 'paga') return <Chip cor="#4ff0c9">paga</Chip>;
  const d = diasAte(f.vencimento);
  if (d === null) return <span className="mudo">sem vencimento</span>;
  if (d < 0) return <Chip cor="#ff7a7a">venceu há {-d} d</Chip>;
  if (d === 0) return <Chip cor="#ff7a7a">vence hoje</Chip>;
  if (d <= 3) return <Chip cor="#ffb86b">vence em {d} d</Chip>;
  return <span className="mudo">em {d} dias</span>;
}

export function Faturas({ ctx }: { ctx: Ctx }) {
  const [dados, setDados] = useState<{ email: EstadoEmail; faturas: Fatura[] } | null>(null);
  const [verificando, setVerificando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<number | null>(null);
  const [form, setForm] = useState({ valor: '', vencimento: '' });
  const [contaSel, setContaSel] = useState<Record<number, string>>({});

  const carregar = useCallback(() => api.get<{ email: EstadoEmail; faturas: Fatura[] }>('faturas').then(setDados).catch(e => setErro(e.message)), []);
  useEffect(() => { carregar(); }, [carregar]);

  async function verificar() {
    setVerificando(true); setErro(null);
    try { await api.post('faturas/verificar'); } catch (e) { setErro((e as Error).message); }
    setVerificando(false); carregar();
  }
  async function mudar(f: Fatura, corpo: Record<string, unknown>) { await api.patch(`faturas/${f.id}`, corpo); carregar(); }
  async function salvarEdicao(f: Fatura) {
    await mudar(f, { valor: form.valor ? Number(form.valor.replace(/\./g, '').replace(',', '.')) : null, vencimento: form.vencimento || null });
    setEditando(null);
  }
  async function importarPdf(f: Fatura) {
    setErro(null);
    try {
      const r = await api.post<{ novos: number; duplicados: number }>(`faturas/${f.id}/importar`, { conta_id: Number(contaSel[f.id]) || f.conta_id });
      alert(`${r.novos} lançamentos importados${r.duplicados ? `, ${r.duplicados} já existiam` : ''}.`);
      ctx.recarregar(); carregar();
    } catch (e) { setErro((e as Error).message); }
  }

  if (!dados) return <Cabecalho titulo="Faturas" sub={erro || 'carregando…'} />;
  const { email, faturas } = dados;
  const abertas = faturas.filter(f => f.status === 'aberta');
  const total = abertas.reduce((s, f) => s + (f.valor || 0), 0);
  const proxima = abertas.filter(f => f.vencimento).sort((a, b) => (a.vencimento! < b.vencimento! ? -1 : 1))[0];
  const cartoes = ctx.contas.filter(c => c.tipo === 'cartao' && !c.arquivada);

  return (
    <>
      <Cabecalho
        titulo="Faturas"
        sub={email.configurado
          ? <>Lendo {email.usuario} a cada {email.intervaloMin} min{email.ultima && <> · última verificação {new Date(email.ultima).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</>}</>
          : 'Faturas dos cartões achadas no seu e-mail'}
        acoes={email.configurado && <button className="btn" onClick={verificar} disabled={verificando || email.rodando}><Icone nome="repetir" />{verificando || email.rodando ? 'Verificando…' : 'Verificar agora'}</button>}
      />

      {!email.configurado && (
        <section className="card">
          <h3 style={{ marginTop: 0 }}>Conecte o e-mail onde chegam as faturas</h3>
          <ol className="passos">
            <li>No Gmail, ative a verificação em duas etapas e crie uma <b>senha de app</b> em myaccount.google.com/apppasswords.</li>
            <li>Em Configurações → Add-ons → Finanças → Configuração, preencha <b>E-mail</b> e <b>Senha de app</b>.</li>
            <li>Se algum banco manda o PDF com senha (muitos usam parte do CPF), coloque em <b>Senhas dos PDFs</b>.</li>
            <li>Salve e reinicie o add-on. Eu olho os últimos 60 dias e depois a cada 30 minutos.</li>
          </ol>
          <p className="mudo pequeno">O acesso é só de leitura: não marco, movo nem apago e-mails. O texto das faturas é lido aqui mesmo; quando as regras não acham o valor, quem lê é a IA da casa ({ctx.estado.ia || 'sem IA configurada'}).</p>
        </section>
      )}

      {email.erro && <div className="banner vermelho"><Icone nome="alerta" /><div className="banner-txt"><b>Não consegui ler o e-mail</b><span>{email.erro}</span></div></div>}
      {erro && <p className="txt-vermelho">{erro}</p>}

      {faturas.length > 0 && (
        <div className="stats pequenos">
          <Stat rotulo="Em aberto" valor={brl(total)} sub={`${abertas.length} fatura${abertas.length === 1 ? '' : 's'}`} tom="rosa" />
          <Stat rotulo="Próxima" valor={proxima?.valor != null ? brl(proxima.valor) : '—'} sub={proxima ? `${proxima.banco} · ${dataBr(proxima.vencimento)}` : 'nenhuma com vencimento'} tom="amarelo" />
          <Stat rotulo="Pagas (120 dias)" valor={faturas.filter(f => f.status === 'paga').length} sub="conciliadas com o extrato ou marcadas" />
        </div>
      )}

      {faturas.length === 0 && email.configurado && (
        <Vazio titulo="Nenhuma fatura encontrada ainda">
          <p>Procuro e-mails com "fatura" no assunto vindos de bancos (Inter, Nubank, Itaú, C6, Santander, Bradesco, BTG, XP, Mercado Pago…).</p>
        </Vazio>
      )}

      {faturas.length > 0 && (
        <section className="card sem-pad">
          <table className="tabela">
            <thead><tr><th>Cartão</th><th className="dir">Valor</th><th>Vencimento</th><th className="esconde-cel">Lançamentos</th><th /></tr></thead>
            <tbody>
              {faturas.map(f => (
                <tr key={f.id} className={f.status !== 'aberta' ? 'apagada' : ''}>
                  <td>
                    <b>{f.banco}{f.cartao_final && <span className="mudo"> · final {f.cartao_final}</span>}</b>
                    <div className="mudo pequeno" title={f.assunto || ''}>{f.conta ? `${f.dono} · ${f.conta}` : 'sem conta ligada'} · recebida {dataBr(f.recebido_em)}</div>
                    {f.erro && <div className="txt-laranja pequeno">{f.erro}</div>}
                  </td>
                  {editando === f.id ? (
                    <>
                      <td className="dir"><input className="mono" style={{ width: 110 }} placeholder="1234,56" value={form.valor} onChange={e => setForm({ ...form, valor: e.target.value })} /></td>
                      <td><input type="date" value={form.vencimento} onChange={e => setForm({ ...form, vencimento: e.target.value })} /></td>
                      <td className="esconde-cel" />
                      <td className="dir nowrap">
                        <button className="btn pequeno" onClick={() => salvarEdicao(f)}>Salvar</button>
                        <button className="btn fantasma pequeno" onClick={() => setEditando(null)}>Cancelar</button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="dir mono">{f.valor != null ? brl(f.valor) : <span className="mudo">—</span>}{f.origem_valor && <div className="mudo pequeno">{ORIGEM[f.origem_valor]}</div>}</td>
                      <td>{dataBr(f.vencimento)} <div>{prazo(f)}</div></td>
                      <td className="esconde-cel">
                        {f.importacao_id ? <Chip cor="#4ff0c9">importados</Chip>
                          : f.pdf ? (
                            <span className="nowrap">
                              <select value={contaSel[f.id] ?? f.conta_id ?? ''} onChange={e => setContaSel({ ...contaSel, [f.id]: e.target.value })}>
                                <option value="">conta…</option>
                                {cartoes.map(c => <option key={c.id} value={c.id}>{c.dono} · {c.nome}</option>)}
                              </select>{' '}
                              <button className="btn pequeno" disabled={!(contaSel[f.id] || f.conta_id)} onClick={() => importarPdf(f)}>Importar PDF</button>
                            </span>
                          ) : <span className="mudo pequeno">sem PDF no e-mail</span>}
                      </td>
                      <td className="dir nowrap">
                        <button className="icone-btn" title="Corrigir valor ou vencimento" onClick={() => { setEditando(f.id); setForm({ valor: f.valor != null ? String(f.valor).replace('.', ',') : '', vencimento: f.vencimento || '' }); }}><Icone nome="lapis" tamanho={16} /></button>
                        {f.status === 'aberta'
                          ? <button className="btn fantasma pequeno" onClick={() => mudar(f, { status: 'paga' })}><Icone nome="ok" tamanho={14} />Paga</button>
                          : <button className="btn fantasma pequeno" onClick={() => mudar(f, { status: 'aberta' })}>Reabrir</button>}
                        {f.status !== 'ignorada' && <button className="icone-btn" title="Não é fatura / ignorar" onClick={() => mudar(f, { status: 'ignorada' })}><Icone nome="lixo" tamanho={16} /></button>}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <p className="mudo pequeno">Uma fatura vira <b>paga</b> sozinha quando o extrato da conta corrente mostra o pagamento com o mesmo valor. O Home Assistant recebe a próxima fatura em <code>sensor.financas_proxima_fatura</code>.</p>
    </>
  );
}
