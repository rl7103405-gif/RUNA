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
// sábado. Todo esto lo confirmó Lety por WhatsApp el 2026-09-22:
//   · Jesús  — de 8 a 6 de lunes a viernes, y el sábado de 8 a 1.
//   · Israel — de 7 a 7, de lunes a sábado.
//   · Los dos comen de 3 a 4: esa hora NO cuenta como trabajo.
// Si cambia el horario de alguien, se cambia aquí y nada más aquí.
//
// Cada día es una LISTA de tramos [minutoDeEntrada, minutoDeSalida] (la comida
// parte el día en dos), o una lista vacía si ese día no se trabaja. El índice
// del día es el de Date.getDay(): 0 = domingo ... 6 = sábado.
const H = (h, m) => h * 60 + (m || 0);

const COMIDA = [H(15), H(16)]; // de 3 a 4 de la tarde, los dos

// Parte un tramo con la hora de comida, si la comida cae dentro
function conComida(desde, hasta) {
  const [ci, cf] = COMIDA;
  if (cf <= desde || ci >= hasta) return [[desde, hasta]];   // la comida queda fuera
  const tramos = [];
  if (ci > desde) tramos.push([desde, ci]);
  if (hasta > cf) tramos.push([cf, hasta]);
  // Un turno que cayera ENTERO dentro de la comida se quedaría sin tramos, y
  // eso significa "ese día no se trabaja": justo la clase de mentira silenciosa
  // que costó 18.9 días de reloj. Que falle a gritos si alguien edita mal.
  if (!tramos.length) console.error('horario.js: el turno ' + desde + '-' + hasta + ' cae entero en la hora de comida; revisa HORARIOS');
  return tramos;
}

const JESUS_ENTRE_SEMANA = conComida(H(8), H(18));  // 8 a 15 y 16 a 18 = 9 h
const JESUS_SABADO = conComida(H(8), H(13));        // sale antes de comer = 5 h
const ISRAEL = conComida(H(7), H(19));              // 7 a 15 y 16 a 19 = 11 h

const TURNO_JESUS = [[], JESUS_ENTRE_SEMANA, JESUS_ENTRE_SEMANA, JESUS_ENTRE_SEMANA,
  JESUS_ENTRE_SEMANA, JESUS_ENTRE_SEMANA, JESUS_SABADO];
const TURNO_ISRAEL = [[], ISRAEL, ISRAEL, ISRAEL, ISRAEL, ISRAEL, ISRAEL];

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

// Tramos de ESE día, ya en milisegundos (hora local de la tablet)
function ventanasDe(fecha, turno) {
  const tramos = turno[fecha.getDay()] || [];
  if (!tramos.length) return [];
  const base = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate()).getTime();
  return tramos.map(([a, b]) => ({ ini: base + a * 60000, fin: base + b * 60000 }));
}

// Segundos de turno entre dos instantes, para el horario de `uid`: recorta
// noches, la hora de comida y cualquier día que esa persona no trabaje. Es una
// función pura y se prueba fuera del navegador.
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
    ventanasDe(cursor, turno).forEach(v => {
      const a = Math.max(ini, v.ini), b = Math.min(fin, v.fin);
      if (b > a) total += (b - a) / 1000;
    });
    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(0, 0, 0, 0); // por si el día tuviera 23 o 25 horas
  }
  return Math.floor(total);
}

// ¿Está ahora dentro de su turno? Lo usa la pantalla del muestrista para
// avisar que el reloj está quieto a propósito y no porque la app se trabó.
// A la hora de la comida devuelve false: el reloj tampoco corre entonces.
export function enHorario(uid, fecha) {
  const f = fecha || new Date();
  const min = f.getHours() * 60 + f.getMinutes();
  return (turnoDe(uid)[f.getDay()] || []).some(([a, b]) => min >= a && min < b);
}

// ¿Está parado justo por la comida? (para decirlo con esas palabras)
export function enComida(uid, fecha) {
  const f = fecha || new Date();
  const tramos = turnoDe(uid)[f.getDay()] || [];
  // Solo si la comida parte el turno de ESE día: el sábado Jesús sale a la
  // una, así que a las 3:30 no está comiendo, ya se fue hasta el lunes. Decirle
  // "vuelve a las 16:00" sería la misma clase de mentira que se vino a quitar.
  if (tramos.length < 2) return false;
  const min = f.getHours() * 60 + f.getMinutes();
  return min >= COMIDA[0] && min < COMIDA[1];
}

const hhmm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const mismoDia = (a, b) => a.length === b.length && a.every((r, i) => r[0] === b[i][0] && r[1] === b[i][1]);

// El turno en palabras, para explicarlo en pantalla sin repetir números.
// Agrupa los días seguidos iguales y dice la comida aparte: "lunes a viernes
// de 08:00 a 18:00 (comida de 15:00 a 16:00) y sábado de 08:00 a 13:00".
export function horarioEnPalabras(uid) {
  const turno = turnoDe(uid);
  const bloques = [];
  for (let d = 0; d < 7; d++) {
    const tramos = turno[d] || [];
    if (!tramos.length) continue;
    const ultimo = bloques[bloques.length - 1];
    if (ultimo && ultimo.hasta === d - 1 && mismoDia(ultimo.tramos, tramos)) ultimo.hasta = d;
    else bloques.push({ desde: d, hasta: d, tramos });
  }
  if (!bloques.length) return 'sin horario';
  return bloques.map(b => {
    const dias = b.desde === b.hasta ? DIAS[b.desde] : DIAS[b.desde] + ' a ' + DIAS[b.hasta];
    const abre = b.tramos[0][0], cierra = b.tramos[b.tramos.length - 1][1];
    const parte = b.tramos.length > 1 ? ' (comida de ' + hhmm(b.tramos[0][1]) + ' a ' + hhmm(b.tramos[1][0]) + ')' : '';
    return dias + ' de ' + hhmm(abre) + ' a ' + hhmm(cierra) + parte;
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
