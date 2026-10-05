# Publicación y continuidad del stock web

Versión 2.0 — 2026-10-02 — preparación del EXECUTOR para runtime, prebuilt y cierre/drenaje; conserva la transición Cron/WAF de R1-E.

Este procedimiento rige la primera publicación que incluya el barrido de stock, cada publicación posterior, promociones y rollback. **No autoriza ni ejecuta ninguna operación remota.** En la entrega R1-A…E quedan sin aplicar despliegues, WAF, protección del deployment, variables, índices y Cron. La aplicación futura necesita su autoridad vigente y los gates independientes correspondientes; no se infiere de este archivo ni de CI verde.

La etapa de preparación de 2026-10-02 tampoco aplica esos cambios ni pausa compras/Admin. Completar los gates no disruptivos antes de pedir únicamente la confirmación temporal de que John y todo otro escritor dejaron de editar. El [inventario, cierre, smokes y drenaje](WEB_STOCK_WRITERS_AND_DRAIN.md) es obligatorio junto con este procedimiento; no comenzar por un deploy ni por la pausa.

## 1. Invariantes y alcance

- Proyecto tienda: `prj_MMfug8FP68f5DcbqzmNngveqn1si`, equipo `team_zgY1367CSDsN9mxaF6EXpe3f`. Resolver nuevamente identidad, target y configuración desde la plataforma en cada aplicación. No copiar IDs de deployments de ejemplos.
- Ruta única: `GET /api/internal/web-stock-reconcile`, con `path` y `raw_path` exactamente iguales. Conservar bearer, duración de función de 60 segundos, lote de 20, concurrencia de dos, presupuesto de 40 segundos y cadencia propuesta `*/5 * * * *`.
- La excepción WAF se limita a hosts literales comprobados. No comodines, sufijos globales, reglas de skip, bypass de autenticación ni permiso para otras rutas o métodos.
- Admin compatible con reservas debe estar aplicado antes de la nueva tienda. No volver a una versión del checkout o Admin que ignore reservas vivas. No borrar reservas, cambiar cantidades, cancelar pagos ni devolver dinero para resolver un problema de publicación.
- La protección SSO/Deployment Protection se comprueba separadamente. Un WAF correcto no demuestra que esa otra capa deje pasar el Cron.

Contexto fechado, no runtime acreditado: la revalidación del 30/09/2026 informó plan Pro, `all_except_custom_domains`, variables de sistema expuestas y propuesta de cinco minutos. Hay que releer esos datos. El plan no acredita secretos instalados, índice READY, primer disparo ni host efectivo.

## 2. Evidencia previa obligatoria

Para el target de autenticación de 2026-10-05, incorporar obligatoriamente
[frontera Firebase y cierre operativo](LEGACY_AUTH_CLOSURE.md). El rechazo custom
no acredita cierre de sesiones derivadas a contraseña. Conservar ese pendiente
en las familias de credenciales; ningún verde de CI sustituye sus recibos.
Las Rules candidatas se seleccionan con `firebase.stock-release.json`, sólo
`firestore:rules`: no publicar el `firebase.json` histórico permisivo. Comparar
los hashes de los bytes probados y del readback antes de declarar aplicación.

Para cada entrega, volver a ejecutar los [controles de la excepción Edge](../edge-tooling-exception.md) sobre el HEAD/tree y el Admin pareado reales: identidad instalada, consumidores, compilación observada, artefactos finales de SPA/checkout/reconciliador y arranque Node aislado. Conservar sus recibos, grafos y hashes junto con los cuatro audits y el CI exacto. `NOT_VERIFIED` o ausencia de evidencia detienen la aceptación. Si la plataforma reconstruye, cambia el builder o usa otros bytes, los artefactos de CI no atestiguan ese build remoto: antes de aceptar una publicación futura, verificar identidad de herramientas/runtime, observación equivalente de carga y grafos/hashes de los artefactos realmente servidos, bajo autorización independiente. Esta preparación no observó ni autoriza esa reconstrucción. Cambios de versión, cadena, bytes, consumidor o exposición suspenden la excepción; no actualizar hashes permitidos sólo para obtener verde. Esto añade un prerrequisito y conserva íntegros los controles Cron/WAF siguientes.

Antes de cambiar Production, conservar un registro con hora, operador, autorización, proyecto/equipo, HEAD/tree y par Admin de destino; deployment anterior y candidato con sus URLs, target, aliases y estado; definición y estado efectivo de Cron; inventario de otros jobs del proyecto; configuración WAF activa/versionada completa; y estado de Deployment Protection. No guardar valores de secretos, headers de autenticación, tokens o cuerpos de pago.

Comprobar los requisitos de aplicación ya autorizados: Admin compatible; sólo el índice requerido en READY, sin borrar índices ajenos; nombres y scopes Production correctos de `MP_COLLECTOR_ID`, `CRON_SECRET`, `WEB_ADMISSION_HMAC_SECRET`, `RELEASE_ATTESTATION_SECRET`, el token MP existente y las credenciales existentes de servidor. El secreto de admisión debe permanecer estable y distinto del de Cron. El secreto de atestación debe ser dedicado (32–256 caracteres `[A-Za-z0-9_-]`), distinto de ambos y jamás entrar al build. Confirmar `VERCEL=1`/variables de sistema sin exponer credenciales. Un fallo detiene el cambio de destino; no convierte un intento parcial en entrega completa.

El documento central `operations/webStockCutover` y la variante `firebase.catalog-cutover.rules` se preparan y comprueban antes del candidato. La variante parte de las Rules R1B con órdenes cerradas, no del archivo histórico permisivo `firebase.rules`. Comparar hash/contenido real antes de cualquier aplicación autorizada; aplicar sólo Rules desde configuración aislada, preservando índices y otros recursos. No usar un deploy general de Firebase. Su ausencia o un documento inválido hacen fallar cerrados los escritores nuevos, de forma intencional.

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

## 8. Canal prebuilt y atestación del nuevo target

Construir desde HEAD/tree limpios y exactos con Node 22.23.3 y `@vercel/node@5.10.2`. El build usa allowlist explícita y rechaza credenciales/secretos comerciales, Firebase privado, MP, Cron y release; no descargar env de Production ni ejecutar `vercel pull` para cargar esos valores. Se conservan los cuatro audits, observación de carga/Edge, SPA y empaquetado nativo. `npm run build:prebuilt -- <directorio-nuevo-externo>`, `npm run verify:prebuilt -- <mismo-directorio>` y `npm run test:prebuilt-output -- <mismo-directorio>` son gates separados con sus códigos reales. No usar `npx` flotante, builder global o `vercel dev`.

El artifact debe contener `.vercel/output/config.json`, estáticos, ambas funciones `.func` completas, configuración de runtime/maxDuration, stamp HEAD/tree/locks/builder, inventario de bytes/modos/tamaños y recibos. Archivar la raíz completa en tar, conservando `.vercel`; comprobar hashes al descargar. Nunca archivar sólo el `dist` o los recibos y llamarlos prebuilt. Ni los cuatro audits ni el verde CI por sí solos atestiguan ese output. Un paquete incompleto, credenciales, un payload Edge o diferencia de identidad hacen fallar el gate.

En la futura publicación se entrega ese output mediante el canal oficial `deploy --prebuilt` con CLI exacto acreditado, sin rebuild remoto. La autenticación del publicador vive fuera del proceso de build y fuera del artifact. Antes de aplicar, validar proyecto/target y el contrato de asociación de env runtime de Vercel; no trasladar env comerciales al build. El Admin va primero y se comprueba su identidad real/compatibilidad, luego la Tienda. Cada destino/candidato debe quedar vinculado con la misma pareja auditada y los hashes del artifact.

Invocar la señal dedicada de **ambos** handlers en el candidato según la matriz de smokes. Validar el recibo contra deployment/URL/HEAD/tree y stamp esperado; comprobar Node y `process.versions.undici` reales. Un valor Undici `null`, una identidad incompleta o runtime distinto queda `NOT_VERIFIED`. La señal devuelve valores, no se autodeclara PASS. Conservar identificadores de invocación/cold-start y correlación de logs, sin bearer ni secretos. No sustituir este gate por Node22.x configurado, Node de CI, paquete npm Undici, estado pagado ni HTTP200.

## 9. Orden completo de una aplicación futura

1. Auditoría independiente del nuevo target, identidad exacta de ambos repos y CI/artifact; lectura de cuatro vínculos Git/hooks, destinos/aliases, WAF/SSO, cron, índice y backups autorizados. Inventario de todos los escritores y cotas efectivas. Ninguna pausa todavía.
2. Verificar que el build se completa sin negocio, smokes cero escrituras están preparados y las configuraciones propuestas pasan matrices. Confirmar disponibilidad del canal runtime y de logs/escrituras para drenar, cobertura y margen verificables, y comprobaciones de cierre sin datos QA ni credenciales que habiliten escrituras si falla una barrera, según [Escritores y drenaje](./WEB_STOCK_WRITERS_AND_DRAIN.md). Un rechazo 401 sin correlación WAF no acredita cierre. Con pendientes desconocidos no declarar `PRE_CUTOVER_READY`.
3. Sólo con ese estado acreditado, confirmación temporal de ventana; cierre WAF/Rules/control/escritores externos, timestamp servidor/readbacks y drenaje por función. Permitir que termine el trabajo admitido antes del cierre dentro de su cota efectiva; exigir ausencia de escrituras en la quietud posterior a esa cota y margen, sin deshacer finalizaciones válidas. El CLI de drenaje conserva `NOT_VERIFIED`/exit 1 por falta de adaptador remoto: el gate puede acreditarse mediante el acta de revisión humana de evidencia primaria descrita en [Escritores y drenaje](./WEB_STOCK_WRITERS_AND_DRAIN.md), conservando ese resultado del CLI y sólo si integridad, consistencia y todas las coberturas están verificadas. Rechazar reapertura por reloj, logs vacíos o una declaración manual sin recibos primarios.
4. Con drenaje aprobado, integración autorizada y aplicación de Admin compatible, luego Tienda prebuilt; mantener cierre inicial de escritores y scheduling interlock de §4 si corresponde. El primer deployment con cron puede activarlo: impedirlo antes, sin suponerlo por `--skip-domain`.
5. Resolver host candidato concreto y adaptar sólo la excepción de smokes, comprobar runtime de ambas funciones, quote/disponibilidad y lecturas Admin acotadas. No navegar SPA para esos smokes ni crear órdenes, preferencias, Auth anónima o cantidades QA.
6. Comprobar índice READY, env runtime por nombres/scopes y controles, aplicar transición de Cron/WAF autorizada con readback, pasar deliberadamente el control a `reconciling` y completar el gate programado de §6. En ese estado sólo la guarda del reconciliador admite el barrido autenticado; compras, Admin, firma y escrituras directas siguen cerradas por sus guardas/Rules y WAF temporal. No se intenta acreditar Cron manteniendo `closed`, que bloquea su ejecución. Registrar cualquier intervalo sin seguimiento y recuperarlo sin falsa garantía de proveedor.
7. Reapertura de compras/Admin sólo después de todos los gates, pasando de `reconciling` a `open` con nueva revisión/Timestamp servidor y readback; remover exclusivamente interlocks temporales revisados y recargar SPAs antiguas. Observar al menos 15 minutos en la etapa productiva, incluyendo Cron/recibo y errores; no prometer un SLA de reconciliación ni una venta E2E no ejecutada.
8. Detener ante drift, runtime/identidad no acreditados, writer/cota desconocidos, smokes con escritura, logs incompletos, índice no READY o recibo Cron insano. Preservar barreras, reservas y datos. Rollback sólo a pareja compatible y repitiendo host/cron/WAF/drenaje; nunca al checkout/Admin anterior que ignore reservas vivas.

Esta secuencia es un procedimiento preparado. Runtime remoto, cierres, configuración, Cron, índice, smokes sobre Production y observación permanecen sin ejecutar en el target de readiness. La revisión independiente pertenece a otra sesión superior.

## 10. Gate técnico pareado y consumo obligatorio

Ejecutar `node scripts/release-gate/cli.cjs verify-pair /absolute/pair-config.json /absolute/new-evidence`
según [su contrato de entrada](../../scripts/release-gate/README.md), desde el source
limpio y exacto. Conserva los audits nativos y el estado global del CI; una
remediación de fuente auditada sólo explica el aviso exacto fijado en su política.
El resultado debe ligar los seis audits, la pareja literal, pasos completos,
digest oficial y bytes del nuevo prebuilt. No usar el artifact diagnóstico histórico.

Antes de aplicar, ejecutar `node scripts/release-gate/cli.cjs publication-check /absolute/publication-config.json /absolute/new-application-evidence`.
Ese comando revalida la evidencia externa y exige auditoría independiente del
delta exacto, autorización de corte y la política/recibos del primer corte.
[El procedimiento del primer corte](./FIRST_CUTOVER_RISK_MANAGED.md) conserva
su sustitución condicionada de la prueba global antigua; no se reabre el residual.
Los gates de runtime, identidades, barreras, operaciones frescas, captura final,
índice y cron siguen siendo operativos. Ningún comando de este gate despliega,
otorga permisos o convierte consistencia documental en enforcement remoto.

La frontera de cuentas exige ahora el método explícito y los recibos de
[ALLOW_ABSENCE_V1 o PROJECT_DENY](./first-cutover/ALLOW_ABSENCE_V1.md). El JSON de
la nueva auditoría debe identificar esta implementación y su artifact. El PASS de
diseño anterior no se reutiliza. Sin políticas reales, revisión de credenciales y
pruebas de ventana, contención y PRE_CUTOVER_READY permanecen NOT_VERIFIED/NO;
el CI técnico puede ser PASS separadamente. No se aplica nada desde este runbook.
