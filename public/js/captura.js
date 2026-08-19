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
    const dev = await db.collection('desarrollos').doc(devId).get();
    const dd = dev.data();
    if (!dd) { toast('Desarrollo no encontrado', false); return; }
    const v = (dd.variantes || []).find(x => x.codigo === cod) || {};
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
      const cSnap = await tx.get(counterRef);
      const prev = cSnap.exists && typeof cSnap.data().seq === 'number' ? Math.floor(cSnap.data().seq) : 0;
      const seq = prev + 1;
      tx.set(counterRef, { seq });
      tx.set(capRef, {
        folio: 'FP-' + String(seq).padStart(5, '0'), folio_seq: seq,
        id_desarrollo: devId, id_muestrista: APP.user.id,
        codigo_variante: cod, descripcion_variante: v.descripcion || '',
        pares_requeridos: v.pares_requeridos || '', tipo_pack: v.tipo_pack || '',
        modelo: dd.modelo, cliente: dd.cliente, ot: dd.ot, po: dd.po, tipo_producto: dd.tipo_producto || '',
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
  } catch (e) { console.error(e); toast('Error iniciando captura', false); }
  finally { createBusy = false; }
}

// Reabre una ficha devuelta por Lety: vuelve a 'activo' e incrementa iteración
export async function reopenCorreccion(capId) {
  if (!fsOk()) return;
  try {
    // Si el listener de capturas aún no sembró el timer, sembrarlo desde el
    // doc para no arrancar en cero y pisar los tiempos reales en el próximo sync
    if (!timers[capId]) {
      const s = await db.collection('capturas').doc(capId).get();
      if (s.exists) seedFromDoc(capId, s.data());
    }
    await db.collection('capturas').doc(capId).update({
      estado: 'activo',
      dt_fin: null, // se re-firmará; evita que la ficha reabierta cuente en historiales
      iter: firebase.firestore.FieldValue.increment(1),
    });
    getT(capId);
    startT(capId);
    await openCap(capId);
  } catch (e) { console.error(e); toast('Error reabriendo ficha', false); }
}

export async function openCap(capturaId) {
  if (!fsOk()) return;
  APP.activeCap = capturaId;
  APP.capDirty = false;
  try {
    const snap = await db.collection('capturas').doc(capturaId).get();
    const d = snap.data();
    if (!d) { toast('Captura no encontrada', false); return; }
    APP.activeCapFolio = d.folio || null;
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
        <div class="g2">
          <div class="fg"><label class="fl">Pares producidos</label><input class="fi" type="number" min="0" id="f-pr" value="${es(d.pares)}" placeholder="${es(d.pares_requeridos)} req."></div>
          <div class="fg"><label class="fl">Tipo de pack</label><input class="fi" id="f-pk" value="${es(d.tipo_pack)}" placeholder="6 Pack"></div>
        </div>
      </div>
      <div class="fsec"><div class="ftitle">Observaciones</div>
        <textarea class="fi" id="f-ob" rows="3" placeholder="Ajustes, incidencias...">${es(d.obs)}</textarea>
      </div>
      <button class="btn btn-am" data-capact="sign">✓ Guardar y firmar</button>
      <button class="btn btn-gh" data-capact="draft">💾 Guardar borrador</button>
    `;
    // Marcar la ficha como "sucia" al editar cualquier campo
    document.getElementById('cbody').querySelectorAll('input,textarea').forEach(inp => {
      inp.addEventListener('input', () => { APP.capDirty = true; });
    });
    scr('sC');
  } catch (e) { console.error(e); toast('Error cargando captura', false); }
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

// Salir de la ficha: el timer sigue corriendo (la máquina sigue tejiendo);
// si hay cambios sin guardar se pide confirmación
export function backCaptura() {
  const leave = () => {
    APP.capDirty = false;
    APP.activeCap = null;
    APP.activeCapFolio = null;
    scr(APP.user && APP.user.rol === 'lety' ? 'sL' : 'sM');
  };
  if (APP.capDirty) {
    confirmDlg('Cambios sin guardar', 'La ficha tiene cambios que no se han guardado. ¿Salir de todas formas? (el timer sigue corriendo)', 'Salir sin guardar', leave);
  } else {
    leave();
  }
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

async function saveCapData() {
  const id = APP.activeCap;
  const sh = {}, mh = {};
  ['A', 'B', 'C', 'D', 'E'].forEach(k => { sh[k] = gv('sh' + k); mh[k] = gv('mh' + k); });
  await db.collection('capturas').doc(id).update({
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
    tipo_pack: gv('f-pk'),
    elapsed_seg: elapsedOf(id), tm_seg: tmOf(id), tm_causas: causesOf(id),
  });
}

let savingCap = false;

export async function saveDraft() {
  if (!fsOk() || savingCap) return;
  const errs = camposInvalidos();
  if (errs.length) { toast('Corrige estos campos: ' + errs.slice(0, 3).join(', '), false); return; }
  savingCap = true;
  try { await saveCapData(); APP.capDirty = false; toast('Borrador guardado'); }
  catch (e) { console.error(e); toast('Error guardando', false); }
  finally { savingCap = false; }
}

export async function saveAndSign() {
  if (!fsOk() || savingCap) return;
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
  try {
    await saveCapData();
    APP.capDirty = false;
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
