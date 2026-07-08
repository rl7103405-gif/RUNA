// Estado global y catálogos del sistema

export const USERS = {
  lety:   { nombre: 'Lety',   rol: 'lety',       ico: '👩‍💼' },
  israel: { nombre: 'Israel', rol: 'muestrista', ico: '👨‍🔧' },
  jesus:  { nombre: 'Jesús',  rol: 'muestrista', ico: '👨‍🔧' },
};

export const DEF_PINS = { lety: '123456', israel: '000001', jesus: '000002' };

export const TM_CAUSES = [
  { id: 'maquina',  label: '⚙️ Espera de máquina (producción)', ext: true },
  { id: 'color',    label: '🎨 Espera aprobación de color',     ext: true },
  { id: 'material', label: '🧵 Espera de material / hilo',      ext: true },
  { id: 'lety',     label: '👁 Espera revisión Lety / BMP',     ext: true },
  { id: 'cliente',  label: '✅ Espera aprobación cliente',      ext: true },
  { id: 'falla',    label: '🔧 Falla / mantenimiento máquina',  ext: true },
  { id: 'descanso', label: '☕ Descanso personal estándar',     ext: false },
  { id: 'personal', label: '🚶 Tiempo personal excesivo',       ext: false },
];

// Estados de captura que cuentan como "abiertas" para el muestrista
export const OPEN_STATES = ['activo', 'pausado', 'correccion'];

export const APP = {
  user: null,
  pinBuf: [],
  pinTarget: null,
  vars: [],
  asignMode: 'single',
  activeCap: null,
  capDirty: false,
  sigData: null,
  revCap: null,
  tmTarget: null,
  tmaCapId: null,
  changePinUid: null,
  listeners: [],
  activasSnap: [],
  dbDocs: [], // últimos docs cargados en el dashboard (para CSV)
};
