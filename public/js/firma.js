// Firma digital en canvas (touch + mouse)
import { db, fsOk } from './fb.js';
import { APP } from './state.js';
import { scr, toast, showExito } from './utils.js';
import { elapsedOf, tmOf, causesOf, pauseT, startT, endTM, dropTimer } from './timers.js';

let sigDrw = false, sigCtxObj = null;

export function showFirma() {
  scr('sF');
  // Inicializar DESPUÉS de que la pantalla sea visible, si no el canvas
  // queda con dimensiones 0 (lección aprendida #2)
  setTimeout(initSig, 80);
}

// El lienzo se rellena de blanco opaco: así la firma guardada se ve bien
// sobre cualquier fondo (las firmas viejas eran transparentes)
function fillBlanco(cv, ctx) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cv.width, cv.height);
}

function initSig() {
  const cv = document.getElementById('sig-cv');
  if (!cv) return;
  const br = cv.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(br.width * dpr) || 320;
  cv.height = Math.round(200 * dpr) || 200;
  cv.style.height = '200px';
  sigCtxObj = cv.getContext('2d');
  fillBlanco(cv, sigCtxObj);
  sigCtxObj.strokeStyle = '#1e40af';
  sigCtxObj.lineWidth = 3 * dpr;
  sigCtxObj.lineCap = 'round';
  sigCtxObj.lineJoin = 'round';
  function xy(e) {
    const r = cv.getBoundingClientRect(), s = e.touches ? e.touches[0] : e;
    const sx = cv.width / r.width, sy = cv.height / r.height;
    return { x: (s.clientX - r.left) * sx, y: (s.clientY - r.top) * sy };
  }
  cv.onmousedown = e => { sigDrw = true; const p = xy(e); sigCtxObj.beginPath(); sigCtxObj.moveTo(p.x, p.y); };
  cv.onmousemove = e => { if (!sigDrw) return; const p = xy(e); sigCtxObj.lineTo(p.x, p.y); sigCtxObj.stroke(); };
  cv.onmouseup = () => sigDrw = false;
  cv.ontouchstart = e => { e.preventDefault(); sigDrw = true; const p = xy(e); sigCtxObj.beginPath(); sigCtxObj.moveTo(p.x, p.y); };
  cv.ontouchmove = e => { e.preventDefault(); if (!sigDrw) return; const p = xy(e); sigCtxObj.lineTo(p.x, p.y); sigCtxObj.stroke(); };
  cv.ontouchend = e => { e.preventDefault(); sigDrw = false; };
}

export function clearSig() {
  const cv = document.getElementById('sig-cv');
  if (cv && sigCtxObj) fillBlanco(cv, sigCtxObj);
}

let savingSig = false;

export async function saveSig() {
  if (!fsOk() || savingSig) return;
  if (!sigCtxObj) { toast('Espera un momento — preparando el lienzo', false); return; }
  const cv = document.getElementById('sig-cv');
  const px = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  // Con fondo blanco opaco, un lienzo sin trazo tiene todos los canales en 255
  if (!px.some(v => v !== 255)) { toast('Dibuja tu firma primero', false); return; }
  const url = cv.toDataURL('image/png');
  const { capturaId, who } = APP.sigData;
  savingSig = true;
  try {
    if (who === 'muestrista') {
      // Folio ANTES de limpiar estado (para la pantalla de éxito): primero el
      // valor fresco guardado por openCap, con el listener como respaldo
      const folio = APP.activeCapFolio || (((APP.allCaps || []).find(c => c.id === capturaId) || {}).data || {}).folio;
      // Si quedó un TM abierto, se cierra aquí para que su causa quede
      // registrada en tm_causas antes de congelar los tiempos
      endTM(capturaId);
      await db.collection('capturas').doc(capturaId).update({
        firma_m: url,
        estado: 'pendiente_lety',
        elapsed_seg: elapsedOf(capturaId),
        tm_seg: tmOf(capturaId),
        tm_causas: causesOf(capturaId),
        dt_fin: firebase.firestore.FieldValue.serverTimestamp(),
      });
      pauseT(capturaId, false);
      dropTimer(capturaId);
      APP.activasSnap = (APP.activasSnap || []).filter(d => d.id !== capturaId);
      APP.activeCap = null;
      APP.sigData = null;
      scr('sM');
      showExito('Ficha firmada — pendiente de Lety', folio || 'Ficha anterior · sin folio');
    } else {
      // Transacción: solo se aprueba si la ficha SIGUE pendiente (evita
      // aprobar desde una pantalla vieja una ficha que ya cambió de estado)
      const ref = db.collection('capturas').doc(capturaId);
      await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists || snap.data().estado !== 'pendiente_lety') {
          throw new Error('estado-cambiado');
        }
        tx.update(ref, { firma_l: url, estado: 'aprobado' });
      });
      APP.sigData = null;
      scr('sL');
      showExito('Ficha aprobada', APP.revFolio || 'Ficha anterior · sin folio');
      // El refresco de listas va aparte: si falla, la aprobación YA quedó
      // guardada y no debe reportarse como error de firma
      try {
        const { loadRev } = await import('./admin.js');
        loadRev();
      } catch (e2) { console.error(e2); }
    }
  } catch (e) {
    console.error(e);
    if (e && e.message === 'estado-cambiado') {
      toast('La ficha cambió de estado — revisa la lista de pendientes', false);
      scr('sL');
      try {
        const { loadRev } = await import('./admin.js');
        loadRev();
      } catch (e2) { console.error(e2); }
    } else {
      toast('Error guardando firma', false);
    }
  } finally {
    savingSig = false;
  }
}

export async function backFirma() {
  if (APP.user && APP.user.rol === 'lety') { scr('sR'); return; }
  // Muestrista canceló la firma: reanudar el timer si estaba corriendo y
  // re-renderizar la ficha para que botón y colores reflejen el estado real
  if (APP.sigData && APP.sigData.wasRunning && APP.activeCap) startT(APP.activeCap);
  if (APP.activeCap) {
    const { openCap } = await import('./captura.js');
    await openCap(APP.activeCap);
  } else {
    scr('sM');
  }
}
