import { useEffect, useRef, useState } from 'react';
import { api, brl, dataBr, type Importacao, type Perfil, type Previa } from '../api';
import type { Ctx } from '../App';
import { Cabecalho, Chip, Icone, Vazio } from '../ui';

type Resultado = { novos: number; duplicados: number; conciliados: number; de: string | null; ate: string | null };

export function Importar({ ctx }: { ctx: Ctx }) {
  const contas = ctx.contas.filter(c => !c.arquivada);
  const [contaId, setContaId] = useState<number | ''>(contas[0]?.id ?? '');
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [historico, setHistorico] = useState<Importacao[]>([]);
  const [arrastando, setArrastando] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const carregarHistorico = () => api.get<Importacao[]>('importacoes').then(setHistorico);
  useEffect(() => { carregarHistorico(); }, []);

  async function enviar(f: File) {
    if (!contaId) { setErro('Escolha a conta antes do arquivo.'); return; }
    setErro(null); setResultado(null); setOcupado(true);
    const fd = new FormData();
    fd.append('contaId', String(contaId));
    fd.append('arquivo', f);
    try {
      const p = await api.post<Previa>('importar/previa', fd);
      setPrevia(p); setPerfil(p.perfil);
    } catch (e) { setErro((e as Error).message); }
    finally { setOcupado(false); }
  }

  async function mudarPerfil(novo: Perfil) {
    if (!previa) return;
    setPerfil(novo);
    try {
      const p = await api.post<Partial<Previa>>('importar/reprevia', { token: previa.token, perfil: novo });
      setPrevia({ ...previa, ...p });
    } catch (e) { setErro((e as Error).message); }
  }

  async function confirmar() {
    if (!previa) return;
    setOcupado(true); setErro(null);
    try {
      const r = await api.post<Resultado>('importar/confirmar', { token: previa.token, contaId, perfil });
      setResultado(r); setPrevia(null); setPerfil(null);
      carregarHistorico(); ctx.recarregar();
    } catch (e) { setErro((e as Error).message); }
    finally { setOcupado(false); }
  }

  async function desfazer(i: Importacao) {
    if (!confirm(`Desfazer a importação de ${i.arquivo}? Os ${i.novos} lançamentos dela serão removidos.`)) return;
    await api.del(`importacoes/${i.id}`);
    carregarHistorico(); ctx.recarregar();
  }

  if (!contas.length) {
    return <><Cabecalho titulo="Importar extrato" /><Vazio titulo="Cadastre uma conta primeiro"><button className="btn" onClick={() => ctx.ir('contas')}>Cadastrar contas</button></Vazio></>;
  }

  const conta = contas.find(c => c.id === contaId);
  return (
    <>
      <Cabecalho titulo="Importar extrato" sub="CSV ou OFX exportado do app ou do site do banco. Reimportar o mesmo período não duplica nada." />

      {resultado && (
        <div className="banner ciano">
          <Icone nome="ok" />
          <div className="banner-txt">
            <b>{resultado.novos} lançamentos novos</b>
            <span>{resultado.duplicados} já existiam{resultado.conciliados ? ` · ${resultado.conciliados} compras da Carteira conciliadas` : ''} · {dataBr(resultado.de)} a {dataBr(resultado.ate)}</span>
          </div>
          <button className="btn ciano" onClick={() => ctx.ir('lancamentos', { conta: String(contaId), categoria: 'sem' })}>Categorizar</button>
        </div>
      )}
      {erro && <div className="banner vermelho"><Icone nome="alerta" /><div className="banner-txt"><b>{erro}</b></div></div>}

      {!previa && (
        <section className="card">
          <label className="campo">
            <span>Conta</span>
            <select value={contaId} onChange={e => setContaId(Number(e.target.value))}>
              {contas.map(c => <option key={c.id} value={c.id}>{c.dono} · {c.nome}{c.tipo === 'cartao' ? ' (cartão)' : ''}</option>)}
            </select>
          </label>
          {conta?.perfil && <p className="mudo pequeno">Mapeamento salvo desta conta{conta.perfil.presetNome ? ` (${conta.perfil.presetNome})` : ''} será usado se o arquivo tiver as mesmas colunas.</p>}
          <div
            className={`drop ${arrastando ? 'on' : ''}`}
            onClick={() => input.current?.click()}
            onDragOver={e => { e.preventDefault(); setArrastando(true); }}
            onDragLeave={() => setArrastando(false)}
            onDrop={e => { e.preventDefault(); setArrastando(false); const f = e.dataTransfer.files[0]; if (f) enviar(f); }}
          >
            <Icone nome="arquivo" tamanho={28} />
            <b>{ocupado ? 'Lendo…' : 'Solte o arquivo aqui ou toque para escolher'}</b>
            <span className="mudo">.csv, .ofx ou .txt · até 10 MB</span>
            <input ref={input} type="file" accept=".csv,.ofx,.txt,text/csv" hidden onChange={e => { const f = e.target.files?.[0]; if (f) enviar(f); e.target.value = ''; }} />
          </div>
          {ctx.estado.pasta && <p className="mudo pequeno">Também dá pra soltar o arquivo na pasta compartilhada <code>{ctx.estado.pasta}/{'<dono> - <conta>'}</code> depois da primeira importação pelo painel.</p>}
        </section>
      )}

      {previa && perfil !== undefined && (
        <section className="card">
          <div className="sh">
            <h2>Conferir antes de importar</h2>
            <span className="m">{previa.nome} · {previa.formato.toUpperCase()}{perfil?.presetNome ? ` · ${perfil.presetNome}` : ''}</span>
          </div>

          {previa.formato === 'csv' && perfil && <Mapeamento previa={previa} perfil={perfil} mudar={mudarPerfil} />}

          <div className="stats pequenos">
            <div className="stat"><div className="stat-l">Lançamentos</div><div className="stat-v mono">{previa.total}</div><div className="stat-s">{dataBr(previa.de)} a {dataBr(previa.ate)}</div></div>
            <div className="stat rosa"><div className="stat-l">Saídas</div><div className="stat-v mono">{brl(previa.saidas)}</div></div>
            <div className="stat ciano"><div className="stat-l">Entradas</div><div className="stat-v mono">{brl(previa.entradas)}</div></div>
          </div>

          <table className="tabela">
            <thead><tr><th>Data</th><th>Descrição</th><th className="dir">Valor</th></tr></thead>
            <tbody>
              {previa.exemplos.map((l, i) => (
                <tr key={i}><td className="mono">{dataBr(l.data)}</td><td>{l.descricao}</td><td className={`dir mono ${l.valor < 0 ? 'neg' : 'pos'}`}>{brl(l.valor)}</td></tr>
              ))}
            </tbody>
          </table>
          {previa.nErros > 0 && <p className="txt-laranja pequeno">{previa.nErros} linhas ignoradas (sem data ou valor), ex.: linha {previa.erros[0]?.linha}: {previa.erros[0]?.conteudo}</p>}
          <p className="mudo pequeno">Saídas devem aparecer negativas. Se estiver ao contrário (comum em CSV de cartão), marque “inverter sinal”.</p>

          <div className="acoes">
            <button className="btn fantasma" onClick={() => { setPrevia(null); setPerfil(null); }}>Cancelar</button>
            <button className="btn" disabled={ocupado || !previa.total} onClick={confirmar}>{ocupado ? 'Importando…' : `Importar ${previa.total} lançamentos`}</button>
          </div>
        </section>
      )}

      <section className="card">
        <div className="sh"><h2>Importações</h2><span className="m">últimas 100</span></div>
        {historico.length === 0 && <p className="mudo">Nada importado ainda.</p>}
        <ul className="linhas">
          {historico.map(i => (
            <li key={i.id}>
              <span><b>{i.conta}</b> <span className="mudo">· {i.dono} · {i.arquivo}</span></span>
              <span className="lin-dir">
                <Chip cor="#4ff0c9">{i.novos} novos</Chip>
                {i.duplicados > 0 && <span className="mudo pequeno">{i.duplicados} repetidos</span>}
                <span className="mudo pequeno">{dataBr(i.criado_em)}{i.quem ? ` · ${i.quem}` : ''}</span>
                <button className="icone-btn" title="Desfazer importação" onClick={() => desfazer(i)}><Icone nome="lixo" tamanho={16} /></button>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function Mapeamento({ previa, perfil, mudar }: { previa: Previa; perfil: Perfil; mudar: (p: Perfil) => void }) {
  const cols = previa.colunas;
  const opc = (
    <>
      <option value={-1}>—</option>
      {cols.map((c, i) => <option key={i} value={i}>{c || `coluna ${i + 1}`}</option>)}
    </>
  );
  const set = (k: keyof Perfil, v: unknown) => mudar({ ...perfil, [k]: v, preset: null, presetNome: null });
  const modoDebCred = perfil.colValor < 0;
  return (
    <div className="mapa">
      <label className="campo"><span>Linha do cabeçalho</span>
        <select value={perfil.linhaCabecalho} onChange={e => set('linhaCabecalho', Number(e.target.value))}>
          {previa.bruto.map((l, i) => <option key={i} value={i}>{i + 1}: {l.slice(0, 4).join(' | ').slice(0, 60)}</option>)}
        </select>
      </label>
      <label className="campo"><span>Data</span><select value={perfil.colData} onChange={e => set('colData', Number(e.target.value))}>{opc}</select></label>
      <label className="campo"><span>Formato da data</span>
        <select value={perfil.formatoData} onChange={e => set('formatoData', e.target.value)}>
          {['dd/mm/yyyy', 'dd/mm/yy', 'yyyy-mm-dd', 'dd-mm-yyyy', 'dd.mm.yyyy'].map(f => <option key={f}>{f}</option>)}
        </select>
      </label>
      <label className="campo"><span>Descrição</span><select value={perfil.colDescricao} onChange={e => set('colDescricao', Number(e.target.value))}>{opc}</select></label>
      <label className="campo"><span>Valor</span>
        <select value={perfil.colValor} onChange={e => set('colValor', Number(e.target.value))}>
          <option value={-1}>— débito e crédito separados —</option>
          {cols.map((c, i) => <option key={i} value={i}>{c || `coluna ${i + 1}`}</option>)}
        </select>
      </label>
      {modoDebCred && <>
        <label className="campo"><span>Débito</span><select value={perfil.colDebito} onChange={e => set('colDebito', Number(e.target.value))}>{opc}</select></label>
        <label className="campo"><span>Crédito</span><select value={perfil.colCredito} onChange={e => set('colCredito', Number(e.target.value))}>{opc}</select></label>
      </>}
      <label className="campo"><span>ID do banco (opcional)</span><select value={perfil.colId} onChange={e => set('colId', Number(e.target.value))}>{opc}</select></label>
      <label className="campo"><span>Decimal</span>
        <select value={perfil.decimal} onChange={e => set('decimal', e.target.value)}>
          <option value="auto">automático</option><option value=",">vírgula (1.234,56)</option><option value=".">ponto (1,234.56)</option>
        </select>
      </label>
      <label className="check"><input type="checkbox" checked={perfil.inverterSinal} onChange={e => set('inverterSinal', e.target.checked)} /> Inverter sinal</label>
    </div>
  );
}
