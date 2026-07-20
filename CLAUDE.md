# CLAUDE.md — Sistema de Muestristas · Deportivos Quini

Contexto completo del proyecto para trabajar en este repositorio.

## Qué es este proyecto

App web (PWA) que digitaliza el área de **muestristas** de Deportivos Quini
S.A. de C.V. (fábrica de calcetines en Puebla, México). Los muestristas
desarrollan las muestras físicas antes de producción; la app gestiona la
asignación de tareas, la captura de fichas prácticas con timers, los tiempos
muertos, las firmas digitales y el dashboard de KPIs.

- **Dueño del proyecto:** Beto, director de Deportivos Quini.
- **URL de producción:** https://quini-muestristas.web.app
- **Backend:** Firebase (proyecto `quini-muestristas`, Firestore región nam5).
- **Especificación completa del negocio:** ver `docs-especificacion.md`.
- **Prototipo original (referencia histórica):** `legacy/prototipo-original.html`.

## Usuarios (3)

| Usuario | uid | Rol | PIN por defecto |
|---|---|---|---|
| Lety | `lety` | Admin: asigna tareas, revisa y aprueba fichas | `123456` |
| Israel | `israel` | Muestrista | `000001` |
| Jesús | `jesus` | Muestrista | `000002` |

## Reglas de negocio críticas (NO romper)

1. La **complejidad (A/B/C)** la asigna Lety y **NUNCA debe ser visible para
   los muestristas** (A=1.0 pts/90 min, B=2.0 pts/180 min, C=3.5 pts/300 min).
2. La captura es **SIEMPRE a nivel variante**, nunca a nivel pack.
3. Varios timers simultáneos e independientes (pausar uno no afecta otros).
4. **TEN = tiempo bruto − TM**. Las causas de TM externas no penalizan al
   muestrista. Catálogo de causas en `public/js/state.js`.
5. Cambio de color NO es un desarrollo nuevo.
6. Marca y número de máquina se capturan como **texto libre** (~113 máquinas,
   numeración con saltos, marca principal Zhenxing).
7. Cambiar cualquier PIN requiere confirmar con el PIN de admin (Lety).
8. **NO usar Firebase Storage** (fotos de muestra quedan para cuando se
   active el plan Blaze).

## Flujo del proceso

Lety asigna desarrollo (código único o pack) → muestrista inicia captura por
variante (timer corre) → registra TM si hay esperas → llena ficha práctica →
firma en canvas → Lety revisa → aprueba con su firma **o** solicita
corrección (la ficha vuelve al muestrista como iteración `iter+1`).

## Arquitectura

Vanilla JS con módulos ES, **sin frameworks ni build** (debe correr rápido
en tablets baratas). Diseño dark, acento ámbar `#F5A623`, mobile-first,
bottom navigation.

```
public/                  ← raíz de Firebase Hosting
  index.html             ← todas las pantallas (s0 login, s1 PIN, sM muestrista,
                            sL Lety, sC captura, sF firma, sR revisión) + modales
  css/styles.css
  js/main.js             ← entrada: expone handlers a window, arranca todo
  js/state.js            ← APP global, USERS, TM_CAUSES, OPEN_STATES
  js/utils.js            ← formato, scr(), toast, confirmDlg()
  js/fb.js               ← init Firebase + indicador de conexión (#conn)
  js/timers.js           ← timers por TIMESTAMPS (no contadores), localStorage
  js/auth.js             ← login PIN, cambio de PINs
  js/muestrista.js       ← tareas, activas, TM, historial
  js/captura.js          ← ficha práctica, borrador, reabrir corrección
  js/firma.js            ← canvas de firma (touch + mouse)
  js/admin.js            ← Lety: asignar, revisar, aprobar/rechazar/reabrir
  js/dashboard.js        ← KPIs, historial, export CSV
  sw.js                  ← service worker (app shell offline)
  manifest.webmanifest   ← PWA instalable
firestore.rules          ← reglas de producción (publicar en Firebase)
firebase.json / .firebaserc
.github/workflows/firebase-hosting-deploy.yml  ← deploy a Hosting en push a main
```

## Colecciones Firestore

- `desarrollos` — {ot, po, codigo_quini, modelo, cliente, genero, talla,
  tipo_producto, tipo_complejidad(A|B|C), asignado_a, notas,
  variantes[{codigo, descripcion, pares_requeridos, tipo_pack}],
  estado: pendiente|en_proceso, fecha_creacion, creado_por}
- `capturas` — {id_desarrollo, id_muestrista, codigo_variante,
  descripcion_variante, pares_requeridos, tipo_pack, modelo, cliente, ot, po,
  tipo_producto, estado: activo|pausado|pendiente_lety|correccion|aprobado,
  elapsed_seg, tm_seg, dt_inicio, dt_fin, maquina_marca, maquina_numero,
  med_sh{A..E}, med_h{A..E}, t_ciclo_min, t_ciclo_seg, peso_sal, peso_cer,
  giros{el,tb,pl,rb}, vels{el,tb,tp,pl}, pto{d1,d2,sk}, pares, obs,
  firma_m(dataURL), firma_l(dataURL), iter}
- `pines` — doc por uid {pin: "123456"}
- `_ping` — {ts} test de conectividad

## Lecciones aprendidas (bugs ya resueltos — NO reintroducir)

1. Firestore: evitar queries compuestas `where+where+orderBy` (piden índices
   manuales). Un solo `where` (o solo igualdades) y filtrar fecha/estado en
   el cliente.
2. Canvas de firma: inicializar DESPUÉS de que la pantalla sea visible
   (setTimeout ~80 ms), si no queda con dimensiones 0.
3. TEN de capturas históricas se calcula desde Firestore
   (`elapsed_seg − tm_seg`), nunca desde timers en memoria.
4. Verificar conexión con un write de prueba a `_ping`; si
   `permission-denied`, avisar que las reglas rechazan la escritura.
5. Timers por timestamps (`Date.now()`), NO contadores `setInterval` — los
   contadores se atrasan si la tablet apaga la pantalla.
6. Las capturas en estado `correccion` DEBEN aparecer al muestrista y
   reabrirse con `iter+1` — nunca crear una captura duplicada.
7. Listas dinámicas: delegación de eventos con data-attributes, NO registrar
   handlers nuevos en cada render (fuga de memoria).

## Comandos

```bash
# Probar localmente (los módulos ES no funcionan con file://)
npx serve public

# Deploy manual de hosting
firebase deploy --only hosting

# Publicar reglas de Firestore
firebase deploy --only firestore:rules

# Verificación rápida de sintaxis de los módulos
for f in public/js/*.js; do node --input-type=module --check < "$f" && echo "OK $f"; done
```

## Estado actual y pendientes (julio 2026)

- [x] App reestructurada en módulos + PWA + mejoras (PR #1).
- [ ] **Publicar `firestore.rules`** en Firebase Console (⚠️ URGENTE: el modo
      prueba vence y bloquea toda la app). Console → Firestore → Reglas →
      pegar el contenido de `firestore.rules` → Publicar.
- [ ] Crear secret de GitHub `FIREBASE_SERVICE_ACCOUNT_QUINI_MUESTRISTAS`
      (JSON de cuenta de servicio de Firebase) para el deploy automático.
- [ ] Merge del PR #1 a `main` → dispara el deploy a Hosting.
- Futuro: foto de la muestra (requiere plan Blaze/Storage), migrar login a
  Firebase Auth para reglas por usuario.

## Advertencias

- El login es por PIN validado en cliente; las reglas de Firestore validan
  forma de datos pero no autentican usuarios individuales.
- No subir NUNCA claves de cuenta de servicio (`*service-account*.json`) —
  el `.gitignore` ya las excluye.
- El service worker cachea el app shell: al cambiar archivos, subir la
  versión del cache (`CACHE` en `sw.js`) si hace falta forzar actualización.
