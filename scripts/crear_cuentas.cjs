/**
 * Crea (o repara) las cuentas de RUNA que no son de piso: Roberto, Dirección
 * (CEO, solo lectura) y las dos de PRUEBA (demo_lety / demo_muestrista).
 *
 * Cada cuenta = un usuario de Firebase Auth (correo sintético
 * {id}@quini-muestristas.local, contraseña = PIN de 6 dígitos) + el perfil
 * usuarios/{uid} = { empleadoId, rol, activo, demo } que leen las reglas.
 *
 * CREDENCIAL: RUNA no tiene serviceAccountKey.json en esta máquina (la
 * suya vive en GitHub Secrets). Se usa la sesión del Firebase CLI
 * (~/.config/configstore/firebase-tools.json): la cuenta dueña del proyecto.
 * Con ese token, Auth va por el Admin SDK y Firestore por su API REST (el
 * cliente de Firestore del Admin SDK exige certificado o ADC).
 * Nada de esto se imprime: los PINs se escriben en un JSON temporal (en
 * %TEMP%, fuera del repo) que el Excel del Escritorio consume y borra.
 *
 * Uso (en la raíz de RUNA). firebase-admin NO está instalado en RUNA: se toma
 * prestado de RAGNAR por NODE_PATH:
 *   NODE_PATH="C:/Users/elita/Desktop/RAGNAR/web/node_modules" node scripts/crear_cuentas.cjs
 *   node scripts/crear_cuentas.cjs                 <- ensayo: dice qué haría
 *   EJECUTAR=1 node scripts/crear_cuentas.cjs      <- crea lo que falte
 *   EJECUTAR=1 RESET=1 node scripts/crear_cuentas.cjs
 *       <- además rota el PIN de las cuentas de ESTA lista que ya existan
 *          (nunca toca a lety/israel/jesus: regla dura 48)
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { initializeApp, refreshToken } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

const PROYECTO = 'quini-muestristas';
const DOMINIO = 'quini-muestristas.local';
// FUERA del árbol del proyecto (ni git add -f ni un respaldo se lo llevan):
// lo consume y borra el script que arma el Excel del Escritorio.
const SALIDA = path.join(os.tmpdir(), 'runa-cuentas-nuevas.json');
const FS = 'https://firestore.googleapis.com/v1/projects/' + PROYECTO + '/databases/(default)/documents';

// Una fila por cuenta. `rol` es el de permisos (reglas); `demo` el ambiente.
const CUENTAS = [
  { id: 'roberto',         nombre: 'Roberto Linares',    rol: 'admin',      demo: false, ve: 'Todo lo de Lety: asignar, tareas, revisar, dashboard, config' },
  { id: 'ceo',             nombre: 'Direccion (papa)',    rol: 'ceo',        demo: false, ve: 'SOLO CONSULTA: tareas, fichas, dashboard, complejidad, ficha tecnica, export. No escribe nada' },
  { id: 'demo_lety',       nombre: 'PRUEBA - admin',      rol: 'admin',      demo: true,  ve: 'Lo de Lety pero solo sobre datos de PRUEBA (folios FD-)' },
  { id: 'demo_muestrista', nombre: 'PRUEBA - muestrista', rol: 'muestrista', demo: true,  ve: 'Lo de Israel/Jesus pero solo tareas de PRUEBA' },
];

const EJECUTAR = process.env.EJECUTAR === '1';
const RESET = process.env.RESET === '1';

function pin6() {
  // 6 dígitos, sin repetidos ni secuencias obvias
  for (;;) {
    const s = String(crypto.randomInt(100000, 1000000));
    if (/^(\d)\1{5}$/.test(s)) continue;
    if ('0123456789'.includes(s) || '9876543210'.includes(s)) continue;
    return s;
  }
}

function credencialCLI() {
  const p = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
  if (!fs.existsSync(p)) throw new Error('No hay sesión del Firebase CLI (' + p + '). Corre `firebase login`.');
  const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
  const rt = cfg.tokens && cfg.tokens.refresh_token;
  if (!rt) throw new Error('La sesión del Firebase CLI no tiene refresh_token. Corre `firebase login --reauth`.');
  // client_id / client_secret públicos del Firebase CLI (firebase-tools/src/api.ts)
  return refreshToken({
    type: 'authorized_user',
    client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
    client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi',
    refresh_token: rt,
  });
}

// ── Firestore por REST con el mismo token ──
function aValor(v) {
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  return { stringValue: String(v) };
}
async function fsCall(token, metodo, ruta, body) {
  const r = await fetch(FS + ruta, {
    method: metodo,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  if (!r.ok) throw new Error('Firestore ' + metodo + ' ' + ruta + ' → ' + r.status + ' ' + txt.slice(0, 300));
  return txt ? JSON.parse(txt) : null;
}
async function leerPerfil(token, uid) {
  try { return await fsCall(token, 'GET', '/usuarios/' + uid); } catch (e) { if (/404/.test(e.message)) return null; throw e; }
}
async function escribirPerfil(token, uid, perfil) {
  const fields = {};
  Object.entries(perfil).forEach(([k, v]) => { fields[k] = aValor(v); });
  // updateMask: solo se tocan estos campos (PATCH sin máscara reemplaza el
  // documento entero y borraría cualquier campo puesto a mano en la consola)
  const mask = Object.keys(perfil).map(k => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&');
  return fsCall(token, 'PATCH', '/usuarios/' + uid + '?' + mask, { fields });
}
async function perfilesPorEmpleado(token, empleadoId) {
  const q = {
    structuredQuery: {
      from: [{ collectionId: 'usuarios' }],
      where: { fieldFilter: { field: { fieldPath: 'empleadoId' }, op: 'EQUAL', value: { stringValue: empleadoId } } },
    },
  };
  const res = await fsCall(token, 'POST', ':runQuery', q);
  return (res || []).filter(x => x.document).map(x => x.document.name.split('/').pop());
}

async function main() {
  const cred = credencialCLI();
  const app = initializeApp({ credential: cred, projectId: PROYECTO });
  const auth = getAuth(app);
  const { access_token: token } = await cred.getAccessToken();
  console.log((EJECUTAR ? 'EJECUTANDO' : 'ENSAYO (sin cambios)') + ' sobre ' + PROYECTO + (RESET ? ' · con RESET de PIN' : ''));

  const salida = [];
  for (const c of CUENTAS) {
    const email = c.id + '@' + DOMINIO;
    let user = null;
    try { user = await auth.getUserByEmail(email); } catch (e) { if (e.code !== 'auth/user-not-found') throw e; }
    const perfilActual = user ? await leerPerfil(token, user.uid) : null;
    let pin = null;
    let accion;
    if (!user) {
      accion = 'CREAR usuario de Auth + perfil';
      if (EJECUTAR) {
        pin = pin6();
        user = await auth.createUser({ email, password: pin, displayName: c.nombre, emailVerified: true });
      }
    } else if (RESET) {
      accion = 'ya existe: ROTAR PIN y asegurar perfil';
      if (EJECUTAR) {
        pin = pin6();
        await auth.updateUser(user.uid, { password: pin, displayName: c.nombre });
      }
    } else {
      accion = 'ya existe (' + (perfilActual ? 'con perfil' : 'SIN perfil') + '): solo asegurar perfil, PIN intacto';
    }
    console.log(' - ' + c.id.padEnd(16) + ' ' + accion);
    if (EJECUTAR && user) {
      // Perfil: crear o reparar. Un perfil huérfano de un uid viejo (cuenta
      // recreada) se detecta por empleadoId y se elimina.
      // Si el perfil no se puede escribir y la cuenta de Auth se acaba de
      // crear, se deshace: una cuenta sin perfil no entra a nada y su PIN se
      // perdería al reintentar.
      const recienCreada = accion.startsWith('CREAR');
      // `activo` se conserva si el perfil ya existía: una cuenta apagada a mano
      // desde la consola no se reactiva sola por correr esto otra vez.
      const activoAntes = perfilActual && perfilActual.fields && perfilActual.fields.activo
        && perfilActual.fields.activo.booleanValue === false ? false : true;
      if (!activoAntes) console.log('   (se conserva activo=false: la cuenta sigue apagada)');
      try {
        await escribirPerfil(token, user.uid, { empleadoId: c.id, rol: c.rol, activo: activoAntes, demo: c.demo, nombre: c.nombre });
      } catch (e) {
        if (recienCreada) { await auth.deleteUser(user.uid).catch(() => {}); console.log('   (cuenta de Auth deshecha: no se pudo escribir el perfil)'); }
        throw e;
      }
      // El PIN se guarda EN CUANTO la cuenta quedó usable (Auth + perfil):
      // si la limpieza de huérfanos de abajo falla, el PIN no se pierde.
      salida.push({ id: c.id, nombre: c.nombre, rol: c.rol, demo: c.demo, email, uid: user.uid, pin: pin || '(sin cambio)', ve: c.ve });
      fs.writeFileSync(SALIDA, JSON.stringify(salida, null, 2));
      try {
        for (const uidViejo of await perfilesPorEmpleado(token, c.id)) {
          if (uidViejo !== user.uid) {
            await fsCall(token, 'DELETE', '/usuarios/' + uidViejo);
            console.log('   (perfil huérfano ' + uidViejo + ' eliminado)');
          }
        }
      } catch (e) { console.log('   (aviso: no se pudo revisar perfiles huérfanos: ' + e.message + ')'); }
    }
  }
  if (EJECUTAR) {
    console.log('Listo. Credenciales en ' + SALIDA + ' (temporal: el Excel lo consume y lo borra).');
  }
}

main().catch(e => { console.error('ERROR:', e.message || e); process.exit(1); });
