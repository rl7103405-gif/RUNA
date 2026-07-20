// Login con PIN + cambio de PINs
import { db, fsOk } from './fb.js';
import { APP, USERS, DEF_PINS } from './state.js';
import { scr, toast, gv, openOvl, closeOvl } from './utils.js';
import { clearAllTimers } from './timers.js';
import { initMuestrista } from './muestrista.js';
import { initLety } from './admin.js';

// Devuelve true (PIN correcto), false (PIN incorrecto) o null (no se pudo
// verificar). Falla cerrado: sin conexión NUNCA se acepta el PIN de fábrica —
// el fallback a DEF_PINS aplica solo cuando Firestore confirma que el doc
// del PIN aún no existe (primer uso).
export async function verifyPIN(uid, pin) {
  if (!db) return null;
  try {
    const doc = await db.collection('pines').doc(uid).get();
    if (!doc.exists) return pin === DEF_PINS[uid];
    return doc.data().pin === pin;
  } catch (e) {
    console.error('verifyPIN:', e);
    return null;
  }
}

export function selectUser(uid) {
  APP.pinTarget = uid;
  APP.pinBuf = [];
  const u = USERS[uid];
  document.getElementById('pin-ico').textContent = u.ico;
  document.getElementById('pin-name').textContent = u.nombre;
  document.getElementById('pin-err').textContent = '';
  updateDots();
  scr('s1');
}

let checkingPin = false;

export function numPad(n) {
  if (checkingPin || APP.pinBuf.length >= 6) return;
  APP.pinBuf.push(n);
  updateDots();
  if (APP.pinBuf.length === 6) setTimeout(submitPin, 150);
}
export function backPin() { if (!checkingPin) { APP.pinBuf.pop(); updateDots(); } }
export function clearPin() { if (!checkingPin) { APP.pinBuf = []; updateDots(); } }

function updateDots() {
  for (let i = 0; i < 6; i++) {
    const d = document.getElementById('pd' + i);
    if (d) d.classList.toggle('on', i < APP.pinBuf.length);
  }
}

async function submitPin() {
  if (checkingPin) return;
  checkingPin = true;
  // Se fija el usuario ANTES del await: si alguien cambia de usuario mientras
  // Firestore responde, la verificación vieja no puede abrir la sesión nueva
  const uid = APP.pinTarget;
  const pin = APP.pinBuf.join('');
  try {
    const ok = await verifyPIN(uid, pin);
    if (APP.pinTarget !== uid) return; // cambió de usuario a media verificación
    if (ok === true) {
      login(uid);
    } else {
      document.getElementById('pin-err').textContent = ok === null
        ? 'Sin conexión — no se pudo verificar el PIN'
        : 'PIN incorrecto, intenta de nuevo';
      const wrap = document.getElementById('pin-dots-wrap');
      wrap.classList.add('shake');
      setTimeout(() => wrap.classList.remove('shake'), 400);
      APP.pinBuf = []; updateDots();
    }
  } finally {
    checkingPin = false;
  }
}

export function login(uid) {
  APP.user = { id: uid, ...USERS[uid] };
  if (uid === 'lety') { initLety(); scr('sL'); }
  else { initMuestrista(); scr('sM'); }
}

export function logout() {
  clearAllTimers();
  APP.listeners.forEach(u => { try { u(); } catch (e) {} });
  APP.listeners = [];
  APP.user = null;
  APP.vars = [];
  APP.activasSnap = [];
  APP.allCaps = [];
  APP.tareasSnap = [];
  APP.dbDocs = [];
  APP.activeCap = null;
  scr('s0');
}

// ── Cambio de PIN ──
export function openChangePin(uid) {
  APP.changePinUid = uid;
  const u = USERS[uid];
  document.getElementById('cp-who-label').textContent = 'Cambiando PIN de: ' + u.ico + ' ' + u.nombre;
  ['cp-new', 'cp-confirm', 'cp-admin'].forEach(id => document.getElementById(id).value = '');
  openOvl('ocp');
}

export function openChangePinSelf() {
  APP.changePinUid = APP.user.id;
  const u = USERS[APP.user.id];
  document.getElementById('cp-who-label').textContent = 'Cambiando tu PIN: ' + u.ico + ' ' + u.nombre;
  ['cp-new', 'cp-confirm', 'cp-admin'].forEach(id => document.getElementById(id).value = '');
  openOvl('ocp');
}

let savingPin = false;

export async function savePin() {
  if (savingPin) return;
  const newPin = gv('cp-new').trim();
  const confirmPin = gv('cp-confirm').trim();
  const adminPin = gv('cp-admin').trim();
  if (!/^\d{6}$/.test(newPin)) { toast('El PIN debe ser de 6 dígitos numéricos', false); return; }
  if (newPin !== confirmPin) { toast('Los PINs no coinciden', false); return; }
  // Se fija el usuario destino ANTES del await: si el diálogo se cierra y
  // reabre para otro usuario mientras se verifica el PIN de admin, el PIN
  // nuevo no debe aplicarse al usuario equivocado
  const targetUid = APP.changePinUid;
  savingPin = true;
  try {
    // Cualquier cambio de PIN se confirma con el PIN de admin (Lety)
    const adminOk = await verifyPIN('lety', adminPin);
    if (adminOk === null) { toast('Sin conexión — no se pudo verificar el PIN de admin', false); return; }
    if (adminOk !== true) { toast('PIN de admin incorrecto', false); return; }
    if (!fsOk()) return;
    await db.collection('pines').doc(targetUid).set({ pin: newPin });
    toast('✅ PIN actualizado correctamente');
    closeOvl('ocp');
  } catch (e) {
    console.error(e);
    toast('Error guardando PIN', false);
  } finally {
    savingPin = false;
  }
}
