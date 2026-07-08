// Inicialización de Firebase + indicador permanente de conexión
import { toast } from './utils.js';

export const FB_CFG = {
  apiKey: 'AIzaSyCm8Ks6Lpds4LoIn3VZkZjh62VVRsXeHdI',
  authDomain: 'quini-muestristas.firebaseapp.com',
  projectId: 'quini-muestristas',
  storageBucket: 'quini-muestristas.firebasestorage.app',
  messagingSenderId: '912659108385',
  appId: '1:912659108385:web:0be9664baec23499910960',
};

export let db = null;

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
  setInterval(() => { if (navigator.onLine && db) pingFS(true); }, 60000);
}

let pinging = false;
function pingFS(silent) {
  if (!db || pinging) return;
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
    fbSt('🟡 Verificando Firestore…', 'var(--am)');
    setConn('wait', 'Verificando…');
    // Write de prueba: confirma conectividad + reglas (lección aprendida #4)
    db.collection('_ping').doc('test').set({ ts: Date.now() })
      .then(() => { fbSt('🟢 Firebase conectado', 'var(--gn)'); setConn('ok', 'En línea'); })
      .catch(e => {
        if (e.code === 'permission-denied') {
          fbSt('🔴 Las reglas de Firestore rechazan escrituras — despliega firestore.rules o renueva el modo de prueba', 'var(--rd)');
          setConn('bad', 'Reglas Firestore');
        } else {
          fbSt('🔴 Error Firestore: ' + e.code, 'var(--rd)');
          setConn('bad', 'Sin conexión');
        }
        console.error('Firestore test:', e);
      });
    watchConnection();
  } catch (e) {
    fbSt('🔴 Error inicializando Firebase: ' + e.message, 'var(--rd)');
    setConn('bad', 'Error');
    console.error('Firebase init:', e);
  }
}
