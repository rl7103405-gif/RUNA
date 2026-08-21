# IDEAS — RUNA

Lo que se pidió o se ocurrió y **no** se va a hacer en la sesión en curso. Una
feature por sesión; lo demás vive aquí hasta que le toque. Cada entrada dice
quién lo pidió, cuándo y el porqué, para no rediseñarlo desde cero después.

## Itinerario: tareas con fecha, visibles desde que se asignan (Lety + Roberto, 2026-08-21)

Lety quiere poder dejar tareas para días futuros (mañana en la mañana, el
lunes, toda la semana) cuando no va a estar, sin que se les vea a los
muestristas como un montón de carga de hoy. Primera idea: ocultarlas hasta la
fecha. **Roberto la cambió el mismo día**: mejor que les aparezcan desde que se
asignan, pero como **itinerario** — "tus próximas tareas" con su fecha — y así
no hay estados escondidos ni sorpresas.

Diseño mínimo (no implementado):
- `desarrollos.fecha_programada` (Timestamp, medianoche local del día elegido)
  y `fecha_limite` opcional; Lety los pone al asignar (vacío = hoy, como
  siempre) y los puede mover mientras la tarea siga `pendiente`.
- Muestrista: su lista se parte en **Hoy / Atrasadas** (fecha ≤ hoy) y
  **Próximas** (fecha futura, ordenadas por día, con el día visible). Puede
  empezar una próxima si quiere (está ocioso): no se bloquea nada, es
  itinerario, no candado.
- Lety: en Tareas, badge con la fecha; vencida = badge rojo informativo.
- KPIs sin cambio: el tiempo de la tarea cuenta desde la primera captura.
- Nada de reglas nuevas salvo permitir que Lety escriba/mueva esas dos fechas
  (campos nuevos en `create` y una rama de `update` mientras esté pendiente).

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
