// Vista del muestrista: tareas, capturas activas, historial y tiempos muertos
import { db, fsOk } from './fb.js';
import { APP, USERS, TM_CAUSES, OPEN_STATES } from './state.js';
import { es, fmt, fmtMin, fmtDate, getRange, toast, openOvl, closeOvl, tenFromDoc } from './utils.js';
import { timers, getT, elapsedOf, tmOf, tenOf, startT, pauseT, startTM, endTM, syncToFS, restoreTimers, seedFromDoc, dropTimer } from './timers.js';
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
      APP.tareasSnap = snap.docs
        .filter(d => ['pendiente', 'en_proceso'].includes(d.data().estado))
        .map(d => ({ id: d.id, data: d.data() }));
      renderTareas();
    }, e => console.error(e)));
  // TODAS las capturas del muestrista: las abiertas alimentan "Activas" y el
  // resto sirve para marcar el avance por variante en "Mis tareas"
  APP.listeners.push(db.collection('capturas')
    .where('id_muestrista', '==', APP.user.id)
    .onSnapshot(snap => {
      APP.allCaps = snap.docs.map(d => ({ id: d.id, data: d.data() }));
      const open = APP.allCaps.filter(c => OPEN_STATES.includes(c.data.estado));
      open.forEach(c => seedFromDoc(c.id, c.data));
      // Timers locales de fichas ya firmadas/aprobadas (cerradas quizá desde
      // otro dispositivo): descartarlos SIN sincronizar para no pisar los
      // tiempos congelados de la ficha
      Object.keys(timers).forEach(id => {
        const c = APP.allCaps.find(x => x.id === id);
        if (c && !OPEN_STATES.includes(c.data.estado)) dropTimer(id);
      });
      APP.activasSnap = open;
      renderActivas();
      renderTareas();
    }, e => console.error(e)));
}

// Estado de una variante según sus capturas existentes
function varStatus(devId, cod) {
  const caps = (APP.allCaps || []).filter(c =>
    c.data.id_desarrollo === devId && c.data.codigo_variante === cod);
  if (caps.some(c => ['activo', 'pausado'].includes(c.data.estado))) return 'abierta';
  if (caps.some(c => c.data.estado === 'correccion')) return 'correccion';
  if (caps.some(c => c.data.estado === 'pendiente_lety')) return 'pendiente';
  if (caps.some(c => c.data.estado === 'aprobado')) return 'aprobada';
  return 'nueva';
}

export function renderTareas() {
  const el = document.getElementById('tareas-list');
  if (!el) return;
  const cards = (APP.tareasSnap || [])
    .map(({ id, data }) => renderTarea(id, data))
    .filter(Boolean);
  el.innerHTML = cards.length
    ? cards.join('')
    : '<div class="empty"><div class="ico">📋</div><p>Sin tareas asignadas</p></div>';
}

function renderTarea(devId, d) {
  const vars = d.variantes || [];
  const sts = vars.map(v => varStatus(devId, v.codigo));
  // Todas las variantes aprobadas: el desarrollo está terminado, ya no es tarea
  if (vars.length > 0 && sts.every(s => s === 'aprobada')) return null;
  return `<div class="card">
    <div class="dt">${es(d.modelo)} <span style="font-size:12px;color:var(--tx2)">· ${es(d.cliente)}</span></div>
    <div class="ds">${es(d.tipo_producto || '')} · ${es(d.genero)} ${es(d.talla)}</div>
    <div style="font-size:11px;color:var(--tx2);margin:4px 0">OT ${es(d.ot)} · PO ${es(d.po)}</div>
    ${d.notas ? `<div class="al ali" style="margin:8px 0"><span>📌</span><span style="font-size:12px">${es(d.notas)}</span></div>` : ''}
    <div class="stitle" style="margin-top:10px">Variantes</div>
    ${vars.map((v, i) => {
      const st = sts[i];
      let accion;
      if (st === 'pendiente') {
        accion = '<span class="bge bpend" style="flex-shrink:0">⏳ Con Lety</span>';
      } else if (st === 'aprobada') {
        accion = `<span class="bge bok" style="flex-shrink:0">✅</span>
          <button class="btn btn-gh btn-sm" style="width:auto;padding:8px 10px" data-act="start" data-dev="${es(devId)}" data-cod="${es(v.codigo)}">🔁 Reiniciar</button>`;
      } else if (st === 'correccion') {
        accion = `<button class="btn btn-rd btn-sm" style="width:auto;padding:8px 14px" data-act="start" data-dev="${es(devId)}" data-cod="${es(v.codigo)}">🔁 Corregir</button>`;
      } else if (st === 'abierta') {
        accion = `<button class="btn btn-gn btn-sm" style="width:auto;padding:8px 14px" data-act="start" data-dev="${es(devId)}" data-cod="${es(v.codigo)}">⏱ Continuar</button>`;
      } else {
        accion = `<button class="btn btn-am btn-sm" style="width:auto;padding:8px 14px" data-act="start" data-dev="${es(devId)}" data-cod="${es(v.codigo)}">▶ Iniciar</button>`;
      }
      return `<div class="vi">
        <div style="flex:1"><div class="vcod">${es(v.codigo)}</div><div style="font-size:12px;color:var(--tx2)">${es(v.descripcion)} · ${es(v.pares_requeridos)} pares · ${es(v.tipo_pack)}</div></div>
        ${accion}
      </div>`;
    }).join('')}
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
    const tmCauseDef = t.tmActive ? TM_CAUSES.find(c => c.id === t.cause) : null;
    const tmMsg = tmCauseDef && tmCauseDef.pen
      ? 'TM en curso — este TM sí cuenta en tu TEN'
      : 'TM en curso — el TEN está pausado';
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
      ${t.tmActive ? `<div class="al alw" style="margin-top:8px;margin-bottom:0"><span>⏸</span><span style="font-size:12px">${tmMsg}</span></div>` : ''}
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
  const t = timers[capturaId];
  // Ya hay un TM en curso: mostrar directo el modal de fin con la causa REAL
  // (antes se podía "elegir" otra causa que no quedaba registrada)
  if (t && t.tmActive) {
    const c = TM_CAUSES.find(x => x.id === t.cause);
    document.getElementById('tma-cause').textContent = c ? c.label : '—';
    APP.tmaCapId = capturaId;
    openOvl('otma');
    return;
  }
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
  syncToFS(APP.tmaCapId); // que Lety vea el TM cerrado sin esperar al sync de 60 s
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
    // Mismos estados que el dashboard de Lety: una ficha reabierta ('activo')
    // vive en "Activas", no duplicada aquí
    const docs = snap.docs.filter(d => {
      const dt = d.data();
      if (!dt.dt_fin) return false;
      if (!['aprobado', 'pendiente_lety', 'correccion'].includes(dt.estado)) return false;
      const ms = dt.dt_fin.toMillis ? dt.dt_fin.toMillis() : 0;
      return ms >= start && ms <= end;
    });
    document.getElementById('mhc').textContent = docs.length;
    document.getElementById('mhl').innerHTML = docs.length === 0
      ? '<div class="empty"><div class="ico">📭</div><p>Sin capturas en este período</p></div>'
      : docs.map(d => {
          const dt = d.data();
          // TEN histórico siempre desde Firestore, nunca desde timers en memoria
          const tn = tenFromDoc(dt);
          return `<div class="card" style="margin-bottom:8px">
            <div style="display:flex;align-items:center;gap:8px">
              <span class="vcod">${es(dt.codigo_variante)}</span>
              <span style="font-size:13px;font-weight:600;flex:1">${es(dt.modelo)}</span>
              <span class="bge ${dt.estado === 'aprobado' ? 'bok' : 'bpend'}">${dt.estado === 'aprobado' ? '✅' : '🔄'}</span>
            </div>
            <div class="mr"><span>${fmtDate(dt.dt_fin)}</span><span>TEN: <strong style="color:var(--gn)">${fmtMin(tn)}</strong></span></div>
          </div>`;
        }).join('');
  } catch (e) {
    console.error('Historial error:', e);
    toast('Error cargando historial', false);
  }
}
