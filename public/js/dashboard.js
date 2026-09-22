// Dashboard de Lety y de Dirección: indicadores, diagnóstico del cronómetro,
// resumen por muestrista, ranking (en espera) e historial filtrable.
// La exportación (CSV y Excel) vive en export.js, con una sola definición de
// columnas compartida por ambos formatos. Los cálculos viven en
// indicadores.js (funciones puras, probadas contra los datos reales).
import { db, fsOk } from './fb.js';
import { APP, USERS, TM_CAUSES, muestristasDe, esDeMiAmbiente, enAmbiente } from './state.js';
import { es, fmtMin, fmtDate, getRange, toast, tenFromDoc } from './utils.js';
import { INICIO_INDICADORES, COMPUERTA, resumir, esperandoALety } from './indicadores.js';

// Identificador de carga: si el filtro cambia mientras una consulta vieja
// sigue en vuelo, la respuesta vieja se descarta (no pisa la nueva)
let loadSeq = 0;

const KPIS = ['db0', 'db1', 'db2', 'db3'];
const SECCIONES = ['db-diag', 'db-personas', 'db-ranking', 'db-cmp'];

// Deja la pantalla en blanco: ni al cargar ni tras un error se deben ver las
// cifras del filtro anterior como si fueran las actuales (auditoría 2026-09-22)
function limpiar() {
  KPIS.forEach(id => {
    const v = document.getElementById(id); if (v) v.textContent = '—';
    const s = document.getElementById(id + 's'); if (s) s.textContent = '';
  });
  SECCIONES.forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = ''; });
}

const nombre = uid => (USERS[uid] || {}).nombre || uid;
const pct = x => Math.round((x || 0) * 100) + '%';

// "32 min" o "2 h 5 min": el TEN en minutos crudos (1,384) no se lee
function duracion(min) {
  if (min === null || min === undefined) return '—';
  const m = Math.round(min);
  if (m < 60) return m + ' min';
  return Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '');
}

function haceDias(ms) {
  if (!ms) return '';
  const d = Math.floor((Date.now() - ms) / 86400000);
  return d <= 0 ? 'la más antigua es de hoy' : 'la más antigua: hace ' + d + (d === 1 ? ' día' : ' días');
}

function setKpi(i, valor, sub) {
  const v = document.getElementById(KPIS[i]); if (v) v.textContent = valor;
  const s = document.getElementById(KPIS[i] + 's'); if (s) s.textContent = sub || '';
}

export async function loadDB() {
  if (!fsOk()) return;
  const seq = ++loadSeq;
  const ses = APP.sesion;
  APP.dbDocs = []; // el CSV nunca exporta datos de un filtro anterior
  limpiar();
  const lista = document.getElementById('db-list');
  try {
    const period = document.getElementById('dp')?.value || 'month';
    const who = document.getElementById('dw')?.value || 'all';
    const { start, end } = getRange(period);
    // Siempre el grupo completo: las referencias (compuerta del ranking,
    // tabla por persona) se calculan con todos, y el filtro por persona solo
    // cambia lo que se presenta. Antes el filtro iba en la consulta y, al
    // elegir a Jesús, el "grupo" era él solo.
    // Las pausas van en la misma tanda: son lo único que respalda el tiempo
    // muerto que declara la tablet del muestrista (las autoriza Lety y sus
    // horas las pone el servidor). Si esta consulta falla, el TM no se juzga.
    const [snap, pausas] = await Promise.all([
      enAmbiente(db.collection('capturas')).get(),
      enAmbiente(db.collectionGroup('pausas').where('estado', 'in', ['aprobada', 'finalizada'])).get()
        .then(s => ({ snap: s, error: false }))
        .catch(e => { console.error('pausas del diagnóstico:', e); return { snap: null, error: true }; }),
    ]);
    if (seq !== loadSeq || ses !== APP.sesion) return; // llegó tarde: ya hay una carga más nueva u otra sesión
    const respaldo = pausas.snap ? respaldoPorFicha(pausas.snap) : null;
    const grupo = snap.docs.filter(d => esDeMiAmbiente(d.data())); // las de prueba no entran a los reales
    const deQuien = d => who === 'all' || d.data().id_muestrista === who;

    // ── Historial y exportación: TODO el periodo, sin el corte ──
    // Lo anterior al 7 de septiembre no promedia, pero sigue siendo registro.
    const hist = grupo.filter(d => {
      const dt = d.data();
      if (!deQuien(d) || !dt.dt_fin) return false;
      const ms = dt.dt_fin.toMillis ? dt.dt_fin.toMillis() : 0;
      return ms >= start && ms <= end && ['aprobado', 'pendiente_lety', 'correccion'].includes(dt.estado);
    });
    APP.dbDocs = hist.map(d => ({ id: d.id, data: d.data() }));

    // ── Indicadores: desde el corte ──
    const quienes = muestristasDe(!!(APP.user && APP.user.demo));
    const datos = grupo.map(d => ({ id: d.id, ...d.data() }));
    const r = resumir(datos, quienes, start, end, respaldo);                      // el grupo
    const rv = who === 'all' ? r : resumir(datos, [who], start, end, respaldo);   // lo que se ve
    const vista = who === 'all'
      ? r.personas.reduce((a, p) => ({ firmadas: a.firmadas + p.firmadas, aprobadas: a.aprobadas + p.aprobadas, sinCorreccion: a.sinCorreccion + p.sinCorreccion }), { firmadas: 0, aprobadas: 0, sinCorreccion: 0 })
      : rv.personas[0];
    const esp = esperandoALety(datos.filter(c => quienes.includes(c.id_muestrista)), who === 'all' ? null : who);
    // Devoluciones del periodo: al rechazar, la ficha queda en 'correccion'
    // con su dt_fin; ahí se ven antes de que el muestrista la reabra.
    const devueltas = datos.filter(c => c.estado === 'correccion' && (who === 'all' || c.id_muestrista === who)
      && c.dt_fin && c.dt_fin.toMillis && c.dt_fin.toMillis() >= Math.max(start, INICIO_INDICADORES.getTime()) && c.dt_fin.toMillis() <= end).length;

    setKpi(0, String(vista.aprobadas), 'de ' + vista.firmadas + ' firmadas en el periodo');
    setKpi(1, String(esp.n), esp.n ? haceDias(esp.masAntigua) : 'al día');
    // Con menos de 5 fichas medibles, una "mediana" en letra grande dice más
    // de lo que sabe: se muestra el hueco, no una cifra.
    const pocas = rv.diag.sin_anomalias < COMPUERTA.minimoPorPersona;
    setKpi(2, pocas ? '—' : duracion(rv.tiempoTipicoMin), !rv.diag.total ? 'sin fichas en el periodo'
      : (pocas ? 'solo ' : '') + rv.diag.sin_anomalias + ' de ' + rv.diag.total + ' fichas se pueden medir');
    setKpi(3, vista.aprobadas ? pct(vista.sinCorreccion / vista.aprobadas) : '—',
      devueltas ? devueltas + ' en corrección ahora'
        : (vista.aprobadas ? 'ninguna en corrección ahora' : ''));

    pintaDiagnostico(document.getElementById('db-diag'), rv.diag, !pausas.error);
    pintaPersonas(document.getElementById('db-personas'), r.personas, who);
    pintaRanking(document.getElementById('db-ranking'), r);
    pintaTM(document.getElementById('db-cmp'), hist);

    lista.innerHTML = hist.length === 0
      ? '<div class="empty"><div class="ico">📭</div><p>Sin capturas en este período</p></div>'
      : hist.map(d => {
          const dt = d.data();
          const tn = tenFromDoc(dt);
          const badge = dt.estado === 'aprobado' ? '<span class="bge bok">✅ aprobado</span>'
            : dt.estado === 'correccion' ? '<span class="bge brd">🔁 corrección</span>'
            : '<span class="bge bpend">🔄 pendiente</span>';
          return `<div class="card" style="margin-bottom:8px">
            <div style="display:flex;align-items:center;gap:8px">
              <span class="vcod">${es(dt.codigo_variante)}</span>
              <span style="font-size:13px;font-weight:600;flex:1">${es(dt.modelo)}${dt.demo ? ' <span class="bge bpend">DEMO</span>' : ''}</span>
              ${badge}
            </div>
            <div class="mr"><span>${dt.folio ? es(dt.folio) + ' · ' : ''}${es(nombre(dt.id_muestrista))}</span><span>${fmtDate(dt.dt_fin)}</span></div>
            <div class="mr"><span>TEN: <strong style="color:var(--gn)">${fmtMin(tn)}</strong></span><span>TM: <span style="color:var(--rd)">${fmtMin(dt.tm_seg || 0)}</span></span></div>
            ${dt.estado === 'aprobado' ? `<button class="btn btn-bl btn-sm" style="margin-top:8px;width:100%" data-view="${es(d.id)}">👁 Ver ficha aprobada</button>` : ''}
          </div>`;
        }).join('');
  } catch (e) {
    console.error('Dashboard error:', e);
    if (seq !== loadSeq || ses !== APP.sesion) return;
    limpiar();
    APP.dbDocs = [];
    if (lista) lista.innerHTML = '<div class="empty"><div class="ico">⚠️</div><p>No se pudo cargar el dashboard</p></div>';
    toast('Error cargando el dashboard — revisa tu conexión', false);
  }
}

// Segundos de pausa autorizada por ficha. Una pausa aprobada y todavía
// abierta cuenta hasta ahora; las horas son del servidor (`inicio_tm` y
// `fin_tm` se escriben con request.time), así que esto no se puede inflar
// desde la tablet.
function respaldoPorFicha(snap) {
  const out = {};
  snap.docs.forEach(d => {
    const capId = d.ref.parent.parent ? d.ref.parent.parent.id : null;
    if (!capId) return;
    const p = d.data();
    const ini = p.inicio_tm && p.inicio_tm.toMillis ? p.inicio_tm.toMillis() : null;
    if (ini === null) return;
    const fin = p.fin_tm && p.fin_tm.toMillis ? p.fin_tm.toMillis() : Date.now();
    out[capId] = (out[capId] || 0) + Math.max(0, (fin - ini) / 1000);
  });
  return out;
}

// ── ¿Se puede creer el cronómetro? ──
function pintaDiagnostico(el, dg, conPausas) {
  if (!el) return;
  if (!dg.total) { el.innerHTML = ''; return; }
  const seg = (n, cls) => n ? `<span class="seg ${cls}" style="width:${es((n / dg.total * 100).toFixed(2))}%"></span>` : '';
  const ley = (n, cls, txt) => `<span><i class="dot ${cls}"></i>${es(txt)} <b>${es(n)}</b></span>`;
  el.innerHTML = `<div class="card">
    <div class="ftitle">¿Se puede creer el cronómetro?</div>
    <div class="pila" role="img" aria-label="${es(dg.sin_anomalias)} de ${es(dg.total)} fichas con tiempo medible">
      ${seg(dg.sin_anomalias, 'ok')}${seg(dg.menor_que_tejido, 'am')}${seg(dg.duracion_alta, 'rd')}${seg(dg.tm_sin_respaldo, 'pu')}${seg(dg.no_evaluable, 'gr')}
    </div>
    <div class="leyenda">
      ${ley(dg.sin_anomalias, 'ok', 'Se puede medir')}
      ${ley(dg.menor_que_tejido, 'am', 'Duró menos que el tejido')}
      ${ley(dg.duracion_alta, 'rd', 'Demasiado larga')}
      ${ley(dg.tm_sin_respaldo, 'pu', 'Tiempo muerto sin pausa')}
      ${ley(dg.no_evaluable, 'gr', 'Sin datos para juzgar')}
    </div>
    <p class="db-expl">Solo <strong>${es(dg.sin_anomalias)} de ${es(dg.total)}</strong> fichas tienen un tiempo que se pueda comparar.
      <strong>Duró menos que el tejido:</strong> la ficha estuvo abierta menos tiempo del que tarda la máquina en tejer esos pares, o sea que se abrió al final solo para capturar.
      <strong>Demasiado larga:</strong> más de 12 horas de reloj (o más del doble del tejido, si el tejido es largo); lo más probable es que el reloj siguiera corriendo fuera del turno.
      <strong>Tiempo muerto sin pausa:</strong> la ficha descuenta más tiempo muerto del que autorizaste en pausas. El tiempo muerto lo escribe la tablet del muestrista; lo único que lo respalda es una pausa aprobada por ti, con las horas del servidor.
      El tiempo solo sirve si la ficha se abre al empezar el trabajo y se pide pausa al terminar el día.${conPausas ? '' : ' <strong>Ahora mismo no se pudieron leer las pausas, así que el tiempo muerto no se está revisando.</strong>'}</p>
  </div>`;
}

// ── Por muestrista (descriptivo, no es ranking) ──
function pintaPersonas(el, personas, who) {
  if (!el) return;
  const con = personas.filter(p => p.firmadas > 0);
  if (!con.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="card">
    <div class="ftitle">Por muestrista</div>
    <div class="tabla-wrap"><table class="tabla">
      <thead><tr><th>Muestrista</th><th>Firmadas</th><th>Aprobadas</th><th>Con Lety</th><th>Se pueden medir</th><th>Tiempo típico</th><th>Campos llenos</th></tr></thead>
      <tbody>${con.map(p => `<tr${who !== 'all' && who === p.uid ? ' class="sel"' : ''}>
        <td><strong>${es(nombre(p.uid))}</strong></td>
        <td>${es(p.firmadas)}</td>
        <td>${es(p.aprobadas)}</td>
        <td>${es(p.conLety)}</td>
        <td>${es(p.tiempo.sin_anomalias)} de ${es(p.firmadas)}</td>
        <td>${es(duracion(p.tiempoTipicoMin))}</td>
        <td>${p.camposLlenos === null ? '—' : es(pct(p.camposLlenos))}</td>
      </tr>`).join('')}</tbody>
    </table></div>
    <p class="db-expl">"Tiempo típico" es la mediana de las fichas que sí se pueden medir; con tan pocas, describe esas fichas y no el desempeño de la persona.</p>
  </div>`;
}

// ── Ranking: en espera hasta que los datos lo sostengan ──
function pintaRanking(el, r) {
  if (!el) return;
  const c = r.compuerta, f = COMPUERTA.fraccionSinAnomalias, m = COMPUERTA.minimoPorPersona;
  const barra = (fr, ok) => `<div class="req-bar"><i style="width:${es(Math.min(100, Math.round(fr * 100)))}%"${ok ? ' class="ok"' : ''}></i><span class="meta" style="left:${es(f * 100)}%"></span></div>`;
  const req = (ok, txt, detalle, fr) => `<div class="req${ok ? ' ok' : ''}">
    <div class="req-top"><span><i class="chk${ok ? ' ok' : ''}"></i>${es(txt)}</span><span class="req-det">${es(detalle)}</span></div>
    ${fr === null ? '' : barra(fr, ok)}
  </div>`;
  const personas = c.porPersona.filter(p => (r.personas.find(x => x.uid === p.uid) || {}).firmadas > 0);
  el.innerHTML = `<div class="card">
    <div class="ftitle">Ranking</div>
    <div class="al ali"><span>🏁</span><span style="font-size:12.5px">En espera: todavía no hay datos para comparar a las muestristas de forma justa. Con los números de hoy, cualquier puntaje las separaría solo por cuántas tareas le toca a cada quien.</span></div>
    ${req(c.fraccionGlobal >= f, 'Fichas que se pueden medir', pct(c.fraccionGlobal) + ' · se necesita ' + pct(f), c.fraccionGlobal)}
    ${personas.map(p => {
      const ok = p.fraccion >= f && p.sinAnomalias >= m;
      return req(ok, nombre(p.uid), p.sinAnomalias + ' medibles (' + pct(p.fraccion) + ') · se necesitan ' + m + ' y ' + pct(f), p.fraccion);
    }).join('')}
    ${req(false, 'Regla para comparar muestras de distinta cantidad y proceso', 'se define con datos limpios', null)}
    <p class="db-expl">Cuando se cumpla todo, aquí aparece el podio con puntos, como en Captura Mecánicos: el tiempo de cada muestra contra la meta de su complejidad, los campos llenos y el volumen.</p>
  </div>`;
}

// ── Tiempo muerto por causa (sobre el historial del periodo) ──
function pintaTM(el, docs) {
  if (!el) return;
  const porCausa = {};
  docs.forEach(d => Object.entries(d.data().tm_causas || {}).forEach(([c, s]) => {
    if (typeof s === 'number' && s > 0) porCausa[c] = (porCausa[c] || 0) + s;
  }));
  const causas = Object.entries(porCausa).map(([cid, s]) => {
    const c = TM_CAUSES.find(x => x.id === cid);
    return { label: c ? c.label : cid, raw: s };
  }).sort((a, b) => b.raw - a.raw);
  const max = Math.max(0, ...causas.map(c => c.raw));
  if (!causas.length || !max) { el.innerHTML = ''; return; }
  el.innerHTML = '<div class="stitle" style="margin-top:8px">Tiempo muerto por causa — minutos del período</div>'
    + causas.map(c => {
      const w = Math.max(0, Math.min(100, Math.round(c.raw / max * 100)));
      return `<div class="cmp"><span class="cl">${es(c.label)}</span><div class="ct"><div class="cb" style="width:${es(w)}%;background:var(--rd-full)"></div></div><span class="cv">${es(c.raw >= 60 ? Math.round(c.raw / 60) + ' min' : Math.round(c.raw) + ' s')}</span></div>`;
    }).join('');
}
