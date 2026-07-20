// Utilidades de UI y formato
import { TM_CAUSES } from './state.js';

export function p(n) { return String(n).padStart(2, '0'); }
export function fmt(s) {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return p(h) + ':' + p(m) + ':' + p(sec);
}
export function fmtMin(s) { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + 'm ' + p(s % 60) + 's'; }
export function fmtDate(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }) + ' ' +
         d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}
export function es(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
export function scr(id) {
  document.querySelectorAll('.scr').forEach(s => s.classList.remove('on'));
  document.getElementById(id).classList.add('on');
}
export function openOvl(id) { document.getElementById(id).classList.add('on'); }
export function closeOvl(id) { document.getElementById(id).classList.remove('on'); }
export function toast(msg, ok = true) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.borderColor = ok ? 'var(--gn)' : 'var(--rd)';
  t.style.display = 'block';
  clearTimeout(t._tid);
  t._tid = setTimeout(() => t.style.display = 'none', 2800);
}
export function gv(id) { return document.getElementById(id)?.value || ''; }

// Rango de fechas para filtros (semana inicia en lunes)
export function getRange(period) {
  const now = new Date(), start = new Date();
  if (period === 'day') start.setHours(0, 0, 0, 0);
  else if (period === 'week') {
    const dow = (now.getDay() + 6) % 7; // 0 = lunes
    start.setDate(now.getDate() - dow);
    start.setHours(0, 0, 0, 0);
  } else if (period === 'month') { start.setDate(1); start.setHours(0, 0, 0, 0); }
  else { start.setMonth(0, 1); start.setHours(0, 0, 0, 0); }
  return { start: start.getTime(), end: now.getTime() };
}

// Modal de confirmación genérico para acciones destructivas
export function confirmDlg(title, msg, okLabel, onOk) {
  document.getElementById('cf-title').textContent = title;
  document.getElementById('cf-msg').textContent = msg;
  const btn = document.getElementById('cf-ok');
  btn.textContent = okLabel;
  btn.onclick = () => { closeOvl('ocf'); onOk(); };
  openOvl('ocf');
}

// ── TM penalizable y TEN desde datos persistidos ──
const PEN_IDS = new Set(TM_CAUSES.filter(c => c.pen).map(c => c.id));

// Suma de segundos de causas que sí penalizan dentro de un mapa {causa: seg}
export function penFromCausas(tc) {
  let s = 0;
  Object.entries(tc || {}).forEach(([c, v]) => {
    if (PEN_IDS.has(c) && typeof v === 'number' && v > 0) s += v;
  });
  return Math.floor(s);
}

// TEN de una captura persistida: bruto − TM + TM penalizable
export function tenFromDoc(dt) {
  return Math.max(0, (dt.elapsed_seg || 0) - (dt.tm_seg || 0) + penFromCausas(dt.tm_causas));
}

// Solo aceptamos como firma un PNG en data-URL bien formado; cualquier otra
// cosa en firma_m/firma_l se ignora al renderizar (bloquea XSS almacenado)
export function esFirmaValida(v) {
  return typeof v === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(v);
}
