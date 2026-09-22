// El horario de cada muestrista, y el único lugar donde se decide qué tiempo
// cuenta.
//
// POR QUÉ EXISTE (2026-09-22): el cronómetro de una ficha corría por reloj de
// pared mientras la ficha estuviera abierta, y solo se detenía al firmar. Como
// la pausa la tiene que autorizar Lety y nadie pide pausas desde el 21-ago, una
// ficha abierta el jueves y firmada el martes siguiente se llevaba las noches y
// el fin de semana enteros: medido en producción, una ficha de Jesús acumuló
// 18.9 días de reloj, y otra firmada ese día quedó con 8 días. Con eso el
// tiempo no sirve ni para medir ni para comparar.
//
// La corrección respeta la regla de que quien se mide no para su propio reloj
// (ver la decisión del 2026-08-19): el reloj no lo detiene el muestrista, lo
// detiene el HORARIO. Fuera del turno, el tiempo simplemente no cuenta.
//
// LOS HORARIOS SON DISTINTOS POR PERSONA, y el de Jesús además cambia el
// sábado. Los confirmó Lety por WhatsApp el 2026-09-22:
//   · Jesús  — de 8 a 6 de lunes a viernes, y el sábado de 8 a 1.
//   · Israel — de 7 a 7, de lunes a sábado.
// Si cambia el horario de alguien, se cambia aquí y nada más aquí.
//
// Cada día es null (no se trabaja) o [minutoDeEntrada, minutoDeSalida], con el
// índice del día tal como lo da Date.getDay(): 0 = domingo ... 6 = sábado.
const H = (h, m) => h * 60 + (m || 0);

const TURNO_JESUS = [null, [H(8), H(18)], [H(8), H(18)], [H(8), H(18)], [H(8), H(18)], [H(8), H(18)], [H(8), H(13)]];
const TURNO_ISRAEL = [null, [H(7), H(19)], [H(7), H(19)], [H(7), H(19)], [H(7), H(19)], [H(7), H(19)], [H(7), H(19)]];

export const HORARIOS = {
  jesus: TURNO_JESUS,
  israel: TURNO_ISRAEL,
  // La cuenta de prueba usa el horario más amplio: así una prueba a media
  // tarde no se topa con que el reloj no avanza.
  demo_muestrista: TURNO_ISRAEL,
};

// Para cualquier otra cuenta (o si el id llega vacío) se toma el turno más
// amplio: es preferible contar de más que dejar a alguien con el reloj muerto
// sin explicación.
export const TURNO_POR_OMISION = TURNO_ISRAEL;

const DIA_MS = 86400000;

export function turnoDe(uid) {
  return HORARIOS[uid] || TURNO_POR_OMISION;
}

// Ventana del día (hora local de la tablet) para ese turno, o null si ese día
// no se trabaja
function ventanaDe(fecha, turno) {
  const rango = turno[fecha.getDay()];
  if (!rango) return null;
  const base = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate()).getTime();
  return { ini: base + rango[0] * 60000, fin: base + rango[1] * 60000 };
}

// Segundos de turno entre dos instantes, para el horario de `uid`: recorta
// noches, domingos y cualquier día que esa persona no trabaje. Es una función
// pura y se prueba fuera del navegador.
//
// Se recorre día por día en hora LOCAL, no en UTC: así el cambio de día cae
// donde cae para la gente de la planta. México ya no cambia de horario de
// verano (desde 2022), pero aunque lo hiciera, construir la ventana con
// `new Date(año, mes, día)` la ancla al huso vigente ESE día.
export function segundosLaborales(desdeMs, hastaMs, uid) {
  const ini = Number(desdeMs), fin = Number(hastaMs);
  if (!Number.isFinite(ini) || !Number.isFinite(fin) || fin <= ini) return 0;
  // Tope de seguridad: más de un año de diferencia es un reloj descompuesto o
  // un dato corrupto, no una ficha (evita recorrer miles de días).
  if (fin - ini > 366 * DIA_MS) return 0;
  const turno = turnoDe(uid);
  let total = 0;
  const cursor = new Date(ini);
  cursor.setHours(0, 0, 0, 0);
  for (let guarda = 0; guarda < 400 && cursor.getTime() <= fin; guarda++) {
    const v = ventanaDe(cursor, turno);
    if (v) {
      const a = Math.max(ini, v.ini), b = Math.min(fin, v.fin);
      if (b > a) total += (b - a) / 1000;
    }
    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(0, 0, 0, 0); // por si el día tuviera 23 o 25 horas
  }
  return Math.floor(total);
}

// ¿Está ahora dentro de su turno? Lo usa la pantalla del muestrista para
// avisar que el reloj está quieto a propósito y no porque la app se trabó.
export function enHorario(uid, fecha) {
  const f = fecha || new Date();
  const rango = turnoDe(uid)[f.getDay()];
  if (!rango) return false;
  const min = f.getHours() * 60 + f.getMinutes();
  return min >= rango[0] && min < rango[1];
}

const hhmm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

// El turno en palabras, para explicarlo en pantalla sin repetir números.
// Agrupa los días seguidos con el mismo rango: "lunes a viernes de 08:00 a
// 18:00 y sábado de 08:00 a 13:00".
export function horarioEnPalabras(uid) {
  const turno = turnoDe(uid);
  const tramos = [];
  for (let d = 0; d < 7; d++) {
    const r = turno[d];
    if (!r) continue;
    const ultimo = tramos[tramos.length - 1];
    if (ultimo && ultimo.hasta === d - 1 && ultimo.r[0] === r[0] && ultimo.r[1] === r[1]) ultimo.hasta = d;
    else tramos.push({ desde: d, hasta: d, r });
  }
  if (!tramos.length) return 'sin horario';
  return tramos.map(t => {
    const dias = t.desde === t.hasta ? DIAS[t.desde] : DIAS[t.desde] + ' a ' + DIAS[t.hasta];
    return dias + ' de ' + hhmm(t.r[0]) + ' a ' + hhmm(t.r[1]);
  }).join(' y ');
}

// Techo de una ficha: el cronómetro nunca puede pasar de las horas de turno
// transcurridas desde que se abrió. Es el invariante que cura de un jalón las
// fichas que ya venían infladas.
export function topeDesde(dtInicioMs, ahoraMs, uid) {
  return segundosLaborales(dtInicioMs, ahoraMs === undefined ? Date.now() : ahoraMs, uid);
}

// Milisegundos de un timestamp de Firestore, una fecha o un número
export function aMs(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v.toMillis) return v.toMillis();
  if (v instanceof Date) return v.getTime();
  return null;
}
