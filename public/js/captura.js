// Ficha práctica: inicio de captura, formulario, borradores y envío a firma
import { db, fsOk } from './fb.js';
import { APP, OPEN_STATES } from './state.js';
import { es, fmt, gv, scr, toast, confirmDlg } from './utils.js';
import { timers, getT, elapsedOf, tmOf, tenOf, startT, pauseT } from './timers.js';
import { showFirma } from './firma.js';

export async function startCap(devId, cod) {
  if (!fsOk()) return;
  try {
    // Dos where de igualdad no requieren índice compuesto manual
    const ex = await db.collection('capturas')
      .where('id_desarrollo', '==', devId)
      .where('codigo_variante', '==', cod)
      .get();
    // Incluye 'correccion': reabrir en vez de duplicar (bug del prototipo)
    const exOpen = ex.docs.find(d => OPEN_STATES.includes(d.data().estado));
    let capId;
    if (exOpen) {
      capId = exOpen.id;
      if (exOpen.data().estado === 'correccion') {
        await reopenCorreccion(capId);
        return;
      }
      toast('Captura existente cargada');
    } else {
      const dev = await db.collection('desarrollos').doc(devId).get();
      const dd = dev.data();
      const v = (dd.variantes || []).find(x => x.codigo === cod) || {};
      const ref = await db.collection('capturas').add({
        id_desarrollo: devId, id_muestrista: APP.user.id,
        codigo_variante: cod, descripcion_variante: v.descripcion || '',
        pares_requeridos: v.pares_requeridos || '', tipo_pack: v.tipo_pack || '',
        modelo: dd.modelo, cliente: dd.cliente, ot: dd.ot, po: dd.po, tipo_producto: dd.tipo_producto || '',
        estado: 'activo', elapsed_seg: 0, tm_seg: 0,
        dt_inicio: firebase.firestore.FieldValue.serverTimestamp(),
        maquina_marca: '', maquina_numero: '',
        med_sh: { A: '', B: '', C: '', D: '', E: '' }, med_h: { A: '', B: '', C: '', D: '', E: '' },
        t_ciclo_min: '', t_ciclo_seg: '', peso_sal: '', peso_cer: '',
        giros: { el: '', tb: '', pl: '', rb: '' }, vels: { el: '', tb: '', tp: '', pl: '' },
        pto: { d1: '', d2: '', sk: '' }, pares: '', obs: '',
        firma_m: null, firma_l: null, iter: 1,
      });
      capId = ref.id;
      await db.collection('desarrollos').doc(devId).update({ estado: 'en_proceso' });
    }
    getT(capId);
    startT(capId);
    await openCap(capId);
  } catch (e) { console.error(e); toast('Error iniciando captura', false); }
}

// Reabre una ficha devuelta por Lety: vuelve a 'activo' e incrementa iteración
export async function reopenCorreccion(capId) {
  if (!fsOk()) return;
  try {
    await db.collection('capturas').doc(capId).update({
      estado: 'activo',
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
    const t = timers[capturaId] || { running: false };
    document.getElementById('ct').textContent = (d.modelo || '') + ' · ' + (d.descripcion_variante || '');
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
        <div class="brow">
          <button class="btn btn-gn btn-sm" id="btn-tog" style="flex:2" onclick="togCapTimer()">${t.running ? '⏸ Pausar' : '▶ Reanudar'}</button>
          <button class="btn btn-rd btn-sm" style="flex:1" onclick="openTMFor('${es(capturaId)}')">⏸ TM</button>
        </div>
      </div>
      <div class="fsec"><div class="ftitle">Máquina</div>
        <div class="g2">
          <div class="fg"><label class="fl">Marca</label><input class="fi" id="f-mm" value="${es(d.maquina_marca)}" placeholder="Zhenxing"></div>
          <div class="fg"><label class="fl">Número</label><input class="fi" id="f-mn" value="${es(d.maquina_numero)}" placeholder="71"></div>
        </div>
      </div>
      <div class="fsec"><div class="ftitle">Medidas de salida (cm)</div>
        <table class="mt">
          <tr><th>Medida</th><th>Sin Hormar</th><th>Hormado</th></tr>
          ${['A — Alto tubo', 'B — Planta', 'C — Ancho planta', 'D — Ancho elástico', 'E — Alto elástico'].map((lbl, i) => {
            const k = String.fromCharCode(65 + i);
            return `<tr><td class="lbl">${lbl}</td><td><input id="sh${k}" value="${es(sh[k] || '')}" placeholder="0.0"></td><td><input id="mh${k}" value="${es(mh[k] || '')}" placeholder="0.0"></td></tr>`;
          }).join('')}
        </table>
      </div>
      <div class="fsec"><div class="ftitle">Tiempos y pesos</div>
        <div class="g2">
          <div class="fg"><label class="fl">T. ciclo — min</label><input class="fi" type="number" id="f-cm" value="${es(d.t_ciclo_min)}" placeholder="1"></div>
          <div class="fg"><label class="fl">T. ciclo — seg</label><input class="fi" type="number" id="f-cs" value="${es(d.t_ciclo_seg)}" placeholder="54"></div>
          <div class="fg"><label class="fl">Peso salida (g)</label><input class="fi" type="number" id="f-ps" value="${es(d.peso_sal)}" placeholder="20.78"></div>
          <div class="fg"><label class="fl">Peso cerrado (g)</label><input class="fi" type="number" id="f-pc" value="${es(d.peso_cer)}" placeholder="17.5"></div>
        </div>
      </div>
      <div class="fsec"><div class="ftitle">Giros de cadena</div>
        <div class="g2">
          <div class="fg"><label class="fl">Elástico</label><input class="fi" type="number" id="g-el" value="${es(gi.el)}" placeholder="20"></div>
          <div class="fg"><label class="fl">Tubo</label><input class="fi" type="number" id="g-tb" value="${es(gi.tb)}" placeholder="10"></div>
          <div class="fg"><label class="fl">Planta</label><input class="fi" type="number" id="g-pl" value="${es(gi.pl)}" placeholder="165"></div>
          <div class="fg"><label class="fl">Rubber</label><input class="fi" type="number" id="g-rb" value="${es(gi.rb)}" placeholder="10"></div>
        </div>
      </div>
      <div class="fsec"><div class="ftitle">Velocidades de cadena</div>
        <div class="g2">
          <div class="fg"><label class="fl">Elástico</label><input class="fi" type="number" id="v-el" value="${es(vl.el)}" placeholder="230"></div>
          <div class="fg"><label class="fl">Tubo</label><input class="fi" type="number" id="v-tb" value="${es(vl.tb)}" placeholder="260"></div>
          <div class="fg"><label class="fl">Talón y punta</label><input class="fi" type="number" id="v-tp" value="${es(vl.tp)}" placeholder="200"></div>
          <div class="fg"><label class="fl">Planta</label><input class="fi" type="number" id="v-pl" value="${es(vl.pl)}" placeholder="260"></div>
        </div>
      </div>
      <div class="fsec"><div class="ftitle">Punto de máquina</div>
        <div class="g3">
          <div class="fg"><label class="fl">DEN-1</label><input class="fi" type="number" id="p-d1" value="${es(pt.d1)}" placeholder="1"></div>
          <div class="fg"><label class="fl">DEN-2</label><input class="fi" type="number" id="p-d2" value="${es(pt.d2)}" placeholder="0"></div>
          <div class="fg"><label class="fl">SINK2</label><input class="fi" type="number" id="p-sk" value="${es(pt.sk)}" placeholder="0"></div>
        </div>
      </div>
      <div class="fsec"><div class="ftitle">Producción — variante ${es(d.codigo_variante)}</div>
        <div class="g2">
          <div class="fg"><label class="fl">Pares producidos</label><input class="fi" type="number" id="f-pr" value="${es(d.pares)}" placeholder="${es(d.pares_requeridos)} req."></div>
          <div class="fg"><label class="fl">Tipo de pack</label><input class="fi" id="f-pk" value="${es(d.tipo_pack)}" placeholder="6 Pack"></div>
        </div>
      </div>
      <div class="fsec"><div class="ftitle">Observaciones</div>
        <textarea class="fi" id="f-ob" rows="3" placeholder="Ajustes, incidencias...">${es(d.obs)}</textarea>
      </div>
      <button class="btn btn-am" onclick="saveAndSign()">✓ Guardar y firmar</button>
      <button class="btn btn-gh" onclick="saveDraft()">💾 Guardar borrador</button>
    `;
    // Marcar la ficha como "sucia" al editar cualquier campo
    document.getElementById('cbody').querySelectorAll('input,textarea').forEach(inp => {
      inp.addEventListener('input', () => { APP.capDirty = true; });
    });
    scr('sC');
  } catch (e) { console.error(e); toast('Error cargando captura', false); }
}

export function togCapTimer() {
  const id = APP.activeCap, t = timers[id];
  if (!t) return;
  if (t.running) pauseT(id, true); else startT(id);
  const btn = document.getElementById('btn-tog');
  if (btn) btn.textContent = t.running ? '⏸ Pausar' : '▶ Reanudar';
  const td = document.getElementById('cap-timer');
  if (td) td.className = 'timer ' + (t.running ? 'tgn' : 'tam');
}

// Salir de la ficha: el timer sigue corriendo (la máquina sigue tejiendo);
// si hay cambios sin guardar se pide confirmación
export function backCaptura() {
  const leave = () => {
    APP.capDirty = false;
    APP.activeCap = null;
    scr(APP.user && APP.user.rol === 'lety' ? 'sL' : 'sM');
  };
  if (APP.capDirty) {
    confirmDlg('Cambios sin guardar', 'La ficha tiene cambios que no se han guardado. ¿Salir de todas formas? (el timer sigue corriendo)', 'Salir sin guardar', leave);
  } else {
    leave();
  }
}

async function saveCapData() {
  const id = APP.activeCap;
  const sh = {}, mh = {};
  ['A', 'B', 'C', 'D', 'E'].forEach(k => { sh[k] = gv('sh' + k); mh[k] = gv('mh' + k); });
  await db.collection('capturas').doc(id).update({
    maquina_marca: gv('f-mm'), maquina_numero: gv('f-mn'),
    med_sh: sh, med_h: mh,
    t_ciclo_min: gv('f-cm'), t_ciclo_seg: gv('f-cs'),
    peso_sal: gv('f-ps'), peso_cer: gv('f-pc'),
    giros: { el: gv('g-el'), tb: gv('g-tb'), pl: gv('g-pl'), rb: gv('g-rb') },
    vels: { el: gv('v-el'), tb: gv('v-tb'), tp: gv('v-tp'), pl: gv('v-pl') },
    pto: { d1: gv('p-d1'), d2: gv('p-d2'), sk: gv('p-sk') },
    pares: gv('f-pr'), obs: gv('f-ob'),
    tipo_pack: gv('f-pk'),
    elapsed_seg: elapsedOf(id), tm_seg: tmOf(id),
  });
}

export async function saveDraft() {
  if (!fsOk()) return;
  try { await saveCapData(); APP.capDirty = false; toast('Borrador guardado'); }
  catch (e) { console.error(e); toast('Error guardando', false); }
}

export async function saveAndSign() {
  if (!fsOk()) return;
  try {
    await saveCapData();
    APP.capDirty = false;
    pauseT(APP.activeCap, false);
    APP.sigData = { capturaId: APP.activeCap, who: 'muestrista' };
    document.getElementById('ft').textContent = 'Firma del muestrista';
    document.getElementById('fi-inst').innerHTML = '<span>✍️</span><span>Firma para confirmar que los datos son correctos.</span>';
    showFirma();
  } catch (e) { console.error(e); toast('Error', false); }
}
