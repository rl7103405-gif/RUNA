// Lectura de la Ficha Técnica de Tejido (F.T.T.) de Deportivos Quini.
//
// El archivo que entrega Lety es la plantilla corporativa "FICHA TÉCNICA DE
// SEMIELABORADO", con UNA HOJA POR VARIANTE (p. ej. hojas 1506-I, 1507-I,
// 1508-I de un mismo modelo). De ahí sale TODO lo teórico de la tarea, así
// que Lety ya no captura nada a mano salvo lo que el Excel no trae
// (muestrista, pares requeridos y complejidad).
//
// El parseo se ancla en ETIQUETAS, no en direcciones de celda: si alguien
// inserta una fila o mueve una sección, la plantilla sigue leyéndose. Se
// normaliza sin acentos ni mayúsculas porque la plantilla mezcla ambos
// ("DIAMETRO CILIDRO" incluso trae un typo de origen).
import { normalizarCodigo, codigoValido } from './catalogo.js';

// Texto normalizado para comparar etiquetas
export function na(v) {
  return String(v ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9#/ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

const txt = v => String(v ?? '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();

// "11.25" → 11.25 · "3 1/2" → 3.5 · "125 Grados" → 125 · "" → null
export function num(v) {
  const s = txt(v);
  if (!s) return null;
  const frac = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)/);
  if (frac) return Number(frac[1]) + Number(frac[2]) / Number(frac[3]);
  const solaFrac = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (solaFrac) return Number(solaFrac[1]) / Number(solaFrac[2]);
  const m = s.replace(/[\s\u00A0]/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.').match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

// "+/- 0.5" → 0.5 · "± 2" → 2 · "N/A" → null
export function tolerancia(v) {
  const s = txt(v);
  if (!s || /^n\/?a$/i.test(s)) return null;
  const m = s.replace(',', '.').match(/(\d+(\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

// Índice de la fila cuya primera celda con texto coincide con alguna etiqueta
function buscaFila(m, etiquetas, desde = 0) {
  const set = etiquetas.map(na);
  for (let r = desde; r < m.length; r++) {
    const fila = m[r] || [];
    for (let c = 0; c < Math.min(fila.length, 14); c++) {
      const t = na(fila[c]);
      if (t && set.includes(t)) return { r, c };
    }
  }
  return null;
}

// La plantilla tiene DOS bloques lado a lado: el de la izquierda (etiqueta en
// A, valor en B–G) y el de la derecha (pesos, tiempos, hormado, a partir de la
// columna H). Leer más allá de este ancho hace que una etiqueta sin valor —un
// bordado vacío, por ejemplo— se "llene" con el texto del bloque vecino.
const ANCHO_IZQ = 7;

// Primer valor no vacío a la derecha de la etiqueta, dentro de una ventana
function valorDerecha(m, pos, ancho = ANCHO_IZQ) {
  if (!pos) return '';
  const fila = m[pos.r] || [];
  for (let c = pos.c + 1; c < Math.min(fila.length, pos.c + 1 + ancho); c++) {
    const v = txt(fila[c]);
    if (v) return v;
  }
  return '';
}

function campo(m, etiquetas, ancho) {
  return valorDerecha(m, buscaFila(m, etiquetas), ancho);
}

// Primer valor no vacío en la MISMA columna, dentro de las siguientes
// `filas` filas (algunas etiquetas, como OBSERVACIONES, traen el texto
// debajo de la etiqueta y no a la derecha)
function valorAbajo(m, pos, filas = 3) {
  if (!pos) return '';
  for (let r = pos.r + 1; r <= pos.r + filas && r < m.length; r++) {
    const v = txt((m[r] || [])[pos.c]);
    if (v) return v;
  }
  return '';
}

// ── Secciones tabulares ──
// Devuelve, para cada etiqueta de fila buscada bajo un ancla, los valores de
// las celdas a su derecha (varias columnas: sin hormar / hormado / tolerancia)
function filasBajo(m, ancla, etiquetas, maxFilas = 14) {
  const pos = buscaFila(m, [ancla]);
  const out = {};
  if (!pos) return out;
  const fin = Math.min(m.length, pos.r + maxFilas);
  etiquetas.forEach(({ key, alias }) => {
    for (let r = pos.r; r < fin; r++) {
      const fila = m[r] || [];
      for (let c = 0; c < Math.min(fila.length, 14); c++) {
        if (alias.map(na).includes(na(fila[c]))) {
          out[key] = { r, c, fila };
          r = fin; break;
        }
      }
    }
  });
  return out;
}

function valoresDe(ref, cols) {
  if (!ref) return [];
  const fila = ref.fila;
  const vals = [];
  for (let c = ref.c + 1; c < fila.length && vals.length < cols; c++) {
    const v = txt(fila[c]);
    if (v) vals.push(v);
  }
  return vals;
}

const MEDIDAS = [
  { key: 'A', alias: ['A', 'ALTO TUBO'] },
  { key: 'B', alias: ['B', 'PLANTA'] },
  { key: 'C', alias: ['C', 'ANCHO PLANTA'] },
  { key: 'D', alias: ['D', 'ANCHO ELASTICO'] },
  { key: 'E', alias: ['E', 'ALTO ELASTICO'] },
];

// Lee UNA hoja (una variante) y devuelve la ficha técnica normalizada
export function parseHoja(matriz) {
  const m = matriz;
  const codigoRaw = campo(m, ['CODIGO DEPORTIVOS QUINI', 'CODIGO QUINI', 'CODIGO']);
  const ft = {
    codigo: normalizarCodigo(codigoRaw),
    codigo_raw: codigoRaw,
    modelo: campo(m, ['MODELO']),
    cliente: campo(m, ['CLIENTE']),
    marca: campo(m, ['MARCA']),
    maquina_marca: campo(m, ['MARCA DE MAQUINA']),
    maquina_numero: campo(m, ['NUMERO DE MAQUINA', 'NO DE MAQUINA']),
    agujas: campo(m, ['# AGUJAS', 'AGUJAS', 'NO AGUJAS']),
    diametro: campo(m, ['DIAMETRO CILIDRO', 'DIAMETRO CILINDRO', 'DIAMETRO']),
    tipo_producto: campo(m, ['TIPO DE PRODUCTO']),
    talla: campo(m, ['TALLA']),
    color_base: campo(m, ['COLOR DE BASE', 'COLOR BASE']),
    fecha_desarrollo: campo(m, ['FECHA DE DESARROLLO']),
    // Pesos y tiempos objetivo
    peso_sal: campo(m, ['PESO SALIDO DE MAQUINA', 'PESO SALIDA DE MAQUINA'], 8),
    peso_cer: campo(m, ['PESO CERRADO'], 8),
    peso_muestra: campo(m, ['PESO MUESTRA EN GRAMOS'], 8),
    nomenclatura: campo(m, ['NOMENCLATURA DE CADENA'], 8),
    hormado: campo(m, ['HORMADO'], 8),
    temperatura: campo(m, ['TEMPERATURA'], 8),
    observaciones: '',
  };

  // OBSERVACIONES: en la plantilla el texto vive en la FILA SIGUIENTE a la
  // etiqueta, misma columna (no a la derecha como el resto de los campos)
  const posObs = buscaFila(m, ['OBSERVACIONES']);
  ft.observaciones = (campo(m, ['OBSERVACIONES'], 8) || valorAbajo(m, posObs, 3)).slice(0, 400);

  // Tiempo de ciclo: la etiqueta y los valores viven en filas distintas
  const posCiclo = buscaFila(m, ['TIEMPO DE CICLO']);
  if (posCiclo) {
    const nums = [];
    for (let r = posCiclo.r; r < Math.min(m.length, posCiclo.r + 3) && nums.length < 2; r++) {
      (m[r] || []).forEach((c, i) => {
        if (i <= posCiclo.c) return;
        const v = txt(c);
        if (v && /^\d+([.,]\d+)?$/.test(v) && nums.length < 2) nums.push(v);
      });
    }
    ft.t_ciclo_min = nums[0] || '';
    ft.t_ciclo_seg = nums[1] || '';
  }

  // Medidas A–E: sin hormar / hormado / tolerancia
  const refs = filasBajo(m, 'MEDIDAS EN CENTIMETROS', MEDIDAS, 12);
  ft.med_sh = {}; ft.med_h = {}; ft.med_tol = {};
  MEDIDAS.forEach(({ key, alias }) => {
    const ref = refs[key];
    ft.med_sh[key] = ''; ft.med_h[key] = ''; ft.med_tol[key] = null;
    if (!ref) return;
    const fila = ref.fila;
    const esNum = v => !/[+±]/.test(v) && num(v) !== null;
    // La fila repite la etiqueta descriptiva: "A | ALTO TUBO | 5.5 | ALTO TUBO
    // | 3.8 | +/-1". Esa segunda aparición marca dónde empieza el bloque
    // HORMADO, y es lo que ancla cada valor a SU columna. Tomarlos por orden
    // de aparición corría los datos: una medida sin "sin hormar" pero con
    // "hormado" guardaba el hormado como si fuera el sin hormar.
    const desc = na(alias[alias.length - 1]);
    const marcas = [];
    for (let c = ref.c; c < fila.length; c++) if (na(fila[c]) === desc) marcas.push(c);
    const corte = marcas.length > 1 ? marcas[1] : -1;
    const tomar = (desdeC, hastaC) => {
      for (let c = desdeC; c < (hastaC < 0 ? fila.length : hastaC); c++) {
        const v = txt(fila[c]);
        if (v && esNum(v)) return String(num(v));
      }
      return '';
    };
    if (corte > 0) {
      ft.med_sh[key] = tomar(ref.c + 1, corte);
      ft.med_h[key] = tomar(corte + 1, -1);
    } else {
      // Plantilla sin la etiqueta repetida: se cae al orden de aparición
      const valores = valoresDe(ref, 6).filter(esNum);
      ft.med_sh[key] = valores[0] !== undefined ? String(num(valores[0])) : '';
      ft.med_h[key] = valores[1] !== undefined ? String(num(valores[1])) : '';
    }
    const tol = valoresDe(ref, 8).find(v => /[+±]/.test(v));
    ft.med_tol[key] = tol ? tolerancia(tol) : null;
  });

  // Giros y velocidades de cadena
  const gRefs = filasBajo(m, 'GIROS DE CADENA', [
    { key: 'el', alias: ['ELASTICO'] }, { key: 'tb', alias: ['TUBO'] },
    { key: 'pl', alias: ['PLANTA'] }, { key: 'rb', alias: ['RUBBPER DE MAQUINA', 'RUBBER DE MAQUINA', 'RUBBER'] },
  ], 8);
  ft.giros = {};
  ['el', 'tb', 'pl', 'rb'].forEach(k => {
    const v = valoresDe(gRefs[k], 3).find(x => num(x) !== null);
    ft.giros[k] = v ? String(num(v)) : '';
  });

  const vRefs = filasBajo(m, 'VELOCIDADES DE CADENA', [
    { key: 'el', alias: ['ELASTICO'] }, { key: 'tb', alias: ['TUBO'] },
    { key: 'tp', alias: ['TALON Y PUNTA'] }, { key: 'pl', alias: ['PLANTA'] },
  ], 8);
  ft.vels = {};
  ['el', 'tb', 'tp', 'pl'].forEach(k => {
    const v = valoresDe(vRefs[k], 3).find(x => num(x) !== null);
    ft.vels[k] = v ? String(num(v)) : '';
  });

  // Punto de máquina: tabla alimentador 1..10 con DEN-1 / DEN-2 / SINK2.
  // La ficha práctica captura un solo juego, así que se toma el primero y se
  // conserva la tabla completa para consulta de Lety.
  const posPto = buscaFila(m, ['PUNTO DE MAQUINA']);
  ft.pto_tabla = [];
  if (posPto) {
    for (let r = posPto.r + 1; r < Math.min(m.length, posPto.r + 14); r++) {
      const fila = m[r] || [];
      const idx = fila.findIndex((c, i) => i >= posPto.c && /^\d{1,2}$/.test(txt(c)));
      if (idx < 0) continue;
      const nums = [];
      for (let c = idx + 1; c < fila.length && nums.length < 3; c++) {
        const v = txt(fila[c]);
        if (v !== '' && num(v) !== null) nums.push(String(num(v)));
      }
      if (nums.length) ft.pto_tabla.push({ alim: txt(fila[idx]), d1: nums[0] || '', d2: nums[1] || '', sk: nums[2] || '' });
    }
  }
  const p0 = ft.pto_tabla[0] || {};
  ft.pto = { d1: p0.d1 || '', d2: p0.d2 || '', sk: p0.sk || '' };

  // Materiales: se recorren las filas del bloque EN ORDEN, no por etiqueta
  // única — la plantilla repite "LYCRA:" tres veces (cuerpo, talón y punta) y
  // buscarla por nombre devolvería siempre la primera.
  ft.materiales = [];
  const posMat = buscaFila(m, ['DESGLOSE DE MATERIALES', 'MATERIALES']);
  if (posMat) {
    let ultimaParte = '';
    for (let r = posMat.r + 1; r < Math.min(m.length, posMat.r + 22); r++) {
      const fila = m[r] || [];
      const etq = txt(fila[posMat.c]);
      if (!etq) continue;
      if (na(etq) === 'POSTURA ALIMENTADOR PRINCIPAL') break;
      const mat = valorDerecha(m, { r, c: posMat.c }, 5);
      if (!mat) continue; // bordado vacío: se omite sin desplazar los demás
      // "LYCRA:" pertenece a la parte anterior (cuerpo/talón/punta)
      const parte = /^LYCRA/i.test(etq) && ultimaParte ? ultimaParte + ' · lycra' : etq.replace(/:$/, '');
      if (!/^LYCRA/i.test(etq)) ultimaParte = etq.replace(/:$/, '');
      ft.materiales.push({ parte, material: mat, fila: r + 1 });
    }
  }
  // Alimentadores: la lectura se corta ANTES del bloque derecho de la
  // plantilla (pesos, tiempos, hormado). Si se lee toda la fila, un
  // alimentador vacío se "llena" con el texto de la sección vecina.
  ft.alimentadores = [];
  for (let i = 1; i <= 8; i++) {
    const pos = buscaFila(m, ['ALIMENTADOR ' + i]);
    if (!pos) continue;
    const fila = m[pos.r] || [];
    const partes = [];
    const limite = Math.min(fila.length, pos.c + ANCHO_IZQ);
    for (let c = pos.c + 1; c < limite; c++) {
      const v = txt(fila[c]);
      if (v && na(v) !== 'Y') partes.push(v);
    }
    if (partes.length) ft.alimentadores.push({ n: i, hilos: partes.slice(0, 2).join(' + ') });
  }

  return ft;
}

// Lee el libro completo: una ficha por hoja con código válido
export function parseLibro(wb, XLSX) {
  const fichas = [], errores = [];
  (wb.SheetNames || []).forEach(nombre => {
    try {
      const m = XLSX.utils.sheet_to_json(wb.Sheets[nombre], { header: 1, raw: false, defval: '', blankrows: true });
      const ft = parseHoja(m);
      if (!ft.codigo) { errores.push({ hoja: nombre, motivo: 'sin código' }); return; }
      if (!codigoValido(ft.codigo)) { errores.push({ hoja: nombre, motivo: 'código no válido (espacios, / u otros símbolos)' }); return; }
      ft.hoja = nombre;
      fichas.push(ft);
    } catch (e) {
      console.error('ficha-tecnica hoja ' + nombre + ':', e);
      errores.push({ hoja: nombre, motivo: 'no se pudo leer' });
    }
  });
  return { fichas, errores };
}

// ── Comparación objetivo vs. real ──
// SOLO se ejecuta en la pantalla de revisión de Lety: ella es la única que
// puede leer la ficha técnica (ver firestore.rules). El muestrista captura a
// ciegas, así que este cálculo nunca corre en su dispositivo.
//
// `fuera` solo se marca cuando la F.T.T. declara una tolerancia explícita —
// hoy solo las medidas A–E la traen. Para giros, velocidades y pesos se
// muestra la diferencia como dato informativo, sin veredicto: tratarlos como
// tolerancia cero llenaría la pantalla de falsos "fuera de rango".
export function comparar(ft, cap) {
  if (!ft || !cap) return [];
  const out = [];
  const chk = (etiqueta, objetivo, real, tol) => {
    const o = num(objetivo), r = num(real);
    if (o === null || r === null) return;
    const dif = Number(Math.abs(r - o).toFixed(2));
    const conTol = tol !== null && tol !== undefined;
    out.push({
      etiqueta, objetivo: o, real: r, dif,
      tol: conTol ? tol : null,
      fuera: conTol ? dif > tol + 1e-9 : null, // null = informativo, sin veredicto
    });
  };
  const ETQ = { A: 'A alto tubo', B: 'B planta', C: 'C ancho planta', D: 'D ancho elástico', E: 'E alto elástico' };
  ['A', 'B', 'C', 'D', 'E'].forEach(k => {
    chk(ETQ[k] + ' · sin hormar', (ft.med_sh || {})[k], (cap.med_sh || {})[k], (ft.med_tol || {})[k]);
    chk(ETQ[k] + ' · hormado', (ft.med_h || {})[k], (cap.med_h || {})[k], (ft.med_tol || {})[k]);
  });
  [['el', 'Giros elástico'], ['tb', 'Giros tubo'], ['pl', 'Giros planta'], ['rb', 'Giros rubber']]
    .forEach(([k, et]) => chk(et, (ft.giros || {})[k], (cap.giros || {})[k], null));
  [['el', 'Vel. elástico'], ['tb', 'Vel. tubo'], ['tp', 'Vel. talón y punta'], ['pl', 'Vel. planta']]
    .forEach(([k, et]) => chk(et, (ft.vels || {})[k], (cap.vels || {})[k], null));
  chk('Peso salida (g)', ft.peso_sal, cap.peso_sal, null);
  chk('Peso cerrado (g)', ft.peso_cer, cap.peso_cer, null);
  chk('T. ciclo (min)', ft.t_ciclo_min, cap.t_ciclo_min, null);
  chk('T. ciclo (seg)', ft.t_ciclo_seg, cap.t_ciclo_seg, null);
  return out;
}
