// NOVEDADES DE LA APP — la campana de la barra superior: qué se corrigió o se
// agregó, contado para la gente de piso.
//
// Portado de [[app-captura-mecanicos]] (pedido de Roberto, 2026-08-31) con sus
// mismas decisiones, que ya costaron aprenderse allá:
//
// · Vive en el CÓDIGO, no en Firestore, a propósito: una novedad describe la
//   versión que la persona tiene instalada, así que se escribe en el MISMO
//   commit del cambio que anuncia. Además no cuesta lecturas de Firebase, no
//   necesita reglas de seguridad ni pantalla de captura.
//
// · ⚠️ UN ARREGLO QUE SOLO TOCA LAS REGLAS DE FIRESTORE TAMBIÉN VA AQUÍ, y hay
//   que publicar el hosting aunque el código de pantalla no haya cambiado. Si
//   no, desde fuera parece que nada se arregló. En RUNA esto importa el doble:
//   los dos bloqueos de agosto (21 y 27) fueron de reglas, y Lety no tenía
//   forma de ver que ya estaban resueltos.
//
// CÓMO AGREGAR UNA (en el commit del cambio, no después):
//   1. Va ARRIBA del todo: el array corre de la más nueva a la más vieja.
//   2. El `id` es 'YYYY-MM-DD-NN', con NN de DOS dígitos. Nunca se reusa ni se
//      reescribe un id ya publicado: es la marca de "hasta aquí ya leí" de cada
//      tablet. Con dos dígitos porque se comparan como TEXTO y '9' saldría
//      mayor que '10'.
//   3. Escríbelo para un muestrista, no para un programador: qué cambió en SU
//      pantalla y qué tiene que hacer distinto. Nada de nombres de archivos,
//      colecciones ni palabras técnicas.
//
// `tipo`: 'nuevo' (algo que antes no existía) · 'corregido' (algo que estaba
// mal y ya no) · 'mejorado' (ya existía y ahora funciona mejor).
import { APP } from './state.js';
import { es } from './utils.js';

export const TIPO_NOVEDAD = {
  nuevo: { etiqueta: 'Nuevo', color: 'var(--gn-full)' },
  corregido: { etiqueta: 'Corregido', color: 'var(--am-full)' },
  mejorado: { etiqueta: 'Mejorado', color: 'var(--pu)' },
};

// Al entrar por primera vez en una tablet no se marcan como nuevas TODAS las
// entradas históricas (sería un globo con 30 que nadie lee, y eso enseña a
// ignorar el globo): solo las de los últimos días.
export const DIAS_NOVEDAD_INICIAL = 30;

export const NOVEDADES = [
  {
    id: '2026-08-31-03',
    fecha: '2026-08-31',
    tipo: 'mejorado',
    titulo: 'Refuerzo de seguridad',
    detalle: 'Reforzamos por dentro los candados que protegen la información: quién puede '
      + 'ver y cambiar cada ficha. No cambia nada de lo que ves ni de cómo trabajas; es una '
      + 'mejora interna para que los datos estén más protegidos.',
  },
  {
    id: '2026-08-31-02',
    fecha: '2026-08-31',
    tipo: 'nuevo',
    titulo: 'Esta campana',
    detalle: 'Aquí van a salir los cambios de la app: lo que se arregló y lo que se agregó. '
      + 'El globito rojo dice cuántos no has visto. Abajo del título viene la versión que '
      + 'tiene ESTE aparato: si no coincide con la del último aviso, cierra la app y ábrela '
      + 'otra vez para que se actualice.',
  },
  {
    id: '2026-08-31-01',
    fecha: '2026-08-31',
    tipo: 'nuevo',
    titulo: 'Agujado 168',
    detalle: 'Ya aparece 168 en la lista de agujado, tanto al asignar la tarea como en la '
      + 'ficha práctica. Antes no estaba y la máquina de 168 no se podía capturar.',
  },
  {
    id: '2026-08-27-01',
    fecha: '2026-08-27',
    tipo: 'corregido',
    titulo: 'Ya se pueden iniciar y terminar las fichas',
    detalle: 'Del 21 al 27 de agosto la app rechazaba TODAS las fichas con el aviso '
      + '"Firestore no aceptó la ficha". No era su teléfono ni fue por picarle: era un '
      + 'error nuestro. Ya quedó, y las tareas que se quedaron atoradas se cerraron para '
      + 'empezar limpio — ese tiempo no cuenta en sus números.',
  },
  {
    id: '2026-08-20-02',
    fecha: '2026-08-20',
    tipo: 'nuevo',
    titulo: 'La pausa se pide, Lety la autoriza',
    detalle: 'Ya no existe el botón de pausar. Ahora toca "Pedir pausa", elige el motivo, y '
      + 'a Lety le llega para autorizarla. Mientras ella contesta el reloj sigue corriendo, '
      + 'así que conviene avisarle en cuanto la pidas.',
  },
  {
    id: '2026-08-20-01',
    fecha: '2026-08-20',
    tipo: 'nuevo',
    titulo: 'La ficha se guarda sola',
    detalle: 'Ya no hace falta acordarse de guardar: mientras escribes, la ficha se va '
      + 'guardando sola, y arriba dice a qué hora se guardó por última vez. Si te sales y '
      + 'vuelves a entrar, ahí está todo lo que llevabas.',
  },
  {
    id: '2026-08-19-01',
    fecha: '2026-08-19',
    tipo: 'nuevo',
    titulo: 'Punto de máquina por alimentador',
    detalle: 'El punto de máquina ya se captura en diez renglones, uno por alimentador '
      + '(DEN-1 al DEN-10), en vez de un solo dato. Deja en blanco los que no uses.',
  },
];

// ── Marca de "hasta aquí ya leí", por USUARIO ──
// En piso varias personas comparten la misma tablet: la marca de uno no puede
// apagarle el aviso al siguiente.
const PREFIJO = 'qu_nov_';
const clave = () => PREFIJO + (APP.user ? APP.user.id : 'anon');

// localStorage puede estar bloqueado (modo privado, política de la tablet).
// Nunca debe tumbar la barra superior: si falla, se trabaja como si no hubiera
// nada guardado y el globo reaparecerá en la próxima carga.
function leerVisto() {
  try { return localStorage.getItem(clave()); } catch (e) { return null; }
}
function guardarVisto(v) {
  try { localStorage.setItem(clave(), v); } catch (e) { /* sin persistencia */ }
}

// Se calcula como el máximo REAL, no NOVEDADES[0]: el orden del array es una
// convención documentada, nada la obliga. Si un día alguien agrega una entrada
// al final por error, tomar la primera posición guardaría como "visto" un id
// que no es el mayor y el globo se quedaría pegado sin explicación.
const ID_MAS_NUEVO = NOVEDADES.reduce((max, n) => (n.id > max ? n.id : max), '');

function idInicial() {
  const c = new Date();
  c.setDate(c.getDate() - DIAS_NOVEDAD_INICIAL);
  return c.getFullYear() + '-' + String(c.getMonth() + 1).padStart(2, '0') + '-'
    + String(c.getDate()).padStart(2, '0') + '-00';
}

function fechaLegible(iso) {
  // 'YYYY-MM-DD' se parsea como UTC y en México cae un día antes: se arma con
  // sus partes (regla dura del proyecto).
  const [a, m, d] = String(iso || '').split('-').map(Number);
  if (!a || !m || !d) return iso || '';
  return new Date(a, m - 1, d).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
}

// La versión que tiene ESTE aparato. Se lee del nombre del caché que dejó el
// service worker, así que es la verdad de lo que la tablet tiene instalado —
// no una constante que se nos olvide subir.
async function versionInstalada() {
  try {
    const ks = await caches.keys();
    const k = ks.find(x => x.startsWith('quini-muestristas-v'));
    return k ? k.replace('quini-muestristas-', '') : null;
  } catch (e) { return null; }
}

function sinLeer() {
  const visto = leerVisto() || idInicial();
  return NOVEDADES.filter(n => n.id > visto).length;
}

// Pinta el globito rojo en las campanas de las dos pantallas
export function refrescaCampana() {
  const n = sinLeer();
  ['nov-badge-m', 'nov-badge-l'].forEach(id => {
    const b = document.getElementById(id);
    if (!b) return;
    b.textContent = n > 9 ? '9+' : String(n);
    b.style.display = n > 0 ? '' : 'none';
  });
  ['nov-btn-m', 'nov-btn-l'].forEach(id => {
    const b = document.getElementById(id);
    if (b) b.setAttribute('aria-label', n ? 'Novedades: ' + n + ' sin leer' : 'Novedades');
  });
}

let devolverFoco = null;

export async function abrirNovedades(botonId) {
  const cont = document.getElementById('nov-lista');
  if (!cont) return;
  devolverFoco = botonId ? document.getElementById(botonId) : null;

  const v = await versionInstalada();
  const ver = document.getElementById('nov-version');
  if (ver) {
    ver.innerHTML = v
      ? 'Versión de este aparato: <strong>' + es(v) + '</strong>'
      : 'No se pudo leer la versión de este aparato';
  }

  cont.innerHTML = NOVEDADES.map(n => {
    const t = TIPO_NOVEDAD[n.tipo] || TIPO_NOVEDAD.mejorado;
    return '<div class="nov">'
      + '<div class="nov-cab">'
      + '<span class="nov-tipo" style="background:' + t.color + '">' + es(t.etiqueta) + '</span>'
      + '<span class="nov-fecha">' + es(fechaLegible(n.fecha)) + '</span>'
      + '</div>'
      + '<div class="nov-tit">' + es(n.titulo) + '</div>'
      + '<div class="nov-det">' + es(n.detalle) + '</div>'
      + '</div>';
  }).join('');

  // Se marca como leído AL ABRIR (igual que en mecánicos): si se marcara al
  // cerrar, salir con el botón de atrás dejaría el globo pegado.
  const visto = leerVisto() || idInicial();
  if (ID_MAS_NUEVO && ID_MAS_NUEVO > visto) guardarVisto(ID_MAS_NUEVO);

  document.getElementById('onov').classList.add('on');
  setTimeout(() => { const c = document.getElementById('nov-cerrar'); if (c) c.focus(); }, 60);
  refrescaCampana();
}

export function cerrarNovedades() {
  document.getElementById('onov').classList.remove('on');
  if (devolverFoco) { try { devolverFoco.focus(); } catch (e) {} }
  devolverFoco = null;
}

// Escape cierra, como el resto de los modales
window.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const o = document.getElementById('onov');
  if (o && o.classList.contains('on')) cerrarNovedades();
});

// Aviso en desarrollo si el archivo se desordena o hay ids repetidos o mal
// formados. Barato, y evita que el globo se quede pegado sin explicación.
const FORMATO_ID = /^\d{4}-\d{2}-\d{2}-\d{2}$/;
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
  const vistos = new Set();
  NOVEDADES.forEach((n, i) => {
    if (!FORMATO_ID.test(n.id)) console.error('Novedades: el id "' + n.id + '" no es YYYY-MM-DD-NN (NN de DOS dígitos)');
    if (vistos.has(n.id)) console.error('Novedades: id repetido "' + n.id + '"');
    vistos.add(n.id);
    if (i > 0 && n.id > NOVEDADES[i - 1].id) console.error('Novedades: desordenado, "' + n.id + '" debería ir antes que "' + NOVEDADES[i - 1].id + '"');
  });
}
