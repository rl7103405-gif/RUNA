/**
 * Cierra en bloque las tareas abiertas y sus fichas NO aprobadas, dejándolas
 * registradas pero fuera de los indicadores (estado 'cancelada', con motivo,
 * autor y fecha). Es el mismo estado que usa el botón "Cancelar tarea" de la
 * app; aquí en bloque porque fueron 7 tareas de golpe.
 *
 * Se usa la sesión del Firebase CLI (dueño del proyecto), así que NO pasa por
 * las reglas: escribe exactamente los mismos campos que la app escribiría.
 *
 * Uso (en la raíz de RUNA):
 *   NODE_PATH="C:/Users/elita/Desktop/RAGNAR/web/node_modules" node scripts/cerrar_tareas.cjs
 *      -> ENSAYO: dice qué haría, no toca nada
 *   ... EJECUTAR=1 node scripts/cerrar_tareas.cjs
 *
 * NO toca: fichas ya aprobadas (son historia), tareas terminadas o ya
 * canceladas, ni nada del ambiente de prueba.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { refreshToken } = require('firebase-admin/app');

const MOTIVO = process.env.MOTIVO
  || 'Error de la app del 22 al 27 de agosto: los muestristas no podian iniciar ni finalizar fichas. Se cierra para empezar limpio.';
const POR = process.env.POR || 'roberto';
const EJECUTAR = process.env.EJECUTAR === '1';

const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json'), 'utf8'));
const cred = refreshToken({
  type: 'authorized_user',
  client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
  client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi',
  refresh_token: cfg.tokens.refresh_token,
});
const FS = 'https://firestore.googleapis.com/v1/projects/quini-muestristas/databases/(default)/documents';
const AHORA = new Date().toISOString();

const val = o => { if (!o) return undefined; const [k, v] = Object.entries(o)[0];
  if (k === 'mapValue') return Object.fromEntries(Object.entries(v.fields || {}).map(([a, b]) => [a, val(b)]));
  if (k === 'arrayValue') return (v.values || []).map(val);
  if (k === 'integerValue') return Number(v); if (k === 'nullValue') return null; return v; };
const doc = d => Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, val(v)]));

const ABIERTAS_CAP = ['activo', 'pausado', 'correccion', 'pendiente_lety'];

(async () => {
  const { access_token: t } = await cred.getAccessToken();
  const H = { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
  const q = async b => { const x = await fetch(FS + ':runQuery', { method: 'POST', headers: H, body: JSON.stringify(b) });
    return (await x.json()).filter(r => r.document).map(r => ({ id: r.document.name.split('/').pop(), _path: r.document.name, ...doc(r.document) })); };
  const patch = async (ruta, campos) => {
    const mask = Object.keys(campos).map(k => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&');
    const fields = {};
    Object.entries(campos).forEach(([k, v]) => { fields[k] = typeof v === 'boolean' ? { booleanValue: v } : (v instanceof Date ? { timestampValue: v.toISOString() } : (k.endsWith('_en') ? { timestampValue: v } : { stringValue: String(v) })); });
    const r = await fetch(FS + ruta + '?' + mask, { method: 'PATCH', headers: H, body: JSON.stringify({ fields }) });
    if (!r.ok) throw new Error(ruta + ' -> ' + r.status + ' ' + (await r.text()).slice(0, 200));
  };

  console.log(EJECUTAR ? 'EJECUTANDO' : 'ENSAYO (no toca nada)');
  console.log('motivo:', MOTIVO, '\n');

  const devs = await q({ structuredQuery: { from: [{ collectionId: 'desarrollos' }] } });
  const caps = await q({ structuredQuery: { from: [{ collectionId: 'capturas' }] } });
  const objetivo = devs.filter(d => ['pendiente', 'en_proceso'].includes(d.estado) && !d.demo);

  let nCap = 0, nPausas = 0;
  for (const d of objetivo) {
    const suyas = caps.filter(c => c.id_desarrollo === d.id && ABIERTAS_CAP.includes(c.estado));
    console.log('TAREA', d.modelo, '(' + d.estado + ') ->cancelada | fichas a cerrar:',
      suyas.map(c => c.folio + ':' + c.estado).join(', ') || '(ninguna)');
    if (!EJECUTAR) { nCap += suyas.length; continue; }
    for (const c of suyas) {
      // Pausas vivas de esa ficha
      const pr = await fetch(FS + '/capturas/' + c.id + '/pausas', { headers: H });
      const pj = pr.ok ? await pr.json() : {};
      for (const p of (pj.documents || [])) {
        const pd = doc(p);
        if (['pendiente', 'aprobada'].includes(pd.estado)) {
          await patch('/capturas/' + c.id + '/pausas/' + p.name.split('/').pop(),
            { estado: 'cancelada', fin_tm: AHORA, decidida_por: POR });
          nPausas++;
        }
      }
      await patch('/capturas/' + c.id, { estado: 'cancelada', cancelada_en: AHORA, cancelada_por: POR });
      nCap++;
    }
    await patch('/desarrollos/' + d.id,
      { estado: 'cancelada', cancelada_motivo: MOTIVO, cancelada_por: POR, cancelada_en: AHORA });
  }
  console.log('\nTareas:', objetivo.length, '| fichas cerradas:', nCap, '| pausas cerradas:', nPausas);
  if (!EJECUTAR) console.log('(ensayo: nada se escribió)');
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
