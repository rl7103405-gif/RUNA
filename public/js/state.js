// Estado global y catálogos del sistema

// `rol` aquí es el de la INTERFAZ ('lety' = pantalla de administración,
// 'muestrista' = pantalla de captura). El rol de PERMISOS vive en
// usuarios/{uid}.rol ('admin' | 'muestrista' | 'ceo') y lo leen las reglas.
// `demo: true` = cuenta de prueba: escribe solo en documentos marcados demo y
// ve solo ese ambiente en las listas (2026-08-20).
export const USERS = {
  lety:    { nombre: 'Lety',    rol: 'lety',       ico: '👩‍💼' },
  israel:  { nombre: 'Israel',  rol: 'muestrista', ico: '👨‍🔧' },
  jesus:   { nombre: 'Jesús',   rol: 'muestrista', ico: '👨‍🔧' },
  roberto: { nombre: 'Roberto', rol: 'lety',       ico: '🧑‍💻' },
  // El papá de Roberto: misma pantalla que Lety, pero solo mira (las reglas
  // no le dejan escribir nada; la app además le esconde los botones)
  ceo:     { nombre: 'Dirección', rol: 'lety',     ico: '👔' },
  demo_lety:       { nombre: 'Demo · admin',      rol: 'lety',       ico: '🧪', demo: true },
  demo_muestrista: { nombre: 'Demo · muestrista', rol: 'muestrista', ico: '🧪', demo: true },
};

// Quiénes pueden recibir tareas en cada ambiente: el muestrista de prueba solo
// recibe tareas de prueba (lo exigen también las reglas).
export function muestristasDe(demo) {
  return demo ? ['demo_muestrista'] : ['israel', 'jesus'];
}

// ¿Este documento es de MI ambiente? Los docs viejos no traen el campo: son
// reales. (Mismo default que las reglas: get('demo', false).)
export function esDeMiAmbiente(d) {
  return ((d && d.demo === true) === (APP.user && APP.user.demo === true));
}

// Consultas del admin: la cuenta de prueba solo puede leer docs demo (las
// reglas no filtran: la consulta DEBE traer el where o se rechaza entera); el
// admin real lee todo y filtra en pantalla con esDeMiAmbiente().
export function enAmbiente(q) {
  return APP.user && APP.user.demo ? q.where('demo', '==', true) : q;
}

// El login sigue siendo "elige tu ícono + tu PIN de 6 dígitos", pero el PIN
// ahora ES la contraseña de la cuenta de Firebase Auth de ese empleado (ver
// auth.js). El correo es solo un identificador interno, nunca se envía nada.
export const EMPLEADO_EMAIL = {
  lety: 'lety@quini-muestristas.local',
  israel: 'israel@quini-muestristas.local',
  jesus: 'jesus@quini-muestristas.local',
  roberto: 'roberto@quini-muestristas.local',
  ceo: 'ceo@quini-muestristas.local',
  demo_lety: 'demo_lety@quini-muestristas.local',
  demo_muestrista: 'demo_muestrista@quini-muestristas.local',
};

// ext: causa externa (no es responsabilidad del muestrista)
// pen: causa que SÍ penaliza — su tiempo cuenta dentro del TEN (spec:
// "Tiempo personal excesivo | interno (sí afecta)")
export const TM_CAUSES = [
  { id: 'maquina',  label: '⚙️ Espera de máquina (producción)', ext: true,  pen: false },
  { id: 'color',    label: '🎨 Espera aprobación de color',     ext: true,  pen: false },
  { id: 'material', label: '🧵 Espera de material / hilo',      ext: true,  pen: false },
  { id: 'lety',     label: '👁 Espera revisión Lety / BMP',     ext: true,  pen: false },
  { id: 'cliente',  label: '✅ Espera aprobación cliente',      ext: true,  pen: false },
  { id: 'falla',    label: '🔧 Falla / mantenimiento máquina',  ext: true,  pen: false },
  { id: 'descanso', label: '☕ Descanso personal estándar',     ext: false, pen: false },
  { id: 'personal', label: '🚶 Tiempo personal excesivo',       ext: false, pen: true },
];

// Estados de captura que cuentan como "abiertas" para el muestrista
export const OPEN_STATES = ['activo', 'pausado', 'correccion'];
// Estados que ya pasaron por firma (cerradas para edición del muestrista)
export const DONE_STATES = ['pendiente_lety', 'aprobado'];

export const APP = {
  user: null,
  sesion: 0,          // sube en cada login: una lectura que llega tarde de otra sesión no pinta
  soloLectura: false, // CEO: pantalla de Lety sin ningún botón de escritura
  pinBuf: [],
  pinTarget: null,
  vars: [],
  vp0: '',           // pares de la variante 1 (el código de arriba) en modo pack
  vp0Cod: '',        // a qué código pertenecen esos pares
  cqExcl: false,     // Lety marcó que el código de arriba NO es una variante
  asignMode: 'single',
  activeCap: null,
  activeCapFolio: null,
  activeCapDoc: null, // copia de la ficha abierta (para avisos sin re-pintar)
  capDirty: false,
  sigData: null,
  revCap: null,
  revFolio: null,
  tareaId: null,      // tarea que Lety tiene abierta en el detalle
  tareaDoc: null,
  tareaFichas: {},
  revFicha: null,
  pausas: {},        // capId -> pausa viva (vista del muestrista)
  unsubPausas: [],   // listeners de esas pausas
  pausasPend: [],    // solicitudes por autorizar (vista de Lety)
  pausasVistas: {},  // rechazos ya avisados, para no repetir el toast    // ficha técnica de la ficha que Lety tiene abierta
  tmTarget: null,
  tmaCapId: null,
  changePinUid: null,
  listeners: [],
  activasSnap: [],
  allCaps: [],    // TODAS las capturas del muestrista (cualquier estado)
  tareasSnap: [], // desarrollos asignados vigentes
  dbDocs: [],     // últimos docs cargados en el dashboard (para CSV)
};
