# IDEAS — RUNA

Lo que se pidió o se ocurrió y **no** se va a hacer en la sesión en curso. Una
feature por sesión; lo demás vive aquí hasta que le toque. Cada entrada dice
quién lo pidió, cuándo y el porqué, para no rediseñarlo desde cero después.

## Tareas programadas: "asignar para el día tal" (Lety, 2026-08-21)

Lety quiere dejar tareas asignadas que **no les aparezcan a los muestristas
hasta una fecha** (mañana en la mañana, el lunes, toda la semana), para poder
cargar trabajo por adelantado cuando no va a estar, sin que se les vea como
más carga hoy. Opcional una **fecha de término** ("que acaben el día tal"). Si
no se pone fecha, se asigna como hoy.

Diseño mínimo pensado (no implementado):
- `desarrollos.visible_desde` (Timestamp, medianoche local del día elegido) y
  `fecha_limite` opcional. Ambos los escribe Lety al asignar y los puede mover
  mientras la tarea siga `pendiente` (rama nueva en reglas; no después de que
  el muestrista la tomó).
- Muestrista: su lista filtra `visible_desde <= ahora` (cliente); la **regla
  de crear captura** exige `request.time >= visible_desde` para que no se
  pueda arrancar antes ni desde la consola.
- Lety: badge "programada para el lun 25" en Tareas; vencida = badge rojo
  (informativo, sin bloquear).
- KPIs no cambian: el tiempo de la tarea sigue contando desde la primera
  captura, no desde la fecha programada.
- Pendiente de decidir: si al muestrista se le avisa el día que aparece
  (hoy no hay notificaciones; con que aparezca en su lista basta).

## Consumo por media docena en la ficha (Lety, 2026-08-21, dictado corrido)

"Incluir consumo en media docena para poder cargar el pedido con ese consumo;
se agarra del pack el diseño más abundante y sobre eso; si viene el consumo
(en la F.T.T.), compara." Interpretación: capturar en la ficha práctica el
**consumo de hilo por media docena** (peso) para poder cargar el pedido de
producción con ese dato; en un pack, el que manda es el diseño más abundante;
y si la ficha técnica trae el consumo objetivo, compararlo como se comparan
las medidas. Toca [[gramajes-y-mermas]] del vault: leerlo antes de diseñar.
**[POR CONFIRMAR]** con Lety qué campo exacto y en qué unidad.

## Cambiar pares de una tarea ya terminada (Lety, 2026-08-21)

Intentó ajustar los pares después de que los muestristas entregaron (el
cambio había sido verbal durante la tarea). Hoy las reglas lo niegan a
propósito: lo que se pidió es parte del registro contra el que se entregó. Si
se repite, opciones: permitirlo con motivo obligatorio y registro (como la
cancelación), o dejarlo como está y que el ajuste se haga durante. Decidir
con Roberto; por ahora el mensaje explica que la tarea ya se cerró.

## Ya anotadas antes (ver vault)

- Muestrarios sin código: estado "descartado por el cliente" para que no
  cuenten como trabajo productivo (2026-08-11).
- PIN de 8 dígitos o segunda medida para Dirección y Roberto; App Check.
- Migrar tareas viejas a `pares_por_codigo` + `tipo_pack` y quitar la
  tolerancia del `create` de capturas.
