// Login con PIN (= contraseña de la cuenta de Firebase Auth del empleado) +
// cambio del PIN propio.
import { db, auth, fsOk } from './fb.js';
import { APP, USERS, EMPLEADO_EMAIL } from './state.js';
import { scr, toast, gv, openOvl, closeOvl } from './utils.js';
import { clearAllTimers } from './timers.js';
import { initMuestrista } from './muestrista.js';
import { initLety } from './admin.js';

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

function mensajeError(code) {
  switch (code) {
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
    case 'auth/user-not-found':
      return 'PIN incorrecto, intenta de nuevo';
    case 'auth/too-many-requests':
      return 'Demasiados intentos — espera unos minutos e intenta de nuevo';
    case 'auth/user-disabled':
      return 'Esta cuenta está deshabilitada, contacta a Lety';
    case 'auth/network-request-failed':
      return 'Sin conexión — no se pudo verificar el PIN';
    default:
      return 'No se pudo iniciar sesión, intenta de nuevo';
  }
}

function mostrarError(uid, texto) {
  if (APP.pinTarget !== uid) return; // cambió de usuario a media verificación
  document.getElementById('pin-err').textContent = texto;
  const wrap = document.getElementById('pin-dots-wrap');
  wrap.classList.add('shake');
  setTimeout(() => wrap.classList.remove('shake'), 400);
  APP.pinBuf = []; updateDots();
}

async function submitPin() {
  if (checkingPin) return;
  checkingPin = true;
  // Se fija el usuario ANTES del await: si alguien cambia de usuario mientras
  // Firebase responde, el resultado viejo no puede abrir la sesión nueva
  const uid = APP.pinTarget;
  const pin = APP.pinBuf.join('');
  try {
    if (!auth) {
      mostrarError(uid, 'Firebase no está listo, espera un momento');
      return;
    }
    await auth.signInWithEmailAndPassword(EMPLEADO_EMAIL[uid], pin);
    if (APP.pinTarget !== uid) { await auth.signOut().catch(() => {}); return; }
    // Confirma que la cuenta que acaba de iniciar sesión está mapeada al
    // empleado esperado (usuarios/{uid}, solo-lectura — ver firestore.rules).
    // Si no coincide, es un error de configuración (cuenta mal creada), no
    // un PIN incorrecto: se avisa distinto para no confundir al operador.
    const perfil = await db.collection('usuarios').doc(auth.currentUser.uid).get();
    if (!perfil.exists || perfil.data().empleadoId !== uid) {
      console.error('usuarios/{uid} no coincide con el empleado esperado:', uid, perfil.data());
      await auth.signOut().catch(() => {});
      mostrarError(uid, 'Cuenta mal configurada — avisa a Roberto');
      return;
    }
    login(uid, perfil.data().rol);
  } catch (e) {
    console.error('login:', e);
    mostrarError(uid, mensajeError(e.code));
  } finally {
    checkingPin = false;
  }
}

export function login(uid, rol) {
  APP.user = { id: uid, ...USERS[uid] };
  if (rol === 'admin') { initLety(); scr('sL'); }
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
  APP.activeCapFolio = null;
  if (auth) auth.signOut().catch(() => {});
  scr('s0');
}

// ── Cambio de PIN propio ──
// Ya no existe "admin cambia el PIN de otro usuario": Firebase Auth no
// permite cambiar la contraseña de OTRA cuenta desde el cliente sin el
// Admin SDK. Si alguien olvida su PIN, se restablece desde Firebase Console
// (Authentication → usuario → Restablecer contraseña).
export function openChangePinSelf() {
  const u = USERS[APP.user.id];
  document.getElementById('cp-who-label').textContent = 'Cambiando tu PIN: ' + u.ico + ' ' + u.nombre;
  ['cp-old', 'cp-new', 'cp-confirm'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  openOvl('ocp');
}

let savingPin = false;

export async function savePin() {
  if (savingPin) return;
  const oldPin = gv('cp-old').trim();
  const newPin = gv('cp-new').trim();
  const confirmPin = gv('cp-confirm').trim();
  if (!/^\d{6}$/.test(newPin)) { toast('El PIN debe ser de 6 dígitos numéricos', false); return; }
  if (newPin !== confirmPin) { toast('Los PINs no coinciden', false); return; }
  if (!fsOk() || !auth || !auth.currentUser) { toast('Sin sesión activa', false); return; }
  savingPin = true;
  try {
    // Firebase exige una sesión "reciente" para cambiar la contraseña:
    // se reautentica con el PIN actual antes de aplicar el nuevo.
    const cred = firebase.auth.EmailAuthProvider.credential(auth.currentUser.email, oldPin);
    await auth.currentUser.reauthenticateWithCredential(cred);
    await auth.currentUser.updatePassword(newPin);
    toast('✅ PIN actualizado correctamente');
    closeOvl('ocp');
  } catch (e) {
    console.error(e);
    const msg = (e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential')
      ? 'Tu PIN actual no es correcto'
      : 'Error guardando PIN';
    toast(msg, false);
  } finally {
    savingPin = false;
  }
}
