// Exportación del historial: CSV y Excel (.xlsx) desde UNA sola definición de
// columnas. Si CSV y XLSX declararan sus columnas por separado, el fallback a
// CSV acabaría desalineado respecto del Excel en cuanto alguien agregue un
// campo (hallazgo de la revisión de diseño).
import { APP, USERS, TM_CAUSES } from './state.js';
import { toast, tenFromDoc, penFromCausas, loadLib, confirmDlg } from './utils.js';

const EXCELJS_URL = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
// ExcelJS arma el libro y el ZIP en memoria: el pico es varias veces el tamaño
// final. En tablets baratas conviene avisar antes de intentarlo.
const AVISO_FILAS = 2000;
const MAX_FILAS_XLSX = 8000;

const min = s => Number(((s || 0) / 60).toFixed(1));
const t = v => String(v ?? '');

// type: 'txt' (texto), 'num' (número real en Excel), 'date' (fecha real)
export const EXPORT_COLUMNS = [
  { header: 'folio',              type: 'txt',  w: 12, get: d => t(d.folio) },
  { header: 'fecha_fin',          type: 'date', w: 18, get: d => (d.dt_fin && d.dt_fin.toDate ? d.dt_fin.toDate() : null) },
  { header: 'muestrista',         type: 'txt',  w: 12, get: d => (USERS[d.id_muestrista] || {}).nombre || t(d.id_muestrista) },
  { header: 'estado',             type: 'txt',  w: 14, get: d => t(d.estado) },
  { header: 'iteracion',          type: 'num',  w: 10, get: d => Number(d.iter) || 1 },
  { header: 'ot',                 type: 'txt',  w: 10, get: d => t(d.ot) },
  { header: 'po',                 type: 'txt',  w: 10, get: d => t(d.po) },
  { header: 'modelo',             type: 'txt',  w: 16, get: d => t(d.modelo) },
  { header: 'cliente',            type: 'txt',  w: 16, get: d => t(d.cliente) },
  { header: 'tipo_producto',      type: 'txt',  w: 22, get: d => t(d.tipo_producto) },
  { header: 'codigo_variante',    type: 'txt',  w: 14, get: d => t(d.codigo_variante) },
  { header: 'descripcion',        type: 'txt',  w: 18, get: d => t(d.descripcion_variante) },
  { header: 'tipo_pack',          type: 'txt',  w: 14, get: d => t(d.tipo_pack) },
  { header: 'pares_producidos',   type: 'txt',  w: 14, get: d => t(d.pares) },
  { header: 'pares_requeridos',   type: 'txt',  w: 14, get: d => t(d.pares_requeridos) },
  { header: 'bruto_min',          type: 'num',  w: 11, get: d => min(d.elapsed_seg) },
  { header: 'tm_min',             type: 'num',  w: 10, get: d => min(d.tm_seg) },
  { header: 'tm_penalizable_min', type: 'num',  w: 17, get: d => min(penFromCausas(d.tm_causas)) },
  { header: 'ten_min',            type: 'num',  w: 10, get: d => min(tenFromDoc(d)) },
  { header: 'maquina_marca',      type: 'txt',  w: 14, get: d => t(d.maquina_marca) },
  { header: 'maquina_numero',     type: 'txt',  w: 14, get: d => t(d.maquina_numero) },
  { header: 'agujado',            type: 'txt',  w: 10, get: d => t(d.agujado) },
  { header: 't_ciclo_min',        type: 'txt',  w: 12, get: d => t(d.t_ciclo_min) },
  { header: 't_ciclo_seg',        type: 'txt',  w: 12, get: d => t(d.t_ciclo_seg) },
  { header: 'peso_salida_g',      type: 'txt',  w: 13, get: d => t(d.peso_sal) },
  { header: 'peso_cerrado_g',     type: 'txt',  w: 13, get: d => t(d.peso_cer) },
  ...['A', 'B', 'C', 'D', 'E'].map(k => ({ header: 'med_sh_' + k, type: 'txt', w: 10, get: d => t((d.med_sh || {})[k]) })),
  ...['A', 'B', 'C', 'D', 'E'].map(k => ({ header: 'med_h_' + k, type: 'txt', w: 10, get: d => t((d.med_h || {})[k]) })),
  { header: 'giros_elastico',     type: 'txt',  w: 13, get: d => t((d.giros || {}).el) },
  { header: 'giros_tubo',         type: 'txt',  w: 12, get: d => t((d.giros || {}).tb) },
  { header: 'giros_planta',       type: 'txt',  w: 13, get: d => t((d.giros || {}).pl) },
  { header: 'giros_rubber',       type: 'txt',  w: 13, get: d => t((d.giros || {}).rb) },
  { header: 'vel_elastico',       type: 'txt',  w: 13, get: d => t((d.vels || {}).el) },
  { header: 'vel_tubo',           type: 'txt',  w: 12, get: d => t((d.vels || {}).tb) },
  { header: 'vel_talon_punta',    type: 'txt',  w: 15, get: d => t((d.vels || {}).tp) },
  { header: 'vel_planta',         type: 'txt',  w: 12, get: d => t((d.vels || {}).pl) },
  { header: 'den1',               type: 'txt',  w: 9,  get: d => t((d.pto || {}).d1) },
  { header: 'den2',               type: 'txt',  w: 9,  get: d => t((d.pto || {}).d2) },
  { header: 'sink2',              type: 'txt',  w: 9,  get: d => t((d.pto || {}).sk) },
  // El punto de máquina son 10 alimentadores. Las tres columnas de arriba
  // conservan el primero (y las fichas viejas, que solo tenían ese trío);
  // estas traen cada renglón como "DEN-1/DEN-2/SINK2".
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => ({
    header: 'pto_alim_' + n, type: 'txt', w: 12,
    get: d => {
      const f = (d.pto_tabla || [])[n - 1];
      if (!f || (!f.d1 && !f.d2 && !f.sk)) return '';
      return [f.d1 || '', f.d2 || '', f.sk || ''].join('/').replace(/\/+$/, '');
    },
  })),
  ...TM_CAUSES.map(c => ({ header: 'tm_' + c.id + '_min', type: 'num', w: 14, get: d => min((d.tm_causas || {})[c.id]) })),
  { header: 'observaciones',      type: 'txt',  w: 34, get: d => t(d.obs) },
];

function nombreArchivo(ext) {
  const period = document.getElementById('dp')?.value || 'month';
  const hoy = new Date().toISOString().slice(0, 10);
  return `historial-muestristas-${period}-${hoy}.${ext}`;
}

function descargar(blob, nombre) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ── CSV ──
function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// Texto libre: neutraliza el inicio de fórmula para Excel
function antiFormula(v) {
  const s = String(v ?? '');
  return /^\s*[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

export function exportCSV(silencioso) {
  const docs = APP.dbDocs || [];
  if (docs.length === 0) { toast('No hay datos en el período seleccionado', false); return; }
  const filas = docs.map(({ data: dt }) => EXPORT_COLUMNS.map(c => {
    const v = c.get(dt);
    if (c.type === 'date') return v ? v.toISOString() : '';
    // 'iteracion' es num pero es un entero (no minutos): va sin decimales
    if (c.type === 'num') return c.header === 'iteracion' ? v : (Number.isFinite(v) ? v.toFixed(1) : '');
    return antiFormula(v);
  }).map(csvCell).join(','));
  // BOM para que Excel abra bien los acentos
  const csv = '﻿' + EXPORT_COLUMNS.map(c => c.header).join(',') + '\n' + filas.join('\n');
  descargar(new Blob([csv], { type: 'text/csv;charset=utf-8' }), nombreArchivo('csv'));
  if (!silencioso) toast('📥 CSV exportado (' + docs.length + ' registros)');
}

// ── Excel (.xlsx) ──
let exportando = false;

export function exportExcel() {
  const docs = APP.dbDocs || [];
  if (docs.length === 0) { toast('No hay datos en el período seleccionado', false); return; }
  if (exportando) return;
  if (docs.length > MAX_FILAS_XLSX) {
    toast(`Son ${docs.length} fichas: demasiadas para Excel en tablet, se exporta CSV`, false);
    exportCSV(true);
    return;
  }
  if (docs.length > AVISO_FILAS) {
    confirmDlg('Exportación grande',
      `Son ${docs.length} fichas. Generar el Excel puede tardar y consumir memoria en la tablet. ¿Continuar?`,
      'Sí, generar Excel', () => generar(docs));
    return;
  }
  generar(docs);
}

async function generar(docs) {
  if (exportando) return;
  exportando = true;
  const btn = document.getElementById('btn-export');
  const txtPrev = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Generando Excel…'; }
  try {
    await loadLib(EXCELJS_URL, 'ExcelJS');
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Sistema de Muestristas · Deportivos Quini';
    const ws = wb.addWorksheet('Historial', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = EXPORT_COLUMNS.map(c => ({ header: c.header, key: c.header, width: c.w }));
    docs.forEach(({ data: dt }) => {
      const fila = {};
      EXPORT_COLUMNS.forEach(c => {
        const v = c.get(dt);
        // Number('') es 0: solo se emite número si el valor es finito
        fila[c.header] = c.type === 'num' ? (Number.isFinite(v) ? v : null)
          : c.type === 'date' ? (v || null)
          : antiFormula(v);
      });
      ws.addRow(fila);
    });
    // Solo se estiliza el encabezado (estilar celda por celda dispara la memoria)
    const head = ws.getRow(1);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
    head.alignment = { vertical: 'middle' };
    head.height = 20;
    EXPORT_COLUMNS.forEach((c, i) => {
      if (c.type === 'date') ws.getColumn(i + 1).numFmt = 'dd/mm/yyyy hh:mm';
      // La iteración es un conteo entero: con '0.0' se vería "1.0"
      else if (c.type === 'num') ws.getColumn(i + 1).numFmt = c.header === 'iteracion' ? '0' : '0.0';
    });
    const buf = await wb.xlsx.writeBuffer();
    descargar(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), nombreArchivo('xlsx'));
    toast('📊 Excel exportado (' + docs.length + ' registros)');
  } catch (e) {
    console.error('exportExcel:', e);
    toast('No se pudo generar el Excel — se descarga el CSV', false);
    exportCSV(true);
  } finally {
    exportando = false;
    if (btn) { btn.disabled = false; btn.textContent = txtPrev || '📊 Exportar a Excel'; }
  }
}
