// El horario de la planta, y el único lugar donde se decide qué tiempo cuenta.
//
// POR QUÉ EXISTE (2026-09-22): el cronómetro de una ficha corría por reloj de
// pared mientras la ficha estuviera abierta, y solo se detenía al firmar. Como
// la pausa la tiene que autorizar Lety y nadie pide pausas desde el 21-ago, una
// ficha abierta el jueves y firmada el martes siguiente se llevaba las noches y
// el fin de semana enteros: medido en producción, una ficha de Jesús acumuló
// 18.9 días de reloj, y otra firmada hoy quedó con 8 días. Con eso el tiempo no
// sirve ni para medir ni para comparar.
//
// La corrección respeta la regla de que quien se mide no para su propio reloj
// (ver la decisión del 2026-08-19): el reloj no lo detiene el muestrista, lo
// detiene el HORARIO. Fuera del turno, el tiempo simplemente no cuenta.
//
// [POR CONFIRMAR con Lety] El horario de abajo NO lo dijo nadie: está medido de
// la propia actividad de la app (351 sellos de tiempo de fichas reales: 08:00 a
// 18:00, de lunes a sábado, cero en domingo; solo 7 eventos fuera de ese rango,
// todos de agosto). En cuanto Lety confirme el horario real, se cambia aquí y
// nada más aquí.
export const HORARIO = {
  // Días laborales: 0 = domingo ... 6 = sábado (igual que Date.getDay())
  dias: [1, 2, 3, 4, 5, 6],
  desdeMin: 8 * 60,   // 08:00
  hastaMin: 18 * 60,  // 18:00
};

const DIA_MS = 86400000;

export function esDiaLaboral(fecha) {
  return HORARIO.dias.includes(fecha.getDay());
}

// Minutos del día (hora local de la tablet) del inicio y el fin del turno
function ventanaDe(fecha) {
  const base = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
  return {
    ini: base.getTime() + HORARIO.desdeMin * 60000,
    fin: base.getTime() + HORARIO.hastaMin * 60000,
  };
}

// Segundos de turno entre dos instantes: recorta noches, domingos y cualquier
// día no laboral. Es una función pura y se prueba fuera del navegador.
//
// Se recorre día por día en hora LOCAL, no en UTC: así el cambio de día cae
// donde cae para la gente de la planta. México ya no cambia de horario de
// verano (desde 2022), pero aunque lo hiciera, construir la ventana con
// `new Date(año, mes, día)` la ancla al huso vigente ESE día.
export function segundosLaborales(desdeMs, hastaMs) {
  const ini = Number(desdeMs), fin = Number(hastaMs);
  if (!Number.isFinite(ini) || !Number.isFinite(fin) || fin <= ini) return 0;
  // Tope de seguridad: más de un año de diferencia es un reloj descompuesto o
  // un dato corrupto, no una ficha (evita recorrer miles de días).
  if (fin - ini > 366 * DIA_MS) return 0;
  let total = 0;
  const cursor = new Date(ini);
  cursor.setHours(0, 0, 0, 0);
  for (let guarda = 0; guarda < 400 && cursor.getTime() <= fin; guarda++) {
    if (esDiaLaboral(cursor)) {
      const v = ventanaDe(cursor);
      const a = Math.max(ini, v.ini), b = Math.min(fin, v.fin);
      if (b > a) total += (b - a) / 1000;
    }
    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(0, 0, 0, 0); // por si el día tuviera 23 o 25 horas
  }
  return Math.floor(total);
}

// ¿Estamos ahora dentro del turno? Lo usa la pantalla del muestrista para
// avisar que el reloj está quieto a propósito y no porque la app se trabó.
export function enHorario(fecha) {
  const f = fecha || new Date();
  if (!esDiaLaboral(f)) return false;
  const min = f.getHours() * 60 + f.getMinutes();
  return min >= HORARIO.desdeMin && min < HORARIO.hastaMin;
}

// Horario en palabras, para explicarlo en pantalla sin repetir números
export function horarioEnPalabras() {
  const hh = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  return hh(HORARIO.desdeMin) + ' a ' + hh(HORARIO.hastaMin) + ', de lunes a sábado';
}

// Techo de una ficha: el cronómetro nunca puede pasar de las horas de turno
// transcurridas desde que se abrió. Es el invariante que cura de un jalón las
// fichas que ya venían infladas.
export function topeDesde(dtInicioMs, ahoraMs) {
  return segundosLaborales(dtInicioMs, ahoraMs === undefined ? Date.now() : ahoraMs);
}

// Milisegundos de un timestamp de Firestore, una fecha o un número
export function aMs(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v.toMillis) return v.toMillis();
  if (v instanceof Date) return v.getTime();
  return null;
}
