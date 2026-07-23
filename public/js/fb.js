// Inicialización de Firebase + indicador permanente de conexión
import { toast } from './utils.js';
import { APP } from './state.js';

export const FB_CFG = {
  apiKey: 'AIzaSyCm8Ks6Lpds4LoIn3VZkZjh62VVRsXeHdI',
  authDomain: 'quini-muestristas.firebaseapp.com',
  projectId: 'quini-muestristas',
  storageBucket: 'quini-muestristas.firebasestorage.app',
  messagingSenderId: '912659108385',
  appId: '1:912659108385:web:0be9664baec23499910960',
};

export let db = null;
export let auth = null;

export function fsOk() {
  if (!db) { toast('Sin conexión a Firebase', false); return false; }
  return true;
}

function fbSt(msg, col) {
  const el = document.getElementById('fb-st');
  if (el) { el.textContent = msg; el.style.color = col; }
}

// ── Indicador permanente de conexión ──
export function setConn(state, txt) {
  const el = document.getElementById('conn');
  if (!el) return;
  el.className = 'conn c-' + state; // ok | bad | wait
  document.getElementById('conn-txt').textContent = txt;
}

function watchConnection() {
  window.addEventListener('online', () => { setConn('wait', 'Reconectando…'); pingFS(); });
  window.addEventListener('offline', () => setConn('bad', 'Sin conexión'));
  // Re-verificar cada 60 s por si la red "dice" online pero Firestore no responde
  setInterval(() => { if (navigator.onLine && db && auth.currentUser) pingFS(true); }, 60000);
}

let pinging = false;
function pingFS(silent) {
  // Las reglas de Firestore exigen sesión: sin usuario autenticado el ping
  // fallaría con permission-denied y ensuciaría el indicador de conexión.
  if (!db || !auth || !auth.currentUser || pinging) return;
  pinging = true;
  db.collection('_ping').doc('test').set({ ts: Date.now() })
    .then(() => setConn('ok', 'En línea'))
    .catch(e => {
      if (e.code === 'permission-denied') {
        setConn('bad', 'Reglas Firestore');
        if (!silent) fbSt('🔴 Reglas de Firestore rechazaron la escritura — revisa firestore.rules en Firebase Console', 'var(--rd)');
      } else {
        setConn('bad', 'Sin conexión');
      }
      console.error('Firestore ping:', e);
    })
    .finally(() => { pinging = false; });
}

// Reintento robusto: el SDK compat se carga por CDN y puede tardar
export function tryInitFB(attempt = 0) {
  if (typeof firebase !== 'undefined' && typeof firebase.initializeApp !== 'undefined') {
    initFB();
  } else if (attempt < 30) {
    fbSt('⏳ Cargando Firebase SDK… (' + (attempt + 1) + '/30)', 'var(--am)');
    setTimeout(() => tryInitFB(attempt + 1), 500);
  } else {
    setConn('bad', 'Sin Firebase');
    const el = document.getElementById('fb-st');
    if (el) el.innerHTML = '🔴 Firebase no cargó — verifica internet <button onclick="location.reload()" style="margin-left:6px;background:var(--s2);border:1px solid var(--b2);border-radius:6px;padding:3px 10px;color:var(--tx);cursor:pointer;font-size:11px;font-family:inherit">🔄 Reintentar</button>';
  }
}

function initFB() {
  try {
    if (!firebase.apps.length) firebase.initializeApp(FB_CFG);
    db = firebase.firestore();
    auth = firebase.auth();
    fbSt('🟢 Firebase listo — inicia sesión', 'var(--gn)');
    setConn('wait', 'Esperando sesión…');
    watchConnection();
    // Las reglas de Firestore exigen autenticación real: no hay nada que
    // verificar (ni el ping de prueba) hasta que el login con PIN complete
    // el signIn de Firebase Auth (ver auth.js).
    // Dispositivo compartido (tableta de piso): si al arrancar ya hay una
    // sesión de Firebase Auth pegada de un uso anterior (crash, recarga a
    // media sesión) pero nadie ha completado el login en esta app todavía
    // (APP.user sigue null, pantalla s0), se cierra esa sesión heredada para
    // que cada arranque parta de cero. Solo aplica al primer disparo de
    // onAuthStateChanged; el signIn legítimo de submitPin() sigue de largo.
    let primerCheckAuth = true;
    auth.onAuthStateChanged(user => {
      if (primerCheckAuth) {
        primerCheckAuth = false;
        if (user && !APP.user) { auth.signOut().catch(() => {}); return; }
      }
      if (user) pingFS();
    });
  } catch (e) {
    fbSt('🔴 Error inicializando Firebase: ' + e.message, 'var(--rd)');
    setConn('bad', 'Error');
    console.error('Firebase init:', e);
  }
}
