// Vista de Lety: asignación de desarrollos y revisión/aprobación de fichas
import { db, fsOk } from './fb.js';
import { APP, USERS } from './state.js';
import { es, fmt, fmtMin, fmtDate, gv, scr, toast, confirmDlg } from './utils.js';
import { showFirma } from './firma.js';
import { loadDB } from './dashboard.js';

export function ltTab(i, btn) {
  [0, 1, 2, 3].forEach(j => document.getElementById('lt' + j).classList.remove('on'));
  document.getElementById('lt' + i).classList.add('on');
  document.querySelectorAll('#sL .nb').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  if (i === 1) loadRev();
  if (i === 2) loadDB();
}

export function initLety() { loadRev(); }

// ── Asignar ──
export function setMode(mode) {
  APP.asignMode = mode;
  document.getElementById('ms-single').classList.toggle('on', mode === 'single');
  document.getElementById('ms-pack').classList.toggle('on', mode === 'pack');
  document.getElementById('form-single').style.display = mode === 'single' ? '' : 'none';
  document.getElementById('form-pack').style.display = mode === 'pack' ? '' : 'none';
}

export function addVar() {
  const cod = gv('vc').trim();
  if (!cod) { toast('Ingresa código de variante', false); return; }
  APP.vars.push({ codigo: cod, descripcion: gv('vd').trim(), pares_requeridos: gv('vp').trim(), tipo_pack: gv('vpk').trim() });
  ['vc', 'vd', 'vp', 'vpk'].forEach(id => { document.getElementById(id).value = ''; });
  renderVars();
}

function renderVars() {
  document.getElementById('vlist').innerHTML = APP.vars.map((v, i) => `
    <div class="vi">
      <div style="flex:1"><div class="vcod">${es(v.codigo)}</div><div style="font-size:12px;color:var(--tx2)">${es(v.descripcion)} · ${es(v.pares_requeridos)} pares · ${es(v.tipo_pack)}</div></div>
      <button data-rmvar="${i}" style="background:none;border:none;color:var(--rd);font-size:18px;cursor:pointer;padding:4px">✕</button>
    </div>`).join('');
}

export async function asignar() {
  if (!fsOk()) return;
  const mod = gv('l-mod').trim();
  if (!mod) { toast('Ingresa el modelo', false); return; }
  let variantes = [];
  if (APP.asignMode === 'single') {
    const cod = gv('s-cod').trim();
    if (!cod) { toast('Ingresa el código de variante', false); return; }
    variantes = [{ codigo: cod, descripcion: gv('s-desc').trim(), pares_requeridos: gv('s-pares').trim(), tipo_pack: gv('s-pack').trim() }];
  } else {
    if (APP.vars.length === 0) { toast('Agrega al menos una variante', false); return; }
    variantes = [...APP.vars];
  }
  try {
    await db.collection('desarrollos').add({
      ot: gv('l-ot'), po: gv('l-po'), codigo_quini: gv('l-cq'),
      modelo: mod, cliente: gv('l-cli'),
      genero: gv('l-gen'), talla: gv('l-tal'), tipo_producto: gv('l-tprod'),
      tipo_complejidad: gv('l-comp'),
      asignado_a: gv('l-asig'),
      notas: gv('l-notas'), variantes,
      estado: 'pendiente',
      fecha_creacion: firebase.firestore.FieldValue.serverTimestamp(),
      creado_por: 'lety',
    });
    APP.vars = [];
    renderVars();
    ['l-ot', 'l-po', 'l-cq', 'l-mod', 'l-cli', 'l-tal', 'l-tprod', 'l-notas', 's-cod', 's-desc', 's-pares', 's-pack'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    toast('✅ Desarrollo asignado');
  } catch (e) { console.error(e); toast('Error asignando', false); }
}

// ── Revisar ──
export async function loadRev() {
  if (!fsOk()) return;
  try {
    // Un solo where por query — sin índices compuestos manuales
    const snap = await db.collection('capturas').where('estado', '==', 'pendiente_lety').get();
    const el = document.getElementById('pend-list');
    if (el) el.innerHTML = snap.empty
      ? '<div class="empty"><div class="ico">✅</div><p>Sin fichas pendientes</p></div>'
      : snap.docs.map(d => renderRevCard(d.id, d.data())).join('');
    const snap2 = await db.collection('capturas').where('estado', 'in', ['activo', 'pausado', 'correccion']).get();
    const el2 = document.getElementById('proc-list');
    if (el2) el2.innerHTML = snap2.empty
      ? '<div class="empty"><div class="ico">⏱</div><p>Sin capturas activas</p></div>'
      : snap2.docs.map(d => {
          const dt = d.data();
          return `<div class="card">
            <div class="dt">${es(dt.modelo)} · <span class="vcod">${es(dt.codigo_variante)}</span>
              ${dt.estado === 'correccion' ? '<span class="bge brd" style="margin-left:6px">🔁 en corrección</span>' : ''}</div>
            <div class="ds">${(USERS[dt.id_muestrista] || {}).nombre || es(dt.id_muestrista)} · ${fmtDate(dt.dt_inicio)}</div>
          </div>`;
        }).join('');
  } catch (e) { console.error(e); }
}

function renderRevCard(id, d) {
  return `<div class="card am">
    <div class="dt">${es(d.modelo)} · <span class="vcod">${es(d.codigo_variante)}</span>${(d.iter || 1) > 1 ? ` <span class="bge bpend">iter ${es(d.iter)}</span>` : ''}</div>
    <div class="ds">${(USERS[d.id_muestrista] || {}).nombre || es(d.id_muestrista)} · ${es(d.descripcion_variante)}</div>
    <div class="mr"><span>OT ${es(d.ot)}</span><span>${fmtDate(d.dt_fin)}</span></div>
    <button class="btn btn-am btn-sm" style="margin-top:10px;width:100%" data-rev="${es(id)}">📋 Ver y firmar</button>
  </div>`;
}

// readOnly=true: ver ficha ya aprobada (con opción de reabrir)
export async function openRev(capturaId, readOnly = false) {
  if (!fsOk()) return;
  APP.revCap = capturaId;
  try {
    const snap = await db.collection('capturas').doc(capturaId).get();
    const d = snap.data();
    if (!d) { toast('Ficha no encontrada', false); return; }
    document.getElementById('rtitle').textContent = readOnly ? 'Ficha aprobada' : 'Revisar ficha práctica';
    // TEN calculado desde Firestore, no desde timers en memoria
    const tn = Math.max(0, (d.elapsed_seg || 0) - (d.tm_seg || 0));
    const sh = d.med_sh || {}, mh = d.med_h || {}, gi = d.giros || {}, vl = d.vels || {}, pt = d.pto || {};
    document.getElementById('rbody').innerHTML = `
      <div class="card ${readOnly ? 'gn' : 'bl'}">
        <div class="dt">${es(d.modelo)} · <span class="vcod">${es(d.codigo_variante)}</span>${(d.iter || 1) > 1 ? ` <span class="bge bpend">iter ${es(d.iter)}</span>` : ''}</div>
        <div class="ds">${es(d.descripcion_variante)} · ${es(d.tipo_pack)}</div>
        <div class="mr"><span>${(USERS[d.id_muestrista] || {}).nombre || es(d.id_muestrista)}</span><span>OT ${es(d.ot)} · PO ${es(d.po)}</span></div>
        <div class="mr"><span>TEN: <strong style="color:var(--gn)">${fmtMin(tn)}</strong></span><span>TM: <span style="color:var(--rd)">${fmtMin(d.tm_seg || 0)}</span></span></div>
        <div class="mr"><span>Bruto: ${fmtMin(d.elapsed_seg || 0)}</span><span>${fmtDate(d.dt_fin)}</span></div>
      </div>
      <div class="fsec"><div class="ftitle">Máquina</div>
        <div class="g2" style="font-size:13px">
          <div><label class="fl">Marca</label>${es(d.maquina_marca) || '—'}</div>
          <div><label class="fl">Número</label>${es(d.maquina_numero) || '—'}</div>
        </div>
      </div>
      <div class="fsec"><div class="ftitle">Medidas</div>
        <table class="mt">
          <tr><th>Medida</th><th>Sin Hormar</th><th>Hormado</th></tr>
          ${['A', 'B', 'C', 'D', 'E'].map(k => `<tr><td class="lbl">${k}</td><td>${es(sh[k]) || '—'}</td><td>${es(mh[k]) || '—'}</td></tr>`).join('')}
        </table>
      </div>
      <div class="fsec"><div class="ftitle">Tiempos y pesos</div>
        <div class="g2" style="font-size:13px">
          <div><label class="fl">T. ciclo</label>${es(d.t_ciclo_min) || '—'} min ${es(d.t_ciclo_seg) || '—'} seg</div>
          <div><label class="fl">Peso salida</label>${es(d.peso_sal) || '—'} g</div>
          <div><label class="fl">Peso cerrado</label>${es(d.peso_cer) || '—'} g</div>
        </div>
      </div>
      <div class="fsec"><div class="ftitle">Giros / Velocidades / Punto máquina</div>
        <div class="g2" style="font-size:13px">
          <div><label class="fl">Giros elástico</label>${es(gi.el) || '—'}</div>
          <div><label class="fl">Giros tubo</label>${es(gi.tb) || '—'}</div>
          <div><label class="fl">Giros planta</label>${es(gi.pl) || '—'}</div>
          <div><label class="fl">Rubber</label>${es(gi.rb) || '—'}</div>
          <div><label class="fl">Vel. elástico</label>${es(vl.el) || '—'}</div>
          <div><label class="fl">Vel. tubo</label>${es(vl.tb) || '—'}</div>
          <div><label class="fl">Vel. talón y punta</label>${es(vl.tp) || '—'}</div>
          <div><label class="fl">Vel. planta</label>${es(vl.pl) || '—'}</div>
          <div><label class="fl">DEN-1</label>${es(pt.d1) || '—'}</div>
          <div><label class="fl">DEN-2 / SINK2</label>${es(pt.d2) || '—'} / ${es(pt.sk) || '—'}</div>
        </div>
      </div>
      <div class="fsec"><div class="ftitle">Producción</div>
        <div style="font-size:13px"><label class="fl">Pares producidos</label>${es(d.pares) || '—'} de ${es(d.pares_requeridos) || '—'} requeridos</div>
      </div>
      ${d.obs ? `<div class="fsec"><div class="ftitle">Observaciones</div><div style="font-size:13px">${es(d.obs)}</div></div>` : ''}
      ${d.firma_m ? `<div class="fsec"><div class="ftitle">Firma muestrista</div><img src="${d.firma_m}" alt="Firma muestrista" style="max-width:100%;border-radius:var(--r);border:1px solid var(--b2)"></div>` : ''}
      ${readOnly && d.firma_l ? `<div class="fsec"><div class="ftitle">Firma de aprobación (Lety)</div><img src="${d.firma_l}" alt="Firma Lety" style="max-width:100%;border-radius:var(--r);border:1px solid var(--b2)"></div>` : ''}
      ${readOnly
        ? `<button class="btn btn-bl" onclick="reabrirFicha()">🔓 Reabrir ficha (volver a pendiente)</button>`
        : `<div class="brow">
            <button class="btn btn-gn" style="flex:1" onclick="aprobar()">✓ Aprobar y firmar</button>
            <button class="btn btn-rd" style="flex:1" onclick="rechazar()">✕ Solicitar corrección</button>
          </div>`}
    `;
    scr('sR');
  } catch (e) { console.error(e); toast('Error cargando revisión', false); }
}

export function aprobar() {
  APP.sigData = { capturaId: APP.revCap, who: 'lety' };
  document.getElementById('ft').textContent = 'Firma de Lety — Aprobar';
  document.getElementById('fi-inst').innerHTML = '<span>✍️</span><span>Firma para aprobar y cerrar la ficha.</span>';
  showFirma();
}

export function rechazar() {
  confirmDlg(
    'Solicitar corrección',
    'La ficha regresará al muestrista para corregirla y su firma actual se descartará. ¿Continuar?',
    'Sí, solicitar corrección',
    async () => {
      if (!fsOk()) return;
      try {
        await db.collection('capturas').doc(APP.revCap).update({ estado: 'correccion', firma_m: null });
        toast('Corrección solicitada');
        scr('sL');
        loadRev();
      } catch (e) { console.error(e); toast('Error solicitando corrección', false); }
    }
  );
}

// Reabrir una ficha ya aprobada: vuelve a pendiente_lety (conserva la firma
// del muestrista, descarta la aprobación)
export function reabrirFicha() {
  confirmDlg(
    'Reabrir ficha aprobada',
    'La ficha volverá a "pendiente de revisión" y se descartará tu firma de aprobación. ¿Continuar?',
    'Sí, reabrir',
    async () => {
      if (!fsOk()) return;
      try {
        await db.collection('capturas').doc(APP.revCap).update({ estado: 'pendiente_lety', firma_l: null });
        toast('Ficha reabierta — pendiente de revisión');
        scr('sL');
        loadRev();
        loadDB();
      } catch (e) { console.error(e); toast('Error reabriendo ficha', false); }
    }
  );
}

export function backRev() { scr('sL'); loadRev(); }

// Delegación de eventos para listas dinámicas de Lety
export function wireAdminEvents() {
  document.getElementById('vlist').addEventListener('click', e => {
    const btn = e.target.closest('[data-rmvar]');
    if (btn) { APP.vars.splice(Number(btn.dataset.rmvar), 1); renderVars(); }
  });
  document.getElementById('pend-list').addEventListener('click', e => {
    const btn = e.target.closest('[data-rev]');
    if (btn) openRev(btn.dataset.rev, false);
  });
  document.getElementById('db-list').addEventListener('click', e => {
    const btn = e.target.closest('[data-view]');
    if (btn) openRev(btn.dataset.view, true);
  });
}
