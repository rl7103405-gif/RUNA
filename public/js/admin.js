// Vista de Lety: asignación de desarrollos y revisión/aprobación de fichas
import { db, fsOk } from './fb.js';
import { APP, USERS, TM_CAUSES } from './state.js';
import { es, fmt, fmtMin, fmtDate, gv, scr, toast, confirmDlg, tenFromDoc, esFirmaValida, loadLib, showExito } from './utils.js';
import { parseLibro, comparar } from './ficha-tecnica.js';
import { showFirma } from './firma.js';
import { loadDB } from './dashboard.js';
import { lookupCodigo, normalizarCodigo, watchCatalogo, codigoValido } from './catalogo.js';

// ── Cierre de la tarea (el desarrollo completo) ──
// Un desarrollo es un pack con varios códigos; cada código es una ficha con
// su propio cronómetro. La tarea se da por terminada cuando Lety aprobó el
// último código, y `terminado_en` mide cuánto tardó el pack de punta a punta.
//
// Es una RECONCILIACIÓN, no un "marcar y ya": recalcula el estado real y lo
// corrige en los dos sentidos. Así, si la escritura falla o alguien reabre una
// ficha ya aprobada, el siguiente paso de Lety devuelve la tarea a en_proceso
// sola. La alternativa (escribir 'terminado' una sola vez tras aprobar) deja
// la tarea colgada para siempre si esa escritura se pierde.
//
// Solo la llama Lety: las reglas no dejan al muestrista cerrar su propia tarea.
export async function reconciliarEstadoTarea(devId) {
  if (!fsOk() || !devId) return;
  try {
    const devRef = db.collection('desarrollos').doc(devId);
    const devSnap = await devRef.get();
    if (!devSnap.exists) return;
    const dev = devSnap.data();
    const codigos = dev.variante_codigos || [];
    // Sin variantes no hay nada que cerrar: `[].every()` daría true y cerraría
    // una tarea vacía.
    if (codigos.length === 0) return;

    const capsSnap = await db.collection('capturas').where('id_desarrollo', '==', devId).get();
    const caps = capsSnap.docs.map(d => d.data());
    // Un código está listo solo si NINGUNA de sus fichas sigue en manos de
    // alguien (una variante aprobada puede recapturarse) y al menos una quedó
    // aprobada. Es el mismo criterio que usa varStatus() en la vista del
    // muestrista, para que pantalla y documento nunca se contradigan.
    const listo = codigos.every(cod => {
      const suyas = caps.filter(c => c.codigo_variante === cod);
      if (suyas.length === 0) return false;
      if (suyas.some(c => ['activo', 'pausado', 'correccion', 'pendiente_lety'].includes(c.estado))) return false;
      return suyas.some(c => c.estado === 'aprobado');
    });

    if (listo && dev.estado === 'en_proceso') {
      await devRef.update({ estado: 'terminado', terminado_en: firebase.firestore.FieldValue.serverTimestamp() });
    } else if (!listo && dev.estado === 'terminado') {
      // Lety reabrió una ficha: la tarea vuelve a estar en curso y el sello de
      // cierre se limpia para no dejar una fecha de término mentirosa.
      await devRef.update({ estado: 'en_proceso', terminado_en: null });
    }
  } catch (e) {
    // La aprobación de la ficha YA quedó guardada, así que esto nunca se
    // reporta como un error de firma. Pero sí se avisa: si el que falló fue el
    // cierre de la ÚLTIMA ficha, no hay una aprobación siguiente que lo
    // reintente y la tarea se quedaría en_proceso para siempre, aunque en
    // pantalla se vea completa. Con el aviso, Lety puede reabrir y volver a
    // aprobar una ficha para forzar el recálculo.
    console.error('reconciliarEstadoTarea:', e);
    toast('El cambio se guardó, pero no se pudo actualizar el estado de la tarea — avisa a Roberto', false);
  }
}

export function ltTab(i, btn) {
  [0, 1, 2, 3, 4].forEach(j => { const e = document.getElementById('lt' + j); if (e) e.classList.remove('on'); });
  document.getElementById('lt' + i).classList.add('on');
  document.querySelectorAll('#sL .nb').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  if (i === 1) loadRev();
  if (i === 2) loadDB();
  if (i === 4) loadTareas();
}

export function initLety() {
  // Los listeners se apagan y se vuelven a crear en cada login (logout() los
  // limpia): así no se duplican si Lety cierra y abre sesión en la tablet
  APP.listeners.forEach(u => { try { u(); } catch (e) {} });
  APP.listeners = [];
  // Pendientes en vivo: alimenta el contador del menú y la lista de revisión
  // (antes loadRev hacía otra consulta idéntica; ahora solo carga "En proceso")
  APP.listeners.push(db.collection('capturas')
    .where('estado', '==', 'pendiente_lety')
    .onSnapshot(snap => {
      if (!APP.user || APP.user.rol !== 'lety') return; // callback tardío
      const docs = snap.docs;
      setBadgePendientes(docs.length);
      const el = document.getElementById('pend-list');
      if (el) el.innerHTML = docs.length === 0
        ? '<div class="empty"><div class="ico">✅</div><p>Sin fichas pendientes</p></div>'
        : docs.map(d => renderRevCard(d.id, d.data())).join('');
    }, e => {
      console.error('pendientes:', e);
      const el = document.getElementById('pend-list');
      if (el) el.innerHTML = '<div class="empty"><div class="ico">⚠️</div><p>No se pudieron cargar las fichas pendientes</p></div>';
      toast('Error cargando pendientes — revisa tu conexión', false);
    }));
  // Pausas pedidas por los muestristas, de todas las fichas a la vez.
  // Es un collectionGroup: cada pausa vive bajo su propia captura.
  APP.listeners.push(db.collectionGroup('pausas')
    .where('estado', '==', 'pendiente')
    .onSnapshot(snap => {
      if (!APP.user || APP.user.rol !== 'lety') return;
      // El id del padre identifica la ficha: en un collectionGroup los
      // documentos llegan de capturas distintas y Lety necesita saber de cuál
      // es cada solicitud (un muestrista puede tener varias fichas abiertas).
      APP.pausasPend = snap.docs.map(d => ({
        id: d.id, ref: d.ref, data: d.data(),
        capId: d.ref.parent.parent ? d.ref.parent.parent.id : null,
      }));
      etiquetarPausas();
      renderPausas();
    }, e => {
      console.error('pausas pendientes:', e);
      // Se distingue la causa: 'failed-precondition' es índice faltante y
      // 'permission-denied' son las reglas. Sin esto el aviso de pantalla es el
      // mismo para las dos y no hay forma de saber cuál fue sin abrir la
      // consola — que es justo lo que pasó el 2026-08-20.
      const causa = e.code === 'permission-denied'
        ? 'las reglas no permiten la consulta'
        : e.code === 'failed-precondition'
          ? 'falta el índice en Firestore'
          : (e.code || 'error desconocido');
      const w = document.getElementById('pausas-wrap');
      const l = document.getElementById('pausas-list');
      if (w && l) {
        w.style.display = '';
        l.innerHTML = '<div class="al alr"><span>⚠️</span><span style="font-size:12px">No se pudieron cargar las pausas pedidas — avísale a Roberto: <b>' + es(causa) + '</b></span></div>';
      }
    }));
  const unsubCat = watchCatalogo();
  if (unsubCat) APP.listeners.push(unsubCat);
  loadRev();
}

// ── Pausas: el muestrista pide, Lety decide ──
// Mientras ella no autorice, el cronómetro del muestrista sigue corriendo
// (decisión del dueño), así que estas solicitudes son urgentes.
// Cruza cada solicitud con su ficha para que la tarjeta diga de CUÁL es.
// Se cachea por captura: las fichas abiertas son pocas y no cambian de folio.
const cacheFichas = {};
async function etiquetarPausas() {
  const pend = APP.pausasPend || [];
  const faltan = [...new Set(pend.map(p => p.capId).filter(id => id && !cacheFichas[id]))];
  if (!faltan.length) return;
  await Promise.all(faltan.map(async id => {
    try {
      const s = await db.collection('capturas').doc(id).get();
      if (s.exists) {
        const d = s.data();
        cacheFichas[id] = [d.folio, d.codigo].filter(Boolean).join(' · ');
      }
    } catch (e) { console.error('ficha de la pausa:', e); }
  }));
  renderPausas();
}

function renderPausas() {
  const wrap = document.getElementById('pausas-wrap');
  const lista = document.getElementById('pausas-list');
  if (!wrap || !lista) return;
  const pend = APP.pausasPend || [];
  wrap.style.display = pend.length ? '' : 'none';
  setBadgePendientes(document.querySelectorAll('#pend-list .card').length, pend.length);
  if (!pend.length) { lista.innerHTML = ''; return; }
  lista.innerHTML = pend.map(({ id, data: p, capId }) => {
    const c = TM_CAUSES.find(x => x.id === p.causa);
    const quien = (USERS[p.solicitada_por] || {}).nombre || p.solicitada_por;
    const ficha = capId ? cacheFichas[capId] : '';
    return `<div class="card am">
      <div class="dt">${es(quien)} pide pausa${ficha ? ' — <span style="font-family:var(--mono);font-size:13px">' + es(ficha) + '</span>' : ''}</div>
      <div class="ds">${es(c ? c.label : p.causa)}${c && !c.ext ? ' · <span class="bge bpend">interna</span>' : ''}</div>
      <div class="mr"><span style="font-size:11px;color:var(--tx3)">Pedida ${fmtDate(p.solicitada_en)} · el tiempo sigue corriendo</span><span></span></div>
      <div class="brow" style="margin-top:8px">
        <button class="btn btn-gn btn-sm" style="flex:1" data-pausa-ok="${es(id)}">✓ Autorizar</button>
        <button class="btn btn-rd btn-sm" style="flex:1" data-pausa-no="${es(id)}">✕ Rechazar</button>
      </div>
    </div>`;
  }).join('');
}

let decidiendo = false;

async function decidirPausa(pausaId, aprobar) {
  if (decidiendo) return;
  const item = (APP.pausasPend || []).find(x => x.id === pausaId);
  if (!item) return;
  decidiendo = true;
  try {
    const cambios = {
      estado: aprobar ? 'aprobada' : 'rechazada',
      decidida_en: firebase.firestore.FieldValue.serverTimestamp(),
      decidida_por: APP.user.id,
    };
    // El TM empieza a contar AQUÍ, no cuando la pidió: hasta ahora estuvo
    // trabajando (o esperando, pero sin autorización).
    if (aprobar) cambios.inicio_tm = firebase.firestore.FieldValue.serverTimestamp();
    await item.ref.update(cambios);
    toast(aprobar ? '✅ Pausa autorizada' : 'Pausa rechazada');
  } catch (e) {
    console.error('decidirPausa:', e);
    toast('No se pudo registrar la decisión — revisa tu conexión', false);
  } finally { decidiendo = false; }
}

export function setBadgePendientes(n, pausas) {
  const b = document.getElementById('nav-pend');
  if (!b) return;
  // El contador junta lo que espera decisión de Lety: fichas por revisar y
  // pausas por autorizar (estas último urgen: el cronómetro sigue corriendo).
  const p = pausas === undefined ? (APP.pausasPend || []).length : pausas;
  const total = (n || 0) + p;
  b.textContent = total > 99 ? '99+' : String(total);
  b.style.display = total > 0 ? '' : 'none';
  b.style.background = p > 0 ? 'var(--am)' : 'var(--rd-full)';
  const btn = b.closest('.nb');
  if (btn) btn.setAttribute('aria-label', total > 0
    ? `Revisar — ${n || 0} ficha(s) pendiente(s)${p ? ' y ' + p + ' pausa(s) por autorizar' : ''}`
    : 'Revisar');
}

// ── Asignar ──
export function setMode(mode) {
  APP.asignMode = mode;
  ['ficha', 'single', 'pack'].forEach(m => {
    const b = document.getElementById('ms-' + m);
    if (b) b.classList.toggle('on', mode === m);
  });
  const ver = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? '' : 'none'; };
  ver('form-ficha', mode === 'ficha');
  ver('form-single', mode === 'single');
  ver('form-pack', mode === 'pack');
  // En modo ficha técnica los datos del pedido salen del Excel: solo se pide
  // lo que el archivo no trae (muestrista, pares y complejidad)
  ver('form-datos', mode !== 'ficha');
  // El banner de complejidad y el botón "Asignar desarrollo" no aplican en
  // modo ficha técnica (ese modo tiene su propio botón "Crear tarea")
  ver('form-submit', mode !== 'ficha');
  if (mode === 'ficha') {
    // Limpia el estado de los otros modos: que no quede nada fantasma que
    // asignar() pudiera usar si el botón se llegara a colar
    APP.vars = [];
    renderVars();
    ['l-ot', 'l-po', 'l-cq', 'l-mod', 'l-cli', 'l-gen', 'l-tal', 'l-tprod', 'l-ag', 'l-notas', 's-cod', 's-desc', 's-pares', 's-pack', 'vc', 'vd', 'vp', 'vpk'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
  }
}

// ── Crear tarea desde la ficha técnica (Excel) ──
const SHEETJS_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
let FT = { fichas: [], errores: [], archivo: '', filas: null };

export async function ftArchivo(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const ui = document.getElementById('ft-ui');
  if (file.size > 12 * 1024 * 1024) { toast('El archivo pesa más de 12 MB', false); input.value = ''; return; }
  FT = { fichas: [], errores: [], archivo: file.name, filas: null, meta: null };
  ui.innerHTML = '<div class="al ali"><span>⏳</span><span style="font-size:12px">Leyendo la ficha técnica…</span></div>';
  try {
    await loadLib(SHEETJS_URL, 'XLSX');
    const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array', cellDates: true, cellText: true, raw: false });
    const { fichas, errores } = parseLibro(wb, XLSX);
    FT.fichas = fichas; FT.errores = errores;
    renderFichas();
  } catch (e) {
    console.error('ficha tecnica:', e);
    ui.innerHTML = '<div class="al alr"><span>⚠️</span><span style="font-size:12px">No se pudo leer el archivo. Debe ser el Excel de fichas técnicas (.xlsx), con una hoja por variante.</span></div>';
  }
}

// Estado editable por ficha: qué se incluye y con qué código. Se conserva
// entre re-renders para no perder lo que Lety ya escribió.
function ftEstado() {
  if (!FT.filas || FT.filas.length !== FT.fichas.length) {
    FT.filas = FT.fichas.map(f => ({ incluir: true, codigo: f.codigo_sugerido || '' }));
  }
  // Los datos de la tarea también se recuerdan: el panel se re-dibuja entero
  // en cada cambio, y sin esto se perderían OT, PO, notas y sobre todo el
  // muestrista asignado, que es INMUTABLE una vez creada la tarea.
  if (!FT.meta) FT.meta = { asig: 'israel', ot: '', po: '', notas: '' };
  return FT.filas;
}

function renderFichas() {
  const ui = document.getElementById('ft-ui');
  const { fichas, errores } = FT;
  const enBlanco = errores.filter(e => e.motivo === 'hoja en blanco');
  const ilegibles = errores.filter(e => e.motivo !== 'hoja en blanco');
  if (fichas.length === 0) {
    ui.innerHTML = `<div class="al alr"><span>⚠️</span><span style="font-size:12px">Este archivo no tiene ninguna hoja con datos${enBlanco.length ? ' (las ' + es(enBlanco.length) + ' hojas están en blanco)' : ''}. Sube el Excel de fichas técnicas, aunque estén a medio llenar.</span></div>`;
    return;
  }
  const filas = ftEstado();
  const inc = fichas.map((f, i) => ({ f, i })).filter(({ i }) => filas[i].incluir);
  const f0 = (inc[0] || { f: fichas[0] }).f;
  const mismoModelo = inc.every(({ f }) => f.modelo === f0.modelo && f.cliente === f0.cliente);
  // Códigos: vacíos, inválidos o repetidos entre las fichas INCLUIDAS
  const vistos = new Map();
  const dup = new Set(), malos = new Set(), vacios = new Set();
  inc.forEach(({ i }) => {
    const c = normalizarCodigo(filas[i].codigo);
    if (!c) { vacios.add(i); return; }
    if (!codigoValidoFT(c)) { malos.add(i); return; }
    if (vistos.has(c)) { dup.add(i); dup.add(vistos.get(c)); } else vistos.set(c, i);
  });
  const demasiadas = inc.length > 40;
  const bloqueado = demasiadas || inc.length === 0 || vacios.size > 0 || malos.size > 0 || dup.size > 0;
  const chip = (txt, tipo) => `<span class="bge ${tipo}" style="margin-right:4px">${es(txt)}</span>`;
  ui.innerHTML = `
    <div class="card bl">
      <div class="dt">${es(f0.modelo || '(sin modelo)')}${f0.cliente ? ' · ' + es(f0.cliente) : ''}</div>
      <div class="ds">${[f0.marca, f0.tipo_producto, f0.talla && 'Talla ' + f0.talla].filter(Boolean).map(es).join(' · ') || 'Sin datos de pedido — se completan después'}</div>
      ${f0.maquina_marca || f0.agujas ? `<div class="mr"><span>Máquina ${es(f0.maquina_marca)} ${f0.maquina_numero ? '#' + es(f0.maquina_numero) : ''}</span><span>${es(f0.agujas)} agujas</span></div>` : ''}
    </div>
    <div class="al ali"><span>📄</span><span style="font-size:12px">${es(fichas.length)} hoja${fichas.length === 1 ? '' : 's'} con datos${enBlanco.length ? ' · ' + es(enBlanco.length) + ' en blanco (omitidas)' : ''}${ilegibles.length ? ' · no se pudo leer: ' + es(ilegibles.map(e => e.hoja).join(', ')) : ''}. Desmarca las que no vayan en esta tarea y ajusta los códigos si hace falta.</span></div>
    ${!mismoModelo ? '<div class="al alw"><span>⚠️</span><span style="font-size:12px">Las hojas incluidas tienen modelo o cliente distintos. Se crea UNA tarea con los datos de la primera; si son desarrollos diferentes, súbelos por separado.</span></div>' : ''}
    ${demasiadas ? `<div class="al alr"><span>⚠️</span><span style="font-size:12px">Tienes ${es(inc.length)} fichas marcadas y el máximo por tarea es 40. Desmarca algunas.</span></div>` : ''}
    ${vacios.size ? '<div class="al alr"><span>⚠️</span><span style="font-size:12px">Hay fichas marcadas sin código. Escríbelo o desmárcalas: el código identifica la ficha en el historial.</span></div>' : ''}
    ${malos.size ? '<div class="al alr"><span>⚠️</span><span style="font-size:12px">Hay códigos con espacios o símbolos no permitidos. Usa solo letras, números, punto, guion y guion bajo.</span></div>' : ''}
    ${dup.size ? '<div class="al alr"><span>⚠️</span><span style="font-size:12px">Hay códigos repetidos entre las fichas marcadas. Cada ficha necesita el suyo.</span></div>' : ''}
    <div class="stitle">Fichas del archivo</div>
    ${fichas.map((f, i) => {
      const st = filas[i];
      const cod = normalizarCodigo(st.codigo);
      const mal = st.incluir && (vacios.has(i) || malos.has(i) || dup.has(i));
      return `<div class="vi" style="flex-wrap:wrap;${st.incluir ? '' : 'opacity:.5'}${mal ? ';border-color:var(--rd)' : ''}">
        <label style="display:flex;align-items:center;gap:8px;flex:1;min-width:150px;cursor:pointer">
          <input type="checkbox" data-ftinc="${i}" ${st.incluir ? 'checked' : ''} style="width:20px;height:20px;flex-shrink:0">
          <span style="font-size:12px;color:var(--tx2)">${es(f.hoja)}${f.color_base ? ' · ' + es(f.color_base) : ''}</span>
        </label>
        <input class="fi" data-ftcod="${i}" value="${es(st.codigo)}" placeholder="código" style="width:150px;flex-shrink:0;padding:8px 10px;font-size:14px${mal ? ';border-color:var(--rd)' : ''}">
        <input class="fi" type="number" min="0" placeholder="pares" data-ftpares="${i}" value="${es(st.pares || '')}" style="width:90px;flex-shrink:0;padding:8px 10px;font-size:14px">
        <select class="fi" data-ftcx="${i}" style="width:64px;flex-shrink:0;padding:8px 4px;font-size:14px">
          ${['A', 'B', 'C'].map(x => `<option value="${x}"${st.cx === x ? ' selected' : ''}>${x}</option>`).join('')}
        </select>
        <div style="flex-basis:100%;font-size:11px;color:var(--tx3);padding-left:28px">
          ${!f.codigo_ok && f.codigo ? chip('código del Excel: ' + f.codigo, 'bpend') : ''}
          ${f.faltantes.length ? chip('falta: ' + f.faltantes.join(', '), 'bpend') : chip('ficha completa', 'bok')}
        </div>
      </div>`;
    }).join('')}
    <div class="fg" style="margin-top:10px"><label class="fl">Asignar a</label>
      <select class="fi" id="ft-asig">
        <option value="israel"${FT.meta.asig === 'israel' ? ' selected' : ''}>Israel</option>
        <option value="jesus"${FT.meta.asig === 'jesus' ? ' selected' : ''}>Jesús</option>
      </select></div>
    <div class="g2">
      <div class="fg"><label class="fl">OT (opcional)</label><input class="fi" id="ft-ot" value="${es(FT.meta.ot)}" placeholder="7735"></div>
      <div class="fg"><label class="fl">PO (opcional)</label><input class="fi" id="ft-po" value="${es(FT.meta.po)}" placeholder="2422"></div>
    </div>
    <div class="fg"><label class="fl">Notas para el muestrista</label><textarea class="fi" id="ft-notas" rows="2" placeholder="Instrucciones especiales...">${es(FT.meta.notas)}</textarea></div>
    <div class="al ali"><span>🔒</span><span style="font-size:12px">A = tin básico · B = con diseño · C = jacquard. La complejidad solo la ves tú.</span></div>
    <button class="btn btn-am" id="ft-go" ${bloqueado ? 'disabled style="opacity:.5"' : ''} onclick="asignarDesdeFicha()">
      ${bloqueado ? (inc.length === 0 ? 'Marca al menos una ficha' : 'Corrige los códigos marcados') : '✓ Crear tarea con ' + inc.length + ' ficha' + (inc.length === 1 ? '' : 's')}</button>`;
}

// La validación de códigos es la MISMA que la del catálogo (importada): si se
// duplicara aquí, un cambio futuro allá dejaría las dos desincronizadas.
const codigoValidoFT = codigoValido;

// Cambios en la lista de fichas: se guardan en FT.filas y se re-pinta para
// refrescar avisos y el estado del botón
export function wireFichaEvents() {
  const ui = document.getElementById('ft-ui');
  if (!ui) return;
  const guarda = t => {
    const filas = ftEstado();
    // Datos de la tarea: se recuerdan pero NO disparan re-render (no cambian
    // ningún aviso y re-dibujar mientras se escribe quitaría el foco)
    if (t.id === 'ft-asig') { FT.meta.asig = t.value; return false; }
    if (t.id === 'ft-ot') { FT.meta.ot = t.value; return false; }
    if (t.id === 'ft-po') { FT.meta.po = t.value; return false; }
    if (t.id === 'ft-notas') { FT.meta.notas = t.value; return false; }
    if (t.dataset.ftinc !== undefined) filas[t.dataset.ftinc].incluir = t.checked;
    else if (t.dataset.ftcod !== undefined) filas[t.dataset.ftcod].codigo = t.value;
    else if (t.dataset.ftpares !== undefined) filas[t.dataset.ftpares].pares = t.value;
    else if (t.dataset.ftcx !== undefined) filas[t.dataset.ftcx].cx = t.value;
    else return false;
    return true;
  };
  // 'change' re-pinta (avisos al día); 'input' solo guarda, para no perder el
  // foco mientras Lety escribe el código
  ui.addEventListener('input', e => { guarda(e.target); });
  ui.addEventListener('change', e => { if (guarda(e.target)) renderFichas(); });
}

let asignandoFT = false;

export async function asignarDesdeFicha() {
  if (!fsOk() || asignandoFT) return;
  if (!FT.fichas.length) { toast('Primero sube el archivo de fichas técnicas', false); return; }
  asignandoFT = true;
  const btn = document.getElementById('ft-go');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Creando tarea…'; }
  try {
    // Solo las fichas marcadas, con el código que Lety dejó en pantalla
    const filas = ftEstado();
    const sel = FT.fichas
      .map((f, i) => ({ f, st: filas[i] }))
      .filter(({ st }) => st.incluir)
      .map(({ f, st }) => ({ f, cod: normalizarCodigo(st.codigo), st }));
    if (sel.length === 0) { toast('Marca al menos una ficha', false); return; }
    const codigos = sel.map(s => s.cod);
    if (codigos.some(c => !c || !codigoValidoFT(c)) || new Set(codigos).size !== codigos.length) {
      toast('Revisa los códigos: no pueden estar vacíos, repetidos ni traer espacios', false);
      return;
    }
    if (sel.length > 40) { toast('Máximo 40 fichas por tarea — desmarca algunas', false); return; }
    const f0 = sel[0].f;
    const variantes = sel.map(({ f, cod, st }) => ({
      codigo: cod,
      descripcion: f.color_base || f.modelo || '',
      pares_requeridos: String(st.pares || '').trim(),
      tipo_pack: '',
    }));
    const complejidadPorCodigo = {};
    sel.forEach(({ cod, st }) => { complejidadPorCodigo[cod] = st.cx || 'A'; });

    const devRef = db.collection('desarrollos').doc();
    const privRef = db.collection('desarrollos_privado').doc(devRef.id);
    const batch = db.batch();
    batch.set(devRef, {
      ot: gv('ft-ot'), po: gv('ft-po'), codigo_quini: f0.codigo || '',
      // El modelo es obligatorio para las reglas; una propuesta sin modelo
      // se identifica por su primer código, que sí existe siempre
      modelo: f0.modelo || codigos[0], cliente: f0.cliente || '',
      genero: '', talla: f0.talla || '', tipo_producto: f0.tipo_producto || '',
      asignado_a: gv('ft-asig') || 'israel',
      notas: gv('ft-notas'), variantes, variante_codigos: codigos,
      estado: 'pendiente',
      origen: 'ficha_tecnica',
      fecha_creacion: firebase.firestore.FieldValue.serverTimestamp(),
      creado_por: APP.user.id,
    });
    batch.set(privRef, {
      tipo_complejidad: sel[0].st.cx || 'A',
      complejidad_por_codigo: complejidadPorCodigo,
    });
    // Una ficha técnica por variante, en la subcolección PRIVADA del
    // desarrollo: son los valores objetivo y solo Lety puede leerlos, para
    // que la captura del muestrista sea ciega de verdad (ver firestore.rules)
    sel.forEach(({ f, cod }) => {
      const { hoja, codigo_raw, codigo_ok, codigo_sugerido, faltantes, ...datos } = f;
      batch.set(privRef.collection('fichas_tecnicas').doc(cod), {
        ...datos, codigo: cod, id_desarrollo: devRef.id,
        hoja_origen: String(hoja || '').slice(0, 60),
        // Qué venía incompleto en el Excel, para que Lety lo sepa al revisar
        faltantes_al_importar: (faltantes || []).slice(0, 12),
        archivo: String(FT.archivo || '').slice(0, 120),
        creado_por: APP.user.id,
        fecha_creacion: firebase.firestore.FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();
    const n = sel.length;
    FT = { fichas: [], errores: [], archivo: '', filas: null, meta: null };
    const file = document.getElementById('ft-file');
    if (file) file.value = '';
    document.getElementById('ft-ui').innerHTML = '';
    ['ft-ot', 'ft-po', 'ft-notas'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    showExito('Tarea creada', n + ' ficha' + (n === 1 ? '' : 's') + ' lista' + (n === 1 ? '' : 's') + ' para el muestrista');
  } catch (e) {
    console.error('asignarDesdeFicha:', e);
    toast(e && e.code === 'permission-denied'
      ? 'Firestore rechazó la tarea — avisa a Roberto'
      : 'Error creando la tarea — revisa tu conexión', false);
  } finally {
    asignandoFT = false;
    if (btn) { btn.disabled = false; btn.textContent = '✓ Crear tarea'; }
  }
}

// ── Autollenado desde el catálogo ──
// Se dispara al salir del campo de código. Rellena SOLO campos vacíos: nunca
// pisa lo que Lety ya escribió. Guard de carrera: si para cuando responde
// Firestore el código del input ya cambió, el resultado viejo se descarta.
// Además se guarda la promesa en curso (lookupPendiente) para que addVar()/
// asignar() puedan esperarla si Lety toca el botón antes de que responda.
let lookupPendiente = null;

async function autollenar(inputId, campos) {
  const cod = normalizarCodigo(gv(inputId));
  if (!cod) return;
  const p = lookupCodigo(cod);
  lookupPendiente = p;
  let data;
  try {
    data = await p;
  } finally {
    if (lookupPendiente === p) lookupPendiente = null;
  }
  if (!data) return;
  if (normalizarCodigo(gv(inputId)) !== cod) return; // el código ya cambió
  let puestos = 0;
  Object.entries(campos).forEach(([elId, key]) => {
    const el = document.getElementById(elId);
    const val = data[key];
    if (!el || !val) return;
    // El select de género arranca vacío justo para poder autollenarlo
    if (el.tagName === 'SELECT') {
      if (el.value) return;
      const opt = Array.from(el.options).find(o => o.value.toLowerCase() === String(val).toLowerCase()
        || o.textContent.trim().toLowerCase() === String(val).toLowerCase());
      if (opt) { el.value = opt.value; puestos++; }
      return;
    }
    if (el.value.trim()) return;
    el.value = val;
    puestos++;
  });
  if (puestos > 0) toast('📚 ' + puestos + ' dato' + (puestos === 1 ? '' : 's') + ' del catálogo');
}

export function wireAutollenado() {
  const unico = document.getElementById('s-cod');
  if (unico) unico.addEventListener('change', () => autollenar('s-cod', {
    's-desc': 'descripcion', 's-pares': 'pares_requeridos', 's-pack': 'tipo_pack',
    'l-mod': 'modelo', 'l-cli': 'cliente', 'l-gen': 'genero', 'l-tal': 'talla',
    'l-tprod': 'tipo_producto', 'l-cq': 'codigo_quini',
  }));
  const vc = document.getElementById('vc');
  if (vc) vc.addEventListener('change', () => autollenar('vc', {
    'vd': 'descripcion', 'vp': 'pares_requeridos', 'vpk': 'tipo_pack',
    'l-mod': 'modelo', 'l-cli': 'cliente', 'l-gen': 'genero', 'l-tal': 'talla',
    'l-tprod': 'tipo_producto', 'l-cq': 'codigo_quini',
  }));
}

export async function addVar() {
  if (lookupPendiente) { try { await lookupPendiente; } catch (e) {} }
  const cod = gv('vc').trim();
  if (!cod) { toast('Ingresa código de variante', false); return; }
  // startCap identifica la variante por código: repetirlo colapsaría dos
  // variantes en una sola captura
  if (APP.vars.some(v => v.codigo === cod)) { toast('Ya agregaste una variante con ese código', false); return; }
  // `complejidad` NO viaja en el documento público: se separa al asignar y se
  // guarda en desarrollos_privado, donde el muestrista no la puede leer.
  APP.vars.push({
    codigo: cod, descripcion: gv('vd').trim(), pares_requeridos: gv('vp').trim(),
    tipo_pack: gv('vpk').trim(), complejidad: gv('vcx') || 'A',
  });
  ['vc', 'vd', 'vp', 'vpk'].forEach(id => { document.getElementById(id).value = ''; });
  const vcx = document.getElementById('vcx');
  if (vcx) vcx.value = 'A';
  renderVars();
}

function renderVars() {
  document.getElementById('vlist').innerHTML = APP.vars.map((v, i) => `
    <div class="vi">
      <div style="flex:1"><div class="vcod">${es(v.codigo)} <span class="bge" style="font-size:10px">${es(v.complejidad || 'A')}</span></div><div style="font-size:12px;color:var(--tx2)">${es(v.descripcion)} · ${es(v.pares_requeridos)} pares · ${es(v.tipo_pack)}</div></div>
      <button data-rmvar="${i}" style="background:none;border:none;color:var(--rd);font-size:18px;cursor:pointer;padding:4px">✕</button>
    </div>`).join('');
}

let asignando = false;

export async function asignar() {
  if (!fsOk() || asignando) return;
  // Defensa en profundidad: el botón vive fuera de la vista en modo ficha
  // técnica (ver setMode), pero si algo lo colara, aquí nunca se crea nada.
  if (APP.asignMode === 'ficha') return;
  // asignando se marca ANTES del await al lookup pendiente (y no solo antes
  // del batch) para que un doble toque durante ese await no pase el guard
  asignando = true;
  try {
    if (lookupPendiente) { try { await lookupPendiente; } catch (e) {} }
    const mod = gv('l-mod').trim();
    if (!mod) { toast('Ingresa el modelo', false); return; }
    let variantes = [];
    if (APP.asignMode === 'single') {
      const cod = gv('s-cod').trim();
      if (!cod) { toast('Ingresa el código de variante', false); return; }
      // Código único: la complejidad del código es la misma del desarrollo
      variantes = [{ codigo: cod, descripcion: gv('s-desc').trim(), pares_requeridos: gv('s-pares').trim(), tipo_pack: gv('s-pack').trim(), complejidad: gv('l-comp') }];
    } else {
      if (APP.vars.length === 0) { toast('Agrega al menos una variante', false); return; }
      variantes = [...APP.vars];
    }
    // La complejidad de cada código se SEPARA del documento público: viaja al
    // espejo privado, que solo lee Lety. Si se quedara dentro de `variantes`,
    // el muestrista la leería junto con su tarea.
    const complejidadPorCodigo = {};
    variantes.forEach(v => { complejidadPorCodigo[v.codigo] = v.complejidad || 'A'; });
    variantes = variantes.map(({ complejidad, ...publico }) => publico);
    const devRef = db.collection('desarrollos').doc();
    const privRef = db.collection('desarrollos_privado').doc(devRef.id);
    const batch = db.batch();
    batch.set(devRef, {
      ot: gv('l-ot'), po: gv('l-po'), codigo_quini: gv('l-cq'),
      modelo: mod, cliente: gv('l-cli'),
      genero: gv('l-gen'), talla: gv('l-tal'), tipo_producto: gv('l-tprod'), agujado: gv('l-ag'),
      asignado_a: gv('l-asig'),
      notas: gv('l-notas'), variantes, variante_codigos: variantes.map(v => v.codigo),
      estado: 'pendiente',
      fecha_creacion: firebase.firestore.FieldValue.serverTimestamp(),
      creado_por: APP.user.id,
    });
    batch.set(privRef, {
      tipo_complejidad: gv('l-comp'),
      complejidad_por_codigo: complejidadPorCodigo,
    });
    await batch.commit();
    APP.vars = [];
    renderVars();
    ['l-ot', 'l-po', 'l-cq', 'l-mod', 'l-cli', 'l-gen', 'l-tal', 'l-tprod', 'l-ag', 'l-notas', 's-cod', 's-desc', 's-pares', 's-pack'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    toast('✅ Desarrollo asignado');
  } catch (e) { console.error(e); toast('Error asignando', false); }
  finally { asignando = false; }
}

// ── Revisar ──
// La lista de pendientes la mantiene el listener de initLety en tiempo real;
// aquí solo se recargan las capturas en proceso.
export async function loadRev() {
  if (!fsOk()) return;
  try {
    const snap2 = await db.collection('capturas').where('estado', 'in', ['activo', 'pausado', 'correccion']).get();
    const el2 = document.getElementById('proc-list');
    if (el2) el2.innerHTML = snap2.empty
      ? '<div class="empty"><div class="ico">⏱</div><p>Sin capturas activas</p></div>'
      : snap2.docs.map(d => {
          const dt = d.data();
          return `<div class="card" data-proc="${es(d.id)}" style="cursor:pointer">
            <div class="dt">${es(dt.modelo)} · <span class="vcod">${es(dt.codigo_variante)}</span>
              ${dt.estado === 'correccion' ? '<span class="bge brd" style="margin-left:6px">🔁 en corrección</span>' : ''}</div>
            <div class="ds">${(USERS[dt.id_muestrista] || {}).nombre || es(dt.id_muestrista)} · ${fmtDate(dt.dt_inicio)}</div>
            <div class="mr"><span style="font-size:11px;color:var(--tx3)">${dt.folio ? es(dt.folio) + ' · ' : ''}Toca para ver la ficha</span><span style="color:var(--pri)">›</span></div>
          </div>`;
        }).join('');
  } catch (e) {
    console.error(e);
    toast('Error cargando fichas — revisa tu conexión', false);
  }
}

function renderRevCard(id, d) {
  return `<div class="card am">
    <div class="dt">${es(d.modelo)} · <span class="vcod">${es(d.codigo_variante)}</span>${(d.iter || 1) > 1 ? ` <span class="bge bpend">iter ${es(d.iter)}</span>` : ''}</div>
    <div class="ds">${(USERS[d.id_muestrista] || {}).nombre || es(d.id_muestrista)} · ${es(d.descripcion_variante)}</div>
    <div class="mr"><span>${d.folio ? es(d.folio) + ' · ' : ''}OT ${es(d.ot)}</span><span>${fmtDate(d.dt_fin)}</span></div>
    <button class="btn btn-am btn-sm" style="margin-top:10px;width:100%" data-rev="${es(id)}">📋 Ver y firmar</button>
  </div>`;
}

// readOnly=true: ver ficha ya aprobada (con opción de reabrir)
export async function openRev(capturaId, readOnly = false, soloVer = false) {
  if (!fsOk()) return;
  APP.revCap = capturaId;
  // Se limpia aquí: renderComparacion solo la asigna cuando ESTA captura tiene
  // ficha técnica, así que sin el reset quedaría la de la ficha anterior.
  APP.revFicha = null;
  try {
    const snap = await db.collection('capturas').doc(capturaId).get();
    const d = snap.data();
    if (!d) { toast('Ficha no encontrada', false); return; }
    APP.revFolio = d.folio || null; // para la pantalla de éxito al aprobar
    document.getElementById('rtitle').textContent = soloVer ? 'Ficha en proceso'
      : readOnly ? 'Ficha aprobada' : 'Revisar ficha práctica';
    // TEN calculado desde Firestore, no desde timers en memoria
    const tn = tenFromDoc(d);
    const sh = d.med_sh || {}, mh = d.med_h || {}, gi = d.giros || {}, vl = d.vels || {}, pt = d.pto || {};
    // Desglose de TM por causa (auditoría de Lety)
    const tmDet = Object.entries(d.tm_causas || {})
      .filter(([, s]) => typeof s === 'number' && s > 0)
      .map(([cid, s]) => {
        const c = TM_CAUSES.find(x => x.id === cid);
        return `<div class="mr"><span>${es(c ? c.label : cid)}${c && c.pen ? ' <span class="bge brd">cuenta en TEN</span>' : ''}</span><span>${fmtMin(s)}</span></div>`;
      }).join('');
    document.getElementById('rbody').innerHTML = `
      <div id="rev-ft"></div>
      <div class="card ${readOnly ? 'gn' : 'bl'}">
        <div class="dt">${es(d.modelo)} · <span class="vcod">${es(d.codigo_variante)}</span>${(d.iter || 1) > 1 ? ` <span class="bge bpend">iter ${es(d.iter)}</span>` : ''}</div>
        <div class="ds">${es(d.descripcion_variante)} · ${es(d.tipo_pack)}</div>
        <div class="mr"><span>${(USERS[d.id_muestrista] || {}).nombre || es(d.id_muestrista)}</span><span>${d.folio ? es(d.folio) + ' · ' : ''}OT ${es(d.ot)} · PO ${es(d.po)}</span></div>
        <div class="mr"><span>TEN: <strong style="color:var(--gn)">${fmtMin(tn)}</strong></span><span>TM: <span style="color:var(--rd)">${fmtMin(d.tm_seg || 0)}</span></span></div>
        <div class="mr"><span>Bruto: ${fmtMin(d.elapsed_seg || 0)}</span><span>${fmtDate(d.dt_fin)}</span></div>
      </div>
      ${tmDet ? `<div class="fsec"><div class="ftitle">Tiempos muertos por causa</div>${tmDet}</div>` : ''}
      <div class="fsec"><div class="ftitle">Máquina</div>
        <div class="g2" style="font-size:13px">
          <div><label class="fl">Marca</label>${es(d.maquina_marca) || '—'}</div>
          <div><label class="fl">Número</label>${es(d.maquina_numero) || '—'}</div>
          <div><label class="fl">Agujado</label>${es(d.agujado) || '—'}</div>
        </div>
      </div>
      <div class="fsec"><div class="ftitle">Medidas</div>
        <table class="mt">
          <tr><th>Medida</th><th>Sin Hormar</th><th>Hormado</th></tr>
          ${['A', 'B', 'C', 'D', 'E'].map(k => `<tr><td class="lbl">${k}</td><td>${es(sh[k]) || '—'}</td><td>${es(mh[k]) || '—'}</td></tr>`).join('')}
        </table>
      </div>
      <div class="fsec"><div class="ftitle">Tiempos y pesos</div>
        <div class="g2" style="font-size:13px">
          <div><label class="fl">T. ciclo</label>${es(d.t_ciclo_min) || '—'} min ${es(d.t_ciclo_seg) || '—'} seg</div>
          <div><label class="fl">Peso salida</label>${es(d.peso_sal) || '—'} g</div>
          <div><label class="fl">Peso cerrado</label>${es(d.peso_cer) || '—'} g</div>
        </div>
      </div>
      <div class="fsec"><div class="ftitle">Giros y velocidades de cadena</div>
        <div class="g2" style="font-size:13px">
          <div><label class="fl">Giros elástico</label>${es(gi.el) || '—'}</div>
          <div><label class="fl">Giros tubo</label>${es(gi.tb) || '—'}</div>
          <div><label class="fl">Giros planta</label>${es(gi.pl) || '—'}</div>
          <div><label class="fl">Rubber</label>${es(gi.rb) || '—'}</div>
          <div><label class="fl">Vel. elástico</label>${es(vl.el) || '—'}</div>
          <div><label class="fl">Vel. tubo</label>${es(vl.tb) || '—'}</div>
          <div><label class="fl">Vel. talón y punta</label>${es(vl.tp) || '—'}</div>
          <div><label class="fl">Vel. planta</label>${es(vl.pl) || '—'}</div>
        </div>
      </div>
      ${(() => {
        // Punto de máquina: la tabla completa si la ficha la trae; si es una
        // ficha vieja, el trío suelto que se capturaba antes.
        const filas = (d.pto_tabla || []).filter(f => f && (f.d1 || f.d2 || f.sk));
        if (!filas.length && !(pt.d1 || pt.d2 || pt.sk)) return '';
        const cuerpo = filas.length
          ? filas.map(f => `<tr><td class="lbl">${es(f.alim)}</td><td>${es(f.d1) || '—'}</td><td>${es(f.d2) || '—'}</td><td>${es(f.sk) || '—'}</td></tr>`).join('')
          : `<tr><td class="lbl">1</td><td>${es(pt.d1) || '—'}</td><td>${es(pt.d2) || '—'}</td><td>${es(pt.sk) || '—'}</td></tr>`;
        return `<div class="fsec"><div class="ftitle">Punto de máquina</div>
          <table class="mt"><tr><th>Alim.</th><th>DEN-1</th><th>DEN-2</th><th>SINK2</th></tr>${cuerpo}</table></div>`;
      })()}
      <div class="fsec"><div class="ftitle">Producción</div>
        <div style="font-size:13px"><label class="fl">Pares producidos</label>${es(d.pares) || '—'} de ${es(d.pares_requeridos) || '—'} requeridos</div>
      </div>
      ${d.obs ? `<div class="fsec"><div class="ftitle">Observaciones</div><div style="font-size:13px">${es(d.obs)}</div></div>` : ''}
      ${esFirmaValida(d.firma_m) ? `<div class="fsec"><div class="ftitle">Firma muestrista</div><img src="${es(d.firma_m)}" alt="Firma muestrista" class="firma-img"></div>` : ''}
      ${readOnly && esFirmaValida(d.firma_l) ? `<div class="fsec"><div class="ftitle">Firma de aprobación (Lety)</div><img src="${es(d.firma_l)}" alt="Firma Lety" class="firma-img"></div>` : ''}
      ${soloVer
        ? `<div class="al ali"><span>⏱</span><span style="font-size:12px">El muestrista sigue capturando esta ficha. Aquí ves lo que lleva y la ficha técnica de referencia; podrás aprobarla cuando la firme.</span></div>`
        : readOnly
        ? `<button class="btn btn-bl" onclick="reabrirFicha()">🔓 Reabrir ficha (volver a pendiente)</button>`
        : `<div class="brow">
            <button class="btn btn-gn" style="flex:1" onclick="aprobar()">✓ Aprobar y firmar</button>
            <button class="btn btn-rd" style="flex:1" onclick="rechazar()">✕ Solicitar corrección</button>
          </div>`}
    `;
    scr('sR');
    renderComparacion(d, capturaId); // asíncrono: no retrasa el render de la ficha
  } catch (e) { console.error(e); toast('Error cargando revisión', false); }
}

// Comparación objetivo (ficha técnica) vs. real (lo que capturó el muestrista).
// Solo corre aquí, en la pantalla de Lety: las reglas prohíben al muestrista
// leer la ficha técnica, justo para que su captura sea ciega.
async function renderComparacion(d, capId) {
  const cont = document.getElementById('rev-ft');
  if (!cont || !d.id_desarrollo || !d.codigo_variante) return;
  try {
    const snap = await db.collection('desarrollos_privado').doc(d.id_desarrollo)
      .collection('fichas_tecnicas').doc(normalizarCodigo(d.codigo_variante)).get();
    if (!snap.exists) return; // desarrollo capturado a mano, sin ficha técnica
    if (APP.revCap !== capId) return; // Lety ya abrió otra ficha mientras cargaba
    const ft = snap.data();
    APP.revFicha = ft; // para el desplegable de la ficha completa
    const filas = comparar(ft, d);
    const fuera = filas.filter(f => f.fuera === true);
    const conTol = filas.filter(f => f.fuera !== null);
    const info = filas.filter(f => f.fuera === null && f.dif > 0);
    const fila = f => `<div class="mr">
      <span>${es(f.etiqueta)}</span>
      <span style="font-family:var(--mono);font-size:12px">
        <span style="color:var(--tx3)">${es(f.objetivo)}</span> →
        <strong style="color:${f.fuera === true ? 'var(--rd)' : f.fuera === false ? 'var(--gn)' : 'var(--tx)'}">${es(f.real)}</strong>
        ${f.tol !== null ? `<span class="bge ${f.fuera ? 'brd' : 'bok'}" style="margin-left:6px">${f.fuera ? '±' + es(f.tol) + ' ✕' : 'ok'}</span>` : `<span style="color:var(--tx3);margin-left:6px">Δ${es(f.dif)}</span>`}
      </span></div>`;
    cont.innerHTML = `
      <div class="card ${fuera.length ? 'rd' : 'gn'}">
        <div class="dt">${fuera.length ? '⚠️ ' + fuera.length + ' medida' + (fuera.length === 1 ? '' : 's') + ' fuera de tolerancia' : '✅ Dentro de tolerancia'}</div>
        <div class="ds">Comparado contra la ficha técnica ${es(ft.hoja_origen || ft.codigo)}${conTol.length ? ' · ' + es(conTol.length) + ' medidas con tolerancia' : ''}</div>
        ${(ft.faltantes_al_importar || []).length ? `<div class="mr"><span style="font-size:11px;color:var(--tx3)">La ficha técnica llegó sin: ${es(ft.faltantes_al_importar.join(', '))}</span></div>` : ''}
      </div>
      ${conTol.length ? `<div class="fsec"><div class="ftitle">Medidas · objetivo → real</div>${conTol.map(fila).join('')}</div>` : ''}
      ${info.length ? `<div class="fsec"><div class="ftitle">Otros parámetros (sin tolerancia en la ficha)</div>${info.map(fila).join('')}</div>` : ''}
      <button class="btn btn-gh btn-sm" style="width:100%" data-revft="1">📄 Ver la ficha técnica completa</button>
      <div id="rev-ftdet"></div>`;
  } catch (e) {
    console.error('comparacion ficha tecnica:', e);
    cont.innerHTML = '<div class="al alw"><span>⚠️</span><span style="font-size:12px">No se pudo cargar la ficha técnica para comparar</span></div>';
  }
}

export function aprobar() {
  APP.sigData = { capturaId: APP.revCap, who: 'lety' };
  document.getElementById('ft').textContent = 'Firma de Lety — Aprobar';
  document.getElementById('fi-inst').innerHTML = '<span>✍️</span><span>Firma para aprobar y cerrar la ficha.</span>';
  showFirma();
}

// Cambio de estado condicionado: solo procede si la ficha sigue en el estado
// esperado (una pantalla vieja no puede pisar un cambio más reciente)
async function transicion(capId, esperado, cambios) {
  const ref = db.collection('capturas').doc(capId);
  let devId = null;
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data().estado !== esperado) throw new Error('estado-cambiado');
    devId = snap.data().id_desarrollo || null;
    tx.update(ref, cambios);
  });
  // Se devuelve para poder recalcular después si la tarea sigue terminada
  return devId;
}

export function rechazar() {
  confirmDlg(
    'Solicitar corrección',
    'La ficha regresará al muestrista para corregirla y su firma actual se descartará. ¿Continuar?',
    'Sí, solicitar corrección',
    async () => {
      if (!fsOk()) return;
      try {
        const devId = await transicion(APP.revCap, 'pendiente_lety', { estado: 'correccion', firma_m: null });
        toast('Corrección solicitada');
        // La tarea deja de estar completa (esta ficha vuelve al muestrista)
        if (devId) reconciliarEstadoTarea(devId);
      } catch (e) {
        console.error(e);
        toast(e && e.message === 'estado-cambiado'
          ? 'La ficha ya cambió de estado — lista actualizada'
          : 'Error solicitando corrección', false);
      }
      scr('sL');
      loadRev();
    }
  );
}

// Reabrir una ficha ya aprobada: vuelve a pendiente_lety (conserva la firma
// del muestrista, descarta la aprobación)
export function reabrirFicha() {
  confirmDlg(
    'Reabrir ficha aprobada',
    'La ficha volverá a "pendiente de revisión" y se descartará tu firma de aprobación. ¿Continuar?',
    'Sí, reabrir',
    async () => {
      if (!fsOk()) return;
      try {
        const devId = await transicion(APP.revCap, 'aprobado', { estado: 'pendiente_lety', firma_l: null });
        toast('Ficha reabierta — pendiente de revisión');
        // Si la tarea ya estaba cerrada, vuelve a abrirse y se limpia su
        // fecha de término (ver reconciliarEstadoTarea)
        if (devId) reconciliarEstadoTarea(devId);
      } catch (e) {
        console.error(e);
        toast(e && e.message === 'estado-cambiado'
          ? 'La ficha ya cambió de estado — lista actualizada'
          : 'Error reabriendo ficha', false);
      }
      scr('sL');
      loadRev();
      loadDB();
    }
  );
}


// ══════════════════════════════════════════════════════════════════════
// Tareas asignadas: ver lo que Lety ya dejó, y AMPLIARLO
//
// Una tarea no se edita — se AGREGA. Es la regla que puso la propia Lety y la
// que hacen cumplir las reglas de Firestore: los datos del pedido solo pasan
// de vacío a lleno, y las variantes solo se suman. Dos casos reales:
//   · La OT no existe al crear la tarea (se genera al subir la muestra al ERP).
//   · Un pack de 6 se vuelve de 12 si el cliente pide derecho e izquierdo.
// ══════════════════════════════════════════════════════════════════════
let TAREAS = [];

export async function loadTareas() {
  if (!fsOk()) return;
  const el = document.getElementById('tk-list');
  try {
    const quien = gv('tk-quien') || 'all';
    const filtro = gv('tk-estado') || 'abiertas';
    let q = db.collection('desarrollos');
    if (quien !== 'all') q = q.where('asignado_a', '==', quien);
    const snap = await q.get();
    let docs = snap.docs.map(d => ({ id: d.id, data: d.data() }));
    if (filtro === 'abiertas') docs = docs.filter(d => d.data.estado !== 'terminado');
    else if (filtro === 'terminado') docs = docs.filter(d => d.data.estado === 'terminado');
    // Más recientes primero. El orden va en cliente para no pedir índice.
    docs.sort((a, b) => (b.data.fecha_creacion && b.data.fecha_creacion.toMillis ? b.data.fecha_creacion.toMillis() : 0)
                      - (a.data.fecha_creacion && a.data.fecha_creacion.toMillis ? a.data.fecha_creacion.toMillis() : 0));
    TAREAS = docs;
    if (!el) return;
    el.innerHTML = docs.length === 0
      ? '<div class="empty"><div class="ico">📋</div><p>Sin tareas en este filtro</p></div>'
      : docs.map(({ id, data: d }) => {
          const n = (d.variante_codigos || []).length;
          const falta = [];
          if (!String(d.ot || '').trim()) falta.push('OT');
          if (!String(d.po || '').trim()) falta.push('PO');
          const bge = d.estado === 'terminado' ? '<span class="bge bok">terminada</span>'
            : d.estado === 'en_proceso' ? '<span class="bge bpend">en proceso</span>'
            : '<span class="bge bpend">pendiente</span>';
          return '<div class="card" style="margin-bottom:8px">'
            + '<div style="display:flex;align-items:center;gap:8px">'
            + '<span style="font-size:14px;font-weight:700;flex:1">' + es(d.modelo) + '</span>' + bge + '</div>'
            + '<div class="mr"><span>' + (es(d.cliente) || '—') + ' · '
            + ((USERS[d.asignado_a] || {}).nombre || es(d.asignado_a)) + '</span><span>'
            + es(n) + ' variante' + (n === 1 ? '' : 's') + '</span></div>'
            + '<div class="mr"><span>' + (d.ot ? 'OT ' + es(d.ot) : '') + (d.po ? ' · PO ' + es(d.po) : '')
            + (falta.length ? ' <span class="bge bpend">falta ' + es(falta.join(' y ')) + '</span>' : '')
            + '</span><span>' + fmtDate(d.fecha_creacion) + '</span></div>'
            + '<button class="btn btn-bl btn-sm" style="margin-top:8px;width:100%" data-tarea="' + es(id) + '">📋 Ver y ampliar</button>'
            + '</div>';
        }).join('');
  } catch (e) {
    console.error('loadTareas:', e);
    if (el) el.innerHTML = '<div class="empty"><div class="ico">⚠️</div><p>No se pudieron cargar las tareas</p></div>';
    toast('Error cargando tareas — revisa tu conexión', false);
  }
}

export function backTarea() { scr('sL'); loadTareas(); }

// Detalle: datos del pedido, variantes con su avance, y su ficha técnica
export async function openTarea(devId) {
  if (!fsOk()) return;
  APP.tareaId = devId;
  const cont = document.getElementById('tk-body');
  scr('sT');
  cont.innerHTML = '<div class="empty"><div class="ico">⏳</div><p>Cargando…</p></div>';
  try {
    const [devSnap, capsSnap, ftSnap] = await Promise.all([
      db.collection('desarrollos').doc(devId).get(),
      db.collection('capturas').where('id_desarrollo', '==', devId).get(),
      db.collection('desarrollos_privado').doc(devId).collection('fichas_tecnicas').get(),
    ]);
    if (APP.tareaId !== devId) return; // abrió otra mientras cargaba
    const d = devSnap.data();
    if (!d) { toast('Tarea no encontrada', false); scr('sL'); return; }
    APP.tareaDoc = d;
    const caps = capsSnap.docs.map(x => x.data());
    const fichas = {};
    ftSnap.docs.forEach(x => { fichas[x.id] = x.data(); });
    APP.tareaFichas = fichas;
    document.getElementById('tk-title').textContent = d.modelo || 'Tarea';

    const estadoDe = cod => {
      const suyas = caps.filter(c => c.codigo_variante === cod);
      const abierta = suyas.some(c => ['activo', 'pausado', 'correccion', 'pendiente_lety'].includes(c.estado));
      if (suyas.some(c => c.estado === 'aprobado') && !abierta) return ['aprobada', 'bok'];
      if (suyas.some(c => c.estado === 'pendiente_lety')) return ['con Lety', 'bpend'];
      if (suyas.some(c => c.estado === 'correccion')) return ['corrección', 'brd'];
      if (suyas.some(c => ['activo', 'pausado'].includes(c.estado))) return ['en curso', 'bpend'];
      return ['sin iniciar', 'bpend'];
    };
    const faltaOT = !String(d.ot || '').trim();
    const faltaPO = !String(d.po || '').trim();
    const faltaAg = !String(d.agujado || '').trim();
    const cab = [d.tipo_producto, d.genero, d.talla && ('Talla ' + d.talla), d.agujado && ('Agujado ' + d.agujado)]
      .filter(Boolean).map(es).join(' · ');

    const variantes = (d.variantes || []).map(v => {
      const par = estadoDe(v.codigo);
      const ft = fichas[v.codigo];
      return '<div class="vi" style="flex-wrap:wrap">'
        + '<div style="flex:1;min-width:140px"><div class="vcod">' + es(v.codigo) + '</div>'
        + '<div style="font-size:12px;color:var(--tx2)">' + (es(v.descripcion) || '—')
        + (v.pares_requeridos ? ' · ' + es(v.pares_requeridos) + ' pares' : '') + '</div></div>'
        + '<span class="bge ' + par[1] + '" style="flex-shrink:0">' + es(par[0]) + '</span>'
        + (ft ? '<button class="btn btn-gh btn-sm" style="width:auto;padding:8px 10px" data-ftver="' + es(v.codigo) + '">📄 Ficha técnica</button>'
              : '<span style="font-size:11px;color:var(--tx3)">sin ficha técnica</span>')
        + '<div id="ftdet-' + es(v.codigo) + '" style="flex-basis:100%"></div>'
        + '</div>';
    }).join('');

    // ── Tiempo de la tarea completa ──
    // Lety pidió "el desglose del tiempo que ocuparon al final de la tarea":
    // hasta ahora solo existía por ficha. Aquí se suman todas las fichas del
    // pack, incluidas las de una variante recapturada.
    const bruto = caps.reduce((a, c) => a + (c.elapsed_seg || 0), 0);
    const tmTot = caps.reduce((a, c) => a + (c.tm_seg || 0), 0);
    const tenTot = caps.reduce((a, c) => a + tenFromDoc(c), 0);
    const porCausa = {};
    caps.forEach(c => Object.entries(c.tm_causas || {}).forEach(([k, v]) => {
      if (typeof v === 'number' && v > 0) porCausa[k] = (porCausa[k] || 0) + v;
    }));
    const causas = Object.entries(porCausa).sort((a, b) => b[1] - a[1]);
    const tiempos = caps.length === 0 ? '' : `
      <div class="fsec"><div class="ftitle">Tiempo de la tarea</div>
        <div class="mr"><span>Trabajo efectivo (TEN)</span><strong style="color:var(--gn)">${fmtMin(tenTot)}</strong></div>
        <div class="mr"><span>Tiempo muerto</span><span style="color:var(--rd)">${fmtMin(tmTot)}</span></div>
        <div class="mr"><span>Bruto de punta a punta</span><span>${fmtMin(bruto)}</span></div>
        <div class="mr"><span style="font-size:11px;color:var(--tx3)">${es(caps.length)} ficha${caps.length === 1 ? '' : 's'} capturada${caps.length === 1 ? '' : 's'}${d.terminado_en ? ' · cerrada ' + fmtDate(d.terminado_en) : ''}</span><span></span></div>
        ${causas.length ? '<div class="ftitle" style="margin-top:10px">Desglose del tiempo muerto</div>' + causas.map(([k, v]) => {
          const c = TM_CAUSES.find(x => x.id === k);
          return `<div class="mr"><span>${es(c ? c.label : k)}${c && c.pen ? ' <span class="bge brd">cuenta en TEN</span>' : ''}</span><span>${fmtMin(v)}</span></div>`;
        }).join('') : ''}
      </div>`;

    const completar = (faltaOT || faltaPO || faltaAg)
      ? '<div class="fsec"><div class="ftitle">Completar datos que faltaban</div>'
        + '<div class="al ali"><span>ℹ️</span><span style="font-size:12px">Solo se puede llenar lo que está vacío; lo ya capturado no se cambia.</span></div>'
        + '<div class="g2">'
        + (faltaOT ? '<div class="fg"><label class="fl">OT</label><input class="fi" id="tk-ot" placeholder="7735"></div>' : '')
        + (faltaPO ? '<div class="fg"><label class="fl">PO</label><input class="fi" id="tk-po" placeholder="2422"></div>' : '')
        + '</div>'
        + (faltaAg ? '<div class="fg"><label class="fl">Agujado</label><select class="fi" id="tk-ag"><option value="">— elegir —</option><option>108</option><option>120</option><option>132</option><option>144</option><option>200</option></select></div>' : '')
        + '<button class="btn btn-am btn-sm" style="width:100%" onclick="guardarDatosTarea()">💾 Guardar datos</button></div>'
      : '';

    cont.innerHTML = '<div class="card bl">'
      + '<div class="dt">' + es(d.modelo) + (d.cliente ? ' · ' + es(d.cliente) : '') + '</div>'
      + '<div class="ds">' + (cab || 'Sin datos de producto') + '</div>'
      + '<div class="mr"><span>' + ((USERS[d.asignado_a] || {}).nombre || es(d.asignado_a)) + '</span>'
      + '<span>' + (d.ot ? 'OT ' + es(d.ot) : 'sin OT') + (d.po ? ' · PO ' + es(d.po) : '') + '</span></div>'
      + '<div class="mr"><span>Creada ' + fmtDate(d.fecha_creacion) + '</span><span>' + es(d.estado) + '</span></div>'
      + (d.notas ? '<div class="mr"><span style="font-size:12px">📌 ' + es(d.notas) + '</span></div>' : '')
      + '</div>'
      + tiempos
      + completar
      + '<div class="stitle">Variantes (' + es((d.variante_codigos || []).length) + ')</div>'
      + variantes
      + '<div class="fsec"><div class="ftitle">Agregar variante</div>'
      + '<div class="al ali"><span>➕</span><span style="font-size:12px">Para cuando el cliente pide más colores o derecho e izquierdo sobre una tarea ya empezada. Las variantes que ya existen no se tocan.</span></div>'
      + '<div class="g2">'
      + '<div class="fg"><label class="fl">Código</label><input class="fi" id="tk-vc" placeholder="2798"></div>'
      + '<div class="fg"><label class="fl">Descripción / color</label><input class="fi" id="tk-vd" placeholder="Negro"></div>'
      + '</div><div class="g2">'
      + '<div class="fg"><label class="fl">Pares requeridos</label><input class="fi" type="number" min="0" id="tk-vp" placeholder="6000"></div>'
      + '<div class="fg"><label class="fl">Complejidad</label><select class="fi" id="tk-vx"><option value="A">A — básico</option><option value="B">B — con diseño</option><option value="C">C — jacquard</option></select></div>'
      + '</div>'
      + '<button class="btn btn-am btn-sm" style="width:100%" onclick="agregarVariante()">➕ Agregar a esta tarea</button></div>';
  } catch (e) {
    console.error('openTarea:', e);
    cont.innerHTML = '<div class="empty"><div class="ico">⚠️</div><p>No se pudo cargar la tarea</p></div>';
  }
}

// Muestra u oculta los valores objetivo de una variante (pestaña Tareas)
function verFichaTecnica(cod) {
  pintaFicha(document.getElementById('ftdet-' + cod), (APP.tareaFichas || {})[cod], cod);
}

// Lo mismo desde la pantalla de revisión: Lety necesita la ficha técnica
// tanto al revisar una ficha firmada como al mirar una que sigue en curso.
function verFichaRev() {
  pintaFicha(document.getElementById('rev-ftdet'), APP.revFicha, (APP.revFicha || {}).codigo || '');
}

function pintaFicha(cont, ft, cod) {
  if (!cont) return;
  if (cont.innerHTML) { cont.innerHTML = ''; return; }
  if (!ft) { cont.innerHTML = '<div style="font-size:12px;color:var(--tx3)">Sin ficha técnica</div>'; return; }
  const fila = (et, v) => v ? '<div class="mr"><span>' + es(et) + '</span><span style="font-family:var(--mono);font-size:12px">' + es(v) + '</span></div>' : '';
  const med = ['A', 'B', 'C', 'D', 'E'].map(k => {
    const sh = (ft.med_sh || {})[k], h = (ft.med_h || {})[k], tol = (ft.med_tol || {})[k];
    if (!sh && !h) return '';
    return '<div class="mr"><span>' + k + '</span><span style="font-family:var(--mono);font-size:12px">'
      + es(sh || '—') + ' / ' + es(h || '—') + (tol ? ' ±' + es(tol) : '') + '</span></div>';
  }).join('');
  const ciclo = [ft.t_ciclo_min, ft.t_ciclo_seg].filter(Boolean).length
    ? es(ft.t_ciclo_min || '0') + 'm ' + es(ft.t_ciclo_seg || '0') + 's' : '';
  cont.innerHTML = '<div class="card" style="margin:8px 0 0;background:var(--s2)">'
    + '<div class="ftitle">Ficha técnica' + (ft.hoja_origen || cod ? ' · ' + es(ft.hoja_origen || cod) : '') + '</div>'
    + fila('Máquina', [ft.maquina_marca, ft.maquina_numero].filter(Boolean).join(' #'))
    + fila('Agujas', ft.agujas)
    + fila('Peso salida / cerrado', [ft.peso_sal, ft.peso_cer].filter(Boolean).join(' / '))
    + fila('Tiempo de ciclo', ciclo)
    + (med ? '<div class="ftitle" style="margin-top:8px">Medidas (sin hormar / hormado)</div>' + med : '')
    + fila('Giros el/tb/pl/rb', ['el', 'tb', 'pl', 'rb'].map(k => (ft.giros || {})[k] || '—').join(' / '))
    + fila('Vels el/tb/tp/pl', ['el', 'tb', 'tp', 'pl'].map(k => (ft.vels || {})[k] || '—').join(' / '))
    + ((ft.pto_tabla || []).filter(f => f && (f.d1 || f.d2 || f.sk)).length
        ? '<div class="ftitle" style="margin-top:8px">Punto de máquina objetivo</div>'
          + '<table class="mt"><tr><th>Alim.</th><th>DEN-1</th><th>DEN-2</th><th>SINK2</th></tr>'
          + ft.pto_tabla.filter(f => f && (f.d1 || f.d2 || f.sk))
              .map(f => '<tr><td class="lbl">' + es(f.alim) + '</td><td>' + (es(f.d1) || '—')
                + '</td><td>' + (es(f.d2) || '—') + '</td><td>' + (es(f.sk) || '—') + '</td></tr>').join('')
          + '</table>'
        : '')
    + ((ft.faltantes_al_importar || []).length
        ? '<div class="mr"><span style="font-size:11px;color:var(--tx3)">Llegó sin: ' + es(ft.faltantes_al_importar.join(', ')) + '</span></div>' : '')
    + '</div>';
}

let guardandoTarea = null; // devId en curso

// Completa OT / PO / agujado. Las reglas solo aceptan pasar de vacío a lleno.
export async function guardarDatosTarea() {
  if (!fsOk() || !APP.tareaId) return;
  if (guardandoTarea) { toast('Espera: se está guardando la tarea anterior', false); return; }
  const cambios = {};
  const ot = gv('tk-ot').trim(), po = gv('tk-po').trim(), ag = gv('tk-ag').trim();
  if (ot) cambios.ot = ot;
  if (po) cambios.po = po;
  if (ag) cambios.agujado = ag;
  if (Object.keys(cambios).length === 0) { toast('Escribe algún dato primero', false); return; }
  // Se fija la tarea ANTES de escribir: si Lety abre otra mientras esto
  // viaja, el resultado viejo no debe arrastrarla de vuelta a esta pantalla.
  const devId = APP.tareaId;
  guardandoTarea = devId;
  try {
    await db.collection('desarrollos').doc(devId).update(cambios);
    // Las fichas que ya nacieron copiaron la OT/PO vacías del desarrollo
    // (createCap las denormaliza al crear). Sin este relleno, una ficha
    // empezada antes de que existiera la OT saldría sin ella en el CSV.
    const propaga = {};
    if (cambios.ot) propaga.ot = cambios.ot;
    if (cambios.po) propaga.po = cambios.po;
    if (cambios.agujado) propaga.agujado = cambios.agujado;
    if (Object.keys(propaga).length) {
      try {
        const caps = await db.collection('capturas').where('id_desarrollo', '==', devId).get();
        // El agujado vive también en el formulario del muestrista: si se lo
        // rellenamos a una ficha que él tiene abierta, su próximo "guardar"
        // lo revertiría al valor de su pantalla. Por eso solo se rellena en
        // fichas ya cerradas; en las abiertas lo captura él.
        const ABIERTAS = ['activo', 'pausado', 'correccion'];
        const pend = caps.docs.filter(c => {
          const dt = c.data();
          const cerrada = !ABIERTAS.includes(dt.estado);
          return (propaga.ot && !String(dt.ot || '').trim())
            || (propaga.po && !String(dt.po || '').trim())
            || (propaga.agujado && cerrada && !String(dt.agujado || '').trim());
        });
        // Cada ficha se actualiza solo con lo que le falta: las reglas
        // rechazan pisar un dato que esa ficha ya traía.
        for (let i = 0; i < pend.length; i += 20) {
          const batch = db.batch();
          pend.slice(i, i + 20).forEach(c => {
            const dt = c.data(), suyo = {};
            if (propaga.ot && !String(dt.ot || '').trim()) suyo.ot = propaga.ot;
            if (propaga.po && !String(dt.po || '').trim()) suyo.po = propaga.po;
            if (propaga.agujado && !ABIERTAS.includes(dt.estado) && !String(dt.agujado || '').trim()) suyo.agujado = propaga.agujado;
            if (Object.keys(suyo).length) batch.update(c.ref, suyo);
          });
          await batch.commit();
        }
        if (pend.length) toast('✅ Datos agregados · ' + pend.length + ' ficha' + (pend.length === 1 ? '' : 's') + ' actualizada' + (pend.length === 1 ? '' : 's'));
        else toast('✅ Datos agregados a la tarea');
      } catch (e2) {
        // El dato principal YA quedó en la tarea: esto es un extra
        console.error('propagar ot/po a capturas:', e2);
        toast('Datos guardados, pero las fichas ya creadas conservan la OT vieja', false);
      }
    } else {
      toast('✅ Datos agregados a la tarea');
    }
    if (APP.tareaId === devId) await openTarea(devId);
  } catch (e) {
    console.error('guardarDatosTarea:', e);
    toast(e && e.code === 'permission-denied'
      ? 'Esos datos ya estaban capturados y no se pueden cambiar'
      : 'Error guardando — revisa tu conexión', false);
  } finally { guardandoTarea = null; }
}

let agregandoVar = null; // devId en curso

// Agrega una variante. Se reescribe el array completo (viejas + nueva) porque
// Firestore no sabe insertar en un array de objetos; las reglas exigen que los
// códigos viejos sigan TODOS presentes, así que no se puede perder ninguno.
export async function agregarVariante() {
  if (!fsOk() || !APP.tareaId) return;
  if (agregandoVar) { toast('Espera: se está agregando otra variante', false); return; }
  const cod = normalizarCodigo(gv('tk-vc'));
  if (!cod) { toast('Escribe el código de la variante', false); return; }
  if (!codigoValido(cod)) { toast('El código no puede llevar espacios ni símbolos raros', false); return; }
  const d = APP.tareaDoc || {};
  const codigos = d.variante_codigos || [];
  if (codigos.includes(cod)) { toast('Esa variante ya está en la tarea', false); return; }
  if (codigos.length >= 40) { toast('Una tarea admite máximo 40 variantes', false); return; }
  // Reabrir no puede ser un efecto lateral silencioso: el muestrista solo ve
  // las tareas pendientes o en proceso, así que agregar aquí la resucita.
  if (d.estado === 'terminado') {
    confirmDlg('La tarea estaba terminada',
      'Agregar una variante la va a reabrir: volverá a la lista del muestrista y se borrará su fecha de cierre. ¿Continuar?',
      'Sí, reabrir y agregar', () => escribirVariante(cod));
    return;
  }
  await escribirVariante(cod);
}

async function escribirVariante(cod) {
  if (!fsOk() || agregandoVar || !APP.tareaId) return;
  const devId = APP.tareaId;
  agregandoVar = devId;
  const d = APP.tareaDoc || {};
  const codigos = d.variante_codigos || [];
  try {
    const nueva = {
      codigo: cod,
      descripcion: gv('tk-vd').trim(),
      pares_requeridos: gv('tk-vp').trim(),
      tipo_pack: '',
    };
    const batch = db.batch();
    batch.update(db.collection('desarrollos').doc(devId), {
      variantes: [...(d.variantes || []), nueva],
      variante_codigos: [...codigos, cod],
    });
    // La complejidad del código nuevo va al espejo privado, nunca al público
    batch.update(db.collection('desarrollos_privado').doc(devId), {
      ['complejidad_por_codigo.' + cod]: gv('tk-vx') || 'A',
    });
    await batch.commit();
    // Si la tarea estaba cerrada, se reabre sola: ya hay un código pendiente.
    await reconciliarEstadoTarea(devId);
    toast('✅ Variante ' + cod + ' agregada');
    if (APP.tareaId === devId) await openTarea(devId);
  } catch (e) {
    console.error('agregarVariante:', e);
    toast(e && e.code === 'permission-denied'
      ? 'Firestore rechazó el cambio — avisa a Roberto'
      : 'Error agregando la variante — revisa tu conexión', false);
  } finally { agregandoVar = null; }
}

export function backRev() { scr('sL'); loadRev(); }

// Delegación de eventos para listas dinámicas de Lety
export function wireAdminEvents() {
  document.getElementById('vlist').addEventListener('click', e => {
    const btn = e.target.closest('[data-rmvar]');
    if (btn) { APP.vars.splice(Number(btn.dataset.rmvar), 1); renderVars(); }
  });
  document.getElementById('pend-list').addEventListener('click', e => {
    const btn = e.target.closest('[data-rev]');
    if (btn) openRev(btn.dataset.rev, false);
  });
  // "En proceso": la ficha aún no está firmada, así que se abre en consulta
  const pausasList = document.getElementById('pausas-list');
  if (pausasList) pausasList.addEventListener('click', e => {
    const ok = e.target.closest('[data-pausa-ok]');
    if (ok) { decidirPausa(ok.dataset.pausaOk, true); return; }
    const no = e.target.closest('[data-pausa-no]');
    if (no) decidirPausa(no.dataset.pausaNo, false);
  });
  const procList = document.getElementById('proc-list');
  if (procList) procList.addEventListener('click', e => {
    const card = e.target.closest('[data-proc]');
    if (card) openRev(card.dataset.proc, false, true);
  });
  const rBody = document.getElementById('rbody');
  if (rBody) rBody.addEventListener('click', e => {
    if (e.target.closest('[data-revft]')) verFichaRev();
  });
  const tkList = document.getElementById('tk-list');
  if (tkList) tkList.addEventListener('click', e => {
    const btn = e.target.closest('[data-tarea]');
    if (btn) openTarea(btn.dataset.tarea);
  });
  const tkBody = document.getElementById('tk-body');
  if (tkBody) tkBody.addEventListener('click', e => {
    const btn = e.target.closest('[data-ftver]');
    if (btn) verFichaTecnica(btn.dataset.ftver);
  });
  document.getElementById('db-list').addEventListener('click', e => {
    const btn = e.target.closest('[data-view]');
    if (btn) openRev(btn.dataset.view, true);
  });
}
