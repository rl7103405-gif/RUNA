// Dashboard de Lety: KPIs, historial filtrable y exportación a CSV
import { db, fsOk } from './fb.js';
import { APP, USERS } from './state.js';
import { es, fmtMin, fmtDate, getRange, toast } from './utils.js';

export async function loadDB() {
  if (!fsOk()) return;
  try {
    const period = document.getElementById('dp')?.value || 'month';
    const who = document.getElementById('dw')?.value || 'all';
    const { start, end } = getRange(period);
    let q = db.collection('capturas');
    if (who !== 'all') q = q.where('id_muestrista', '==', who);
    const snap = await q.get();
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
    const avgTen = docs.length > 0
      ? Math.round(docs.reduce((a, d) => { const dt = d.data(); return a + Math.max(0, (dt.elapsed_seg || 0) - (dt.tm_seg || 0)); }, 0) / docs.length / 60)
      : 0;
    const tmTot = docs.reduce((a, d) => a + (d.data().tm_seg || 0), 0);
    document.getElementById('db0').textContent = docs.length;
    document.getElementById('db1').textContent = avgTen + 'm';
    document.getElementById('db2').textContent = aprob.length ? Math.round(firstPass / aprob.length * 100) + '%' : '—';
    document.getElementById('db3').textContent = Math.round(tmTot / 60);
    document.getElementById('db-list').innerHTML = docs.length === 0
      ? '<div class="empty"><div class="ico">📭</div><p>Sin capturas en este período</p></div>'
      : docs.map(d => {
          const dt = d.data();
          const tn = Math.max(0, (dt.elapsed_seg || 0) - (dt.tm_seg || 0));
          const badge = dt.estado === 'aprobado' ? '<span class="bge bok">✅ aprobado</span>'
            : dt.estado === 'correccion' ? '<span class="bge brd">🔁 corrección</span>'
            : '<span class="bge bpend">🔄 pendiente</span>';
          return `<div class="card" style="margin-bottom:8px">
            <div style="display:flex;align-items:center;gap:8px">
              <span class="vcod">${es(dt.codigo_variante)}</span>
              <span style="font-size:13px;font-weight:600;flex:1">${es(dt.modelo)}</span>
              ${badge}
            </div>
            <div class="mr"><span>${(USERS[dt.id_muestrista] || {}).nombre || es(dt.id_muestrista)}</span><span>${fmtDate(dt.dt_fin)}</span></div>
            <div class="mr"><span>TEN: <strong style="color:var(--gn)">${fmtMin(tn)}</strong></span><span>TM: <span style="color:var(--rd)">${fmtMin(dt.tm_seg || 0)}</span></span></div>
            ${dt.estado === 'aprobado' ? `<button class="btn btn-bl btn-sm" style="margin-top:8px;width:100%" data-view="${es(d.id)}">👁 Ver ficha aprobada</button>` : ''}
          </div>`;
        }).join('');
  } catch (e) { console.error('Dashboard error:', e); }
}

// ── Exportar historial a CSV ──
function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function exportCSV() {
  const docs = APP.dbDocs || [];
  if (docs.length === 0) { toast('No hay datos en el período seleccionado', false); return; }
  const header = ['fecha_fin', 'muestrista', 'estado', 'iteracion', 'ot', 'po', 'modelo', 'cliente', 'tipo_producto',
    'codigo_variante', 'descripcion', 'tipo_pack', 'pares_producidos', 'pares_requeridos',
    'bruto_min', 'tm_min', 'ten_min', 'maquina_marca', 'maquina_numero',
    't_ciclo_min', 't_ciclo_seg', 'peso_salida_g', 'peso_cerrado_g',
    'med_sh_A', 'med_sh_B', 'med_sh_C', 'med_sh_D', 'med_sh_E',
    'med_h_A', 'med_h_B', 'med_h_C', 'med_h_D', 'med_h_E',
    'giros_elastico', 'giros_tubo', 'giros_planta', 'giros_rubber',
    'vel_elastico', 'vel_tubo', 'vel_talon_punta', 'vel_planta',
    'den1', 'den2', 'sink2', 'observaciones'];
  const rows = docs.map(({ data: dt }) => {
    const sh = dt.med_sh || {}, mh = dt.med_h || {}, gi = dt.giros || {}, vl = dt.vels || {}, pt = dt.pto || {};
    const fin = dt.dt_fin && dt.dt_fin.toDate ? dt.dt_fin.toDate().toISOString() : '';
    const bruto = dt.elapsed_seg || 0, tm = dt.tm_seg || 0;
    return [fin, (USERS[dt.id_muestrista] || {}).nombre || dt.id_muestrista, dt.estado, dt.iter || 1,
      dt.ot, dt.po, dt.modelo, dt.cliente, dt.tipo_producto,
      dt.codigo_variante, dt.descripcion_variante, dt.tipo_pack, dt.pares, dt.pares_requeridos,
      (bruto / 60).toFixed(1), (tm / 60).toFixed(1), (Math.max(0, bruto - tm) / 60).toFixed(1),
      dt.maquina_marca, dt.maquina_numero,
      dt.t_ciclo_min, dt.t_ciclo_seg, dt.peso_sal, dt.peso_cer,
      sh.A, sh.B, sh.C, sh.D, sh.E, mh.A, mh.B, mh.C, mh.D, mh.E,
      gi.el, gi.tb, gi.pl, gi.rb, vl.el, vl.tb, vl.tp, vl.pl,
      pt.d1, pt.d2, pt.sk, dt.obs].map(csvCell).join(',');
  });
  // BOM para que Excel abra acentos correctamente
  const csv = '\uFEFF' + header.join(',') + '\n' + rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const period = document.getElementById('dp')?.value || 'month';
  const today = new Date().toISOString().slice(0, 10);
  a.download = `historial-muestristas-${period}-${today}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('📥 CSV exportado (' + docs.length + ' registros)');
}
