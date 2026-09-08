// Ficha práctica → Excel, para pegarla dentro del tech pack de RAGNAR.
//
// Dos entradas: una ficha (pantalla de revisión) o todas las variantes de una
// tarea (detalle de tarea, una hoja por variante). Formato deliberadamente
// aburrido —dos columnas, un renglón por dato, sin celdas combinadas, sin
// imágenes, sin bordes de fantasía— porque el destino es copiar y pegar dentro
// de OTRO archivo: todo lo que se rompe al pegar aquí no existe.
//
// Permisos: no se abre ninguno. Estas dos pantallas viven solo en admin.js,
// que únicamente se inicializa para 'admin' y 'ceo' (auth.js:login). El
// muestrista jamás llega aquí, así que la ficha técnica TEÓRICA —que él no
// puede leer, para que su captura sea ciega— no se le escapa por esta puerta.
// La barrera de verdad son las reglas: leePrivadoDe() en firestore.rules.
import { APP, USERS, enAmbiente } from './state.js';
import { db, fsOk } from './fb.js';
import { toast, loadLib, p, fmtMin, tenFromDoc, esFirmaValida, confirmDlg } from './utils.js';
import { normalizarCodigo } from './catalogo.js';
import { paresEfectivos } from './admin.js';
import { EXCELJS_URL, antiFormula, descargar } from './export.js';

const PEND = 'PENDIENTE';
const SIN_FT = 'SIN FICHA TÉCNICA TEÓRICA IMPORTADA';
const ERR_FT = 'ERROR AL LEER LA FICHA TÉCNICA — VUELVE A DESCARGARLA';
const MAX_HOJA = 31;      // límite de Excel para el nombre de una pestaña
const MAX_ARCHIVO = 150;  // conservador para Windows/OneDrive
const AVISO_HOJAS = 20;   // a partir de aquí se pregunta antes de generar

// Candado de generación. Guarda la SESIÓN que lo tomó: si una descarga se
// queda colgada (el CDN de ExcelJS sin responder) y entra otra persona a la
// tablet, no debe heredar un "espera" eterno que solo se quita recargando.
let generando = 0;
const ocupado = () => generando !== 0 && generando === APP.sesion;

// ── Valores ───────────────────────────────────────────────────────────────
// Ojo con el cero: `0` es un dato, no un hueco. Nada de `||` ni de truthy.
const tieneValor = v => v !== null && v !== undefined && String(v).trim() !== '';

// Vacío es PENDIENTE: Lety pidió ver de un golpe qué le falta pedir.
const val = v => (tieneValor(v) ? antiFormula(String(v).trim()) : PEND);

const fechaHora = ts => {
  const d = ts && ts.toDate ? ts.toDate() : (ts instanceof Date ? ts : null);
  if (!d || isNaN(d)) return PEND;
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
    + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
};

// Fecha LOCAL. `toISOString()` está en UTC: a partir de las 6 de la tarde en
// México le pondría al archivo la fecha de mañana.
function hoyLocal() {
  const d = new Date();
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// ── Nombres ───────────────────────────────────────────────────────────────
// Los caracteres de control son invisibles en pantalla, pero Excel rechaza
// con ellos el nombre de la pestaña y Windows el del archivo. Se comparan por
// código y no con una clase de regex: así el fuente no lleva bytes invisibles.
function sinControl(v) {
  const s = String(v === null || v === undefined ? '' : v);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out += (c < 32 || c === 127) ? ' ' : s[i];
  }
  return out;
}

function recorta(s, n) {
  if (s.length <= n) return s;
  let t = s.slice(0, n);
  // No partir un emoji a la mitad: si queda colgada la primera mitad del par,
  // se tira. (El modelo puede traer emoji si alguien lo pegó del pedido.)
  const c = t.charCodeAt(t.length - 1);
  if (c >= 0xD800 && c <= 0xDBFF) t = t.slice(0, -1);
  return t.trim();
}

// Excel rechaza el apóstrofo al principio y al final del nombre de la hoja.
// Se limpia DESPUÉS de recortar, no antes: un apóstrofo que estaba a mitad
// del texto queda al final cuando el corte cae justo ahí, y ese caso tumbaba
// el libro entero (hallazgo de la revisión de ChatGPT).
const bordes = s => s.replace(/^'+|'+$/g, '').trim();

// Prohibidos por Excel: : \ / ? * [ ] y más de 31 caracteres. Los duplicados
// se comparan sin distinguir mayúsculas porque Excel tampoco las distingue.
function nombreHoja(base, usados) {
  const limpio = bordes(sinControl(base).replace(/[:\\/?*[\]]/g, ' ').replace(/\s+/g, ' ').trim());
  const corta = n => bordes(recorta(limpio, n)) || 'Ficha';
  let cand = corta(MAX_HOJA);
  for (let i = 2; usados.has(cand.toLowerCase()); i++) {
    const suf = ' (' + i + ')';
    cand = corta(MAX_HOJA - suf.length) + suf;
  }
  usados.add(cand.toLowerCase());
  return cand;
}

function nombreArchivo(base) {
  let n = sinControl(base)
    .replace(/[<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  // Nombres que Windows tiene reservados desde MS-DOS y sigue rechazando,
  // solos o con cualquier extensión
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i.test(n)) n = 'Ficha ' + n;
  n = recorta(n || 'Ficha tecnica', MAX_ARCHIVO - 5).replace(/[. ]+$/, '');
  return (n || 'Ficha tecnica') + '.xlsx';
}

// ── Armado de las filas de una hoja ───────────────────────────────────────
// Cada fila es ['sec', título] o ['dato', etiqueta, valor].
function filasDeFicha(dev, cap, ft, cod, errFt) {
  const F = [];
  const sec = t => F.push(['sec', t]);
  const dato = (et, v) => F.push(['dato', et, val(v)]);
  const fijo = (et, v) => F.push(['dato', et, v]);
  const c = cap || {};
  const d = dev || {};
  const t = ft || {};
  const aviso = errFt ? ERR_FT : SIN_FT;
  const v = (d.variantes || []).find(x => x && x.codigo === cod) || {};
  // Los pares vigentes salen de la MISMA función que usa la pantalla de Lety
  // (admin.js), para que el Excel no pueda decir un número distinto al que
  // ella está viendo. Si la tarea no se pudo leer, queda el de la captura.
  const paresReq = dev ? paresEfectivos(d, cod) : c.pares_requeridos;

  sec('IDENTIFICACIÓN');
  dato('Modelo', c.modelo || d.modelo || t.modelo);
  dato('Código de la variante', cod);
  dato('Descripción de la variante', c.descripcion_variante || v.descripcion);
  dato('Código Quini de la tarea', d.codigo_quini);
  dato('Cliente', c.cliente || d.cliente || t.cliente);
  dato('Marca', t.marca);
  dato('Tipo de producto', c.tipo_producto || d.tipo_producto || t.tipo_producto);
  dato('Género', d.genero);
  dato('Talla', d.talla || t.talla);
  dato('Tipo de pack', c.tipo_pack || d.tipo_pack);
  dato('OT', c.ot || d.ot);
  dato('PO', c.po || d.po);
  dato('Notas de la tarea', d.notas);

  sec('MÁQUINA');
  dato('Marca de la máquina', c.maquina_marca);
  dato('Número de máquina', c.maquina_numero);
  dato('Agujado (número de agujas)', c.agujado || d.agujado);
  dato('Diámetro del cilindro', t.diametro);

  // Hilos: RUNA solo los conoce si la tarea se asignó desde el Excel de ficha
  // técnica. No hay campo de PROVEEDOR en ninguna parte del sistema: el
  // material viene descrito en una sola cadena ("POLIESTER 100% 150/48 ROSA
  // CLARO 6037"), que es lo que trae la plantilla de la fábrica.
  sec('HILOS Y MATERIALES');
  if (!ft) {
    fijo('Hilos y materiales', aviso);
  } else {
    const mats = (t.materiales || []).filter(m => m && tieneValor(m.material));
    if (mats.length) mats.forEach(m => dato('Hilo · ' + (String(m.parte || '').trim() || 'sin parte'), m.material));
    else fijo('Hilos y materiales', PEND);
    const alim = (t.alimentadores || []).filter(a => a && tieneValor(a.hilos));
    if (alim.length) alim.forEach(a => dato('Alimentador ' + val(a.n) + ' · hilos', a.hilos));
    else fijo('Hilos por alimentador', PEND);
  }

  sec('MEDIDAS EN CENTÍMETROS (lo capturado)');
  ['A', 'B', 'C', 'D', 'E'].forEach(k => {
    dato('Medida ' + k + ' · sin hormar', (c.med_sh || {})[k]);
    dato('Medida ' + k + ' · hormado', (c.med_h || {})[k]);
  });

  sec('TIEMPOS Y PESOS');
  dato('Tiempo de ciclo · minutos', c.t_ciclo_min);
  dato('Tiempo de ciclo · segundos', c.t_ciclo_seg);
  dato('Peso salida de máquina (gramos)', c.peso_sal);
  dato('Peso cerrado (gramos)', c.peso_cer);

  sec('GIROS DE CADENA');
  dato('Giros de elástico', (c.giros || {}).el);
  dato('Giros de tubo', (c.giros || {}).tb);
  dato('Giros de planta', (c.giros || {}).pl);
  dato('Giros de rubber', (c.giros || {}).rb);

  sec('VELOCIDADES DE CADENA');
  dato('Velocidad de elástico', (c.vels || {}).el);
  dato('Velocidad de tubo', (c.vels || {}).tb);
  dato('Velocidad de talón y punta', (c.vels || {}).tp);
  dato('Velocidad de planta', (c.vels || {}).pl);

  sec('PUNTO DE MÁQUINA');
  filasPunto(F, c.pto_tabla, c.pto, '');

  sec('PRODUCCIÓN');
  dato('Pares producidos', c.pares);
  dato('Pares requeridos', paresReq);

  sec('TIEMPOS DE TRABAJO');
  dato('Trabajo efectivo (TEN)', cap ? fmtMin(tenFromDoc(c)) : '');
  dato('Tiempo muerto', cap ? fmtMin(c.tm_seg || 0) : '');
  dato('Tiempo bruto de punta a punta', cap ? fmtMin(c.elapsed_seg || 0) : '');
  dato('Inicio de la captura', cap ? fechaHora(c.dt_inicio) : '');
  dato('Término de la captura', cap ? fechaHora(c.dt_fin) : '');

  sec('OBSERVACIONES');
  dato('Observaciones del muestrista', c.obs);
  if (ft) dato('Observaciones de la ficha técnica', t.observaciones);
  else fijo('Observaciones de la ficha técnica', aviso);

  // Valores objetivo: lo que la ficha técnica de la fábrica pedía. Van al
  // final para que arriba quede lo que se midió de verdad.
  sec('FICHA TÉCNICA TEÓRICA (valores objetivo)');
  if (!ft) {
    fijo('Ficha técnica teórica', aviso);
  } else {
    dato('Hoja de origen', t.hoja_origen);
    dato('Fecha de desarrollo', t.fecha_desarrollo);
    dato('Color base', t.color_base);
    dato('Hormado', t.hormado);
    dato('Temperatura', t.temperatura);
    dato('Nomenclatura de cadena', t.nomenclatura);
    dato('Máquina objetivo', [t.maquina_marca, t.maquina_numero].filter(Boolean).join(' #'));
    dato('Agujas objetivo', t.agujas);
    dato('Peso de muestra objetivo (gramos)', t.peso_muestra);
    dato('Peso salida objetivo (gramos)', t.peso_sal);
    dato('Peso cerrado objetivo (gramos)', t.peso_cer);
    dato('Tiempo de ciclo objetivo · minutos', t.t_ciclo_min);
    dato('Tiempo de ciclo objetivo · segundos', t.t_ciclo_seg);
    ['A', 'B', 'C', 'D', 'E'].forEach(k => {
      dato('Medida ' + k + ' objetivo · sin hormar', (t.med_sh || {})[k]);
      dato('Medida ' + k + ' objetivo · hormado', (t.med_h || {})[k]);
      dato('Medida ' + k + ' · tolerancia', (t.med_tol || {})[k]);
    });
    dato('Giros objetivo de elástico', (t.giros || {}).el);
    dato('Giros objetivo de tubo', (t.giros || {}).tb);
    dato('Giros objetivo de planta', (t.giros || {}).pl);
    dato('Giros objetivo de rubber', (t.giros || {}).rb);
    dato('Velocidad objetivo de elástico', (t.vels || {}).el);
    dato('Velocidad objetivo de tubo', (t.vels || {}).tb);
    dato('Velocidad objetivo de talón y punta', (t.vels || {}).tp);
    dato('Velocidad objetivo de planta', (t.vels || {}).pl);
    filasPunto(F, t.pto_tabla, null, ' objetivo');
    if ((t.faltantes_al_importar || []).length) {
      dato('La ficha técnica llegó sin', t.faltantes_al_importar.join(', '));
    }
  }

  // Para que Lety sepa de qué captura salió esta hoja y en qué estado estaba
  sec('CONTROL');
  dato('Folio de la ficha', cap ? c.folio : '');
  fijo('Estado de la captura', cap ? val(c.estado) : 'SIN CAPTURAR');
  dato('Iteración', cap ? (c.iter || 1) : '');
  dato('Muestrista', cap ? ((USERS[c.id_muestrista] || {}).nombre || c.id_muestrista) : '');
  fijo('Firmada por el muestrista', esFirmaValida(c.firma_m) ? 'Sí' : 'No');
  fijo('Aprobada y firmada por Lety', esFirmaValida(c.firma_l) ? 'Sí' : 'No');
  fijo('Generado el', fechaHora(new Date()));
  return F;
}

// El muestrista deja en blanco los alimentadores que su máquina no usa: una
// fila vacía NO es un dato faltante, así que solo salen los usados. Si no hay
// ninguno, entonces sí falta la captura. Un 0 SÍ es un valor: la ficha
// técnica importada del Excel trae ceros de verdad en DEN-2 y SINK2.
function filasPunto(F, tabla, viejo, suf) {
  const usa = f => f && (tieneValor(f.d1) || tieneValor(f.d2) || tieneValor(f.sk));
  const filas = (tabla || []).filter(usa);
  const fila = (n, f) => {
    F.push(['dato', 'Alimentador ' + n + suf + ' · DEN-1', val(f.d1)]);
    F.push(['dato', 'Alimentador ' + n + suf + ' · DEN-2', val(f.d2)]);
    F.push(['dato', 'Alimentador ' + n + suf + ' · SINK2', val(f.sk)]);
  };
  if (filas.length) {
    filas.forEach((f, i) => fila(tieneValor(f.alim) ? val(f.alim) : String(i + 1), f));
  } else if (usa(viejo)) {
    fila('1', viejo); // fichas viejas: solo se capturaba el primer alimentador
  } else {
    F.push(['dato', 'Punto de máquina' + suf, PEND]);
  }
}

// ── Escritura del libro ───────────────────────────────────────────────────
async function construirLibro(hojas) {
  const ExcelJS = await loadLib(EXCELJS_URL, 'ExcelJS');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'RUNA';
  wb.created = new Date();
  const usados = new Set();
  hojas.forEach(h => {
    const ws = wb.addWorksheet(nombreHoja(h.nombre, usados));
    ws.columns = [{ width: 38 }, { width: 52 }];
    const head = ws.addRow(['Dato', 'Valor']);
    head.font = { bold: true };
    h.filas.forEach(f => {
      if (f[0] === 'sec') {
        const r = ws.addRow([f[1], '']);
        r.font = { bold: true };
      } else {
        const r = ws.addRow([f[1], f[2]]);
        // Todo como texto: los códigos con puntos ("16.01.1") y los pesos con
        // ceros a la izquierda se deforman si Excel los adivina.
        r.getCell(2).numFmt = '@';
        r.getCell(2).alignment = { wrapText: true, vertical: 'top' };
      }
    });
  });
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// Entrega el archivo solo si seguimos en la misma sesión: en una tablet
// compartida, generar tarda y el archivo no debe caerle a quien entre después.
async function entregar(hojas, archivo, ses) {
  const blob = await construirLibro(hojas);
  if (ses !== APP.sesion) return false;
  descargar(blob, nombreArchivo(archivo));
  return true;
}

function fallo(e) {
  console.error('ficha-excel:', e);
  toast('No se pudo generar el Excel — revisa tu conexión e inténtalo otra vez', false);
}

// Una lectura que falla NO es lo mismo que un documento que no existe. Si se
// confundieran, el Excel diría "sin ficha técnica" tan tranquilo y Lety
// creería que a esa variante nunca le importaron los hilos.
async function leer(ref) {
  try {
    const snap = await ref.get();
    return { doc: snap.exists ? snap.data() : null, error: false };
  } catch (e) {
    console.error('ficha-excel/leer:', e);
    return { doc: null, error: true };
  }
}

// ── Una ficha (pantalla de revisión) ──────────────────────────────────────
export async function descargarFichaExcel() {
  if (!fsOk() || !APP.revCap) return;
  if (ocupado()) { toast('Ya se está generando un Excel, espera', false); return; }
  const ses = APP.sesion;
  const capId = APP.revCap;
  generando = ses;
  toast('Generando el Excel…');
  try {
    const capSnap = await db.collection('capturas').doc(capId).get();
    const cap = capSnap.data();
    if (!cap) { toast('Ficha no encontrada', false); return; }
    // La tarea y la ficha técnica son opcionales: una ficha puede vivir sin
    // ellas (capturada a mano, o la tarea nunca llegó a tener ficha técnica).
    const [dev, ft] = await Promise.all([
      cap.id_desarrollo
        ? leer(db.collection('desarrollos').doc(cap.id_desarrollo))
        : { doc: null, error: false },
      cap.id_desarrollo && cap.codigo_variante
        ? leer(db.collection('desarrollos_privado').doc(cap.id_desarrollo)
            .collection('fichas_tecnicas').doc(normalizarCodigo(cap.codigo_variante)))
        : { doc: null, error: false },
    ]);
    if (ses !== APP.sesion) return;
    const cod = cap.codigo_variante || '';
    const modelo = cap.modelo || (dev.doc || {}).modelo || 'Ficha';
    const hojas = [{ nombre: modelo + ' - ' + cod, filas: filasDeFicha(dev.doc, cap, ft.doc, cod, ft.error) }];
    const ok = await entregar(hojas, 'Ficha tecnica practica - ' + modelo + ' - ' + hoyLocal(), ses);
    if (!ok) return;
    if (ft.error || dev.error) toast('Excel descargado, pero algo no se pudo leer — vuelve a descargarlo', false);
    else toast('✅ Excel descargado');
  } catch (e) { fallo(e); } finally { if (generando === ses) generando = 0; }
}

// ── Todas las variantes de una tarea ──────────────────────────────────────
// Elige UNA captura por código: la aprobada más reciente; si no hay aprobada,
// la más avanzada que exista. Una variante puede tener varias capturas (tras
// aprobar se permite recapturar), y meter dos hojas del mismo código en un
// tech pack es peor que quedarse con la buena. Es una lista blanca: las
// canceladas —y una ficha descartada queda cancelada— no entran nunca. El
// estado de la elegida queda escrito en su hoja.
const ORDEN = { aprobado: 5, pendiente_lety: 4, correccion: 3, pausado: 2, activo: 1 };

function mejorCaptura(lista) {
  const vivas = lista.filter(c => ORDEN[c.estado]);
  if (!vivas.length) return null;
  return vivas.slice().sort((a, b) => {
    const d = (ORDEN[b.estado] || 0) - (ORDEN[a.estado] || 0);
    if (d) return d;
    const fa = a.dt_fin && a.dt_fin.toMillis ? a.dt_fin.toMillis() : 0;
    const fb = b.dt_fin && b.dt_fin.toMillis ? b.dt_fin.toMillis() : 0;
    if (fb !== fa) return fb - fa;
    return (Number(b.folio_seq) || 0) - (Number(a.folio_seq) || 0);
  })[0];
}

export async function descargarFichasTarea() {
  if (!fsOk() || !APP.tareaId) return;
  if (ocupado()) { toast('Ya se está generando un Excel, espera', false); return; }
  // Se fijan ANTES de abrir la confirmación: si mientras el cuadro está
  // abierto alguien cierra sesión o se abre otra tarea, lo que se descargue
  // después no puede ser el pedido de la pantalla anterior.
  const ses = APP.sesion;
  const devId = APP.tareaId;
  const nVar = ((APP.tareaDoc || {}).variante_codigos || []).length;
  if (!nVar) { toast('Esta tarea no tiene variantes', false); return; }

  const correr = async () => {
    if (ses !== APP.sesion || APP.tareaId !== devId) return;
    if (ocupado()) { toast('Ya se está generando un Excel, espera', false); return; }
    generando = ses;
    toast('Generando el Excel…');
    try {
      // Se relee en vez de usar lo que quedó en pantalla: si el muestrista
      // firmó o recapturó mientras Lety tenía la tarea abierta, el tech pack
      // debe llevar lo último, no lo que se cargó hace media hora. Las fichas
      // técnicas son inmutables por reglas, pero viajan en la misma tanda.
      const [devSnap, capsSnap, ftRes] = await Promise.all([
        db.collection('desarrollos').doc(devId).get(),
        enAmbiente(db.collection('capturas').where('id_desarrollo', '==', devId)).get(),
        db.collection('desarrollos_privado').doc(devId).collection('fichas_tecnicas').get()
          .then(s => ({ snap: s, error: false }))
          .catch(e => { console.error('ficha-excel/ft:', e); return { snap: null, error: true }; }),
      ]);
      if (ses !== APP.sesion) return;
      const dev = devSnap.data();
      if (!dev) { toast('Tarea no encontrada', false); return; }
      const caps = capsSnap.docs.map(x => x.data());
      const fichas = {};
      if (ftRes.snap) ftRes.snap.docs.forEach(x => { fichas[x.id] = x.data(); });
      const modelo = dev.modelo || 'Ficha';
      const hojas = (dev.variante_codigos || []).filter(Boolean).map(cod => {
        // Se compara normalizado por los dos lados: una captura vieja con el
        // código en minúsculas o con un espacio de más no debe salir "SIN CAPTURAR"
        const nc = normalizarCodigo(cod);
        const cap = mejorCaptura(caps.filter(c => normalizarCodigo(c.codigo_variante) === nc));
        const ft = fichas[nc] || fichas[cod] || null;
        return { nombre: modelo + ' - ' + cod, filas: filasDeFicha(dev, cap, ft, cod, ftRes.error) };
      });
      if (!hojas.length) { toast('Esta tarea no tiene variantes', false); return; }
      const ok = await entregar(hojas, 'Fichas tecnicas practicas - ' + modelo + ' - ' + hoyLocal(), ses);
      if (!ok) return;
      if (ftRes.error) toast('Excel descargado, pero las fichas técnicas no se pudieron leer', false);
      else toast('✅ Excel descargado · ' + hojas.length + ' hoja' + (hojas.length === 1 ? '' : 's'));
    } catch (e) { fallo(e); } finally { if (generando === ses) generando = 0; }
  };

  if (nVar >= AVISO_HOJAS) {
    confirmDlg('Descargar ' + nVar + ' fichas',
      'Se va a generar un libro con ' + nVar + ' hojas. En una tablet puede tardar un poco.',
      'Descargar', correr);
    return;
  }
  await correr();
}
