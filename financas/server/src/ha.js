// Ponte com o Home Assistant pelo Supervisor: escuta o evento da Carteira e publica sensores.
const TOKEN = process.env.SUPERVISOR_TOKEN;
const API = 'http://supervisor/core/api';
const WS = 'ws://supervisor/core/websocket';

export const haDisponivel = () => Boolean(TOKEN);

export async function publicarEstado(entityId, state, attributes, log) {
  if (!TOKEN) return;
  try {
    const r = await fetch(`${API}/states/${entityId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: String(state), attributes }),
    });
    if (!r.ok) log?.warn({ entityId, status: r.status }, 'falha ao publicar sensor');
  } catch (e) {
    log?.warn({ err: e.message, entityId }, 'falha ao publicar sensor');
  }
}

export function escutarEvento(tipo, aoReceber, log) {
  if (!TOKEN) { log?.info('sem SUPERVISOR_TOKEN: não vou escutar eventos do HA'); return; }
  let tentativa = 0;
  const conectar = () => {
    const ws = new WebSocket(WS);
    ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: TOKEN }));
      else if (m.type === 'auth_ok') {
        tentativa = 0;
        ws.send(JSON.stringify({ id: 1, type: 'subscribe_events', event_type: tipo }));
        log?.info(`escutando ${tipo}`);
      } else if (m.type === 'event' && m.event?.event_type === tipo) {
        try { aoReceber(m.event.data); } catch (e) { log?.error({ err: e.message }, 'erro ao tratar evento'); }
      }
    });
    // Um erro de conexão dispara error e depois close; fechar dentro do error gerava recursão infinita.
    let encerrado = false;
    const religar = () => {
      if (encerrado) return;
      encerrado = true;
      const espera = Math.min(60000, 2000 * 2 ** tentativa++);
      setTimeout(conectar, espera);
    };
    ws.addEventListener('close', religar);
    ws.addEventListener('error', () => { if (ws.readyState === WebSocket.OPEN) ws.close(); else religar(); });
  };
  conectar();
}

export async function publicarResumo(r, log) {
  const brl = { unit_of_measurement: 'R$', device_class: 'monetary', state_class: 'total', icon: 'mdi:cash-minus' };
  const cats = Object.fromEntries(r.porCategoria.slice(0, 12).map(c => [c.categoria, Math.round(c.total * 100) / 100]));
  const donos = Object.fromEntries(r.porDono.map(d => [d.dono, Math.round(d.total * 100) / 100]));
  await publicarEstado('sensor.financas_saidas_do_mes', (r.saidas + r.carteiraPendente.total).toFixed(2), {
    ...brl, friendly_name: 'Finanças · saídas do mês', mes: r.mes, por_categoria: cats, por_dono: donos,
    carteira_pendente: r.carteiraPendente.total, extratos: r.saidas,
    comentario: r.comentario?.texto || null,
    recorrentes: (r.recorrentes || []).map(x => `${x.descricao} · R$ ${x.valor.toFixed(2).replace('.', ',')} x${x.vezes}`),
  }, log);
  await publicarEstado('sensor.financas_entradas_do_mes', r.entradas.toFixed(2), {
    ...brl, icon: 'mdi:cash-plus', friendly_name: 'Finanças · entradas do mês', mes: r.mes,
  }, log);
  await publicarEstado('sensor.financas_sem_categoria', r.semCategoria, {
    friendly_name: 'Finanças · lançamentos sem categoria', icon: 'mdi:tag-off-outline', sugestoes_da_ia: r.sugestoes || 0,
  }, log);
  const ultimas = r.contas.map(c => c.ultima_importacao).filter(Boolean).sort();
  const atrasadas = r.contas.filter(c => !c.ultima_importacao || (Date.now() - Date.parse(c.ultima_importacao + 'Z')) > 8 * 864e5).map(c => c.nome);
  await publicarEstado('sensor.financas_ultima_importacao', ultimas.length ? new Date(ultimas.at(-1) + 'Z').toISOString() : 'unknown', {
    device_class: 'timestamp', friendly_name: 'Finanças · última importação', icon: 'mdi:file-upload-outline',
    contas_atrasadas: atrasadas,
  }, log);
}

export async function listarNotificadores() {
  if (!TOKEN) return [];
  try {
    const r = await fetch(`${API}/services`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const doms = await r.json();
    const notify = doms.find(d => d.domain === 'notify');
    return Object.keys(notify?.services || {}).filter(s => s.startsWith('mobile_app_')).sort();
  } catch { return []; }
}
