// Login con PIN + cambio de PINs
import { db, fsOk } from './fb.js';
import { APP, USERS, DEF_PINS } from './state.js';
import { scr, toast, gv, openOvl, closeOvl } from './utils.js';
import { clearAllTimers } from './timers.js';
import { initMuestrista } from './muestrista.js';
import { initLety } from './admin.js';

export async function verifyPIN(uid, pin) {
  if (!db) return pin === DEF_PINS[uid];
  try {
    const doc = await db.collection('pines').doc(uid).get();
    if (!doc.exists) return pin === DEF_PINS[uid];
    return doc.data().pin === pin;
  } catch (e) { return pin === DEF_PINS[uid]; }
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

export function numPad(n) {
  if (APP.pinBuf.length >= 6) return;
  APP.pinBuf.push(n);
  updateDots();
  if (APP.pinBuf.length === 6) setTimeout(submitPin, 150);
}
export function backPin() { APP.pinBuf.pop(); updateDots(); }
export function clearPin() { APP.pinBuf = []; updateDots(); }

function updateDots() {
  for (let i = 0; i < 6; i++) {
    const d = document.getElementById('pd' + i);
    if (d) d.classList.toggle('on', i < APP.pinBuf.length);
  }
}

async function submitPin() {
  const pin = APP.pinBuf.join('');
  const ok = await verifyPIN(APP.pinTarget, pin);
  if (ok) {
    login(APP.pinTarget);
  } else {
    document.getElementById('pin-err').textContent = 'PIN incorrecto, intenta de nuevo';
    const wrap = document.getElementById('pin-dots-wrap');
    wrap.classList.add('shake');
    setTimeout(() => wrap.classList.remove('shake'), 400);
    APP.pinBuf = []; updateDots();
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

export async function savePin() {
  const newPin = gv('cp-new').trim();
  const confirmPin = gv('cp-confirm').trim();
  const adminPin = gv('cp-admin').trim();
  if (!/^\d{6}$/.test(newPin)) { toast('El PIN debe ser de 6 dígitos numéricos', false); return; }
  if (newPin !== confirmPin) { toast('Los PINs no coinciden', false); return; }
  // Cualquier cambio de PIN se confirma con el PIN de admin (Lety)
  const adminOk = await verifyPIN('lety', adminPin);
  if (!adminOk) { toast('PIN de admin incorrecto', false); return; }
  if (!fsOk()) return;
  try {
    await db.collection('pines').doc(APP.changePinUid).set({ pin: newPin });
    toast('✅ PIN actualizado correctamente');
    closeOvl('ocp');
  } catch (e) { console.error(e); toast('Error guardando PIN', false); }
}
