// Estado global y catálogos del sistema

export const USERS = {
  lety:   { nombre: 'Lety',   rol: 'lety',       ico: '👩‍💼' },
  israel: { nombre: 'Israel', rol: 'muestrista', ico: '👨‍🔧' },
  jesus:  { nombre: 'Jesús',  rol: 'muestrista', ico: '👨‍🔧' },
};

export const DEF_PINS = { lety: '123456', israel: '000001', jesus: '000002' };

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
  tmTarget: null,
  tmaCapId: null,
  changePinUid: null,
  listeners: [],
  activasSnap: [],
  allCaps: [],    // TODAS las capturas del muestrista (cualquier estado)
  tareasSnap: [], // desarrollos asignados vigentes
  dbDocs: [],     // últimos docs cargados en el dashboard (para CSV)
};
