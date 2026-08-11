// Vista de Lety: asignación de desarrollos y revisión/aprobación de fichas
import { db, fsOk } from './fb.js';
import { APP, USERS, TM_CAUSES } from './state.js';
import { es, fmt, fmtMin, fmtDate, gv, scr, toast, confirmDlg, tenFromDoc, esFirmaValida, loadLib, showExito } from './utils.js';
import { parseLibro, comparar } from './ficha-tecnica.js';
import { showFirma } from './firma.js';
import { loadDB } from './dashboard.js';
import { lookupCodigo, normalizarCodigo, watchCatalogo } from './catalogo.js';

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
    toast('La ficha se guardó, pero no se pudo cerrar la tarea — avisa a Roberto', false);
  }
}

export function ltTab(i, btn) {
  [0, 1, 2, 3].forEach(j => document.getElementById('lt' + j).classList.remove('on'));
  document.getElementById('lt' + i).classList.add('on');
  document.querySelectorAll('#sL .nb').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  if (i === 1) loadRev();
  if (i === 2) loadDB();
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
  const unsubCat = watchCatalogo();
  if (unsubCat) APP.listeners.push(unsubCat);
  loadRev();
}

export function setBadgePendientes(n) {
  const b = document.getElementById('nav-pend');
  if (!b) return;
  b.textContent = n > 99 ? '99+' : String(n);
  b.style.display = n > 0 ? '' : 'none';
  const btn = b.closest('.nb');
  if (btn) btn.setAttribute('aria-label', n > 0 ? `Revisar — ${n} ficha${n === 1 ? '' : 's'} pendiente${n === 1 ? '' : 's'}` : 'Revisar');
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
    ['l-ot', 'l-po', 'l-cq', 'l-mod', 'l-cli', 'l-gen', 'l-tal', 'l-tprod', 'l-notas', 's-cod', 's-desc', 's-pares', 's-pack', 'vc', 'vd', 'vp', 'vpk'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
  }
}

// ── Crear tarea desde la ficha técnica (Excel) ──
const SHEETJS_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
let FT = { fichas: [], errores: [], archivo: '' };

export async function ftArchivo(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const ui = document.getElementById('ft-ui');
  if (file.size > 12 * 1024 * 1024) { toast('El archivo pesa más de 12 MB', false); input.value = ''; return; }
  FT = { fichas: [], errores: [], archivo: file.name };
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

function renderFichas() {
  const ui = document.getElementById('ft-ui');
  const { fichas, errores } = FT;
  if (fichas.length === 0) {
    ui.innerHTML = `<div class="al alr"><span>⚠️</span><span style="font-size:12px">No se encontró ninguna ficha con código. Revisa que el archivo sea el de fichas técnicas llenas (la plantilla vacía no sirve).${errores.length ? ' Hojas revisadas: ' + es(errores.map(e => e.hoja).join(', ')) : ''}</span></div>`;
    return;
  }
  const f0 = fichas[0];
  const mismoModelo = fichas.every(f => f.modelo === f0.modelo && f.cliente === f0.cliente);
  // Validaciones ANTES de dejar que Lety llene el formulario: si algo bloquea,
  // no se pinta el botón de crear.
  const demasiadas = fichas.length > 40;
  const vistos = new Set();
  const duplicados = new Set();
  fichas.forEach(f => {
    if (vistos.has(f.codigo)) duplicados.add(f.codigo); else vistos.add(f.codigo);
  });
  const bloqueado = demasiadas || duplicados.size > 0;
  ui.innerHTML = `
    <div class="card bl">
      <div class="dt">${es(f0.modelo)} · ${es(f0.cliente)}</div>
      <div class="ds">${es(f0.marca)} · ${es(f0.tipo_producto)} · Talla ${es(f0.talla)}</div>
      <div class="mr"><span>Máquina ${es(f0.maquina_marca)} #${es(f0.maquina_numero)}</span><span>${es(f0.agujas)} agujas · Ø ${es(f0.diametro)}</span></div>
    </div>
    ${!mismoModelo ? '<div class="al alw"><span>⚠️</span><span style="font-size:12px">Las hojas tienen modelo o cliente distintos. Se creará UNA tarea con el modelo de la primera hoja; si son desarrollos diferentes, súbelos por separado.</span></div>' : ''}
    ${errores.length ? `<div class="al alw"><span>ℹ️</span><span style="font-size:12px">Hojas omitidas por no tener código: ${es(errores.map(e => e.hoja).join(', '))}</span></div>` : ''}
    ${demasiadas ? `<div class="al alr"><span>⚠️</span><span style="font-size:12px">El archivo trae ${fichas.length} variantes y el máximo por tarea es 40. Divide el pack en dos archivos.</span></div>` : ''}
    ${duplicados.size ? `<div class="al alr"><span>⚠️</span><span style="font-size:12px">Códigos repetidos entre hojas: ${es([...duplicados].join(', '))}. Corrige el archivo antes de continuar.</span></div>` : ''}
    <div class="stitle">${fichas.length} variante${fichas.length === 1 ? '' : 's'} detectada${fichas.length === 1 ? '' : 's'}</div>
    ${fichas.map((f, i) => `<div class="vi">
      <div style="flex:1">
        <div class="vcod">${es(f.codigo)}</div>
        <div style="font-size:12px;color:var(--tx2)">${es(f.color_base || '—')} · medidas ${es(['A','B','C','D','E'].filter(k => f.med_sh[k]).length)}/5 · giros ${es(Object.values(f.giros).filter(Boolean).length)}/4</div>
      </div>
      <div style="width:110px;flex-shrink:0">
        <input class="fi" type="number" min="0" placeholder="pares" data-ftpares="${i}" style="padding:8px 10px;font-size:14px">
      </div>
      <select class="fi" data-ftcx="${i}" style="width:70px;flex-shrink:0;padding:8px 6px;font-size:14px">
        <option value="A">A</option><option value="B">B</option><option value="C">C</option>
      </select>
    </div>`).join('')}
    ${bloqueado ? '' : `
    <div class="fg" style="margin-top:10px"><label class="fl">Asignar a</label>
      <select class="fi" id="ft-asig"><option value="israel">Israel</option><option value="jesus">Jesús</option></select></div>
    <div class="g2">
      <div class="fg"><label class="fl">OT</label><input class="fi" id="ft-ot" placeholder="7735"></div>
      <div class="fg"><label class="fl">PO</label><input class="fi" id="ft-po" placeholder="2422"></div>
    </div>
    <div class="fg"><label class="fl">Notas para el muestrista</label><textarea class="fi" id="ft-notas" rows="2" placeholder="Instrucciones especiales..."></textarea></div>
    <div class="al ali"><span>🔒</span><span style="font-size:12px">A = tin básico · B = con diseño · C = jacquard. La complejidad solo la ves tú.</span></div>
    <button class="btn btn-am" id="ft-go" onclick="asignarDesdeFicha()">✓ Crear tarea con ${fichas.length} ficha${fichas.length === 1 ? '' : 's'}</button>`}`;
}

let asignandoFT = false;

export async function asignarDesdeFicha() {
  if (!fsOk() || asignandoFT) return;
  if (!FT.fichas.length) { toast('Primero sube el archivo de fichas técnicas', false); return; }
  asignandoFT = true;
  const btn = document.getElementById('ft-go');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Creando tarea…'; }
  try {
    const f0 = FT.fichas[0];
    const pares = i => (document.querySelector(`[data-ftpares="${i}"]`) || {}).value || '';
    const cx = i => (document.querySelector(`[data-ftcx="${i}"]`) || {}).value || 'A';
    const variantes = FT.fichas.map((f, i) => ({
      codigo: f.codigo,
      descripcion: f.color_base || f.modelo || '',
      pares_requeridos: String(pares(i)).trim(),
      tipo_pack: '',
    }));
    const complejidadPorCodigo = {};
    FT.fichas.forEach((f, i) => { complejidadPorCodigo[f.codigo] = cx(i); });

    const devRef = db.collection('desarrollos').doc();
    const privRef = db.collection('desarrollos_privado').doc(devRef.id);
    const batch = db.batch();
    batch.set(devRef, {
      ot: gv('ft-ot'), po: gv('ft-po'), codigo_quini: f0.codigo,
      modelo: f0.modelo || '(sin modelo)', cliente: f0.cliente || '',
      genero: '', talla: f0.talla || '', tipo_producto: f0.tipo_producto || '',
      asignado_a: gv('ft-asig') || 'israel',
      notas: gv('ft-notas'), variantes, variante_codigos: variantes.map(v => v.codigo),
      estado: 'pendiente',
      origen: 'ficha_tecnica',
      fecha_creacion: firebase.firestore.FieldValue.serverTimestamp(),
      creado_por: APP.user.id,
    });
    batch.set(privRef, {
      tipo_complejidad: cx(0),
      complejidad_por_codigo: complejidadPorCodigo,
    });
    // Una ficha técnica por variante, en la subcolección PRIVADA del
    // desarrollo: son los valores objetivo y solo Lety puede leerlos, para
    // que la captura del muestrista sea ciega de verdad (ver firestore.rules)
    FT.fichas.forEach(f => {
      const { hoja, codigo_raw, ...datos } = f;
      batch.set(privRef.collection('fichas_tecnicas').doc(f.codigo), {
        ...datos, id_desarrollo: devRef.id, hoja_origen: String(hoja || '').slice(0, 60),
        archivo: String(FT.archivo || '').slice(0, 120),
        creado_por: APP.user.id,
        fecha_creacion: firebase.firestore.FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();
    const n = FT.fichas.length;
    FT = { fichas: [], errores: [], archivo: '' };
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
      genero: gv('l-gen'), talla: gv('l-tal'), tipo_producto: gv('l-tprod'),
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
    ['l-ot', 'l-po', 'l-cq', 'l-mod', 'l-cli', 'l-gen', 'l-tal', 'l-tprod', 'l-notas', 's-cod', 's-desc', 's-pares', 's-pack'].forEach(id => {
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
          return `<div class="card">
            <div class="dt">${es(dt.modelo)} · <span class="vcod">${es(dt.codigo_variante)}</span>
              ${dt.estado === 'correccion' ? '<span class="bge brd" style="margin-left:6px">🔁 en corrección</span>' : ''}</div>
            <div class="ds">${(USERS[dt.id_muestrista] || {}).nombre || es(dt.id_muestrista)} · ${fmtDate(dt.dt_inicio)}</div>
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
export async function openRev(capturaId, readOnly = false) {
  if (!fsOk()) return;
  APP.revCap = capturaId;
  try {
    const snap = await db.collection('capturas').doc(capturaId).get();
    const d = snap.data();
    if (!d) { toast('Ficha no encontrada', false); return; }
    APP.revFolio = d.folio || null; // para la pantalla de éxito al aprobar
    document.getElementById('rtitle').textContent = readOnly ? 'Ficha aprobada' : 'Revisar ficha práctica';
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
      <div class="fsec"><div class="ftitle">Giros / Velocidades / Punto máquina</div>
        <div class="g2" style="font-size:13px">
          <div><label class="fl">Giros elástico</label>${es(gi.el) || '—'}</div>
          <div><label class="fl">Giros tubo</label>${es(gi.tb) || '—'}</div>
          <div><label class="fl">Giros planta</label>${es(gi.pl) || '—'}</div>
          <div><label class="fl">Rubber</label>${es(gi.rb) || '—'}</div>
          <div><label class="fl">Vel. elástico</label>${es(vl.el) || '—'}</div>
          <div><label class="fl">Vel. tubo</label>${es(vl.tb) || '—'}</div>
          <div><label class="fl">Vel. talón y punta</label>${es(vl.tp) || '—'}</div>
          <div><label class="fl">Vel. planta</label>${es(vl.pl) || '—'}</div>
          <div><label class="fl">DEN-1</label>${es(pt.d1) || '—'}</div>
          <div><label class="fl">DEN-2 / SINK2</label>${es(pt.d2) || '—'} / ${es(pt.sk) || '—'}</div>
        </div>
      </div>
      <div class="fsec"><div class="ftitle">Producción</div>
        <div style="font-size:13px"><label class="fl">Pares producidos</label>${es(d.pares) || '—'} de ${es(d.pares_requeridos) || '—'} requeridos</div>
      </div>
      ${d.obs ? `<div class="fsec"><div class="ftitle">Observaciones</div><div style="font-size:13px">${es(d.obs)}</div></div>` : ''}
      ${esFirmaValida(d.firma_m) ? `<div class="fsec"><div class="ftitle">Firma muestrista</div><img src="${es(d.firma_m)}" alt="Firma muestrista" class="firma-img"></div>` : ''}
      ${readOnly && esFirmaValida(d.firma_l) ? `<div class="fsec"><div class="ftitle">Firma de aprobación (Lety)</div><img src="${es(d.firma_l)}" alt="Firma Lety" class="firma-img"></div>` : ''}
      ${readOnly
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
      </div>
      ${conTol.length ? `<div class="fsec"><div class="ftitle">Medidas · objetivo → real</div>${conTol.map(fila).join('')}</div>` : ''}
      ${info.length ? `<div class="fsec"><div class="ftitle">Otros parámetros (sin tolerancia en la ficha)</div>${info.map(fila).join('')}</div>` : ''}`;
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
  document.getElementById('db-list').addEventListener('click', e => {
    const btn = e.target.closest('[data-view]');
    if (btn) openRev(btn.dataset.view, true);
  });
}
