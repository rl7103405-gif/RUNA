// Login con PIN (= contraseña de la cuenta de Firebase Auth del empleado) +
// cambio del PIN propio.
import { db, auth, fsOk, pingFS } from './fb.js';
import { APP, USERS, EMPLEADO_EMAIL } from './state.js';
import { scr, toast, gv, openOvl, closeOvl } from './utils.js';
import { clearAllTimers } from './timers.js';
import { initMuestrista } from './muestrista.js';
import { initLety, setBadgePendientes, invalidarLookups, limpiarCacheAdmin, resetAsignar } from './admin.js';
import { refrescaCampana } from './novedades.js';

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
      // Se muestra el UID: sin él, quien tiene que arreglarlo no sabe QUÉ
      // documento crear en la consola de Firebase, y el aviso es inútil.
      const authUid = auth.currentUser.uid;
      console.error(
        'Falta el perfil de este usuario. Crea el documento usuarios/' + authUid +
        ' con { empleadoId: "' + uid + '", rol: "' + (uid === 'lety' ? 'admin' : 'muestrista') + '", activo: true }.',
        'Perfil encontrado:', perfil.exists ? perfil.data() : '(no existe)');
      await auth.signOut().catch(() => {});
      mostrarError(uid, 'Falta registrar esta cuenta. Avísale a Roberto: usuarios/' + authUid);
      return;
    }
    // Baja de personal: `activo: false` en el perfil. Las reglas de Firestore
    // son la autoridad y ya le niegan todo; este corte es para que no entre a
    // una app vacía llena de errores de permisos sin entender por qué.
    // Campo ausente = perfil creado antes de que existiera el campo = activo
    // (mismo default que firestore.rules). Cualquier otro valor que no sea
    // exactamente `true` (string "false", 0, null...) se trata como inactivo:
    // las reglas exigen `is bool && == true`, así que un valor mal tipado ya
    // es rechazado por el servidor y aquí debe coincidir el mismo criterio.
    const activo = perfil.data().activo;
    if (activo !== undefined && activo !== true) {
      await auth.signOut().catch(() => {});
      mostrarError(uid, 'Tu cuenta está desactivada — avisa a Roberto');
      return;
    }
    // El ambiente (demo o real) lo dice el PERFIL, no el botón que se tocó:
    // si alguien crea una cuenta demo sin el flag, entra como real y las
    // reglas la tratan como real. Se avisa si el botón y el perfil no cuadran.
    const esDemoPerfil = perfil.data().demo === true;
    if (esDemoPerfil !== (USERS[uid].demo === true)) {
      console.error('El perfil usuarios/' + auth.currentUser.uid + ' tiene demo=' + esDemoPerfil + ' pero la app esperaba ' + (USERS[uid].demo === true) + ' para ' + uid);
      await auth.signOut().catch(() => {});
      mostrarError(uid, 'Esta cuenta está mal configurada (ambiente). Avísale a Roberto');
      return;
    }
    login(uid, perfil.data().rol, perfil.data());
  } catch (e) {
    console.error('login:', e);
    mostrarError(uid, mensajeError(e.code));
  } finally {
    checkingPin = false;
  }
}

export function login(uid, rol, perfil) {
  APP.sesion = (APP.sesion || 0) + 1;
  APP.user = { id: uid, ...USERS[uid], demo: !!(perfil && perfil.demo === true) };
  // El CEO usa la pantalla de Lety en modo solo lectura: las reglas ya le
  // niegan toda escritura; esto solo le quita de enfrente los botones.
  APP.soloLectura = rol === 'ceo';
  if (rol === 'admin' || rol === 'ceo') { initLety(); scr('sL'); }
  else { initMuestrista(); scr('sM'); }
  pingFS(); // el indicador de conexión arranca ya sabiendo el modo (lectura o escritura)
  refrescaCampana(); // la marca de leído es de ESTA persona, no de la anterior
  // Vigila el propio perfil para cortar la sesión en vivo si Lety desactiva
  // esta cuenta mientras la tablet ya está abierta (si no, sigue con la UI y
  // los timers corriendo hasta que falle un guardado sin explicación). Se
  // registra DESPUÉS de initLety()/initMuestrista() porque esas funciones
  // vacían APP.listeners al arrancar (muestrista.js:21-22, admin.js:21-22);
  // si se registrara antes, quedaría borrado de inmediato.
  APP.listeners.push(db.collection('usuarios').doc(auth.currentUser.uid)
    .onSnapshot(s => {
      const a = s.data()?.activo;
      if (a !== undefined && a !== true) { toast('Tu cuenta fue desactivada', false); logout(); }
    }, e => console.error('perfil:', e)));
}

export function logout() {
  clearAllTimers();
  APP.listeners.forEach(u => { try { u(); } catch (e) {} });
  APP.listeners = [];
  // Los de pausas viven aparte: uno por ficha abierta, se recrean al entrar
  (APP.unsubPausas || []).forEach(u => { try { u(); } catch (e) {} });
  APP.unsubPausas = [];
  APP.pausas = {};
  APP.pausasVistas = {};
  APP.pausasPend = [];
  APP.user = null;
  APP.soloLectura = false;
  limpiarCacheAdmin();
  refrescaCampana();
  resetAsignar(); // lo escrito sin enviar no le aparece a la siguiente cuenta
  // "Otros accesos" vuelve a plegarse: la pantalla de la tablet es la de siempre
  const ot = document.getElementById('otros-toggle'); if (ot) ot.style.display = '';
  const oa = document.getElementById('otros-accesos'); if (oa) oa.style.display = 'none';
  APP.vars = [];
  APP.vp0 = ''; APP.vp0Cod = ''; APP.cqExcl = false;
  APP.activeCapDoc = null;
  invalidarLookups(); // un autollenado en vuelo no debe rellenar el formulario de la siguiente sesión
  APP.activasSnap = [];
  APP.allCaps = [];
  APP.tareasSnap = [];
  APP.dbDocs = [];
  APP.activeCap = null;
  APP.activeCapFolio = null;
  APP.revCap = null; APP.revFolio = null; APP.revFicha = null;
  APP.tareaId = null; APP.tareaDoc = null; APP.tareaFichas = {};
  APP.sesion = (APP.sesion || 0) + 1; // lo que esté en vuelo ya no pinta
  // Tablet compartida: que la siguiente sesión no vea lo que pintó la anterior
  // (otra persona, otro ambiente) ni un segundo
  [['pend-list', '⏳', 'Cargando pendientes…'], ['proc-list', '⏱', 'Sin capturas activas'],
   ['tk-list', '⏳', 'Cargando tareas…'], ['db-list', '', ''], ['db-cmp', '', ''],
   ['pausas-list', '', ''], ['tk-body', '', ''], ['rbody', '', ''], ['cbody', '', '']].forEach(([id, ico, txt]) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = txt ? '<div class="empty"><div class="ico">' + ico + '</div><p>' + txt + '</p></div>' : '';
  });
  ['db0', 'db1', 'db2', 'db3'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '—'; });
  const pw = document.getElementById('pausas-wrap'); if (pw) pw.style.display = 'none';
  setBadgePendientes(0); // que no quede el conteo viejo al reingresar
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
