// Catálogo de códigos: importación desde Excel/CSV (solo Lety) y autollenado
// de la pantalla Asignar a partir del código de variante.
//
// Parsing 100% en el navegador con SheetJS (carga perezosa por CDN: los
// muestristas nunca lo descargan). Decisiones de diseño acordadas en la
// revisión con Codex:
//   · El ID del documento es el código NORMALIZADO (point-read directo, y la
//     unicidad la garantiza Firestore). No hay sustituciones silenciosas de
//     caracteres: un código con '/' o espacios se reporta como inválido en el
//     resumen previo en vez de colisionar con otro (A/B vs A-B).
//   · Todo se lee como TEXTO FORMATEADO (raw:false) para no perder ceros a la
//     izquierda ("00123"); los pares se sanean aparte quitando separadores de
//     miles porque el input del formulario es type="number".
//   · La fila de encabezados se detecta por coincidencia de alias en las
//     primeras 30 filas y se puede corregir a mano.
//   · La importación se confirma con un resumen (filas útiles, vacías,
//     duplicadas, inválidas). Un duplicado BLOQUEA: no aplica "la última gana".
//   · Cada documento se escribe completo (set sin merge) para que un campo que
//     ahora viene vacío no conserve el valor viejo.
import { db, fsOk } from './fb.js';
import { es, toast, openOvl, closeOvl, showExito, loadLib, fmtDate } from './utils.js';

const SHEETJS_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const MAX_FILAS = 5000;
const CHUNK = 50;                  // docs por batch (conservador vs. límites de reglas)

export const CAT_FIELDS = [
  { key: 'codigo',           label: 'Código de variante *', req: true, alias: ['codigo', 'código', 'cod', 'code', 'sku', 'codigo variante', 'código variante', 'codigo de variante'] },
  { key: 'descripcion',      label: 'Descripción / color',  alias: ['descripcion', 'descripción', 'color', 'desc', 'descripcion color'] },
  { key: 'modelo',           label: 'Modelo',               alias: ['modelo', 'model', 'estilo', 'style'] },
  { key: 'cliente',          label: 'Cliente',              alias: ['cliente', 'client', 'customer', 'marca'] },
  { key: 'pares_requeridos', label: 'Pares requeridos', num: true, alias: ['pares', 'pares requeridos', 'cantidad', 'qty', 'piezas'] },
  { key: 'tipo_pack',        label: 'Tipo de pack',         alias: ['pack', 'tipo pack', 'tipo de pack', 'empaque'] },
  { key: 'genero',           label: 'Género',               alias: ['genero', 'género', 'gender', 'sexo'] },
  { key: 'talla',            label: 'Talla',                alias: ['talla', 'size', 'tallas'] },
  { key: 'tipo_producto',    label: 'Tipo de producto',     alias: ['tipo producto', 'tipo de producto', 'producto', 'linea', 'línea'] },
  { key: 'codigo_quini',     label: 'Código Quini',         alias: ['codigo quini', 'código quini', 'cod quini', 'quini'] },
];

// ── Normalización de códigos (una sola función para importar, deduplicar y
// buscar: si divergen, el autollenado dejaría de encontrar lo importado) ──
export function normalizarCodigo(v) {
  return String(v ?? '')
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, ' ') // invisibles → espacio
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

// Firestore prohíbe '/', '.' y '..' como id; además se rechazan espacios para
// no tener que sustituir nada (sustituir es lo que produce colisiones)
export function codigoValido(s) {
  return /^[A-Z0-9][A-Z0-9._-]*$/.test(s) && s.length <= 60 && s !== '.' && s !== '..';
}

function limpiaTexto(v) {
  return String(v ?? '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim().slice(0, 200);
}

// Los pares alimentan un input type="number": "6,000" o "6 000" no sirven
function limpiaNumero(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  const limpio = s.replace(/[\s\u00A0]/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.');
  const n = Number(limpio);
  return Number.isFinite(n) && n >= 0 ? String(n) : '';
}

// ── Estado de la importación en curso ──
const IMP = { hojas: [], hoja: null, matriz: [], headerRow: 0, mapa: {}, archivo: '', encoding: 'auto' };

export function openCatalogo() {
  IMP.hojas = []; IMP.matriz = []; IMP.mapa = {}; IMP.headerRow = 0; IMP.archivo = ''; IMP.encoding = 'auto';
  const f = document.getElementById('cat-file');
  if (f) f.value = '';
  document.getElementById('cat-ui').innerHTML =
    '<div class="al ali"><span>📄</span><span style="font-size:12px">Elige un archivo de Excel (.xlsx, .xls) o CSV con la lista de códigos. Se lee en esta tablet; nada se sube hasta que confirmes.</span></div>';
  openOvl('ocat');
}

// Un CSV sin BOM puede venir en UTF-8 o Windows-1252 (Excel en español):
// se decodifica como UTF-8 y si aparece el carácter de reemplazo se reintenta
function decodificaCSV(buffer, encoding) {
  const bytes = new Uint8Array(buffer);
  if (encoding === 'utf-8' || encoding === 'windows-1252') {
    return new TextDecoder(encoding).decode(bytes);
  }
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  return utf8.includes('�') ? new TextDecoder('windows-1252').decode(bytes) : utf8;
}

export async function catArchivo(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  if (file.size > MAX_BYTES) {
    toast('El archivo pesa más de 8 MB — divídelo o guárdalo como CSV', false);
    input.value = '';
    return;
  }
  IMP.archivo = file.name;
  const ui = document.getElementById('cat-ui');
  ui.innerHTML = '<div class="al ali"><span>⏳</span><span style="font-size:12px">Leyendo el archivo…</span></div>';
  try {
    await loadLib(SHEETJS_URL, 'XLSX');
    const buf = await file.arrayBuffer();
    const esCSV = /\.csv$/i.test(file.name);
    const wb = esCSV
      ? XLSX.read(decodificaCSV(buf, IMP.encoding), { type: 'string', raw: false })
      : XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true, cellText: true, raw: false });
    IMP.hojas = wb.SheetNames || [];
    if (IMP.hojas.length === 0) { ui.innerHTML = alerta('rd', '⚠️', 'El archivo no tiene hojas legibles.'); return; }
    IMP.wb = wb;
    IMP.hoja = IMP.hojas[0];
    cargarHoja();
  } catch (e) {
    console.error('catalogo parse:', e);
    ui.innerHTML = alerta('rd', '⚠️', 'No se pudo leer el archivo. Si es .xls muy viejo, guárdalo como .xlsx o .csv e intenta de nuevo.');
  }
}

function alerta(tipo, ico, txt) {
  const cls = tipo === 'rd' ? 'alr' : tipo === 'am' ? 'alw' : 'ali';
  return `<div class="al ${cls}"><span>${ico}</span><span style="font-size:12px">${es(txt)}</span></div>`;
}

function cargarHoja() {
  const ws = IMP.wb.Sheets[IMP.hoja];
  // header:1 → matriz de filas; raw:false → texto formateado (conserva ceros)
  const matriz = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: false });
  IMP.filasArchivo = matriz.length;
  IMP.truncado = matriz.length > MAX_FILAS + 50;
  IMP.matriz = matriz.slice(0, MAX_FILAS + 50);
  IMP.headerRow = detectaHeader(IMP.matriz);
  IMP.mapa = adivinaMapa(IMP.matriz[IMP.headerRow] || []);
  render();
}

// Fila de encabezado = la de las primeras 30 con más coincidencias de alias
function detectaHeader(matriz) {
  let mejor = 0, mejorPts = -1;
  const lim = Math.min(30, matriz.length);
  for (let i = 0; i < lim; i++) {
    const fila = matriz[i] || [];
    if (fila.every(c => String(c ?? '').trim() === '')) continue;
    let pts = 0;
    fila.forEach(c => {
      const t = normalizaAlias(c);
      if (t && CAT_FIELDS.some(f => f.alias.includes(t))) pts += 2;
      else if (t) pts += 0.1; // celda con texto: mejor candidata que una casi vacía
    });
    if (pts > mejorPts) { mejorPts = pts; mejor = i; }
  }
  return mejor;
}

function normalizaAlias(v) {
  return String(v ?? '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // sin acentos
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function adivinaMapa(header) {
  const mapa = {};
  const usadas = new Set();
  CAT_FIELDS.forEach(f => {
    const idx = header.findIndex((h, i) => !usadas.has(i) && f.alias.includes(normalizaAlias(h)));
    if (idx >= 0) { mapa[f.key] = idx; usadas.add(idx); }
    else mapa[f.key] = -1;
  });
  return mapa;
}

function colLetra(i) {
  let s = '';
  for (let n = i; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + (n % 26)) + s;
  return s;
}

// Filas mapeadas + clasificación (lo que se muestra antes de escribir nada)
function analiza() {
  const header = IMP.matriz[IMP.headerRow] || [];
  const cols = header.length;
  const idxCodigo = IMP.mapa.codigo;
  const out = { filas: [], vacias: 0, invalidos: [], duplicados: [], numMalos: [], filasTotales: 0, cortado: false };
  const vistos = new Map();
  let r = IMP.headerRow + 1;
  for (; r < IMP.matriz.length && out.filas.length < MAX_FILAS; r++) {
    const fila = IMP.matriz[r] || [];
    if (fila.every(c => String(c ?? '').trim() === '')) { out.vacias++; out.filasTotales++; continue; }
    out.filasTotales++;
    const crudo = idxCodigo >= 0 ? fila[idxCodigo] : '';
    const cod = normalizarCodigo(crudo);
    if (!cod) { out.vacias++; continue; }
    if (!codigoValido(cod)) { out.invalidos.push({ fila: r + 1, cod: String(crudo).slice(0, 30) }); continue; }
    if (vistos.has(cod)) { out.duplicados.push({ fila: r + 1, cod, antes: vistos.get(cod) }); continue; }
    vistos.set(cod, r + 1);
    const doc = { codigo: cod };
    CAT_FIELDS.forEach(f => {
      if (f.key === 'codigo') return;
      const i = IMP.mapa[f.key];
      const val = i >= 0 && i < Math.max(cols, fila.length) ? fila[i] : '';
      if (f.num) {
        const n = limpiaNumero(val);
        if (String(val ?? '').trim() && !n) out.numMalos.push({ fila: r + 1, campo: f.label });
        doc[f.key] = n;
      } else {
        doc[f.key] = limpiaTexto(val);
      }
    });
    out.filas.push(doc);
  }
  out.cortado = r < IMP.matriz.length;
  return out;
}

function render() {
  const header = IMP.matriz[IMP.headerRow] || [];
  const an = analiza();
  const opciones = i => ['<option value="-1">— sin usar —</option>']
    .concat(header.map((h, j) => `<option value="${j}"${j === i ? ' selected' : ''}>${es(colLetra(j))} — ${es(String(h || '(vacía)').slice(0, 28))}</option>`))
    .join('');
  const prev = an.filas.slice(0, 5);
  document.getElementById('cat-ui').innerHTML = `
    ${IMP.hojas.length > 1 ? `<div class="fg"><label class="fl">Hoja del archivo</label>
      <select class="fi" data-catsel="hoja">${IMP.hojas.map(h => `<option${h === IMP.hoja ? ' selected' : ''}>${es(h)}</option>`).join('')}</select></div>` : ''}
    <div class="fg"><label class="fl">Fila de encabezados (detectada: ${IMP.headerRow + 1})</label>
      <input class="fi" type="number" min="1" max="${IMP.matriz.length}" value="${IMP.headerRow + 1}" data-catsel="hrow"></div>
    <div class="stitle">Qué columna es cada dato</div>
    ${CAT_FIELDS.map(f => `<div class="fg"><label class="fl">${es(f.label)}</label>
      <select class="fi" data-catmap="${f.key}">${opciones(IMP.mapa[f.key])}</select></div>`).join('')}
    <div class="stitle">Resumen antes de importar</div>
    <div class="card">
      <div class="mr"><span>Códigos listos</span><strong style="color:var(--gn)">${an.filas.length}</strong></div>
      <div class="mr"><span>Filas vacías o sin código</span><span>${an.vacias}</span></div>
      <div class="mr"><span>Códigos repetidos</span><strong style="color:${an.duplicados.length ? 'var(--rd)' : 'inherit'}">${an.duplicados.length}</strong></div>
      <div class="mr"><span>Códigos con caracteres no válidos</span><strong style="color:${an.invalidos.length ? 'var(--am)' : 'inherit'}">${an.invalidos.length}</strong></div>
      ${an.numMalos.length ? `<div class="mr"><span>Números ilegibles (se dejan vacíos)</span><span>${an.numMalos.length}</span></div>` : ''}
    </div>
    ${an.duplicados.length ? alerta('rd', '🚫', 'Hay códigos repetidos (ej. ' + an.duplicados.slice(0, 3).map(d => d.cod + ' en fila ' + d.fila).join(', ') + '). Corrige el archivo: no se importa nada hasta que cada código aparezca una sola vez.') : ''}
    ${an.invalidos.length ? alerta('am', '⚠️', 'Estos códigos se van a omitir por tener espacios, diagonales u otros símbolos: ' + an.invalidos.slice(0, 4).map(d => '"' + d.cod + '" (fila ' + d.fila + ')').join(', ')) : ''}
    ${IMP.truncado || an.cortado ? alerta('rd', '🚫', 'El archivo tiene ' + IMP.filasArchivo + ' filas y el máximo por importación es ' + MAX_FILAS + '. Divide el archivo en partes e impórtalas una por una.') : ''}
    ${prev.length ? `<div class="stitle">Vista previa (${prev.length} de ${an.filas.length})</div>
      <div style="overflow-x:auto"><table class="mt"><tr><th>Código</th><th>Descripción</th><th>Modelo</th><th>Cliente</th><th>Pares</th></tr>
      ${prev.map(p => `<tr><td class="lbl">${es(p.codigo)}</td><td>${es(p.descripcion) || '—'}</td><td>${es(p.modelo) || '—'}</td><td>${es(p.cliente) || '—'}</td><td>${es(p.pares_requeridos) || '—'}</td></tr>`).join('')}
      </table></div>` : alerta('am', '⚠️', 'No se encontró ningún código con este mapeo. Revisa la fila de encabezados y la columna del código.')}
    <button class="btn btn-am" id="cat-go" ${an.filas.length === 0 || an.duplicados.length > 0 || IMP.truncado || an.cortado ? 'disabled style="opacity:.5"' : ''} data-catsel="go">
      📥 Importar ${an.filas.length} código${an.filas.length === 1 ? '' : 's'}</button>
    <button class="btn btn-gh" onclick="closeOvl('ocat')">Cancelar</button>`;
}

export function wireCatalogoEvents() {
  const ui = document.getElementById('cat-ui');
  if (!ui) return;
  ui.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.catmap) {
      const idx = Number(t.value);
      // Una misma columna no puede alimentar dos campos: se libera la otra
      if (idx >= 0) Object.keys(IMP.mapa).forEach(k => { if (k !== t.dataset.catmap && IMP.mapa[k] === idx) IMP.mapa[k] = -1; });
      IMP.mapa[t.dataset.catmap] = idx;
      render();
    } else if (t.dataset.catsel === 'hoja') {
      IMP.hoja = t.value;
      cargarHoja();
    } else if (t.dataset.catsel === 'hrow') {
      const n = Math.max(1, Math.min(Number(t.value) || 1, IMP.matriz.length)) - 1;
      IMP.headerRow = n;
      IMP.mapa = adivinaMapa(IMP.matriz[n] || []);
      render();
    }
  });
  ui.addEventListener('click', e => {
    if (e.target.closest('[data-catsel="go"]')) importar();
  });
}

let importando = false;

async function importar() {
  if (importando || !fsOk()) return;
  const an = analiza();
  if (an.filas.length === 0 || an.duplicados.length > 0 || IMP.truncado || an.cortado) return;
  importando = true;
  const btn = document.getElementById('cat-go');
  const total = an.filas.length;
  let escritos = 0;
  try {
    for (let i = 0; i < an.filas.length; i += CHUNK) {
      const lote = an.filas.slice(i, i + CHUNK);
      const batch = db.batch();
      lote.forEach(doc => {
        // set sin merge: un campo que ahora viene vacío NO conserva el valor viejo
        batch.set(db.collection('catalogo').doc(doc.codigo), {
          ...doc, actualizado: firebase.firestore.FieldValue.serverTimestamp(),
        });
      });
      await batch.commit();
      escritos += lote.length;
      // Se limpia tras cada lote: si un lote falla a la mitad, los códigos ya
      // escritos no deben seguir sirviéndose desde una caché vieja
      cache.clear();
      if (btn) btn.textContent = `📥 Importando… ${escritos} de ${total}`;
    }
    // La metadata se escribe SOLO si todos los lotes pasaron: su importId es
    // lo que invalida la caché de autollenado en todos los dispositivos
    await db.collection('catalogo_meta').doc('info').set({
      filas_importadas: escritos,
      total_archivo: an.filasTotales,
      fuente: String(IMP.archivo || '').slice(0, 120),
      importId: String(Date.now()),
      actualizado: firebase.firestore.FieldValue.serverTimestamp(),
    });
    cache.clear();
    closeOvl('ocat');
    showExito('Catálogo actualizado', escritos + ' código' + (escritos === 1 ? '' : 's') + ' listos para autollenar');
  } catch (e) {
    console.error('catalogo import:', e);
    if (btn) btn.textContent = '📥 Reintentar importación';
    // Un rechazo por reglas se repetiría igual al reintentar: se distingue
    // del corte de red para no mandar a Lety a un bucle inútil
    const rechazado = e && (e.code === 'permission-denied' || e.code === 'invalid-argument');
    document.getElementById('cat-ui').insertAdjacentHTML('afterbegin',
      alerta('rd', '⚠️', rechazado
        ? `Firestore rechazó los datos${escritos > 0 ? ` después de ${escritos} códigos` : ''}. Suele ser un texto demasiado largo o un carácter no permitido: revisa esa parte del archivo (reintentar tal cual fallará igual).`
        : escritos > 0
          ? `Se importaron ${escritos} de ${total} y se interrumpió. Vuelve a importar el MISMO archivo: los ya guardados se actualizan sin duplicarse.`
          : 'No se pudo importar. Revisa tu conexión e intenta de nuevo.'));
  } finally {
    importando = false;
  }
}

// ── Autollenado ──
// Caché por sesión, invalidada cuando cambia importId de catalogo_meta/info
// (si no, tras re-importar se seguirían sirviendo datos viejos, incluidos los
// "no existe" cacheados).
const cache = new Map();
let catImportId = null;

export function watchCatalogo() {
  if (!db) return null;
  return db.collection('catalogo_meta').doc('info').onSnapshot(snap => {
    const d = snap.exists ? snap.data() : null;
    const id = d ? d.importId : null;
    if (id !== catImportId) { catImportId = id; cache.clear(); }
    const info = document.getElementById('cat-info');
    if (info) {
      info.innerHTML = d
        ? `📚 <strong>${es(d.filas_importadas)}</strong> códigos · ${es(d.fuente || 'archivo')} · ${es(fmtDate(d.actualizado))}`
        : '📭 Todavía no has importado ningún catálogo.';
    }
  }, e => console.error('catalogo_meta:', e));
}

export async function lookupCodigo(codRaw) {
  const cod = normalizarCodigo(codRaw);
  if (!cod || !codigoValido(cod) || !db) return null;
  if (cache.has(cod)) return cache.get(cod);
  try {
    const snap = await db.collection('catalogo').doc(cod).get();
    const data = snap.exists ? snap.data() : null;
    cache.set(cod, data);
    return data;
  } catch (e) {
    console.error('lookup catalogo:', e);
    return null; // no se cachea el fallo de red
  }
}
