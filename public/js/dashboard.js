// Dashboard de Lety: KPIs, historial filtrable y barras de comparación.
// La exportación (CSV y Excel) vive en export.js, con una sola definición de
// columnas compartida por ambos formatos.
import { db, fsOk } from './fb.js';
import { APP, USERS, TM_CAUSES } from './state.js';
import { es, fmtMin, fmtDate, getRange, toast, tenFromDoc } from './utils.js';

// Identificador de carga: si el filtro cambia mientras una consulta vieja
// sigue en vuelo, la respuesta vieja se descarta (no pisa la nueva)
let loadSeq = 0;

export async function loadDB() {
  if (!fsOk()) return;
  const seq = ++loadSeq;
  APP.dbDocs = []; // el CSV nunca exporta datos de un filtro anterior
  const cmpEl = document.getElementById('db-cmp');
  if (cmpEl) cmpEl.innerHTML = ''; // sin barras del filtro anterior
  try {
    const period = document.getElementById('dp')?.value || 'month';
    const who = document.getElementById('dw')?.value || 'all';
    const { start, end } = getRange(period);
    let q = db.collection('capturas');
    if (who !== 'all') q = q.where('id_muestrista', '==', who);
    const snap = await q.get();
    if (seq !== loadSeq) return; // llegó tarde: ya hay una carga más nueva
    // Filtrado por fecha/estado en cliente (evita índices compuestos)
    const docs = snap.docs.filter(d => {
      const dt = d.data();
      if (!dt.dt_fin) return false;
      const ms = dt.dt_fin.toMillis ? dt.dt_fin.toMillis() : 0;
      return ms >= start && ms <= end && ['aprobado', 'pendiente_lety', 'correccion'].includes(dt.estado);
    });
    APP.dbDocs = docs.map(d => ({ id: d.id, data: d.data() }));
    const aprob = docs.filter(d => d.data().estado === 'aprobado');
    // IPP 1ª pasada: % de fichas aprobadas sin ninguna corrección (iter 1)
    const firstPass = aprob.filter(d => (d.data().iter || 1) === 1).length;
    // KPIs de cierre solo sobre APROBADAS (una ficha en corrección no está completada)
    const avgTen = aprob.length > 0
      ? Math.round(aprob.reduce((a, d) => a + tenFromDoc(d.data()), 0) / aprob.length / 60)
      : null;
    const tmTot = docs.reduce((a, d) => a + (d.data().tm_seg || 0), 0);
    document.getElementById('db0').textContent = aprob.length;
    document.getElementById('db1').textContent = avgTen === null ? '—' : avgTen + 'm';
    document.getElementById('db2').textContent = aprob.length ? Math.round(firstPass / aprob.length * 100) + '%' : '—';
    document.getElementById('db3').textContent = Math.round(tmTot / 60);
    document.getElementById('db-list').innerHTML = docs.length === 0
      ? '<div class="empty"><div class="ico">📭</div><p>Sin capturas en este período</p></div>'
      : docs.map(d => {
          const dt = d.data();
          const tn = tenFromDoc(dt);
          const badge = dt.estado === 'aprobado' ? '<span class="bge bok">✅ aprobado</span>'
            : dt.estado === 'correccion' ? '<span class="bge brd">🔁 corrección</span>'
            : '<span class="bge bpend">🔄 pendiente</span>';
          return `<div class="card" style="margin-bottom:8px">
            <div style="display:flex;align-items:center;gap:8px">
              <span class="vcod">${es(dt.codigo_variante)}</span>
              <span style="font-size:13px;font-weight:600;flex:1">${es(dt.modelo)}</span>
              ${badge}
            </div>
            <div class="mr"><span>${dt.folio ? es(dt.folio) + ' · ' : ''}${(USERS[dt.id_muestrista] || {}).nombre || es(dt.id_muestrista)}</span><span>${fmtDate(dt.dt_fin)}</span></div>
            <div class="mr"><span>TEN: <strong style="color:var(--gn)">${fmtMin(tn)}</strong></span><span>TM: <span style="color:var(--rd)">${fmtMin(dt.tm_seg || 0)}</span></span></div>
            ${dt.estado === 'aprobado' ? `<button class="btn btn-bl btn-sm" style="margin-top:8px;width:100%" data-view="${es(d.id)}">👁 Ver ficha aprobada</button>` : ''}
          </div>`;
        }).join('');
    renderBarras(cmpEl, who, docs, aprob);
  } catch (e) {
    console.error('Dashboard error:', e);
    if (seq === loadSeq) toast('Error cargando el dashboard — revisa tu conexión', false);
  }
}

// ── Barras de comparación ──
function barra(label, valTxt, frac, color) {
  const w = Math.max(0, Math.min(100, Math.round(frac * 100)));
  return `<div class="cmp"><span class="cl">${es(label)}</span><div class="ct"><div class="cb" style="width:${w}%;background:${color}"></div></div><span class="cv">${es(valTxt)}</span></div>`;
}

// Comparación descriptiva (no ranking): TEN solo sobre aprobadas y solo con
// el filtro "Todos"; TM por causa sobre el mismo universo que "TM total"
function renderBarras(cmpEl, who, docs, aprob) {
  if (!cmpEl) return;
  let html = '';
  if (who === 'all') {
    const series = Object.keys(USERS).filter(u => USERS[u].rol === 'muestrista').map(uid => {
      const de = aprob.filter(d => d.data().id_muestrista === uid);
      const avg = de.length ? de.reduce((a, d) => a + tenFromDoc(d.data()), 0) / de.length / 60 : 0;
      return { label: USERS[uid].nombre, n: de.length, val: Math.round(avg) };
    }).filter(s => s.n > 0).sort((a, b) => b.val - a.val);
    const max = Math.max(0, ...series.map(s => s.val));
    if (series.length > 0 && max > 0) {
      html += '<div class="stitle" style="margin-top:8px">TEN promedio por muestrista (aprobadas)</div>'
        + series.map(s => barra(s.label, s.val + 'm · ' + s.n + (s.n === 1 ? ' ficha' : ' fichas'), s.val / max, 'var(--gn-full)')).join('');
    }
  }
  const porCausa = {};
  docs.forEach(d => Object.entries(d.data().tm_causas || {}).forEach(([c, s]) => {
    if (typeof s === 'number' && s > 0) porCausa[c] = (porCausa[c] || 0) + s;
  }));
  const causas = Object.entries(porCausa).map(([cid, s]) => {
    const c = TM_CAUSES.find(x => x.id === cid);
    return { label: c ? c.label : cid, raw: s, val: Math.round(s / 60) };
  }).filter(x => x.raw > 0).sort((a, b) => b.raw - a.raw);
  const maxRaw = Math.max(0, ...causas.map(c => c.raw));
  if (causas.length > 0 && maxRaw > 0) {
    html += '<div class="stitle" style="margin-top:8px">TM por causa — minutos del período</div>'
      + causas.map(c => barra(c.label, c.val + 'm', c.raw / maxRaw, 'var(--rd-full)')).join('');
  }
  cmpEl.innerHTML = html;
}
