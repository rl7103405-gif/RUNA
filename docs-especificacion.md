# PROMPT PARA CLAUDE CODE — Sistema de Muestristas · Deportivos Quini

> Copia todo este documento y pégalo como primer mensaje en Claude Code.
> Coloca también el archivo `sistema-muestristas-quini.html` en la carpeta del proyecto antes de empezar.

---

## CONTEXTO DEL NEGOCIO

Soy Beto, director de Deportivos Quini S.A. de C.V., fábrica de calcetines en Puebla, México. Estamos digitalizando el área de **muestristas** (los operarios que desarrollan las muestras físicas antes de producción).

**Usuarios del sistema (3):**
| Usuario | Rol | PIN por defecto |
|---|---|---|
| Lety | Admin — desarrollo de producto. Asigna tareas, revisa y aprueba fichas | `123456` |
| Israel | Muestrista | `000001` |
| Jesús | Muestrista | `000002` |

**Flujo del proceso:**
1. Lety crea un desarrollo (tarea) y lo asigna a un muestrista. Puede ser **código único** o **pack con variantes** (un pack puede tener varios códigos de variante, ej. color negro=2798, gris=2818).
2. El muestrista ve sus tareas en su tablet, selecciona una variante y **la captura es SIEMPRE a nivel variante**, nunca a nivel pack.
3. Al iniciar corre un **timer**. Puede haber **varias capturas simultáneas**, cada una con timer independiente (pausar una no afecta las otras).
4. Si hay espera (máquina ocupada, falta material, aprobación de color, etc.) registra un **Tiempo Muerto (TM)** con causa del catálogo. El **TEN (Tiempo Efectivo Neto) = tiempo bruto − TM**. Las causas externas NO penalizan al muestrista.
5. El muestrista llena la **ficha práctica** (ver campos abajo) y **firma digitalmente** (dibujo en canvas).
6. Lety revisa la ficha, y **aprueba con su propia firma** o solicita corrección.
7. Todo queda en Firestore en tiempo real, con dashboard filtrable por día/semana/mes/año.

**Reglas de negocio críticas:**
- El **tipo de complejidad (A/B/C)** lo asigna Lety y NUNCA es visible para los muestristas.
  - A = Tin básico/liso (1.0 pts, 90 min estándar)
  - B = Con diseño (2.0 pts, 180 min)
  - C = Jacquard/alta complejidad (3.5 pts, 300 min)
- Cambio de color NO es un desarrollo nuevo.
- Los PINs son de 6 dígitos, se guardan en Firestore (colección `pines`) y se pueden cambiar desde la app. Cambiar cualquier PIN requiere confirmar con el PIN de admin (Lety).
- Hay ~113 máquinas (marca principal Zhenxing), la numeración se salta números, por eso **marca y número de máquina se capturan manualmente** (texto libre).

**Campos de la ficha práctica (lo que captura el muestrista):**
- Máquina: marca + número (texto libre)
- Medidas de salida en cm, tabla con columnas "Sin hormar" y "Hormado": A=Alto tubo, B=Planta, C=Ancho planta, D=Ancho elástico, E=Alto elástico
- Tiempo de ciclo (min + seg), Peso salida de máquina (g), Peso cerrado (g)
- Giros de cadena: elástico, tubo, planta, rubber
- Velocidades de cadena: elástico, tubo, talón y punta, planta
- Punto de máquina: DEN-1, DEN-2, SINK2
- Pares producidos + tipo de pack
- Observaciones
- (FUTURO, no ahora): foto de la muestra — requiere Firebase Storage/plan Blaze que aún no activamos. NO usar Storage.

**Catálogo de causas de Tiempo Muerto:**
| Causa | Tipo |
|---|---|
| ⚙️ Espera de máquina (producción) | externo |
| 🎨 Espera aprobación de color | externo |
| 🧵 Espera de material / hilo | externo |
| 👁 Espera revisión Lety / BMP | externo |
| ✅ Espera aprobación cliente | externo |
| 🔧 Falla / mantenimiento máquina | externo |
| ☕ Descanso personal estándar | interno (no afecta) |
| 🚶 Tiempo personal excesivo | interno (sí afecta) |

---

## ESTADO ACTUAL

Existe un prototipo funcional en **UN SOLO ARCHIVO HTML** (`sistema-muestristas-quini.html`, incluido en este proyecto) con:
- Login con PIN (teclado numérico visual, animación shake en error)
- Vista muestrista: Tareas / Activas / Historial
- Vista Lety: Asignar (modo código único o pack) / Revisar / Dashboard / Config PINs
- Timers múltiples simultáneos con persistencia en localStorage
- Firma digital en canvas (touch + mouse)
- Firebase Firestore en tiempo real (compat SDK 9.22.0 vía CDN)

**Firebase (proyecto ya creado, Firestore activo en modo prueba, región nam5):**
```js
const firebaseConfig = {
  apiKey: "AIzaSyCm8Ks6Lpds4LoIn3VZkZjh62VVRsXeHdI",
  authDomain: "quini-muestristas.firebaseapp.com",
  projectId: "quini-muestristas",
  storageBucket: "quini-muestristas.firebasestorage.app",
  messagingSenderId: "912659108385",
  appId: "1:912659108385:web:0be9664baec23499910960"
};
```

**Colecciones Firestore actuales:**
- `desarrollos` — {ot, po, codigo_quini, modelo, cliente, genero, talla, tipo_producto, tipo_complejidad, asignado_a, notas, variantes[{codigo, descripcion, pares_requeridos, tipo_pack}], estado: pendiente|en_proceso, fecha_creacion, creado_por}
- `capturas` — {id_desarrollo, id_muestrista, codigo_variante, descripcion_variante, pares_requeridos, tipo_pack, modelo, cliente, ot, po, tipo_producto, estado: activo|pausado|pendiente_lety|correccion|aprobado, elapsed_seg, tm_seg, dt_inicio, dt_fin, maquina_marca, maquina_numero, med_sh{A-E}, med_h{A-E}, t_ciclo_min, t_ciclo_seg, peso_sal, peso_cer, giros{el,tb,pl,rb}, vels{el,tb,tp,pl}, pto{d1,d2,sk}, pares, obs, firma_m (dataURL), firma_l (dataURL), iter}
- `pines` — doc por uid {pin: "123456"}
- `_ping` — test de conectividad

**Lecciones aprendidas (bugs ya resueltos — NO reintroducir):**
1. Firestore: evitar queries compuestas `where+where+orderBy` (piden índices manuales). Usar un solo `where` y filtrar por fecha/estado en el cliente.
2. Canvas de firma: inicializar DESPUÉS de que la pantalla sea visible (setTimeout ~80ms), si no queda con dimensiones 0.
3. TEN de capturas históricas se calcula desde Firestore (`elapsed_seg - tm_seg`), nunca desde timers en memoria.
4. Verificar conexión Firestore con un write de prueba; si `permission-denied`, avisar que las reglas de modo prueba vencieron.
5. Los archivos HTML generados por heredoc se pueden truncar — siempre verificar sintaxis JS completa al final.

---

## LO QUE QUIERO QUE HAGAS

1. **Reestructura el proyecto profesionalmente** (deja de ser un solo HTML):
   - Estructura sugerida: `public/` con `index.html` + `css/` + `js/` en módulos separados (auth, timers, captura, admin, dashboard, firma, firebase), o si prefieres Vite + vanilla JS, adelante. Sin frameworks pesados — debe correr rápido en tablets baratas.
   - Mantén el diseño visual actual (dark, acentos ámbar #F5A623, mobile-first, bottom navigation).
2. **Configura Firebase Hosting + GitHub:**
   - `firebase init hosting` apuntando al proyecto `quini-muestristas`, public dir = carpeta de build
   - Crea repo Git con `.gitignore` apropiado, commits limpios
   - Configura GitHub Actions para deploy automático a Firebase Hosting en cada push a `main` (usa `FirebaseExtended/action-hosting-deploy`)
   - Al final quiero mi app en `https://quini-muestristas.web.app`
3. **Escribe reglas de Firestore de producción** (el modo prueba vence a los 30 días): las colecciones deben ser legibles/escribibles solo con las validaciones básicas necesarias; documenta el archivo `firestore.rules` y súbelo con `firebase deploy`.
4. **Mejoras funcionales al reestructurar:**
   - PWA completa: manifest.json + service worker para que cargue offline la interfaz (los datos siguen necesitando red) y sea instalable en Android/iOS
   - Indicador visual permanente de estado de conexión Firestore
   - En el dashboard de Lety: exportar historial a CSV
   - Botón para que Lety pueda ver/reabrir fichas ya aprobadas
   - Confirmación antes de acciones destructivas (rechazar ficha, salir de captura activa sin guardar)
5. **Verifica todo antes de entregar**: sintaxis, flujo completo (asignar → capturar → firmar → aprobar), y despliega.

Trabaja paso a paso: primero muéstrame el plan de estructura, luego ejecuta. Pregúntame si algo del proceso de negocio no queda claro.
