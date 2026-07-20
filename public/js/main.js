// Punto de entrada: expone handlers a los onclick del HTML estático,
// cablea la delegación de eventos y arranca Firebase + service worker
import { tryInitFB } from './fb.js';
import { scr, closeOvl } from './utils.js';
import { selectUser, numPad, backPin, clearPin, logout, openChangePin, openChangePinSelf, savePin } from './auth.js';
import { mTab, loadMHist, openTMFor, endTMA, wireMuestristaEvents } from './muestrista.js';
import { togCapTimer, backCaptura, saveDraft, saveAndSign, wireCapturaEvents } from './captura.js';
import { clearSig, saveSig, backFirma } from './firma.js';
import { ltTab, setMode, addVar, asignar, aprobar, rechazar, reabrirFicha, backRev, wireAdminEvents } from './admin.js';
import { loadDB, exportCSV } from './dashboard.js';

// El HTML estático usa onclick="..."; los módulos no son globales, así que
// exponemos explícitamente lo que el markup necesita.
Object.assign(window, {
  scr, closeOvl,
  selectUser, numPad, backPin, clearPin, logout,
  openChangePin, openChangePinSelf, savePin,
  mTab, loadMHist, openTMFor, endTMA,
  togCapTimer, backCaptura, saveDraft, saveAndSign,
  clearSig, saveSig, backFirma,
  ltTab, setMode, addVar, asignar, aprobar, rechazar, reabrirFicha, backRev,
  loadDB, exportCSV,
});

window.addEventListener('DOMContentLoaded', () => {
  setMode('single');
  wireMuestristaEvents();
  wireAdminEvents();
  wireCapturaEvents();
  // Cerrar modales al tocar el fondo (excepto el de confirmación)
  ['otm', 'otma', 'ocp'].forEach(id => {
    const ovl = document.getElementById(id);
    ovl.addEventListener('click', e => { if (e.target === ovl) closeOvl(id); });
  });
  tryInitFB(0);
});

// PWA: registrar service worker (la interfaz carga offline; los datos
// siguen necesitando red)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW no registrado:', e));
  });
}
