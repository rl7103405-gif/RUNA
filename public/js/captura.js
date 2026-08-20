// Ficha práctica: inicio de captura, formulario, borradores y envío a firma
import { db, fsOk } from './fb.js';
import { APP, OPEN_STATES, TM_CAUSES } from './state.js';
import { es, fmt, gv, scr, toast, confirmDlg } from './utils.js';
import { timers, getT, elapsedOf, tmOf, tenOf, causesOf, startT, pauseT, seedFromDoc } from './timers.js';
import { showFirma } from './firma.js';
import { openTMFor, terminarPausa } from './muestrista.js';

// La ficha técnica define el punto de máquina como una tabla de 10
// alimentadores (DEN-1 / DEN-2 / SINK2 cada uno), no como un solo trío.
export const PTO_ALIM = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

let startBusy = false;

export async function startCap(devId, cod) {
  if (!fsOk() || startBusy) return;
  startBusy = true;
  try {
    // Tres where de igualdad no requieren índice compuesto manual (Firestore
    // combina índices de campo único). El filtro por id_muestrista NO es
    // cosmético: las reglas solo dejan al muestrista leer sus propias
    // capturas, y sin este where Firestore rechaza la consulta completa.
    // No pierde duplicados: todas las capturas de un desarrollo son del
    // mismo empleado, porque la regla de `create` exige que su dueño sea el
    // `asignado_a` del desarrollo.
    const ex = await db.collection('capturas')
      .where('id_desarrollo', '==', devId)
      .where('codigo_variante', '==', cod)
      .where('id_muestrista', '==', APP.user.id)
      .get();
    // Incluye 'correccion': reabrir en vez de duplicar (bug del prototipo)
    const exOpen = ex.docs.find(d => OPEN_STATES.includes(d.data().estado));
    if (exOpen) {
      if (exOpen.data().estado === 'correccion') {
        await reopenCorreccion(exOpen.id);
        return;
      }
      toast('Captura existente cargada');
      // Si el listener de capturas aún no sembró el timer, no arrancar en
      // cero: sembrar desde el doc para no pisar los tiempos reales
      seedFromDoc(exOpen.id, exOpen.data());
      getT(exOpen.id);
      startT(exOpen.id);
      await openCap(exOpen.id);
      return;
    }
    // Ya firmada y en manos de Lety: no crear duplicados
    if (ex.docs.some(d => d.data().estado === 'pendiente_lety')) {
      toast('Esta variante ya fue firmada y está pendiente de revisión de Lety', false);
      return;
    }
    // Ya aprobada: solo re-capturar con confirmación explícita
    if (ex.docs.some(d => d.data().estado === 'aprobado')) {
      confirmDlg(
        'Variante ya aprobada',
        'Esta variante ya tiene una ficha aprobada. ¿Iniciar una captura nueva desde cero?',
        'Sí, capturar de nuevo',
        () => createCap(devId, cod)
      );
      return;
    }
    await createCap(devId, cod);
  } catch (e) { console.error(e); toast('Error iniciando captura', false); }
  finally { startBusy = false; }
}

let createBusy = false;

async function createCap(devId, cod) {
  // Guard propio: el startBusy de startCap ya se liberó cuando corre el
  // callback del confirmDlg de "Variante ya aprobada", así que no protege
  // contra doble tap aquí
  if (createBusy) return;
  createBusy = true;
  try {
    const dev0 = await db.collection('desarrollos').doc(devId).get();
    if (!dev0.exists) { toast('Desarrollo no encontrado', false); return; }
    // Repetir la consulta de duplicados justo antes de comprometer: alguien
    // pudo haber creado una captura para esta variante en el intervalo
    const dup = await db.collection('capturas')
      .where('id_desarrollo', '==', devId)
      .where('codigo_variante', '==', cod)
      .where('id_muestrista', '==', APP.user.id)
      .get();
    if (dup.docs.some(d => [...OPEN_STATES, 'pendiente_lety'].includes(d.data().estado))) {
      toast('Ya existe una captura en curso para esta variante', false);
      return;
    }
    // Transacción: folio consecutivo (contadores/capturas) + creación de la
    // captura + cambio de estado del desarrollo, todo atómico. Las refs se
    // crean FUERA del callback; el callback solo lee/calcula/escribe (puede
    // reintentarse si otro dispositivo incrementa el contador a la vez).
    const counterRef = db.collection('contadores').doc('capturas');
    const capRef = db.collection('capturas').doc();
    const devRef = db.collection('desarrollos').doc(devId);
    await db.runTransaction(async tx => {
      // La tarea se lee DENTRO de la transacción: si Lety ajusta los pares o
      // cancela entre la pantalla y el commit, se ve el dato final (las reglas
      // comparan la ficha nueva contra lo que la tarea dice en ese instante).
      const devSnap = await tx.get(devRef);
      if (!devSnap.exists) throw new Error('tarea-inexistente');
      const dd = devSnap.data();
      if (!['pendiente', 'en_proceso'].includes(dd.estado)) throw new Error('tarea-cerrada');
      const v = (dd.variantes || []).find(x => x.codigo === cod) || {};
      // Los pares vigentes: si Lety los ajustó después de asignar, manda el
      // ajuste (pares_por_codigo) sobre lo que traía la variante.
      const paresVig = paresVigentes(dd, cod);
      const cSnap = await tx.get(counterRef);
      const prev = cSnap.exists && typeof cSnap.data().seq === 'number' ? Math.floor(cSnap.data().seq) : 0;
      const seq = prev + 1;
      // last_cap_id ata el contador a ESTA captura: la regla exige que el
      // contador apunte al mismo doc que se esta creando, asi un solo batch no
      // puede crear DOS capturas con el mismo folio_seq (pentest 2026-08-20).
      tx.set(counterRef, { seq, last_cap_id: capRef.id });
      tx.set(capRef, {
        folio: 'FP-' + String(seq).padStart(5, '0'), folio_seq: seq,
        id_desarrollo: devId, id_muestrista: APP.user.id,
        codigo_variante: cod, descripcion_variante: v.descripcion || '',
        pares_requeridos: paresVig, tipo_pack: dd.tipo_pack || v.tipo_pack || '',
        modelo: dd.modelo || '', cliente: dd.cliente || '', ot: dd.ot || '', po: dd.po || '', tipo_producto: dd.tipo_producto || '',
        estado: 'activo', elapsed_seg: 0, tm_seg: 0, tm_causas: {},
        dt_inicio: firebase.firestore.FieldValue.serverTimestamp(),
        maquina_marca: '', maquina_numero: '', agujado: dd.agujado || '',
        med_sh: { A: '', B: '', C: '', D: '', E: '' }, med_h: { A: '', B: '', C: '', D: '', E: '' },
        t_ciclo_min: '', t_ciclo_seg: '', peso_sal: '', peso_cer: '',
        giros: { el: '', tb: '', pl: '', rb: '' }, vels: { el: '', tb: '', tp: '', pl: '' },
        pto: { d1: '', d2: '', sk: '' },
        pto_tabla: PTO_ALIM.map(n => ({ alim: String(n), d1: '', d2: '', sk: '' })),
        pares: '', obs: '',
        firma_m: null, firma_l: null, iter: 1,
      });
      tx.update(devRef, { estado: 'en_proceso' });
    });
    getT(capRef.id);
    startT(capRef.id);
    await openCap(capRef.id);
  } catch (e) {
    console.error(e);
    toast(e && e.message === 'tarea-cerrada' ? 'Esta tarea ya no está abierta (la cerró o canceló Lety)'
      : e && e.code === 'permission-denied' ? 'Firestore no aceptó la ficha — avísale a Roberto'
      : 'Error iniciando captura', false);
  } finally { createBusy = false; }
}

// Reabre una ficha devuelta por Lety: vuelve a 'activo' e incrementa iteración
// Un doble toque lanzaba dos reaperturas y la ficha saltaba dos iteraciones
// (las reglas solo exigen que `iter` no retroceda, no que suba de uno en uno).
// El cierre remoto de pausas de abajo alarga la ventana, así que el candado
// deja de ser opcional.
let reabriendo = false;

export async function reopenCorreccion(capId) {
  if (!fsOk() || reabriendo) return;
  reabriendo = true;
  try {
    // Si el listener de capturas aún no sembró el timer, sembrarlo desde el
    // doc para no arrancar en cero y pisar los tiempos reales en el próximo sync
    if (!timers[capId]) {
      const s = await db.collection('capturas').doc(capId).get();
      if (s.exists) seedFromDoc(capId, s.data());
    }
    // Segunda oportunidad de cerrar pausas colgadas: al firmar ya se intenta,
    // pero si aquella escritura falló (red, o carrera con Lety autorizando),
    // una pausa 'aprobada' seguiría viva y al reabrir arrancaría el TM con su
    // `inicio_tm` original — inflando el tiempo muerto sin que nadie la pidiera.
    try {
      const { cerrarPausasDe } = await import('./muestrista.js');
      await cerrarPausasDe(capId);
    } catch (e) { console.error('cerrar pausas al reabrir:', e); }
    await db.collection('capturas').doc(capId).update({
      estado: 'activo',
      dt_fin: null, // se re-firmará; evita que la ficha reabierta cuente en historiales
      iter: firebase.firestore.FieldValue.increment(1),
    });
    getT(capId);
    startT(capId);
    await openCap(capId);
  } catch (e) {
    console.error(e); toast('Error reabriendo ficha', false);
  } finally { reabriendo = false; }
}

export async function openCap(capturaId) {
  if (!fsOk()) return;
  // Si venía de otra ficha con un autosave programado, se cancela: el timer
  // apuntaría a un formulario que ya no está en pantalla.
  cancelarAutosave();
  APP.activeCap = capturaId;
  APP.capDirty = false;
  editVersion = 0;
  try {
    const snap = await db.collection('capturas').doc(capturaId).get();
    const d = snap.data();
    if (!d) { toast('Captura no encontrada', false); limpiarActiva(capturaId); return; }
    if (APP.activeCap !== capturaId) return; // abrió otra mientras cargaba
    if (d.estado === 'cancelada') { toast('Esta tarea fue cancelada por Lety', false); limpiarActiva(capturaId); return; }
    APP.activeCapFolio = d.folio || null;
    APP.activeCapDoc = d;
    // Revisión del último guardado que Firestore conoce: el borrador local
    // se compara contra esto, no contra relojes (ver restaurarBorradorLocal)
    capRev = d.guardado_rev || null;
    const t = timers[capturaId] || { running: false, tmActive: false };
    const tmCauseDef = t.tmActive ? TM_CAUSES.find(c => c.id === t.cause) : null;
    const tmMsg = tmCauseDef && tmCauseDef.pen
      ? 'TM en curso — este TM sí cuenta en tu TEN'
      : 'TM en curso — el TEN está pausado';
    document.getElementById('ct').textContent =
      (d.folio ? d.folio + ' · ' : '') + (d.modelo || '') + ' · ' + (d.descripcion_variante || '');
    document.getElementById('cc').textContent = d.codigo_variante || '';
    const sh = d.med_sh || {}, mh = d.med_h || {}, gi = d.giros || {}, vl = d.vels || {}, pt = d.pto || {};
    document.getElementById('cbody').innerHTML = `
      ${(d.iter || 1) > 1 ? `<div class="al alr"><span>🔁</span><span style="font-size:12px">Iteración ${es(d.iter)} — Lety solicitó corrección. Revisa los datos y vuelve a firmar.</span></div>` : ''}
      <div class="card ${t.running ? 'am' : ''}">
        <div class="ds" style="margin-bottom:6px">OT ${es(d.ot)} · ${es(d.cliente)}</div>
        <div class="timer ${t.running ? 'tgn' : 'tam'}" id="cap-timer" data-tf="el" data-tid="${es(capturaId)}">${fmt(elapsedOf(capturaId))}</div>
        <div class="trow" style="margin-bottom:10px">
          <span>TEN: <strong style="color:var(--gn)" data-tf="ten" data-tid="${es(capturaId)}">${fmt(tenOf(capturaId))}</strong></span>
          <span style="color:var(--rd)">TM: <span data-tf="tm" data-tid="${es(capturaId)}">${fmt(tmOf(capturaId))}</span></span>
        </div>
        ${t.tmActive ? `<div class="al alw" style="margin-bottom:10px"><span>⏸</span><span style="font-size:12px">${tmMsg}</span></div>` : ''}
        <div class="brow" id="cap-btns">${botoneraPausa(capturaId)}</div>
      </div>
      <div class="brow" style="margin:-4px 0 12px;align-items:center">
        <button class="btn btn-gh btn-sm" style="flex:1" data-capact="draft">💾 Guardar avance</button>
        <span id="cap-save" style="flex:1;font-size:11px;color:var(--tx3);text-align:right">Se guarda solo al escribir</span>
      </div>
      <div class="fsec"><div class="ftitle">Máquina</div>
        <div class="g2">
          <div class="fg"><label class="fl">Marca</label><input class="fi" id="f-mm" value="${es(d.maquina_marca)}" placeholder="Zhenxing"></div>
          <div class="fg"><label class="fl">Número</label><input class="fi" id="f-mn" value="${es(d.maquina_numero)}" placeholder="71"></div>
          <div class="fg"><label class="fl">Agujado</label>
            <select class="fi" id="f-ag">
              <option value="">— elegir —</option>
              ${['108', '120', '132', '144', '200'].map(n => `<option${String(d.agujado) === n ? ' selected' : ''}>${n}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>
      <div class="fsec"><div class="ftitle">Medidas de salida (cm)</div>
        <table class="mt">
          <tr><th>Medida</th><th>Sin Hormar</th><th>Hormado</th></tr>
          ${['A — Alto tubo', 'B — Planta', 'C — Ancho planta', 'D — Ancho elástico', 'E — Alto elástico'].map((lbl, i) => {
            const k = String.fromCharCode(65 + i);
            return `<tr><td class="lbl">${lbl}</td><td><input id="sh${k}" value="${es(sh[k] || '')}" placeholder="0.0" inputmode="decimal"></td><td><input id="mh${k}" value="${es(mh[k] || '')}" placeholder="0.0" inputmode="decimal"></td></tr>`;
          }).join('')}
        </table>
      </div>
      <div class="fsec"><div class="ftitle">Tiempos y pesos</div>
        <div class="g2">
          <div class="fg"><label class="fl">T. ciclo — min</label><input class="fi" type="number" min="0" id="f-cm" value="${es(d.t_ciclo_min)}" placeholder="1"></div>
          <div class="fg"><label class="fl">T. ciclo — seg</label><input class="fi" type="number" min="0" max="59" id="f-cs" value="${es(d.t_ciclo_seg)}" placeholder="54"></div>
          <div class="fg"><label class="fl">Peso salida (g)</label><input class="fi" type="number" min="0" id="f-ps" value="${es(d.peso_sal)}" placeholder="20.78"></div>
          <div class="fg"><label class="fl">Peso cerrado (g)</label><input class="fi" type="number" min="0" id="f-pc" value="${es(d.peso_cer)}" placeholder="17.5"></div>
        </div>
      </div>
      <div class="fsec"><div class="ftitle">Giros de cadena</div>
        <div class="g2">
          <div class="fg"><label class="fl">Elástico</label><input class="fi" type="number" min="0" id="g-el" value="${es(gi.el)}" placeholder="20"></div>
          <div class="fg"><label class="fl">Tubo</label><input class="fi" type="number" min="0" id="g-tb" value="${es(gi.tb)}" placeholder="10"></div>
          <div class="fg"><label class="fl">Planta</label><input class="fi" type="number" min="0" id="g-pl" value="${es(gi.pl)}" placeholder="165"></div>
          <div class="fg"><label class="fl">Rubber</label><input class="fi" type="number" min="0" id="g-rb" value="${es(gi.rb)}" placeholder="10"></div>
        </div>
      </div>
      <div class="fsec"><div class="ftitle">Velocidades de cadena</div>
        <div class="g2">
          <div class="fg"><label class="fl">Elástico</label><input class="fi" type="number" min="0" id="v-el" value="${es(vl.el)}" placeholder="230"></div>
          <div class="fg"><label class="fl">Tubo</label><input class="fi" type="number" min="0" id="v-tb" value="${es(vl.tb)}" placeholder="260"></div>
          <div class="fg"><label class="fl">Talón y punta</label><input class="fi" type="number" min="0" id="v-tp" value="${es(vl.tp)}" placeholder="200"></div>
          <div class="fg"><label class="fl">Planta</label><input class="fi" type="number" min="0" id="v-pl" value="${es(vl.pl)}" placeholder="260"></div>
        </div>
      </div>
      <div class="fsec"><div class="ftitle">Punto de máquina — un renglón por alimentador</div>
        <table class="mt">
          <tr><th>Alim.</th><th>DEN-1</th><th>DEN-2</th><th>SINK2</th></tr>
          ${PTO_ALIM.map(n => {
            // La ficha técnica trae los 10 renglones; el primero conserva
            // además el trío suelto de las fichas viejas (pto.d1/d2/sk).
            const f = (d.pto_tabla || [])[n - 1] || (n === 1 ? pt : {});
            return `<tr>
              <td class="lbl">${n}</td>
              <td><input id="pt-${n}-d1" value="${es(f.d1 || '')}" inputmode="numeric" placeholder="—"></td>
              <td><input id="pt-${n}-d2" value="${es(f.d2 || '')}" inputmode="numeric" placeholder="—"></td>
              <td><input id="pt-${n}-sk" value="${es(f.sk || '')}" inputmode="numeric" placeholder="—"></td>
            </tr>`;
          }).join('')}
        </table>
        <div style="font-size:11px;color:var(--tx3);margin-top:6px">DEN-1 es el que normalmente se ajusta. Deja en blanco los alimentadores que no uses.</div>
      </div>
      <div class="fsec"><div class="ftitle">Producción — variante ${es(d.codigo_variante)}</div>
        <div id="cap-pares-aviso">${avisoParesHTML(d)}</div>
        <div class="g2">
          <div class="fg"><label class="fl">Pares producidos${d.pares_requeridos ? ' (se piden ' + es(d.pares_requeridos) + ')' : ''}</label><input class="fi" type="number" min="0" id="f-pr" value="${es(d.pares)}" placeholder="${es(d.pares_requeridos)} req."></div>
          <div class="fg"><label class="fl">Tipo de pack (del pedido)</label><input class="fi" id="f-pk" value="${es(d.tipo_pack)}" placeholder="—" readonly tabindex="-1" style="background:var(--s2);color:var(--tx2)"></div>
        </div>
      </div>
      <div class="fsec"><div class="ftitle">Observaciones</div>
        <textarea class="fi" id="f-ob" rows="3" placeholder="Ajustes, incidencias...">${es(d.obs)}</textarea>
      </div>
      <button class="btn btn-am" data-capact="sign">✓ Guardar y firmar</button>
      <button class="btn btn-gh" data-capact="draft">💾 Guardar avance (sin terminar)</button>
    `;
    // Cualquier edición marca la ficha como "sucia", guarda un borrador local
    // y programa el autosave. 'change' además de 'input': los <select>
    // (agujado) no disparan 'input' en todos los navegadores.
    document.getElementById('cbody').querySelectorAll('input,textarea,select').forEach(inp => {
      inp.addEventListener('input', marcarSucio);
      inp.addEventListener('change', marcarSucio);
    });
    scr('sC');
    // Lo que se escribió en ESTE dispositivo y no alcanzó a subir (se cerró
    // el navegador, se fue la señal) se recupera encima de lo que trae
    // Firestore, siempre que sea más nuevo que el último guardado.
    restaurarBorradorLocal(capturaId, d);
  } catch (e) {
    console.error(e); toast('Error cargando captura', false);
    if (APP.activeCap === capturaId) limpiarActiva(capturaId);
  }
}

// La ficha no se pudo abrir (o ya no existe): que no quede media abierta con
// un autosave apuntando a un formulario vacío.
function limpiarActiva(capturaId) {
  if (APP.activeCap !== capturaId) return;
  cancelarAutosave();
  APP.activeCap = null;
  APP.activeCapFolio = null;
  APP.activeCapDoc = null;
  APP.capDirty = false;
}

// ── Pares vigentes y aviso de ajuste ──
// Lety puede bajar (o subir) los pares de un código a media marcha: el
// ajuste vive en desarrollo.pares_por_codigo y manda sobre la variante.
export function paresVigentes(dd, cod) {
  // El mapa es canónico: si conoce el código, manda aunque esté vacío (las
  // reglas comparan contra él tal cual). Solo las tareas viejas sin mapa caen
  // a lo que traía la variante.
  const ppc = (dd && dd.pares_por_codigo) || {};
  if (Object.prototype.hasOwnProperty.call(ppc, cod) && ppc[cod] !== null && ppc[cod] !== undefined) return String(ppc[cod]);
  const v = ((dd && dd.variantes) || []).find(x => x.codigo === cod) || {};
  return String(v.pares_requeridos || '');
}

function avisoParesHTML(d) {
  if (!d) return '';
  const dev = (APP.tareasSnap || []).find(t => t.id === d.id_desarrollo);
  if (!dev) return '';
  const vig = paresVigentes(dev.data, d.codigo_variante);
  if (!vig || vig === String(d.pares_requeridos || '')) return '';
  return `<div class="al alw" style="margin:0 0 10px"><span>✏️</span><span style="font-size:12px">Lety cambió los pares requeridos: ahora <strong>${es(vig)}</strong>${d.pares_requeridos ? ' (antes ' + es(d.pares_requeridos) + ')' : ''}</span></div>`;
}

// Se llama desde el listener de tareas: si Lety ajusta los pares mientras la
// ficha está abierta, solo se repinta el aviso — nunca el formulario.
export function refrescaAvisoPares() {
  const el = document.getElementById('cap-pares-aviso');
  if (el && APP.activeCap && APP.activeCapDoc) el.innerHTML = avisoParesHTML(APP.activeCapDoc);
}

// ── Autosave ──
// Israel y Jesús llenan la ficha desde el celular y no firman hasta terminar;
// si salían sin "guardar borrador" (botón al fondo de un formulario largo),
// perdían todo. Ahora: cada edición guarda un borrador LOCAL al instante y
// programa un guardado a Firestore 2.5 s después de la última tecla. Un
// contador de versión evita la carrera clásica: si se escribe MIENTRAS un
// guardado viaja, ese guardado no da la ficha por limpia.
let editVersion = 0;
let autosaveTimer = null;
const AUTOSAVE_MS = 2500;
const REINTENTO_MS = 10000;

function marcarSucio() {
  if (!APP.activeCap) return;
  editVersion++;
  APP.capDirty = true;
  guardarBorradorLocal();
  pintaGuardado('pendiente');
  programarAutosave(AUTOSAVE_MS);
}

function programarAutosave(ms) {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(autosave, ms);
}

function cancelarAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = null;
}

async function autosave() {
  autosaveTimer = null;
  if (!APP.activeCap || !APP.capDirty) return;
  if (savingCap) { programarAutosave(1000); return; } // hay uno en vuelo: después
  const errs = camposInvalidos();
  if (errs.length) { pintaGuardado('invalido', errs[0]); return; }
  await guardar(true);
}

// Núcleo compartido por autosave, "Guardar avance" y la salida de la ficha.
// Devuelve true si Firestore aceptó la escritura.
async function guardar(silencioso) {
  const id = APP.activeCap;
  if (!id || savingCap) return false;
  savingCap = true;
  const ver = editVersion;
  try {
    await saveCapData();
    if (APP.activeCap !== id) return true; // ya se abrió otra ficha
    if (editVersion === ver) {
      // Nada cambió mientras viajaba: la ficha está limpia de verdad
      APP.capDirty = false;
      borrarBorradorLocal(id);
      pintaGuardado('ok');
    } else {
      // Hubo teclas durante el vuelo: lo guardado ya está viejo. El borrador
      // local se vuelve a escribir sobre la revisión que acaba de quedar, para
      // que siga contando como "más nuevo que Firestore" si el navegador se
      // cierra antes del siguiente guardado.
      guardarBorradorLocal();
      programarAutosave(AUTOSAVE_MS);
    }
    if (!silencioso) toast('Avance guardado');
    return true;
  } catch (e) {
    console.error('guardar ficha:', e);
    if (e && e.message === 'rev-conflicto') {
      // Otro dispositivo guardó esta ficha: lo de esta pantalla ya es viejo.
      // Se recarga (el borrador local se descarta solo en la restauración
      // porque su base ya no coincide) y se avisa.
      toast('Esta ficha se guardó desde otro dispositivo — se recargó con lo más reciente', false);
      borrarBorradorLocal(id);
      APP.capDirty = false;
      if (APP.activeCap === id) openCap(id);
      return false;
    }
    pintaGuardado('error');
    if (!silencioso) {
      toast(e && e.code === 'permission-denied'
        ? 'Firestore no aceptó el guardado — puede que Lety haya cancelado la tarea'
        : 'No se pudo guardar — sin conexión. Queda en este dispositivo y se reintenta solo', false);
    }
    // Sin conexión: se reintenta solo. El borrador local ya está a salvo.
    if (APP.activeCap === id && APP.capDirty) programarAutosave(REINTENTO_MS);
    return false;
  } finally { savingCap = false; }
}

function pintaGuardado(estado, detalle) {
  const el = document.getElementById('cap-save');
  if (!el) return;
  const hora = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  if (estado === 'ok') { el.textContent = '✓ Guardado ' + hora; el.style.color = 'var(--gn)'; }
  else if (estado === 'pendiente') { el.textContent = '● Cambios sin guardar…'; el.style.color = 'var(--tx3)'; }
  else if (estado === 'invalido') { el.textContent = '⚠ Corrige ' + (detalle || 'el campo marcado') + ' para guardar'; el.style.color = 'var(--rd)'; }
  else if (estado === 'error') { el.textContent = '⚠ Sin conexión — guardado en este dispositivo, se reintenta'; el.style.color = 'var(--am)'; }
}

// Espera a que termine un guardado en vuelo (tope 6 s) para no pisarlo ni
// salir con él a medias
async function esperarGuardadoLibre() {
  for (let i = 0; i < 30 && savingCap; i++) await new Promise(r => setTimeout(r, 200));
  return !savingCap;
}

// ── Borrador local (por dispositivo y usuario) ──
function claveBorrador(id) { return 'qu_d_' + (APP.user ? APP.user.id : 'anon') + '_' + id; }

function leerInputs() {
  const out = {};
  document.querySelectorAll('#cbody input, #cbody textarea, #cbody select').forEach(el => {
    if (el.id) out[el.id] = el.value;
  });
  return out;
}

function guardarBorradorLocal() {
  if (!APP.activeCap) return;
  try {
    // `base`: la revisión de Firestore sobre la que se escribió este borrador
    localStorage.setItem(claveBorrador(APP.activeCap), JSON.stringify({ t: Date.now(), base: capRev || null, pend: revEnVuelo || null, v: leerInputs() }));
  } catch (e) { /* almacenamiento lleno o bloqueado: el autosave sigue */ }
}

function borrarBorradorLocal(id) {
  try { localStorage.removeItem(claveBorrador(id)); } catch (e) {}
}

// La firma y el cierre remoto también lo olvidan: un borrador viejo no debe
// reaparecer encima de una ficha que ya siguió su camino.
export function olvidarBorradorLocal(id) { borrarBorradorLocal(id); }

function restaurarBorradorLocal(id, d) {
  let raw = null;
  try { raw = localStorage.getItem(claveBorrador(id)); } catch (e) { return; }
  if (!raw) return;
  let draft;
  try { draft = JSON.parse(raw); } catch (e) { borrarBorradorLocal(id); return; }
  if (!draft || !draft.v || typeof draft.v !== 'object') { borrarBorradorLocal(id); return; }
  // Solo si Firestore sigue en la MISMA revisión que el borrador conoció: si
  // alguien guardó después (desde la tablet, tras una corrección...), el
  // borrador es viejo y se descarta. Se compara por revisión y no por hora:
  // el reloj de un celular adelantado haría pasar por nuevo un borrador viejo.
  // También vale si Firestore quedó en la revisión que estaba EN VUELO cuando
  // se escribió el borrador: el commit llegó pero el navegador murió antes de
  // enterarse.
  const revDoc = (d && d.guardado_rev) || null;
  if ((draft.base || null) !== revDoc && (draft.pend || null) !== revDoc) {
    borrarBorradorLocal(id);
    toast('Había cambios sin subir en este dispositivo, pero la ficha ya se guardó después desde otro lado: se descartaron', false);
    return;
  }
  let n = 0;
  Object.entries(draft.v).forEach(([elId, val]) => {
    const el = document.getElementById(elId);
    if (!el || typeof val !== 'string') return;
    if (el.value !== val) { el.value = val; n++; }
  });
  if (n === 0) { borrarBorradorLocal(id); return; }
  editVersion++;
  APP.capDirty = true;
  pintaGuardado('pendiente');
  programarAutosave(800);
  toast('Se recuperó lo que llevabas capturado en este dispositivo');
}

// Lety canceló la tarea mientras la ficha estaba abierta: se cierra sin
// intentar guardar (las reglas ya no lo aceptarían) y se olvida el borrador.
export function cerrarFichaRemota() {
  const id = APP.activeCap;
  cancelarAutosave();
  if (id) borrarBorradorLocal(id);
  APP.capDirty = false;
  APP.activeCap = null;
  APP.activeCapFolio = null;
  APP.activeCapDoc = null;
  scr('sM');
}

// El muestrista ya no para su propio cronómetro: pide la pausa y Lety la
// autoriza. Mientras tanto el tiempo sigue corriendo.
export function botoneraPausa(capturaId) {
  const t = timers[capturaId] || {};
  const pa = (APP.pausas || {})[capturaId];
  if (pa && pa.estado === 'pendiente') {
    return '<div class="al alw" style="flex:1;margin:0"><span>⏳</span><span style="font-size:12px">Pausa pedida — esperando a Lety</span></div>';
  }
  if (t.tmActive) {
    return '<button class="btn btn-gn btn-sm" style="flex:1" data-capact="finpausa">▶ Volver al trabajo</button>';
  }
  return '<button class="btn btn-rd btn-sm" style="flex:1" data-capact="tm">✋ Pedir pausa</button>';
}

// Refresca SOLO la botonera de la ficha abierta. No se re-pinta el formulario
// entero a propósito: el muestrista puede estar escribiendo sus medidas.
export function refrescaBotonera() {
  const cont = document.getElementById('cap-btns');
  if (cont && APP.activeCap) cont.innerHTML = botoneraPausa(APP.activeCap);
}

// Delegación de eventos de la ficha: nada de handlers inline con datos
// interpolados (un ID de captura manipulado podría inyectar JS)
export function wireCapturaEvents() {
  document.getElementById('cbody').addEventListener('click', e => {
    const btn = e.target.closest('[data-capact]');
    if (!btn) return;
    switch (btn.dataset.capact) {
      case 'finpausa': if (APP.activeCap) terminarPausa(APP.activeCap); break;
      case 'tm': if (APP.activeCap) openTMFor(APP.activeCap); break;
      case 'sign': saveAndSign(); break;
      case 'draft': saveDraft(); break;
    }
  });
}

// Salir de la ficha: el timer sigue corriendo (la máquina sigue tejiendo).
// Si hay cambios, se GUARDAN y se sale; solo se pregunta cuando no se puede
// guardar (campo inválido o sin conexión). Antes la única opción era "Salir
// sin guardar", y así se perdía media ficha capturada.
let saliendo = false;

export async function backCaptura() {
  if (saliendo) return; // doble toque en la flecha: la primera ya está en ello
  const id = APP.activeCap;
  const leave = () => {
    cancelarAutosave();
    APP.capDirty = false;
    APP.activeCap = null;
    APP.activeCapFolio = null;
    APP.activeCapDoc = null;
    scr(APP.user && APP.user.rol === 'lety' ? 'sL' : 'sM');
  };
  if (!APP.capDirty) { leave(); return; }
  const errs = camposInvalidos();
  if (errs.length) {
    // "Salir sin guardar" descarta de verdad: también el borrador local, que
    // si no reaparecería después pese a que la acción dice descartar.
    confirmDlg('Hay un campo con error', 'Corrige "' + errs[0] + '" para poder guardar, o sal sin guardar estos cambios (el timer sigue corriendo).', 'Salir sin guardar', () => { if (id) borrarBorradorLocal(id); leave(); });
    return;
  }
  saliendo = true;
  try {
    cancelarAutosave();
    // Se guarda hasta que no queden teclas en vuelo (tope 3 intentos): "guardar
    // y salir" significa que lo último escrito también llegó a Firestore.
    let ok = false;
    for (let i = 0; i < 3 && APP.capDirty; i++) {
      await esperarGuardadoLibre();
      if (!APP.capDirty) break;
      ok = await guardar(true);
      if (!ok) break;
    }
    if (!APP.capDirty) { toast('Avance guardado'); leave(); return; }
    if (ok) { leave(); return; } // seguían escribiendo: el borrador local tiene lo último
    confirmDlg('No se pudo guardar', 'Sin conexión. Lo capturado queda en este dispositivo y se sube solo cuando vuelvas a abrir la ficha. ¿Salir?', 'Salir', leave);
  } finally { saliendo = false; }
}

// ── Validación de campos numéricos (bloquea negativos y valores no numéricos) ──
const NUM_FIELDS = [
  ['f-cm', 'T. ciclo min'], ['f-cs', 'T. ciclo seg'], ['f-ps', 'Peso salida'], ['f-pc', 'Peso cerrado'],
  ['g-el', 'Giros elástico'], ['g-tb', 'Giros tubo'], ['g-pl', 'Giros planta'], ['g-rb', 'Giros rubber'],
  ['v-el', 'Vel. elástico'], ['v-tb', 'Vel. tubo'], ['v-tp', 'Vel. talón y punta'], ['v-pl', 'Vel. planta'],
  ['f-pr', 'Pares producidos'],
  ['shA', 'Medida A sin hormar'], ['shB', 'Medida B sin hormar'], ['shC', 'Medida C sin hormar'],
  ['shD', 'Medida D sin hormar'], ['shE', 'Medida E sin hormar'],
  ['mhA', 'Medida A hormada'], ['mhB', 'Medida B hormada'], ['mhC', 'Medida C hormada'],
  ['mhD', 'Medida D hormada'], ['mhE', 'Medida E hormada'],
];

function camposInvalidos() {
  const errores = [];
  // Los 30 campos del punto de máquina se validan aparte: se generan
  // dinámicamente, así que no están en la lista fija de arriba.
  PTO_ALIM.forEach(n => {
    [['d1', 'DEN-1'], ['d2', 'DEN-2'], ['sk', 'SINK2']].forEach(([k, et]) => {
      const v = gv('pt-' + n + '-' + k).trim();
      if (v === '') return;
      const num = Number(v.replace(',', '.'));
      if (!Number.isFinite(num) || num < 0) errores.push(et + ' del alimentador ' + n);
    });
  });
  NUM_FIELDS.forEach(([id, label]) => {
    const v = gv(id).trim();
    if (v === '') return; // vacío se permite (Lety decide en revisión)
    const n = Number(v.replace(',', '.'));
    if (!Number.isFinite(n) || n < 0) errores.push(label);
  });
  const cs = Number(gv('f-cs').trim().replace(',', '.'));
  if (Number.isFinite(cs) && cs > 59) errores.push('T. ciclo seg (máx. 59)');
  return errores;
}

// Revisión de guardado vigente de la ficha abierta (la que Firestore tiene,
// según lo último que este dispositivo leyó o escribió)
let capRev = null;
function nuevaRev() { return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }

// Revisión que está viajando a Firestore (si la hay): el borrador local la
// anota para que, si el navegador muere justo entre el commit y su
// confirmación, el borrador no se descarte al reabrir por "viejo".
let revEnVuelo = null;

async function saveCapData() {
  const id = APP.activeCap;
  const rev = nuevaRev();
  const base = capRev;
  const sh = {}, mh = {};
  ['A', 'B', 'C', 'D', 'E'].forEach(k => { sh[k] = gv('sh' + k); mh[k] = gv('mh' + k); });
  const datos = {
    maquina_marca: gv('f-mm'), maquina_numero: gv('f-mn'), agujado: gv('f-ag'),
    med_sh: sh, med_h: mh,
    t_ciclo_min: gv('f-cm'), t_ciclo_seg: gv('f-cs'),
    peso_sal: gv('f-ps'), peso_cer: gv('f-pc'),
    giros: { el: gv('g-el'), tb: gv('g-tb'), pl: gv('g-pl'), rb: gv('g-rb') },
    vels: { el: gv('v-el'), tb: gv('v-tb'), tp: gv('v-tp'), pl: gv('v-pl') },
    pto_tabla: PTO_ALIM.map(n => ({
      alim: String(n),
      d1: gv('pt-' + n + '-d1'), d2: gv('pt-' + n + '-d2'), sk: gv('pt-' + n + '-sk'),
    })),
    // El primer alimentador se sigue guardando suelto: el histórico y las
    // columnas den1/den2/sink2 del reporte se leen de aquí.
    pto: { d1: gv('pt-1-d1'), d2: gv('pt-1-d2'), sk: gv('pt-1-sk') },
    pares: gv('f-pr'), obs: gv('f-ob'),
    // tipo_pack ya no se escribe: es dato del pedido (lo fija Lety) y las
    // reglas lo congelan en la ficha.
    elapsed_seg: elapsedOf(id), tm_seg: tmOf(id), tm_causas: causesOf(id),
    // Sello y revisión del guardado. La revisión la genera el cliente antes
    // de escribir, así sabe cuál quedó; el borrador local se restaura solo si
    // la revisión del documento sigue siendo la que el borrador conoció.
    guardado_en: firebase.firestore.FieldValue.serverTimestamp(),
    guardado_rev: rev,
  };
  revEnVuelo = rev;
  if (APP.capDirty) guardarBorradorLocal(); // el borrador conoce la revisión en vuelo
  try {
    // Transacción con control de revisión: si OTRO dispositivo guardó esta
    // ficha desde que este la leyó, no se pisa lo suyo con un formulario
    // viejo. El que llega tarde se entera y recarga.
    await db.runTransaction(async tx => {
      const ref = db.collection('capturas').doc(id);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error('ficha-inexistente');
      const actual = snap.data().guardado_rev || null;
      if (actual !== (base || null)) throw new Error('rev-conflicto');
      tx.update(ref, datos);
    });
  } finally { if (revEnVuelo === rev) revEnVuelo = null; }
  if (APP.activeCap === id) capRev = rev;
}

let savingCap = false;

export async function saveDraft() {
  if (!fsOk() || !APP.activeCap) return;
  const errs = camposInvalidos();
  if (errs.length) { toast('Corrige estos campos: ' + errs.slice(0, 3).join(', '), false); return; }
  cancelarAutosave();
  await esperarGuardadoLibre();
  if (!APP.capDirty) { pintaGuardado('ok'); toast('Ya estaba guardado'); return; }
  await guardar(false);
}

export async function saveAndSign() {
  if (!fsOk() || !APP.activeCap) return;
  // Un autosave en vuelo no debe hacer que el toque en "firmar" se pierda en
  // silencio: se espera a que termine y se sigue.
  cancelarAutosave();
  await esperarGuardadoLibre();
  if (savingCap) { toast('Espera un momento: se está guardando', false); return; }
  const errs = camposInvalidos();
  if (errs.length) { toast('Corrige estos campos: ' + errs.slice(0, 3).join(', '), false); return; }
  // Aviso (no bloqueo) si faltan datos clave: en fábrica puede haber fichas
  // parciales legítimas; Lety decide en revisión
  const faltan = [];
  if (!gv('f-mm').trim() && !gv('f-mn').trim()) faltan.push('máquina');
  if (!gv('f-pr').trim()) faltan.push('pares producidos');
  if (!gv('f-ag').trim()) faltan.push('agujado');
  if (['A', 'B', 'C', 'D', 'E'].every(k => !gv('sh' + k).trim() && !gv('mh' + k).trim())) faltan.push('medidas');
  if (faltan.length) {
    confirmDlg('Ficha incompleta', 'Faltan datos: ' + faltan.join(', ') + '. ¿Firmar de todas formas?', 'Firmar así', doSign);
  } else {
    doSign();
  }
}

async function doSign() {
  if (savingCap) return;
  savingCap = true;
  cancelarAutosave();
  try {
    await saveCapData();
    APP.capDirty = false;
    // El borrador local se borra al FIRMAR (firma.js), no aquí: si cancela la
    // firma vuelve a la ficha y lo escrito ya está en Firestore de todos modos.
    const t = timers[APP.activeCap];
    // wasRunning: si cancela la firma, el timer se reanuda como estaba
    APP.sigData = { capturaId: APP.activeCap, who: 'muestrista', wasRunning: !!(t && t.running) };
    pauseT(APP.activeCap, false);
    document.getElementById('ft').textContent = 'Firma del muestrista';
    document.getElementById('fi-inst').innerHTML = '<span>✍️</span><span>Firma para confirmar que los datos son correctos.</span>';
    showFirma();
  } catch (e) { console.error(e); toast('Error', false); }
  finally { savingCap = false; }
}
