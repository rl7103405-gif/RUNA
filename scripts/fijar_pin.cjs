/**
 * Fija el PIN de UNA cuenta de RUNA (de las que no son de piso) al valor que
 * Roberto eligió. Uso, en la raíz de RUNA:
 *   NODE_PATH="C:/Users/elita/Desktop/RAGNAR/web/node_modules" \
 *     PIN=123456 node scripts/fijar_pin.cjs <id>
 * Solo acepta roberto | ceo | demo_lety | demo_muestrista (regla dura 48: las
 * cuentas de piso no se tocan desde aquí). No imprime el PIN.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { initializeApp, refreshToken } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

const PERMITIDAS = ['roberto', 'ceo', 'demo_lety', 'demo_muestrista'];
const id = process.argv[2];
const pin = process.env.PIN || '';
if (!PERMITIDAS.includes(id)) { console.error('Cuenta no permitida: ' + id + ' (solo ' + PERMITIDAS.join(', ') + ')'); process.exit(1); }
if (!/^\d{6}$/.test(pin)) { console.error('PIN debe ser de 6 dígitos (variable de entorno PIN)'); process.exit(1); }

function credencialCLI() {
  const p = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
  const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
  return refreshToken({
    type: 'authorized_user',
    client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
    client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi',
    refresh_token: cfg.tokens.refresh_token,
  });
}

(async () => {
  const app = initializeApp({ credential: credencialCLI(), projectId: 'quini-muestristas' });
  const auth = getAuth(app);
  const user = await auth.getUserByEmail(id + '@quini-muestristas.local');
  await auth.updateUser(user.uid, { password: pin });
  console.log('PIN de ' + id + ' actualizado (uid ' + user.uid.slice(0, 6) + '…)');
})().catch(e => { console.error('ERROR:', e.message || e); process.exit(1); });
