# ALLOW_ABSENCE_V1 — contrato de evidencia, sin aplicación

Estado: implementación preparada para revisión independiente. **No aplicada**.
No equivale universalmente a PROJECT_DENY: depende de demostrar ausencia de allows,
rutas indirectas y credenciales con autoridad pertinente. No hay fallback automático.
El proyecto sigue siendo `mutter-games`, número `26777776532`, base `(default)`.
La decisión histórica conserva exclusivamente la escritura Firestore antigua ya
admitida que confirme tarde; no acepta delegación, credenciales ni permisos activos.

## Entradas y procedencia

`evaluateFirstCutover` recibe `containment` además de las barreras existentes.
`schema:1`, `method:ALLOW_ABSENCE_V1|PROJECT_DENY`, proyecto/número/base exactos.
La sección lleva su propio recibo privado en `receipts`, ligado como los demás por
`verifyReceiptFiles`. La barrera `legacy-authority` y `delegation.containmentSha256`
usan el digest canónico de la sección completa, no un booleano ni una captura UI.
La ventana y revisión deben coincidir en cada fuente. No se agregan firmas ni otro
motor de publicación. Sólo el operador y la revisión independiente pueden verificar
procedencia/autenticidad; hashes y etiquetas no prueban un hecho remoto.

Cada captura tiene `schema:1`, `origin:GOOGLE_OFFICIAL_CAPTURE` (o
`GOOGLE_PUBLIC_CAPTURE` para la referencia pública), `revision`, `windowSha256`,
`observedAtMs`, `channel:{kind,principal,captureId}`, `requestRaw`, `responseRaw`,
sus SHA256 sobre **los bytes de los strings**, `httpStatus`, `responseComplete:true`
y `projection:NONE`. `requestRaw` conserva un sobre explícito
`{method,resource,body,query}` con el método/recurso y los parámetros reales;
`responseRaw` conserva la respuesta JSON original, sin reescribir `version`.
No copiar headers, bearer, cookies, claves ni cuerpos comerciales. La captura de
canal y la identidad representada son evidencia por revisar, no identidad probada
por escribir el email. `SYNTHETIC` sólo se acepta con contexto sintético, rechazado
en publicación por la comprobación de recibos.

Lecturas obligatorias: proyecto completo (`projects.get`, incluye ausencia de
parent sin proyección), lista agotada de cuentas y sus políticas, política de
proyecto, roles mínimos exactos y superficie/política aplicable a Firestore.
Para IAM siempre solicitar versión máxima 3: proyecto en `body.options`, cuentas
en `query['options.requestedPolicyVersion']` con body vacío, según REST v1. Se
admite respuesta wire 1 sólo sin condiciones ni `_withcond_` y con esa solicitud
completa. V3 conserva condiciones ajenas; una condición pertinente no revisada
bloquea. Versiones/contextos desconocidos, proyección, paginación sin agotar,
403 o fuentes ausentes mantienen NOT_VERIFIED.

Firestore v1 no expone getIamPolicy/setIamPolicy sobre databases en la superficie
pública consultada. `databasePolicy.mode:PROJECT_POLICY_ONLY_V1_API` exige captura
completa de Discovery y revisión ligada a esa fuente y a la política de proyecto,
con sus condiciones efectivas para la base. No afirma que una consulta falló y por
eso no hay política. `RESOURCE_POLICY` exige que la superficie capturada exponga
esos métodos y un readback propio completo. Cambio de superficie bloquea el modo
anterior. No hay `testIamPermissions` ficticio sobre la base: el control de
lectura autenticada usa `databases.get` y sólo metadata técnica.

## Delta exacto y momentos separados

`legacyAllowProposal` conserva payload/version/etag y auditConfigs, terceros,
operador y agentes. Sólo retira, para Firebase, SDK Admin, Firebase Auth Admin y
Token Creator; para Appspot, Editor. Conserva/agrega el lector mínimo. Un rol
conocido pero atribuido a la cuenta equivocada también bloquea. No se elimina un
rol extra para obtener un after aparentemente seguro.

`verifyAllowBase` compara **antes** con la lectura fresca inmediatamente previa.
`verifyAllowAfter` vuelve a validar la propuesta y compara el **después** completo
con etag nuevo. Tolera sólo orden semántico de bindings/miembros. No descarta
condiciones, auditConfigs, versión ni campos desconocidos. La respuesta de
setIamPolicy, su solicitud exacta y el GET posterior deben concordar; la respuesta
de escritura sola no acredita propagación ni sustituye probes.

La CLI acepta un bundle privado `{context,before,proposal,fresh}`. `context` contiene
revision, ventana, nowMs/maxAgeMs y sólo para pruebas `synthetic:true`.
`propose-allow` devuelve `{proposal,sourceReceipt}`; conservar ambos. Para verificar,
`proposal` es el objeto interno exacto (no el wrapper). Nunca hay comando apply:

```sh
node scripts/first-cutover/cli.mjs propose-allow /absolute/bound-policy-sources.json
node scripts/first-cutover/cli.mjs verify-allow-base /absolute/bound-policy-sources.json
node scripts/first-cutover/cli.mjs verify-allow-after /absolute/bound-policy-sources.json
```

## Orden futuro obligatorio, no ejecutado por este código

1. Canal del mismo operador Mutter, fuentes completas y revisión de rutas directas,
   condiciones, membresías indirectas, políticas de recursos, servicios capaces de
   lanzar trabajo bajo otra cuenta y recuperación de autoridad. Roles lector y
   candidato exactos comprobados; crearlos sólo bajo autorización productiva futura.
2. Todos los preflight no disruptivos resueltos; confirmación temporal nueva. Cierre
   coordinado de WAF/Rules/interlock/entradas administrativas; no reutilizar 00:30.
3. Relectura de roles/base y etag; `verifyAllowBase`; retirada condicionada; preservar
   respuesta y lectura posterior. `verifyAllowAfter`; resolver propagación y drift.
4. Pruebas negativas y controles positivos por cada principal antiguo; revisión
   de todas las vías y de credenciales anteriores. No conceder autoridad candidata
   con un campo desconocido ni por una espera. Guardar revisión y fuentes de ventana.
5. Relectura no-grant de proyecto **posterior** a esa contención. Candidata aún
   ausente en el inventario previo; crear sin autoridad/clave bajo el contrato de
   aplicación, leer su política directa vacía. Operador/agentes mantienen sus grants
   heredados preservados. Un binding directo adicional requiere revisión, no se
   acepta implícitamente. Grant sólo del rol candidato, after exacto y etag nuevo.
6. La cuenta legítimamente concedida puede existir al reabrir. El evaluador exige
   orden y recibos anteriores, no ausencia perpetua. La clave única/provisión
   sensitive sólo bajo la autorización futura, nunca en este tooling/CI/artifact.
7. Mantener todos los gates de operaciones frescas bajo barreras, captura/comparación
   final, recuperación selectiva, runtime, índice, cron, reapertura y observación.
   No restaurar Editor/Token Creator como rollback ni volver a un runtime que
   ignore reservas. El residual de escritura tardía sigue explícito y acotado.

## Probes y límites de credenciales

`negativeProofs` exige cada cuenta antigua representada, lectura autenticada y metadata de creación de la base. La credencial lleva
principal representado, referencia opaca no secreta y alcance cloud-platform
revisados; lectura, negativo y evaluaciones ligan la misma referencia. No persistir
el token ni confundir esa metadata declarada con autenticidad probada. El
update con precondición imposible revisada para el recurso concreto. El mismo
request sin campos comerciales, con máscara vacía y updateTime 1970, debe dar
PERMISSION_DENIED/403 para la antigua y FAILED_PRECONDITION/400 para el canal
operador autorizado. La fecha imposible debe acreditarse para ese recurso antes
de cualquier ensayo futuro. Se conservan hashes/request y razones. No hay canario
create, ni interpretación de 401/timeout/fallo de red/precondición como contención.
Esta etapa no ejecuta ninguno de esos probes remotos.

Las evaluaciones `testIamPermissions` llevan nombres IAM explícitos (no conversión
de prefijos deny), resource real, respuesta nativa, soporte agotado de
`queryTestablePermissions`, revisión de semántica y límites. Cubren proyecto y cada
cuenta inventariada. Si el método no admite un permiso/recurso, no inventar una
respuesta vacía: queda NOT_VERIFIED y debe prepararse una evaluación oficial
aplicable para esa frontera. TestIamPermissions es una comprobación del llamador,
no sustituto de IAM readback, análisis de otras identidades/condiciones ni garantía
universal de ejecución. El positivo distingue autenticación de falta de autoridad.

`review.coverage` exige fuentes exactas para cinco dominios: grants directos y
condiciones; membresías/recursos indirectos; lanzamiento y trabajo existente;
recuperación/delegación; credenciales preexistentes. Es una revisión humana
estructurada, no el resultado inventado de una API. Cada ruta sin resolver bloquea.

`credentials` distingue claves/tokens que representan las antiguas, access tokens
de otros destinos, firmas JWT/blob, OIDC y sesiones Firebase. Para cada familia:
destinos, alcance, fundamento de vigencia, fuentes y hora de revisión. Destino
contenido, vigencia acotada más cierre acreditado de emisión, o ausencia de
autoridad relevante con evidencia son disposiciones revisables; UNKNOWN, espera
sola, falta de logs, «sin organización» o borrado de clave no cierran el campo.
La vida de generateAccessToken no es una cota universal para JWT, ID tokens o
sesiones. Retirar Token Creator tampoco revoca credenciales emitidas. No se pide
un censo imposible de copias de claves, no se infiere intrusión ni emisión real.
No se deshabilitan agentes/cuentas para resolver credenciales no observadas.
Una ruta material que no pueda acreditarse permanece pendiente aunque los tests
sintéticos pasen. La versión preparada no aporta ese dato real.

## Publicación y revisión del delta

El evaluador de primer corte se consume desde `publication-check`, que revalida
la pareja y su prebuilt y exige el JSON separado del **nuevo** informe auditor con
HEAD/TREE/artifact exactos. Un PASS antiguo o de diseño no vale para este delta.
La sección containment y sus recibos son obligatorios. La ausencia de revisión o
recibos produce PUBLICATION_PREREQUISITES=NOT_VERIFIED; el PASS técnico de braces
permanece separado. No se alteran scanner, seis audits, locks, parser ni excepciones.
`PROJECT_DENY` conserva containmentProposal y readback exacto, retirada de allows,
pruebas y revisión; nunca se selecciona ALLOW automáticamente por falta de deny.

Fuentes primarias (describen API, no prueban Mutter):
- [Versiones de política](https://docs.cloud.google.com/iam/docs/reference/rest/v1/GetPolicyOptions).
- [Allow y etag](https://docs.cloud.google.com/iam/docs/allow-policies).
- [Opciones en cuentas](https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.serviceAccounts/getIamPolicy).
- [Discovery Firestore v1](https://firestore.googleapis.com/$discovery/rest?version=v1).
- [Vigencia de access tokens](https://docs.cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/generateAccessToken).
