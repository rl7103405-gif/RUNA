// Estado global y catálogos del sistema

export const USERS = {
  lety:   { nombre: 'Lety',   rol: 'lety',       ico: '👩‍💼' },
  israel: { nombre: 'Israel', rol: 'muestrista', ico: '👨‍🔧' },
  jesus:  { nombre: 'Jesús',  rol: 'muestrista', ico: '👨‍🔧' },
};

// El login sigue siendo "elige tu ícono + tu PIN de 6 dígitos", pero el PIN
// ahora ES la contraseña de la cuenta de Firebase Auth de ese empleado (ver
// auth.js). El correo es solo un identificador interno, nunca se envía nada.
export const EMPLEADO_EMAIL = {
  lety: 'lety@quini-muestristas.local',
  israel: 'israel@quini-muestristas.local',
  jesus: 'jesus@quini-muestristas.local',
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
  pinBuf: [],
  pinTarget: null,
  vars: [],
  asignMode: 'single',
  activeCap: null,
  activeCapFolio: null,
  capDirty: false,
  sigData: null,
  revCap: null,
  revFolio: null,
  tareaId: null,      // tarea que Lety tiene abierta en el detalle
  tareaDoc: null,
  tareaFichas: {},
  revFicha: null,    // ficha técnica de la ficha que Lety tiene abierta
  tmTarget: null,
  tmaCapId: null,
  changePinUid: null,
  listeners: [],
  activasSnap: [],
  allCaps: [],    // TODAS las capturas del muestrista (cualquier estado)
  tareasSnap: [], // desarrollos asignados vigentes
  dbDocs: [],     // últimos docs cargados en el dashboard (para CSV)
};
