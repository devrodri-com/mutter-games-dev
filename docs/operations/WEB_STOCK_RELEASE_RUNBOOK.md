# Publicación y continuidad del stock web

Versión 1.0 — 2026-09-30 — propuesta del EXECUTOR para R1-E.

Este procedimiento rige la primera publicación que incluya el barrido de stock, cada publicación posterior, promociones y rollback. **No autoriza ni ejecuta ninguna operación remota.** En la entrega R1-A…E quedan sin aplicar despliegues, WAF, protección del deployment, variables, índices y Cron. La aplicación futura necesita su autoridad vigente y los gates independientes correspondientes; no se infiere de este archivo ni de CI verde.

## 1. Invariantes y alcance

- Proyecto tienda: `prj_MMfug8FP68f5DcbqzmNngveqn1si`, equipo `team_zgY1367CSDsN9mxaF6EXpe3f`. Resolver nuevamente identidad, target y configuración desde la plataforma en cada aplicación. No copiar IDs de deployments de ejemplos.
- Ruta única: `GET /api/internal/web-stock-reconcile`, con `path` y `raw_path` exactamente iguales. Conservar bearer, duración de función de 60 segundos, lote de 20, concurrencia de dos, presupuesto de 40 segundos y cadencia propuesta `*/5 * * * *`.
- La excepción WAF se limita a hosts literales comprobados. No comodines, sufijos globales, reglas de skip, bypass de autenticación ni permiso para otras rutas o métodos.
- Admin compatible con reservas debe estar aplicado antes de la nueva tienda. No volver a una versión del checkout o Admin que ignore reservas vivas. No borrar reservas, cambiar cantidades, cancelar pagos ni devolver dinero para resolver un problema de publicación.
- La protección SSO/Deployment Protection se comprueba separadamente. Un WAF correcto no demuestra que esa otra capa deje pasar el Cron.

Contexto fechado, no runtime acreditado: la revalidación del 30/09/2026 informó plan Pro, `all_except_custom_domains`, variables de sistema expuestas y propuesta de cinco minutos. Hay que releer esos datos. El plan no acredita secretos instalados, índice READY, primer disparo ni host efectivo.

## 2. Evidencia previa obligatoria

Antes de cambiar Production, conservar un registro con hora, operador, autorización, proyecto/equipo, HEAD/tree y par Admin de destino; deployment anterior y candidato con sus URLs, target, aliases y estado; definición y estado efectivo de Cron; inventario de otros jobs del proyecto; configuración WAF activa/versionada completa; y estado de Deployment Protection. No guardar valores de secretos, headers de autenticación, tokens o cuerpos de pago.

Comprobar los requisitos de aplicación ya autorizados: Admin compatible; sólo el índice requerido en READY, sin borrar índices ajenos; nombres y scopes correctos de `MP_COLLECTOR_ID`, `CRON_SECRET`, `WEB_ADMISSION_HMAC_SECRET`, el token MP existente y las credenciales existentes de servidor. El secreto de admisión debe permanecer estable y distinto del de Cron. Confirmar `VERCEL=1`/variables de sistema sin exponer credenciales. Un fallo detiene el cambio de destino; no convierte un intento parcial en entrega completa.

La publicación cambia el contrato del cursor de pedidos del Admin: antes era un ID de texto; ahora es una unión validada por sección que, para los pedidos fechados, conserva timestamp con nanosegundos e ID. Un cursor del contrato anterior recibe `400` intencionalmente. Antes de validar la operación del Admin, hacer una recarga completa de cada SPA/Admin que ya estuviera abierta y comprobar que cargó la versión nueva. El botón «Actualizar» dentro de una UI vieja sólo vuelve a consultar datos y no garantiza descargar el nuevo bundle. Esta condición se aplica a la publicación futura; no exige pausar ni modificar el Admin hoy.

Clasificar la procedencia del host candidato:

1. **Metadata:** host que la plataforma declara para el destino y la configuración Cron. Conservar la lectura y cómo se obtuvo; un alias visto en el panel no prueba por sí solo que sea el destino del scheduler.
2. **Observación:** host, deployment, método y ruta del primer disparo real, correlacionados con función y recibo. Antes de ese disparo, `CRON_HOST_OBSERVED=NO`.
3. Si se acredita un host estable entre deployments, conservar ambas observaciones. Revalidar ese supuesto en cada cambio; no generalizarlo a partir de documentación o un único evento.

Vercel describe un [GET a la URL del deployment de Production](https://vercel.com/docs/cron-jobs), pero el host exacto debe comprobarse. El primer deployment Production con `crons` puede activar la programación. **`--skip-domain` no es prueba de que Cron esté desactivado** ni evita esta secuencia.

## 3. Recomponer únicamente la excepción de stock

Leer WAF inmediatamente antes de preparar cada cambio y comparar su versión/hash con el input del delta. La evidencia histórica v4 sólo identifica las restricciones que se deben conservar; no es un payload vigente para aplicar sin lectura nueva.

En la configuración histórica, las dos reglas que bloquean esta invocación son:

- `rule_mutter_noncanonical_host_deny_8vomr5` (`mutter-noncanonical-host-deny`);
- `rule_mutter_api_get_deny_RGNeDu` (`mutter-api-get-deny`).

Sobre cada predicado de denegación, la modificación propuesta es:

```text
deny_vigente_sin_la_excepcion_anterior
AND NOT (
  host EN conjunto_de_hosts_literales_verificados
  AND method == GET
  AND path == /api/internal/web-stock-reconcile
  AND raw_path == /api/internal/web-stock-reconcile
)
```

Conservar ID, orden, acción y estado de las reglas. `mutter-only-checkout-post`, `mutter-orders-retired` y cualquier regla ajena permanecen íntegros. No retirar una denegación ajena sólo porque impida llegar al Cron: ese cambio exige su propio tratamiento autorizado. Si cambiaron los predicados permanentes o se desconoce la excepción anterior, recomponer y revisar sobre esa configuración; no retirar condiciones mediante heurísticas ni sobrescribir con la v4.

El payload propuesto incluye versión/hash anterior, hosts anterior/siguiente, y `before`/`after` sólo de esas dos reglas. Antes de la aplicación futura, comprobar otra vez que no hubo drift y, después, hacer readback de las reglas completas, su versión y los campos no modificados. Los payloads privados de esta entrega contienen hosts sintéticos y están marcados `PROPOSAL_ONLY_NOT_APPLIED`; no son solicitudes listas para ejecutar.

## 4. Cambio H1 → H2 y primer deployment

**Si H2 puede resolverse antes de activar su programación**, preparar una transición finita:

| Momento | Hosts literales exceptuados | Condición para avanzar |
|---|---|---|
| Estado inicial | H1; ninguno si es primer deployment | Lecturas de identidad/configuración conservadas |
| Preparación de cambio | H1 y H2; sólo H2 si no existe H1 | Ambos destinos conocidos y autorizados; delta WAF aplicado y readback correcto |
| Cambio de Production/promoción | H1 y H2 | Cron efectivo, destino, protección y credenciales verificados |
| Primer disparo sano del destino | H1 y H2 | Gate de §6 satisfecho en H2 |
| Cierre de transición | Sólo H2 | Nueva recomposición y readback; otro disparo posterior no vuelve a H1 |

El máximo transitorio son dos hosts explícitos, nunca toda la allowlist. Conservar H1 durante la transición permite recibir una invocación previa todavía en vuelo; los leases e idempotencia manejan duplicados. Ambos deployments deben respetar reservas. Retirar H1 sólo tras comprobar el destino efectivo; si una invocación posterior aún lo usa, el gate falla y se aplica la contención acordada, no se amplía la excepción a ciegas.

**Si H2 no puede resolverse antes de que Production active Cron**, no declarar que el orden anterior elimina la carrera. La aplicación futura debe incluir un interlock de programación explícitamente autorizado:

1. Identificar el control real disponible y su alcance. Vercel documenta [Disable Cron Jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs); comprobar si afecta a todo el proyecto y listar otros jobs. No suspender trabajos ajenos sin autoridad para su impacto. Este documento no concede ese permiso.
2. Desactivar temporalmente la programación por ese control y conservar readback **antes** de crear/promover el destino. No pausar la tienda ni Admin. Verificar qué invocaciones anteriores siguen en vuelo; desactivar no prueba que se hayan cancelado.
3. Resolver el nuevo deployment y host. Confirmar mediante otro readback que el interlock continúa vigente después de que el target esté preparado. Si ese comportamiento no se puede comprobar, no habilitar el destino como una transición segura ni presumirlo por flags del deploy.
4. Rehacer la excepción exacta, validar SSO y prerrequisitos, y completar el cambio de destino autorizado. Habilitar de nuevo Cron sólo con destino y controles listos; guardar readback del estado y configuración efectivos.
5. Esperar y comprobar el primer disparo real según §6. El intervalo de interlock es una interrupción explícita del seguimiento; registrar duración y atraso posterior. No presentarlo como continuidad sin interrupción ni tiempo máximo garantizado.

Si falta autoridad para ese interlock, hay otros jobs afectados sin decisión o el readback no garantiza el estado, la preparación puede quedar documentada pero **la aplicación no está habilitada**. No sustituirlo por comodines, `--skip-domain`, una tarea externa, un pago real o un monitor nuevo. Una invocación con host distinto del candidato deja el gate en fallo: conservar la evidencia, resolver el host exacto observado y recomponer dentro de la autoridad vigente antes de reintentar.

## 5. Deploys posteriores, promociones, host estable y rollback

Repetir §2–4 para **cada** cambio de Production aunque el código de stock no haya cambiado. Una URL nueva puede dejar la excepción antigua sin efecto. Para un host estable acreditado, el conjunto final sigue teniendo un solo host literal; la identidad del deployment atendido y los gates del recibo se vuelven a comprobar.

Rollback se modela H2 → {H2,H1} → H1, con nueva lectura/recomposición en ambos pasos. H1 es un destino concreto compatible con reservas, no un “anterior” supuesto seguro. Releer Cron efectivo después del rollback; no inferir su estado por el movimiento del alias o por la restauración del código. La [documentación de rollback](https://vercel.com/docs/instant-rollback) no sustituye ese readback. Si el host no puede resolverse previamente, aplica el mismo interlock autorizado de §4.

Un rollback o fallo de gate sólo permite la contención coordinada que autorice la futura liberación. Este runbook no otorga permiso de rollback, pausa, cambio de stock ni desactivación de protecciones hoy. La producción anterior que ignore reservas no es un destino válido mientras existan compromisos vivos.

## 6. Gate después de cada cambio

Conservar evidencia nueva posterior al cambio, no sólo el badge o HTTP 200:

1. Metadata confirma el proyecto, deployment, host, ruta y cadencia efectivos; Cron habilitado; readback WAF correcto; protección del deployment resuelta sin bypass global.
2. Log de una invocación **real programada**, con deployment/host/método/ruta exactos, timestamp y evidencia de llegada al handler autenticado. No considerar User-Agent ni `x-vercel-cron-schedule` autoridad de autenticación; no registrar el bearer. Una petición manual no sustituye el primer disparo programado.
3. Lectura nueva de `webStockMaintenance/reconciliation`: `runId` distinto del anterior, `lastStartedAt` posterior al cambio y `lastFinishedAt` presente. Correlacionar log y ventana de ejecución con ese recibo. El documento no incluye host/deployment; si hubo solapamiento que impide correlación, conservar logs y esperar una evidencia inequívoca. No afirmar un join por runId que el log no expone.
4. Estado actual `completed`; `unverified=0`, `failed=0`, `unattemptedInBatch=0`, sin deadline agotado ni `failureTypes`. `processed = verified + unverified`; no significa ventas. Un pago pendiente leído correctamente puede contarse verificado. Una consulta fallida no puede contarse sana.
5. Registrar `measuredAt`, `moreDue` y `oldestDueLagMs`. Es una muestra al seleccionar, no un conteo final de toda la cola. Si `moreDue=true`, obtener la siguiente muestra acotada y constatar avance; no cerrar con “remaining=0”. Una ejecución toda diferida o sin pedidos acredita llegada y runtime, **no prueba salud de MP ni una venta**. No crear un pago para rellenar esa evidencia sin autorización específica.
6. Conservar `lastFailureAt`, `lastFailureRunId`, `lastFailureTypes` y sus contadores aun tras una ejecución sana. Separar la falla histórica de la salud actual: no borrarla para mostrar verde ni convertirla en alarma activa eterna. Fallas actuales, backlog sin avance, ausencia de recibo reciente, correlación dudosa o sólo `lastStartedAt` hacen fallar el gate.

Los cinco minutos son cadencia configurada, no SLA. Duplicados, backlog, retrasos y caídas pueden alargar el seguimiento. Definir y registrar antes de evaluar la ventana de observación `maxReceiptAgeMs`, un número entero positivo: el gate exige `observedAt − lastFinishedAt <= maxReceiptAgeMs`, además de los tiempos posteriores al cambio. Un recibo de ayer no acredita salud hoy aunque se haya emitido después del deploy. Esta ventana es un criterio explícito de frescura de evidencia, no una promesa del plazo de ejecución del scheduler. Si no se obtiene un recibo válido dentro de ella, marcar el gate fallido y continuar la contención autorizada. Ningún resultado de este procedimiento confirma automáticamente un pago ni altera la política 30+15 minutos o los 360 días de cobertura.

## 7. Validación preparada en esta entrega

El paquete privado de R1-A…E contiene `tools/release-transition/model.mjs`, `validate.mjs` y evidencia bajo `evidence/release-transition/`. Es un evaluador documental local, sin red, credenciales, cliente Vercel ni aplicador remoto. Modela H1→H2→H1, host estable condicionado, interlock con autorización/readback, predicados exactos y preservación de reglas; rechaza otros hosts, métodos, rutas codificadas o distintas y drift de predicados. También rechaza recibos viejos, parciales, sin invocación, sin autenticación/correlación, sin finalización y con atraso pendiente.

Este modelo no es el motor WAF de Vercel ni observa el scheduler. En la futura aplicación deben sustituirse los hosts sintéticos por lecturas y verificar primer disparo y cambio posterior reales. La ausencia de esa evidencia permanece explícita; no se presenta este ensayo local como operación productiva aprobada.
