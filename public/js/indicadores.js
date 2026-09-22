// Indicadores de las muestristas: qué tanto se puede creer el cronómetro y
// cómo va cada quien. Funciones puras (sin pantalla ni Firebase) para poder
// probarlas contra los datos reales fuera del navegador.
//
// Por qué no hay puntos ni podio todavía (2026-09-22): Roberto pidió un
// ranking con puntos al estilo de Captura Mecánicos. Medido con este mismo
// criterio sobre las 61 fichas firmadas del 7 al 21 de septiembre: solo 4 se
// pueden medir; 42 duran MENOS que el propio tejido (la ficha se abre al final
// solo para capturar), 12 traen más de 12 h de reloj (nadie pide pausa y el
// reloj no se detiene solo fuera del turno) y 3 no traen pares o ciclo para
// juzgarlas. Con eso, cualquier
// índice separaría a Israel de Jesús únicamente por cuántas tareas les asigna
// Lety. ChatGPT y la revisión interna coincidieron: publicar el diagnóstico,
// y el ranking cuando los datos lo sostengan. La compuerta de abajo dice qué
// falta; los puntos se calibrarán con datos limpios, no antes.
import { tenFromDoc } from './utils.js';

// Los indicadores cuentan desde aquí. Lo anterior fue arranque y pruebas:
// NO se borra (sigue en el historial y en la exportación), solo no promedia.
// Lunes 7 de septiembre de 2026, hora local de la tablet.
export const INICIO_INDICADORES = new Date(2026, 8, 7, 0, 0, 0, 0);

// Una ficha de más de 12 h de reloj corrido casi siempre es una noche
// completa. Si el propio tejido estimado es largo, el techo crece con él:
// nunca puede quedar un caso en que ningún tiempo pase las dos pruebas.
const TECHO_MIN = 12 * 60;

// Compuerta del ranking: mínimos operativos, no una verdad estadística.
export const COMPUERTA = { fraccionSinAnomalias: 0.6, minimoPorPersona: 5 };

const FIRMADAS = ['aprobado', 'pendiente_lety'];

const numero = v => {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const tieneValor = v => v !== null && v !== undefined && String(v).trim() !== '';
const ms = ts => (ts && ts.toMillis ? ts.toMillis() : (ts instanceof Date ? ts.getTime() : null));

// ── ¿Se puede creer el tiempo de esta ficha? ──────────────────────────────
// Tres respuestas, a propósito ninguna dice "confiable":
//   sin_anomalias — pasó las pruebas; no prueba que el tiempo sea exacto
//   sospechoso    — con uno o más motivos
//   no_evaluable  — faltan datos para juzgarla
export function evaluarTiempo(c) {
  const d = c || {};
  const invalido = { estado: 'no_evaluable', motivos: ['datos_invalidos'], tenMin: null, tejidoMin: null };
  const el = d.elapsed_seg, tm = d.tm_seg === undefined ? 0 : d.tm_seg;
  const tc = d.tm_causas && typeof d.tm_causas === 'object' ? d.tm_causas : {};
  const causas = Object.values(tc);
  if (!Number.isFinite(el) || el < 0 || !Number.isFinite(tm) || tm < 0 || tm > el
    || causas.some(v => typeof v !== 'number' || !Number.isFinite(v) || v < 0)) return invalido;
  // El desglose por causa no puede sumar más que el tiempo muerto total (con
  // 5 s de holgura por redondeo). Si no, una causa inflada "regala" TEN que
  // nunca corrió en el reloj. Ninguna ficha real lo viola (medido 2026-09-22).
  if (causas.reduce((a, v) => a + v, 0) > tm + 5) return invalido;

  const tenSeg = tenFromDoc(d);
  if (!Number.isFinite(tenSeg) || tenSeg > el) return invalido;
  const tenMin = tenSeg / 60;
  const pares = numero(d.pares);
  const cMin = numero(d.t_ciclo_min), cSeg = numero(d.t_ciclo_seg);
  if ((cMin !== null && cMin < 0) || (cSeg !== null && cSeg < 0)) return invalido;
  const ciclo = (cMin || 0) + (cSeg || 0) / 60;
  if (!(pares > 0) || !(ciclo > 0)) {
    return { estado: 'no_evaluable', motivos: ['sin_pares_o_ciclo'], tenMin, tejidoMin: null };
  }
  // Tejido estimado: dos calcetines por par, uno tras otro, al tiempo de
  // ciclo capturado. Es un piso: nadie teje más rápido que su máquina.
  const tejidoMin = pares * 2 * ciclo;
  const motivos = [];
  if (tenMin < tejidoMin) motivos.push('menor_que_tejido');
  if (tenMin > Math.max(TECHO_MIN, 2 * tejidoMin)) motivos.push('duracion_alta');
  return { estado: motivos.length ? 'sospechoso' : 'sin_anomalias', motivos, tenMin, tejidoMin };
}

// ── Campos llenos ─────────────────────────────────────────────────────────
// Cuántos de los datos de la ficha práctica vienen capturados. Es "llenos",
// no "correctos": un 0 cuenta como dato, y todavía no se sabe qué campos no
// aplican a ciertos productos [POR CONFIRMAR con Lety].
export function camposLlenos(c) {
  const d = c || {};
  const sh = d.med_sh || {}, h = d.med_h || {}, g = d.giros || {}, v = d.vels || {};
  const items = [
    d.maquina_marca, d.maquina_numero, d.agujado,
    ...['A', 'B', 'C', 'D', 'E'].map(k => sh[k]),
    ...['A', 'B', 'C', 'D', 'E'].map(k => h[k]),
    (numero(d.t_ciclo_min) || numero(d.t_ciclo_seg)) ? 'ok' : '',
    d.peso_sal, d.peso_cer,
    g.el, g.tb, g.pl, g.rb,
    v.el, v.tb, v.tp, v.pl,
    // Array.isArray: un dato viejo o mal tipado no debe tumbar el dashboard
    (Array.isArray(d.pto_tabla) ? d.pto_tabla : []).some(f => f && (tieneValor(f.d1) || tieneValor(f.d2) || tieneValor(f.sk))) ? 'ok' : '',
    d.pares,
  ];
  return items.filter(tieneValor).length / items.length;
}

const mediana = a => {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// ── ¿Entra esta ficha a los indicadores? ──────────────────────────────────
// Firmada, terminada desde el corte y dentro del periodo elegido.
export function entraAIndicadores(c, desde, hasta) {
  if (!c || !FIRMADAS.includes(c.estado)) return false;
  const fin = ms(c.dt_fin);
  if (fin === null) return false;
  const ini = Math.max(INICIO_INDICADORES.getTime(), desde || 0);
  return fin >= ini && fin <= (hasta || Infinity);
}

// ── Resumen del periodo ───────────────────────────────────────────────────
// `fichas`: capturas del ambiente (datos planos). `quienes`: ids de las
// muestristas a mostrar. Devuelve el diagnóstico del cronómetro, una fila
// por persona y el estado de la compuerta del ranking.
export function resumir(fichas, quienes, desde, hasta) {
  const lista = quienes || [];
  // Solo las personas pedidas: con el filtro en una muestrista, el
  // diagnóstico es el suyo, no el del grupo.
  const del = (fichas || []).filter(c => lista.includes(c.id_muestrista) && entraAIndicadores(c, desde, hasta))
    .map(c => ({ c, t: evaluarTiempo(c), llenos: camposLlenos(c) }));

  const cuenta = xs => {
    const r = { total: xs.length, sin_anomalias: 0, menor_que_tejido: 0, duracion_alta: 0, no_evaluable: 0 };
    xs.forEach(({ t }) => {
      if (t.estado === 'sin_anomalias') r.sin_anomalias++;
      else if (t.estado === 'no_evaluable') r.no_evaluable++;
      else {
        // Una ficha con los dos motivos cuenta en el primero: la barra suma
        // exactamente el total, sin fichas repetidas.
        if (t.motivos.includes('menor_que_tejido')) r.menor_que_tejido++;
        else r.duracion_alta++;
      }
    });
    return r;
  };

  const personas = lista.map(uid => {
    const suyas = del.filter(x => x.c.id_muestrista === uid);
    const aprob = suyas.filter(x => x.c.estado === 'aprobado');
    const buenos = suyas.filter(x => x.t.estado === 'sin_anomalias').map(x => x.t.tenMin);
    return {
      uid,
      firmadas: suyas.length,
      aprobadas: aprob.length,
      conLety: suyas.filter(x => x.c.estado === 'pendiente_lety').length,
      sinCorreccion: aprob.filter(x => (Number(x.c.iter) || 1) === 1).length,
      tiempo: cuenta(suyas),
      tiempoTipicoMin: mediana(buenos),
      camposLlenos: suyas.length ? suyas.reduce((a, x) => a + x.llenos, 0) / suyas.length : null,
    };
  });

  const diag = cuenta(del);
  const buenosTodos = del.filter(x => x.t.estado === 'sin_anomalias').map(x => x.t.tenMin);

  // Compuerta: global y por persona, y al menos dos personas que cumplan.
  // Aun abierta, falta la regla para comparar muestras de distinta cantidad
  // y proceso: por eso `listo` nunca es true desde aquí. Cuando exista, esa
  // regla se agrega como una condición más.
  const f = COMPUERTA.fraccionSinAnomalias, m = COMPUERTA.minimoPorPersona;
  const porPersona = personas.map(p => ({
    uid: p.uid,
    fraccion: p.firmadas ? p.tiempo.sin_anomalias / p.firmadas : 0,
    sinAnomalias: p.tiempo.sin_anomalias,
  }));
  const cumplen = porPersona.filter(p => p.fraccion >= f && p.sinAnomalias >= m).length;
  const compuerta = {
    fraccionGlobal: diag.total ? diag.sin_anomalias / diag.total : 0,
    porPersona,
    personasQueCumplen: cumplen,
    datosSuficientes: diag.total > 0 && diag.sin_anomalias / diag.total >= f && cumplen >= 2,
    reglaDeComparacion: false,
    listo: false,
  };

  return {
    diag,
    tiempoTipicoMin: mediana(buenosTodos),
    personas,
    compuerta,
  };
}

// Pendientes de aprobar HOY, sin importar el periodo: lo que Lety tiene en
// la mesa no depende del filtro que esté mirando.
export function esperandoALety(fichas, uid) {
  const pend = (fichas || []).filter(c => c && c.estado === 'pendiente_lety' && (!uid || c.id_muestrista === uid));
  const fines = pend.map(c => ms(c.dt_fin)).filter(x => x !== null);
  return { n: pend.length, masAntigua: fines.length ? Math.min(...fines) : null };
}
