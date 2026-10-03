# Primer corte con contención y recuperación selectiva

Estado: **PREPARACIÓN; NO APLICADO**. Esta es la única secuencia del primer corte
con riesgo residual aceptado. Los módulos `release-cutover` siguen disponibles para
construir/verificar WAF; su `verify-drain` estricto permanece NOT_VERIFIED. Este
documento sustituye, sólo para el primer corte y bajo la decisión indicada, la
precondición de probar globalmente todos los Commit/Write antiguos. No cambia la
lógica de inventario, pagos, atestación o prebuilt ni los requisitos de auditoría.

## Decisión y límites

Decisión `MUTTER_FIRST_CUTOVER_RISK_MANAGED_PREPARATION`, contrato SHA256
`c9806fb28998d1103d878bbbab81168ad573d52066ca05f8b3ca4aad112aa322`.
Rodrigo acepta exclusivamente una escritura antigua admitida/autorizada antes de
las barreras que confirme tarde y cuya respuesta se haya perdido. La probabilidad
no está cuantificada. No se la convierte en drenaje probado ni en una garantía
del proveedor. No se requieren nuevos logs ni una consulta al proveedor para
volver a aceptar ese mismo residual.

La coordinación comunicada fue aproximadamente 00:30 de Uruguay, John descansando
sin usar Admin. Es una declaración temporal; no acredita que nadie compraba, que
no existían trabajos en vuelo o que haya una ventana indefinida. Renovar sólo esa
coordinación cuando corresponda, nunca pedir de nuevo aprobación general del alcance.

NO aceptados: entradas antiguas nuevas, delegación al candidato, LRO desconocidas
o activas sin tratamiento, backup incompleto, pérdida no explicada, reparación que
pise reservas/ventas nuevas, errores del candidato, identidad incorrecta, secretos
expuestos o fallos de barreras. El evaluador rechaza esas condiciones.

## Herramientas y fronteras

Desde el checkout exacto Tienda, Node del lock/toolchain auditado:

```sh
npm run test:first-cutover
node node_modules/firebase-tools/lib/bin/firebase.js emulators:exec --only firestore --project demo-mutter-first-cutover --config firebase.catalog-emulators.json "npm run test:first-cutover:emulator"
node scripts/first-cutover/cli.mjs propose-authority docs/operations/first-cutover/supported-deny-permissions.json
node scripts/first-cutover/cli.mjs propose-allow iam-project-v3.json
node scripts/first-cutover/cli.mjs evaluate first-cutover-evidence.json
node scripts/first-cutover/cli.mjs verify-backup /Users/lolo/PrivateBackups/Mutter/CAPTURA_PRIVADA
node scripts/first-cutover/cli.mjs compare /Users/lolo/PrivateBackups/Mutter/RESPALDO /Users/lolo/PrivateBackups/Mutter/READBACK
node scripts/first-cutover/cli.mjs propose-repair /Users/lolo/PrivateBackups/Mutter/RESPALDO /Users/lolo/PrivateBackups/Mutter/READBACK incidente-privado.json
```

Los nombres CAPTURA/RESPALDO/READBACK identifican entradas que la ejecución futura
debe obtener, no respaldos ya realizados. El informe privado entrega la ruta real.
No hay comando apply, deploy, restore remoto o aceptación por espera. `evaluate`
sólo devuelve consistencia documental y exige recibos primarios ligados por hash a
cada sección. Los hashes y `provenanceReviewed` no son firmas del proveedor: la
revisión independiente verifica procedencia, lectura real, frescura y contenido.
Fixtures sintéticos no son recibos de producción. El tool nunca autoriza aplicación.

## 1. Identidad, operaciones y material de recuperación

Releer HEAD/tree de ambos candidatos, CI pareado, artifact completo/stamp/digest,
cuatro proyectos Vercel y destinos reales. Admin permanece en
`74fd10955ac8163221b1478bafa791d1969ace48`; el informe congela el nuevo Tienda.
Comprobar `mutter-games`, número `26777776532`, Firestore `(default)`; no aceptar
defaults del CLI. Verificar source/runtime y principal configurado por separado.

`readOperations` prepara ListOperations nativo con proyección en origen de
nombre/done/código/tiempos/estado, sin response ni mensajes libres. Requiere canal
oficial existente, permisos `datastore.operations.list/get` y scope datastore o
cloud-platform ya autorizado; no obtiene credenciales. Agotar páginas, preservar
errores, rechazar unreachable, no pedir partial success. Determinar retención real;
la respuesta no inventa una ventana histórica. Terminar/tratar trabajos existentes
y bloquear nuevos lanzamientos durante la ventana. Releer tras las barreras. TTL,
imports/restores/bulk delete/índices y jobs pertinentes son superficies separadas.
La landing de un servicio no es un listado vacío. Si falta acceso:
`ADMINISTRATIVE_OPERATIONS_STATUS=NOT_VERIFIED`; aplicación bloqueada, código auditable.

`createBackup` reutiliza la lectura REST tipada del respaldo anterior, sin la rama
ImageKit. Sólo recorre las colecciones declaradas en `common.mjs` y el documento
de control. Conserva IDs, campos Firestore sin conversión a números JS, referencias,
timestamps/createTime/updateTime, padres ausentes y `categories/*/subcategories`.
Subcolección no clasificada, bucle de paginación, credencial en campos o fallo de
lectura => incompleto, nunca éxito parcial. No lee Auth, clientes, perfiles o carts.
Los campos de propietario/contacto/entrega de pedidos se conservan exclusivamente
en privado para recuperar un pedido perdido coherentemente; no se usan para análisis.

Destino nuevo privado bajo `/Users/lolo/PrivateBackups/Mutter/`, directorios0700 y
archivos0600, sin symlinks. La credencial existente vive sólo en el proceso privado
de respaldo: selección individual de las tres variables Firebase, sin entorno
completo, argumentos secretos, logs, persistencia o CI. Si el canal no lo permite,
informar ese acceso puntual; no usar contraseñas, MP o ImageKit.

Dos pasadas guardan páginas, conteos, versiones, hashes, inicio/fin/errores.
**No es snapshot atómico** con la tienda abierta. Estabilidad entre pasadas no
descarta un cambio posterior. Verificar todos los hashes y restaurar estructuralmente
en un emulador nuevo con proyecto demo y egress de negocio bloqueado; no triggers.
Mantener su cwd/logs/residuos privados; eliminar sólo ese ensayo al finalizar,
conservando el respaldo original y el recibo sanitizado. El emulador genera nuevas
versiones; el respaldo conserva las originales.

## 2. Contención e identidad nueva, en ese orden

`first-cutover/authority-proposal.json` es una propuesta exacta, no un readback.
Planificar `mutter-stock-runtime-v1@mutter-games.iam.gserviceaccount.com`, ausente
en la tabla consultada; volver a comprobar disponibilidad antes de crear. No se
creó, no tiene permisos ni claves. Reservar su uso al par auditado y rollback
compatible; no compartirla con herramientas o deployments históricos.

1. Cerrar entradas WAF con los generadores existentes para los cuatro proyectos,
   preservando reglas anteriores/hosts históricos. Cubrir GET ImageKit signature,
   reconciliación y flujos mixtos Auth→Firestore. Confirmar Rules directas y guarda
   `operations/webStockCutover` cerradas en una ventana futura autorizada. No pausar
   durante la preparación. No hacer bypass global por header/IP.
2. Instalar y releer la deny policy propuesta, limitada a las dos cuentas antiguas.
   El punto de adjunción es `cloudresourcemanager.googleapis.com/projects/26777776532`.
   La API IAM v2 usa el attachment point URL-encoded, kind `denypolicies`, policy ID
   `mutter-first-cutover-legacy`. Guardar name/uid/etag/createTime/updateTime y todos
   los permisos/principals del readback; esperar la operación API real. Rechazar
   diferencia. La propuesta no incluye un permiso no soportado ni deny universal
   a agentes Google. Habilitar APIs faltantes NO está autorizado aquí.
3. Retirar los allow elevados de las cuentas antiguas con el delta versionado:
   Editor, SDK Admin, Firebase Auth Admin y TokenCreator. Conservar solamente el
   rol custom `mutterLegacyReadOnly`. `propose-allow` exige version3/etag, preserva
   otros miembros y auditConfigs, y detiene roles/condiciones no revisados. Releer
   y comparar etag/base antes de aplicar; nunca reemplazar un IAM completo desde
   una captura vieja. Examinar allow heredados y resource policies aparte. Esta
   retirada es necesaria para cerrar lanzamiento de procesos privilegiados y
   permisos no cubiertos por la deny enumerada; la deny sola NO basta.
4. Verificar que las cuentas antiguas no pueden modificar políticas/roles, emitir
   tokens o claves ni lanzar/actualizar servicios con otra identidad. La revisión
   incluye recursos y herencia, no sólo un binding visible. Sólo después crear la
   identidad candidata sin autoridad, restringir su resource policy, y otorgar el
   rol custom `mutterStockRuntime`. Mantener explícitamente operadores humanos y
   agentes Google necesarios; no exceptuar a las cuentas antiguas. Una vía de
   escape pendiente bloquea el otorgamiento y la aplicación.

Permisos mínimos propuestos derivados de consumidores: lectura/listado de entidades
y `datastore.databases.get` para transacciones; create/update/delete para inventario,
pedidos y Admin; `firebaseauth.users.get/create/update/delete` para verificación con
revocación, usuarios y claims. Sin Owner, Editor, TokenCreator, export/import o
delegación. No se usó `allocateIds`: los IDs del SDK se generan localmente. Validar
compatibilidad y soporte custom role en la API antes de crear, sin añadir permisos
genéricos si falla. La separación no es por colección: IAM Firestore opera sobre
la base; las reglas de aplicación auditadas conservan la frontera comercial.

Impacto: las lecturas de catálogo y verificación Auth previstas se conservan; las
escrituras Auth antiguas quedan cerradas igual que el Admin. Tratar cualquier
secuencia Auth→Firestore incierta antes de reapertura: no pertenece al waiver
Firestore. Imágenes existentes permanecen; una firma antigua puede servir hasta
expirar, sin conceder escritura de stock. No se reabre ese residual ni se consulta
ImageKit. Reversión compatible: mantener contención antigua y volver sólo a un
runtime que respete reservas con la identidad dedicada; nunca reponer Editor o
TokenCreator a las cuentas antiguas para hacer rollback.

## 3. Pruebas futuras de barrera, sin efectos comerciales

Guardar identidad autenticada/huella no secreta del canal, policy/version exactas,
momento y resultado. 401 de aplicación, ausencia de logs o test con otro principal
no acredita deny de escritura. No se obtienen tokens antiguos ni se ejecutan estas
sondas en la preparación.

- WAF: repetir matriz de rutas/métodos/hosts/raw_path, incluidos GET firmante y
  reconciliación. Verificar rechazo en borde sin alcanzar handler comercial.
- Rules: source/version/readback más regresiones reales emuladas y evaluación de
  propagación según canal disponible; no crear producto QA ni pedido en producción.
- IAM: inspección de allow/deny efectivos y evaluación nativa por cada permiso y
  principal. Para probar rechazo de Commit update/delete sin cambiar datos, diseñar
  una precondición `updateTime` imposible (anterior a la existencia de la base),
  jamás una operación sin precondición. Comparar PERMISSION_DENIED de la cuenta
  antigua autenticada con FAILED_PRECONDITION del canal autorizado para idéntica
  petición. No confundir ambas respuestas ni ejecutarla sin revisión específica.
  No existe aquí una sonda create garantizada sin escritura: no usar exists:false
  sobre un producto como canario. Para create exigir evaluación efectiva nativa
  y readback de la misma deny; documentar que eso no es un Commit create real.
  Si el canal no permite acreditar la barrera requerida, STOP; no falsificar un
  recibo `enforcementEvidence=true` por un ensayo local.

La propagación IAM es eventual; sus tiempos orientativos no son un máximo probado.
No asignar hora de efectividad sólo al recibir éxito de setIamPolicy. Repetir
readbacks/evaluación pertinente y conservar límites. Resolver contradicciones.

## 4. Mitigación temporal y comparación final

Derivar la espera operacional de `effectiveFunctions` sobre los deployments y
`output[].lambda.timeout` efectivos de los cuatro proyectos, nunca de un default
o del candidato aún no publicado. La lectura previa fue 300s; debe revalidarse.
Propuesta conservadora: máximo observado + 300s de margen operativo (propagación,
terminación y reloj), contados desde la última barrera comprobada. Es una política
de mitigación revisable con las mediciones, **no una cota universal** ni suma con
270s transaccionales. No acredita desaparición del residual aceptado.

Con entradas/autoridad cerradas, tomar respaldo/readback final y comparar. Verificar
intentos, pedidos, reservas, propietarios, locks, cuotas y movimientos. No deducir
ventas de diferencias de cantidades. Discrepancia comercial o secuencia mixta no
explicada detiene reapertura. Los fixtures no fabrican recibos de esa ventana.

`compare` clasifica cambios/ausencias/recreaciones/nuevos y no escribe. `propose-repair`
admite sólo un producto con pérdida acreditada, referencia a evidencia causal y
alcance de reparación autorizado por separado, hashes de backup/actual y precondición.
No crea automáticamente un ausente. Un documento recreado, hold activo, venta,
registro nuevo o modificación de cualquier dependiente bloquea la propuesta. No
recalcula ni aumenta stock a partir de una fórmula. La limitación conservadora es
intencional: si hay comercio nuevo se necesita análisis/reparación específica.

`rehearseRepair` relee todas las colecciones operativas dentro de una transacción
Firestore y comprueba el conjunto de datos/versión antes de escribir un producto.
No tiene adaptador productivo. Conserva la precondición del documento y no borra
registros nuevos. El único restore de base existe para un emulador vacío, forzado
a loopback/demo. Su uso no es una alternativa de rollback productivo.

## 5. Aplicación, reapertura y recuperación posteriores

Después de auditoría independiente del target nuevo y todos los requisitos
operacionales anteriores, aplicar el par/artifact auditado bajo el contrato de
publicación correspondiente. Configurar identidad/secretos por canal autorizado,
índice READY y cron controlado; atestar ambos handlers y comprobar principal
runtime. Conservar cron sin negocio hasta la fase deliberada de conciliación.
Los smokes son los existentes de sólo lectura, sin pago real, cantidades QA ni MP
de prueba. No confundir build/READY con aplicación real.

Evaluar evidencia nueva mediante la política separada. La consistencia del JSON
no sustituye su revisión primaria. Abrir sólo cuando no queden discrepancias,
atenciones sin tratamiento ni errores del candidato, preservando siempre las
barreras a identidades/hosts/clientes antiguos. Observar el funcionamiento real;
no reabrir por reloj. El riesgo de confirmación tardía permanece aun tras un
readback estable. Si se manifiesta: mantener contención, preservar evidencia y
datos nuevos, explicar la divergencia y preparar reparación específica; no
restaurar toda la base ni volver a código sin reservas.

Estados de preparación obligatorios: STRICT_DRAIN_PROOF=NOT_VERIFIED_WITH_AVAILABLE_CHANNELS,
INDEPENDENT_AUDIT=PENDING, PRODUCTION_SECURITY_CHANGES=0, CUTOVER_PERFORMED=NO,
PRE_CUTOVER_READY=NO, STOCK_RELEASE_READY=NO. LRO y backup reales se informan por
separado, sin impedir la revisión del código cuando sólo falte su acceso.

Fuentes primarias: [Deny y API](https://docs.cloud.google.com/iam/docs/deny-access),
[permisos soportados](https://docs.cloud.google.com/iam/docs/deny-permissions-support),
[propagación](https://docs.cloud.google.com/iam/docs/access-change-propagation),
[precondiciones](https://docs.cloud.google.com/firestore/docs/reference/rest/v1/Precondition),
[operaciones](https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.operations/list),
[IAM Firestore](https://docs.cloud.google.com/firestore/native/docs/security/iam),
[permisos Auth](https://docs.cloud.google.com/iam/docs/roles-permissions/firebaseauth).
La documentación fundamenta el diseño; no prueba configuración aplicada.
