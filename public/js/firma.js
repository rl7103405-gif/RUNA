// Firma digital en canvas (touch + mouse)
import { db, fsOk } from './fb.js';
import { APP } from './state.js';
import { scr, toast } from './utils.js';
import { elapsedOf, tmOf, pauseT, dropTimer } from './timers.js';

let sigDrw = false, sigCtxObj = null;

export function showFirma() {
  scr('sF');
  // Inicializar DESPUÉS de que la pantalla sea visible, si no el canvas
  // queda con dimensiones 0 (lección aprendida #2)
  setTimeout(initSig, 80);
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
  sigCtxObj.strokeStyle = '#F5A623';
  sigCtxObj.lineWidth = 3 * dpr;
  sigCtxObj.lineCap = 'round';
  sigCtxObj.lineJoin = 'round';
  sigCtxObj.clearRect(0, 0, cv.width, cv.height);
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
  if (cv && sigCtxObj) sigCtxObj.clearRect(0, 0, cv.width, cv.height);
}

export async function saveSig() {
  if (!fsOk()) return;
  const cv = document.getElementById('sig-cv');
  const px = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  if (!px.some(v => v !== 0)) { toast('Dibuja tu firma primero', false); return; }
  const url = cv.toDataURL('image/png');
  const { capturaId, who } = APP.sigData;
  try {
    if (who === 'muestrista') {
      await db.collection('capturas').doc(capturaId).update({
        firma_m: url,
        estado: 'pendiente_lety',
        elapsed_seg: elapsedOf(capturaId),
        tm_seg: tmOf(capturaId),
        dt_fin: firebase.firestore.FieldValue.serverTimestamp(),
      });
      pauseT(capturaId, false);
      dropTimer(capturaId);
      APP.activasSnap = (APP.activasSnap || []).filter(d => d.id !== capturaId);
      APP.activeCap = null;
      toast('✅ Ficha firmada — pendiente de Lety');
      scr('sM');
    } else {
      await db.collection('capturas').doc(capturaId).update({ firma_l: url, estado: 'aprobado' });
      toast('✅ Ficha aprobada');
      scr('sL');
      const { loadRev } = await import('./admin.js');
      loadRev();
    }
  } catch (e) { console.error(e); toast('Error guardando firma', false); }
}

export function backFirma() {
  scr(APP.user && APP.user.rol === 'lety' ? 'sR' : 'sC');
}
