// Timers múltiples simultáneos, basados en timestamps.
// A diferencia del prototipo (que contaba con setInterval elapsed++ y se
// atrasaba si la tablet apagaba la pantalla), aquí el tiempo transcurrido se
// calcula siempre contra Date.now(), así el conteo es exacto aunque el
// navegador congele la pestaña.
import { db } from './fb.js';
import { APP } from './state.js';
import { penFromCausas } from './utils.js';

// capId -> { running, startedAt, accum, tmActive, tmStartedAt, tmAccum,
//            cause, tmCauseStart, causes }
//   accum / tmAccum: segundos acumulados hasta la última pausa
//   startedAt / tmStartedAt: timestamp (ms) del último arranque, null si pausado
//   causes: {causaId: segundos} de los TM ya cerrados (auditoría por causa)
//   tmCauseStart: valor de tmOf() cuando arrancó el TM en curso
export const timers = {};

function lsKey() { return 'qu_t_' + (APP.user ? APP.user.id : 'anon'); }

function blank() {
  return {
    running: false, startedAt: null, accum: 0,
    tmActive: false, tmStartedAt: null, tmAccum: 0,
    cause: null, tmCauseStart: 0, causes: {},
  };
}

export function getT(id) {
  if (!timers[id]) timers[id] = blank();
  return timers[id];
}

export function elapsedOf(id) {
  const t = timers[id];
  if (!t) return 0;
  return Math.floor(t.accum + (t.running && t.startedAt ? (Date.now() - t.startedAt) / 1000 : 0));
}
export function tmOf(id) {
  const t = timers[id];
  if (!t) return 0;
  return Math.floor(t.tmAccum + (t.running && t.tmActive && t.tmStartedAt ? (Date.now() - t.tmStartedAt) / 1000 : 0));
}

// Segundos del segmento de TM en curso (aún no cerrados en `causes`)
function liveCauseSeg(id) {
  const t = timers[id];
  if (!t || !t.tmActive) return 0;
  return Math.max(0, tmOf(id) - (t.tmCauseStart || 0));
}

// TM penalizable: causas internas que "sí afectan" cuentan dentro del TEN
export function penOf(id) {
  const t = timers[id];
  if (!t) return 0;
  let pen = penFromCausas(t.causes);
  if (t.tmActive && t.cause) {
    pen += penFromCausas({ [t.cause]: liveCauseSeg(id) });
  }
  return Math.floor(pen);
}

export function tenOf(id) { return Math.max(0, elapsedOf(id) - tmOf(id) + penOf(id)); }

// Mapa causa->segundos incluyendo el segmento activo (para persistir)
export function causesOf(id) {
  const t = timers[id];
  if (!t) return {};
  const out = { ...(t.causes || {}) };
  if (t.tmActive && t.cause) {
    out[t.cause] = (out[t.cause] || 0) + liveCauseSeg(id);
  }
  return out;
}

export function startT(id) {
  const t = getT(id);
  if (t.running) return;
  t.running = true;
  t.startedAt = Date.now();
  if (t.tmActive) t.tmStartedAt = Date.now();
  persist();
}

export function pauseT(id, sync = false) {
  const t = timers[id];
  if (!t) return;
  if (t.running) {
    t.accum = elapsedOf(id);
    t.tmAccum = tmOf(id);
    t.running = false;
    t.startedAt = null;
    t.tmStartedAt = null;
  }
  persist();
  if (sync) syncToFS(id);
}

export function startTM(id, causeId) {
  const t = getT(id);
  if (t.tmActive) return;
  t.tmActive = true;
  t.cause = causeId;
  if (!t.running) startT(id);
  else t.tmStartedAt = Date.now();
  t.tmCauseStart = tmOf(id);
  persist();
}

export function endTM(id) {
  const t = timers[id];
  if (!t || !t.tmActive) return;
  const total = tmOf(id);
  if (t.cause) {
    if (!t.causes) t.causes = {};
    t.causes[t.cause] = (t.causes[t.cause] || 0) + Math.max(0, total - (t.tmCauseStart || 0));
  }
  t.tmAccum = total;
  t.tmActive = false;
  t.tmStartedAt = null;
  t.cause = null;
  t.tmCauseStart = 0;
  persist();
}

export function dropTimer(id) {
  delete timers[id];
  persist();
}

export function syncToFS(id) {
  if (!db) return;
  // Solo tiempos: el estado lo gestionan los flujos de captura/firma para no
  // pisar estados como 'correccion' o 'pendiente_lety'.
  db.collection('capturas').doc(id).update({
    elapsed_seg: elapsedOf(id),
    tm_seg: tmOf(id),
    tm_causas: causesOf(id),
  }).catch(() => {});
}

// ── Persistencia local (sobrevive recargas de página) ──
export function persist() {
  try {
    const out = {};
    Object.entries(timers).forEach(([id, t]) => {
      out[id] = {
        running: t.running, startedAt: t.startedAt, accum: t.accum,
        tmActive: t.tmActive, tmStartedAt: t.tmStartedAt, tmAccum: t.tmAccum,
        cause: t.cause, tmCauseStart: t.tmCauseStart || 0, causes: t.causes || {},
      };
    });
    localStorage.setItem(lsKey(), JSON.stringify(out));
  } catch (e) { /* almacenamiento lleno o bloqueado: ignorar */ }
}

export function restoreTimers() {
  try {
    const saved = JSON.parse(localStorage.getItem(lsKey()) || '{}');
    Object.entries(saved).forEach(([id, v]) => {
      if (timers[id]) return;
      timers[id] = {
        running: !!v.running, startedAt: v.startedAt || null, accum: v.accum || 0,
        tmActive: !!v.tmActive, tmStartedAt: v.tmStartedAt || null, tmAccum: v.tmAccum || 0,
        cause: v.cause || null,
        // Migración de estado viejo: si el TM venía activo pero sin tmCauseStart
        // (versión anterior no lo guardaba), usar tmAccum como punto de partida
        // para no atribuir todo el TM histórico a la causa actual al cerrarlo
        tmCauseStart: v.tmCauseStart ?? (v.tmActive ? (v.tmAccum || 0) : 0),
        causes: (v.causes && typeof v.causes === 'object') ? v.causes : {},
      };
    });
  } catch (e) { /* JSON corrupto: empezar limpio */ }
}

// Inicializa un timer desde los datos de Firestore si no existe localmente
export function seedFromDoc(id, data) {
  if (timers[id]) return;
  timers[id] = {
    running: false, startedAt: null, accum: data.elapsed_seg || 0,
    tmActive: false, tmStartedAt: null, tmAccum: data.tm_seg || 0,
    cause: null, tmCauseStart: 0,
    causes: { ...(data.tm_causas || {}) },
  };
}

export function clearAllTimers() {
  Object.keys(timers).forEach(id => pauseT(id, true));
  Object.keys(timers).forEach(id => delete timers[id]);
  persist(); // sin esto, la próxima sesión restauraría timers ya limpiados
}

// Sincroniza a Firestore cada 60 s los timers corriendo (para que Lety vea
// avance en "En proceso" sin esperar una pausa)
setInterval(() => {
  Object.entries(timers).forEach(([id, t]) => { if (t.running) syncToFS(id); });
}, 60000);
