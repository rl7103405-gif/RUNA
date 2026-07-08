# Sistema de Muestristas · Deportivos Quini

Aplicación web (PWA) para digitalizar el área de muestristas de Deportivos
Quini S.A. de C.V.: asignación de desarrollos, captura de fichas prácticas
con timers y tiempos muertos, firmas digitales y dashboard de KPIs.

**App en producción:** https://quini-muestristas.web.app

## Estructura del proyecto

```
public/                  ← raíz de Firebase Hosting (sin build, vanilla JS)
  index.html             ← shell de la app (todas las pantallas)
  css/styles.css         ← tema dark, acento ámbar #F5A623, mobile-first
  js/
    main.js              ← punto de entrada, expone handlers y arranca todo
    state.js             ← estado global, usuarios y catálogo de causas TM
    utils.js             ← formato, navegación, toast, modal de confirmación
    fb.js                ← init de Firebase + indicador de conexión
    timers.js            ← timers múltiples basados en timestamps
    auth.js              ← login por PIN y cambio de PINs
    muestrista.js        ← tareas, capturas activas, TM, historial
    captura.js           ← ficha práctica (formulario, borrador, corrección)
    firma.js             ← firma digital en canvas (touch + mouse)
    admin.js             ← vista Lety: asignar, revisar, aprobar/rechazar
    dashboard.js         ← KPIs, historial filtrable, exportación CSV
  sw.js                  ← service worker (interfaz offline)
  manifest.webmanifest   ← instalable en Android/iOS
  icons/                 ← íconos PWA
firestore.rules          ← reglas de producción de Firestore
firebase.json            ← config de Hosting + Firestore
.github/workflows/       ← deploy automático a Hosting en push a main
legacy/                  ← prototipo original de un solo HTML (referencia)
docs-especificacion.md   ← especificación completa del negocio
```

## Usuarios y PINs por defecto

| Usuario | Rol | PIN |
|---|---|---|
| Lety | Admin (asigna, revisa, aprueba) | `123456` |
| Israel | Muestrista | `000001` |
| Jesús | Muestrista | `000002` |

Los PINs se guardan en Firestore (colección `pines`) y se cambian desde la
app; cualquier cambio requiere confirmar con el PIN de admin (Lety).

## Flujo del proceso

1. Lety crea un desarrollo (código único o pack con variantes) y lo asigna.
2. El muestrista inicia la captura **por variante**; corre un timer
   (varias capturas simultáneas, timers independientes).
3. Esperas → **Tiempo Muerto (TM)** con causa del catálogo.
   **TEN = tiempo bruto − TM**; las causas externas no penalizan.
4. El muestrista llena la ficha práctica y firma en pantalla.
5. Lety revisa y aprueba con su firma, o solicita corrección
   (la ficha regresa al muestrista como iteración N+1).
6. Todo en Firestore en tiempo real; dashboard filtrable + export a CSV.

## Deploy

### Hosting (automático)

Cada push a `main` despliega a Firebase Hosting vía GitHub Actions.
Requiere el secret **`FIREBASE_SERVICE_ACCOUNT_QUINI_MUESTRISTAS`**:

1. Firebase Console → ⚙️ Configuración del proyecto → Cuentas de servicio →
   **Generar nueva clave privada** (descarga un JSON).
2. GitHub → repo → Settings → Secrets and variables → Actions →
   **New repository secret**, nombre `FIREBASE_SERVICE_ACCOUNT_QUINI_MUESTRISTAS`,
   valor = contenido completo del JSON.

Alternativa: con Firebase CLI local, `firebase init hosting:github` crea el
secret automáticamente.

### Reglas de Firestore (manual, una vez)

El "modo prueba" de Firestore vence a los 30 días. Despliega las reglas de
producción con:

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only firestore:rules
```

> ⚠️ Nota de seguridad: la app no usa Firebase Auth (login por PIN validado
> en cliente), así que las reglas validan forma de datos y bloquean
> colecciones ajenas y borrados, pero no pueden autenticar usuarios
> individuales. Migrar a Firebase Auth es la mejora recomendada a futuro.

### Deploy manual de hosting (opcional)

```bash
firebase deploy --only hosting
```

## Desarrollo local

No hay build: es HTML/CSS/JS plano. Para probar localmente:

```bash
npx serve public
# o
firebase emulators:start --only hosting
```

(Abrir con `file://` no funciona: los módulos ES requieren servidor HTTP.)

## Decisiones técnicas

- **Sin frameworks**: vanilla JS con módulos ES — carga rápido en tablets
  económicas y no requiere pipeline de build.
- **Timers por timestamps** (`Date.now()`), no contadores `setInterval`:
  el tiempo es exacto aunque la tablet apague la pantalla o el navegador
  congele la pestaña. Estado persistido en `localStorage` por usuario.
- **Queries de Firestore con un solo `where`** (o solo igualdades) y
  filtrado de fecha/estado en el cliente, para no requerir índices
  compuestos manuales.
- **La complejidad (A/B/C) nunca se muestra a los muestristas** — solo
  existe en la vista de Lety y en el documento `desarrollos`.
- **Sin Firebase Storage** (fotos de muestra quedan para cuando se active
  el plan Blaze).
