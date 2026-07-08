// Vista del muestrista: tareas, capturas activas, historial y tiempos muertos
import { db, fsOk } from './fb.js';
import { APP, USERS, TM_CAUSES, OPEN_STATES } from './state.js';
import { es, fmt, fmtMin, fmtDate, getRange, toast, openOvl, closeOvl } from './utils.js';
import { timers, getT, elapsedOf, tmOf, tenOf, startT, pauseT, startTM, endTM, restoreTimers, seedFromDoc } from './timers.js';
import { startCap, openCap, reopenCorreccion } from './captura.js';

export function mTab(i, btn) {
  [0, 1, 2].forEach(j => document.getElementById('mt' + j).classList.remove('on'));
  document.getElementById('mt' + i).classList.add('on');
  document.querySelectorAll('#sM .nb').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  if (i === 2) loadMHist();
  if (i === 1) renderActivas();
}

export function initMuestrista() {
  document.getElementById('m-name').textContent = APP.user.nombre;
  restoreTimers();
  if (!fsOk()) return;
  APP.listeners.forEach(u => { try { u(); } catch (e) {} });
  APP.listeners = [];
  // Un solo where; el estado se filtra en cliente (evita índices compuestos)
  APP.listeners.push(db.collection('desarrollos')
    .where('asignado_a', '==', APP.user.id)
    .onSnapshot(snap => {
      const docs = snap.docs.filter(d => ['pendiente', 'en_proceso'].includes(d.data().estado));
      const el = document.getElementById('tareas-list');
      if (!el) return;
      el.innerHTML = docs.length === 0
        ? '<div class="empty"><div class="ico">📋</div><p>Sin tareas asignadas</p></div>'
        : docs.map(d => renderTarea(d.id, d.data())).join('');
    }, e => console.error(e)));
  // Capturas abiertas — incluye 'correccion' para que el muestrista vea
  // las fichas que Lety devolvió (bug del prototipo: quedaban invisibles)
  APP.listeners.push(db.collection('capturas')
    .where('id_muestrista', '==', APP.user.id)
    .onSnapshot(snap => {
      const docs = snap.docs.filter(d => OPEN_STATES.includes(d.data().estado));
      docs.forEach(d => seedFromDoc(d.id, d.data()));
      APP.activasSnap = docs.map(d => ({ id: d.id, data: d.data() }));
      renderActivas();
    }, e => console.error(e)));
}

function renderTarea(devId, d) {
  const vars = d.variantes || [];
  return `<div class="card">
    <div class="dt">${es(d.modelo)} <span style="font-size:12px;color:var(--tx2)">· ${es(d.cliente)}</span></div>
    <div class="ds">${es(d.tipo_producto || '')} · ${es(d.genero)} ${es(d.talla)}</div>
    <div style="font-size:11px;color:var(--tx2);margin:4px 0">OT ${es(d.ot)} · PO ${es(d.po)}</div>
    ${d.notas ? `<div class="al ali" style="margin:8px 0"><span>📌</span><span style="font-size:12px">${es(d.notas)}</span></div>` : ''}
    <div class="stitle" style="margin-top:10px">Variantes</div>
    ${vars.map(v => `<div class="vi">
      <div style="flex:1"><div class="vcod">${es(v.codigo)}</div><div style="font-size:12px;color:var(--tx2)">${es(v.descripcion)} · ${es(v.pares_requeridos)} pares · ${es(v.tipo_pack)}</div></div>
      <button class="btn btn-am btn-sm" style="width:auto;padding:8px 14px" data-act="start" data-dev="${es(devId)}" data-cod="${es(v.codigo)}">▶ Iniciar</button>
    </div>`).join('')}
  </div>`;
}

export function renderActivas() {
  const list = APP.activasSnap || [];
  const el = document.getElementById('activas-list');
  if (!el) return;
  if (list.length === 0) {
    el.innerHTML = '<div class="empty"><div class="ico">⏱</div><p>Sin capturas activas</p></div>';
    return;
  }
  el.innerHTML = list.map(({ id, data: dt }) => {
    const t = timers[id] || { running: false, tmActive: false };
    if (dt.estado === 'correccion') {
      return `<div class="card rd">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <span class="vcod">${es(dt.codigo_variante)}</span>
          <span style="font-size:13px;font-weight:600;flex:1">${es(dt.modelo)}</span>
          <span class="bge brd">🔁 Corrección</span>
        </div>
        <div class="ds" style="margin-bottom:8px">Lety solicitó corregir esta ficha. Ábrela, ajusta los datos y vuelve a firmar.</div>
        <button class="btn btn-rd btn-sm" style="width:100%" data-act="fix" data-id="${es(id)}">🔁 Corregir ficha</button>
      </div>`;
    }
    return `<div class="card ${t.running ? 'am' : ''}">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <span class="vcod">${es(dt.codigo_variante)}</span>
        <span style="font-size:13px;font-weight:600;flex:1">${es(dt.modelo)}</span>
        <span style="font-size:11px;color:var(--tx2)">${es(dt.descripcion_variante)}</span>
      </div>
      <div class="timer ${t.running ? 'tgn' : 'tam'}" style="font-size:30px" data-tf="el" data-tid="${es(id)}">${fmt(elapsedOf(id))}</div>
      <div class="trow">
        <span>TEN: <strong style="color:var(--gn)" data-tf="ten" data-tid="${es(id)}">${fmt(tenOf(id))}</strong></span>
        <span style="color:var(--rd)">TM: <span data-tf="tm" data-tid="${es(id)}">${fmt(tmOf(id))}</span></span>
      </div>
      ${t.tmActive ? '<div class="al alw" style="margin-top:8px;margin-bottom:0"><span>⏸</span><span style="font-size:12px">TM en curso — el TEN está pausado</span></div>' : ''}
      <div class="brow" style="margin-top:10px">
        <button class="btn btn-am btn-sm" style="flex:2" data-act="open" data-id="${es(id)}">📝 Abrir ficha</button>
        <button class="btn btn-rd btn-sm" style="flex:1" data-act="tm" data-id="${es(id)}">⏸ TM</button>
        <button class="btn btn-gh btn-sm" style="flex:1" data-act="tog" data-id="${es(id)}">${t.running ? '⏸' : '▶'}</button>
      </div>
    </div>`;
  }).join('');
}

// Delegación de eventos: un solo listener por contenedor (el prototipo
// registraba handlers nuevos en cada render y fugaba memoria)
export function wireMuestristaEvents() {
  document.getElementById('tareas-list').addEventListener('click', e => {
    const btn = e.target.closest('[data-act="start"]');
    if (btn) startCap(btn.dataset.dev, btn.dataset.cod);
  });
  document.getElementById('activas-list').addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.dataset.id;
    switch (btn.dataset.act) {
      case 'open': openCap(id); break;
      case 'fix': reopenCorreccion(id); break;
      case 'tm': openTMFor(id); break;
      case 'tog': {
        const t = timers[id];
        if (t && t.running) pauseT(id, true); else startT(id);
        renderActivas();
        break;
      }
    }
  });
  document.getElementById('tm-btns').addEventListener('click', e => {
    const btn = e.target.closest('[data-cause]');
    if (btn) startTMCause(APP.tmTarget, btn.dataset.cause);
  });
}

// Actualización por segundo de los displays (sin re-render completo)
setInterval(() => {
  document.querySelectorAll('[data-tf]').forEach(elm => {
    const id = elm.dataset.tid;
    if (!timers[id]) return;
    if (elm.dataset.tf === 'el') elm.textContent = fmt(elapsedOf(id));
    else if (elm.dataset.tf === 'ten') elm.textContent = fmt(tenOf(id));
    else if (elm.dataset.tf === 'tm') elm.textContent = fmt(tmOf(id));
  });
}, 1000);

// ── Tiempo muerto ──
export function openTMFor(capturaId) {
  APP.tmTarget = capturaId;
  document.getElementById('tm-btns').innerHTML = TM_CAUSES.map(c => `
    <button class="btn btn-gh btn-sm" style="margin-bottom:8px;width:100%;justify-content:space-between;text-align:left" data-cause="${es(c.id)}">
      <span>${es(c.label)}</span>
      <span class="bge ${c.ext ? 'bok' : 'bpend'}" style="margin-left:8px;flex-shrink:0">${c.ext ? 'externo' : 'interno'}</span>
    </button>`).join('');
  openOvl('otm');
}

function startTMCause(capturaId, causeId) {
  if (!capturaId) return;
  startTM(capturaId, causeId);
  closeOvl('otm');
  const cause = TM_CAUSES.find(c => c.id === causeId);
  document.getElementById('tma-cause').textContent = cause ? cause.label : causeId;
  APP.tmaCapId = capturaId;
  openOvl('otma');
  renderActivas();
}

export function endTMA() {
  endTM(APP.tmaCapId);
  closeOvl('otma');
  renderActivas();
}

// ── Historial del muestrista ──
export async function loadMHist() {
  if (!fsOk()) return;
  try {
    const period = document.getElementById('mhf')?.value || 'day';
    const { start, end } = getRange(period);
    const snap = await db.collection('capturas').where('id_muestrista', '==', APP.user.id).get();
    const docs = snap.docs.filter(d => {
      const dt = d.data();
      if (!dt.dt_fin) return false;
      const ms = dt.dt_fin.toMillis ? dt.dt_fin.toMillis() : 0;
      return ms >= start && ms <= end;
    });
    document.getElementById('mhc').textContent = docs.length;
    document.getElementById('mhl').innerHTML = docs.length === 0
      ? '<div class="empty"><div class="ico">📭</div><p>Sin capturas en este período</p></div>'
      : docs.map(d => {
          const dt = d.data();
          // TEN histórico siempre desde Firestore, nunca desde timers en memoria
          const tn = Math.max(0, (dt.elapsed_seg || 0) - (dt.tm_seg || 0));
          return `<div class="card" style="margin-bottom:8px">
            <div style="display:flex;align-items:center;gap:8px">
              <span class="vcod">${es(dt.codigo_variante)}</span>
              <span style="font-size:13px;font-weight:600;flex:1">${es(dt.modelo)}</span>
              <span class="bge ${dt.estado === 'aprobado' ? 'bok' : 'bpend'}">${dt.estado === 'aprobado' ? '✅' : '🔄'}</span>
            </div>
            <div class="mr"><span>${fmtDate(dt.dt_fin)}</span><span>TEN: <strong style="color:var(--gn)">${fmtMin(tn)}</strong></span></div>
          </div>`;
        }).join('');
  } catch (e) { console.error('Historial error:', e); }
}
