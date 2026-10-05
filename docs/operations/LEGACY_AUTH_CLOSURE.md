# Frontera Firebase y cierre operativo pendiente

Preparación del 2026-10-05. No autoriza aplicación, revocación ni otro login.
El rechazo implementado de sesiones custom **no cierra su transformación a
contraseña**. Mantener `FIREBASE_SESSIONS` y `SIGNED_JWT_AND_BLOB` sin cierre
acreditado hasta resolver las rutas siguientes. No completar `unresolved: 0`
ni `REVIEWED_NO_UNRESOLVED_ROUTE` en `verifyCredentials` por este cambio.

## Destinos y autoridad

| Destino | Autoridad exigida | Efecto |
|---|---|---|
| Once endpoints Admin, incluidas lecturas y firma ImageKit GET | ID token verificado con revocación, proveedor password, rol booleano admin/superadmin; cutover para escritores/firma | Acciones existentes y acotadas; conserva CORS |
| Admin `/api/orders` retirado | Ninguna sesión lo reactiva | POST 409, sin negocio |
| Tienda `admin_orders` / `admin_order` | ID token verificado con revocación, password y rol booleano | Proyección administrativa existente |
| Tienda quote, availability, start, status, recover, verify | ID token verificado con revocación; password o anonymous | Flujo comercial y guardas existentes, sin nuevos privilegios |
| Rules carts/usuarios | request.auth password/anonymous y UID propietario | Lectura/escritura propia; cutover para escritura |
| Rules clients | password/anonymous propietario por UID/email; administrador password con registro adminUsers existente | Facultades existentes, cutover para escritura |
| Rules orders/adminUsers | Sesión admitida; dueño/admin donde ya correspondía | Sólo lectura; conserva modelo existente |
| Rules catálogo | Lectura pública; ninguna escritura cliente | Cantidades, publicaciones y reservas sólo mediante servidor |
| Rules checkoutIntents/operations y caminos no declarados | Denegados | Sin acceso cliente |
| Atestación, read-smoke y reconciliador | Bearers dedicados y controles auditados existentes | No reemplazados por sesión Firebase |

La política del servidor está en `api/_lib/session-authority.ts`, idéntica en
los dos repositorios desplegables; la prueba pareada exige igualdad de bytes.
No interpreta body, header de proveedor ni JWT sin validar. El SDK conserva
firma, audiencia, caducidad, usuario deshabilitado y revocación. Las Rules no
consultan automáticamente `tokensValidAfterTime` del Admin SDK.

El código de acceso ordinario usa email/contraseña, registro y recuperación;
la tienda también inicia sesiones anónimas. Esto no identifica la sesión
productiva de John. No se cambió UI ni se agregó otro proveedor.

## Reproducción y límite derivado

Las pruebas usan Auth/Firestore demo y consumidores reales. La base admite
custom con UID/roles sintéticos. El target rechaza sesiones custom iniciales
y renovadas antes de negocio, y las Rules niegan sus escrituras/lecturas
privadas. Las pruebas de formas de claims malformadas son pruebas unitarias
de la política; no simulan una validación criptográfica exitosa del SDK.

Se ejecutaron también estas rutas, sin claves o usuarios productivos:

1. Custom → vincular email/contraseña → reautenticar con contraseña → renovar
   ID token. El proveedor pasa a password, con el mismo UID y roles.
2. Cerrar sesión → entrar con esa contraseña → renovar: vuelve a alcanzar
   Admin, consulta de pedidos y escritura propia por Rules.
3. Emitir otro custom para esa cuenta ya vinculada → cambiar su contraseña
   por accounts:update → entrar con la contraseña cambiada y renovar: vuelve
   a pasar la frontera Admin.

Estos casos son **caracterizaciones de una ruta todavía abierta**, no pruebas
de cierre ni aceptación del riesgo. Los tests fallan si cambia el comportamiento
observado para que se revise el procedimiento. El emulador no demuestra firma
criptográfica, aceptación ni explotación en el proveedor productivo. No hay
evidencia de intrusión ni de sesiones maliciosas existentes.

## Secuencia conjunta de instalación y cierre

Procedimiento futuro, idéntico en Admin y Tienda. Esta preparación sólo ensaya
la secuencia con datos ficticios, transportes loopback y emuladores demo. No
aplica barreras productivas ni crea claves, logins o recibos reales. El target
anterior y su R1 histórico se conservan; esta corrección exige revalidación
independiente focalizada por una sesión superior separada.

| Orden | Estado / decisión | Evidencia para avanzar | Familias y reapertura |
|---|---|---|---|
| 1 | Preparación, aislamiento IAM y alta/grant de candidata | Autoridad vigente, ventana, pareja/destinos exactos, barreras activas; revisión IAM antes del grant y `verifyInstallationIsolation` después | `PENDING_CLOSURE`; `FIREBASE_SESSIONS` y `SIGNED_JWT_AND_BLOB` permanecen `PENDING_TREATMENT` |
| 2 | `CONTROLLED_INSTALL_PENDING_CLOSURE` | Aislamiento IAM/grant comprobados, `provisionOneKey` y configuración bajo barreras | `credentialRoutesClosed: false`, `unresolved > 0`; ningún cierre/publicación |
| 3 | Candidata migrada y comprobada | Runtime Admin/Tienda consume la identidad nueva; smokes autorizados del candidato | Los pendientes se conservan; todavía no se retira el emisor antiguo |
| 4 | Retirada de emisores concretos | Consumidores migrados y comprobados antes de deshabilitar cada clave `USER_MANAGED` | Preservar `SYSTEM_MANAGED`; sesiones y contraseñas siguen pendientes |
| 5 | Tratamiento acotado | Identidades resueltas, recuperación legítima y acciones aprobadas sobre sesiones/vínculos/contraseñas | Conservar UID, roles legítimos, pedidos y datos; delimitar compradores aparte |
| 6 | Revocación/caducidad acreditada | Rechazos SDK y evidencia aplicable a Firestore Rules, emisión/renovación contenidas | Barreras mantenidas hasta resolver todas las rutas aplicables |
| 7 | Aceptación final y posible reapertura | `verifyCredentials`, `verifyContainment` y `publication-check`, más todos los gates operacionales existentes | Sólo el cierre acreditado permite recibos finales; instalación nunca habilita reapertura |

### 1. Preparación e aislamiento de autoridad

Una futura aplicación requiere revisión independiente del target exacto,
autoridad vigente, ventana actual, pareja Admin/Tienda y destinos Production
literales. Cerrar entradas, escritores directos, firma y vías de delegación
según el método elegido. Conservar la diferenciación de `PROJECT_DENY` y
`ALLOW_ABSENCE_V1`, políticas heredadas/de recurso, etags, barreras y negativas.
Retirar los grants elevados antiguos que permitan recuperar autoridad antes de
dar autoridad a la candidata. No convertir esa separación IAM en cierre de
Firebase ni atribuir al WAF/Rules un bloqueo de `identitytoolkit.googleapis.com`.

La revisión `installationReview` de las cuatro categorías IAM precede al
grant. El alta sin claves/autoridad, restricción de política y grant exacto
siguen su orden revisado. `verifyInstallationIsolation` comprueba después ese
conjunto, las restricciones heredadas/de recurso y el orden del grant, antes de
provisionar la clave. `installationReview` y el snapshot
`installationCredentials` conservan el estado pendiente. La revisión final de
credenciales/sesiones viene después del tratamiento; no se mueve el requisito
de cierre Firebase al alta o al grant.

### 2. Instalación controlada, todavía pendiente

Elegir explícitamente `CONTROLLED_INSTALL_PENDING_CLOSURE` para esta primera
migración. La entrada, salida y recibos de `provisionOneKey` conservan
`credentialRoutesClosed: false`, `PENDING_CLOSURE`, `unresolved > 0` y las familias
pendientes aplicables. Presentar ese mismo caso como ya cerrado se rechaza.
`CLOSED_SYSTEM_INSTALL` es una fase separada para un sistema realmente cerrado,
con evidencias propias; no es fallback para una instalación pendiente ni se
elige automáticamente ante un rechazo.

La autoridad de instalación se representa con
`EXPLICIT_CONTROLLED_INSTALL_AUTHORIZATION`, ligada a targets, ventana y fuente
vigentes, además de destinos exactos, aislamiento revalidado, grant runtime
candidato y `b2Cleaned`. Una autorización/fuente histórica no sustituye esos
prerrequisitos. La salida `PROVISION_METADATA_VERIFIED_RUNTIME_PENDING` conserva
el estado de instalación pendiente y `publicationAuthorized: false`: verifica
metadata/provisión, mientras el runtime todavía requiere su propia comprobación.

Mantener una sola creación de clave, identidad literal, las dos cuentas y
proyectos previstos, retirada de B2 por recurso/etag, stdin y secretos sólo en
memoria. Un resultado incierto no habilita reintento ciego; un fallo parcial no
acredita pareja provisionada. Preservar barreras y detener la cadena ante fallo
sin retirar claves antiguas ni abrir tráfico.

Configurar primero Admin y luego Tienda para la identidad candidata bajo esas
barreras, sin tráfico comercial abierto. Actualizar una variable no demuestra
que un deployment la haya consumido: ligar las comprobaciones al deployment,
HEAD/tree, artifact y runtime que realmente la usan. No copiar secretos al
build, logs, argumentos o archivos para demostrar esa asociación. La configuración
y el runtime comprobado deben corresponder a la misma pareja candidata.

### 3. Comprobaciones antes de retirar el emisor

Comprobar con acceso y alcance autorizados password legítimo con rol booleano
en los once destinos Admin, comprador anonymous en quote/availability,
checkout password, rechazo custom antes de negocio, catálogo legible y escritura
cliente denegada. Mantener el control de revocación del SDK y las guardas
existentes. No abrir escrituras generales para hacer un smoke ni crear una
preferencia ante una sesión rechazada. Una prueba sin pago no acredita una
compra E2E realizada. En esta remediación son ensayos locales con datos ficticios.

Si falla instalación, configuración o comprobación del runtime/smoke, no
continuar a la retirada del emisor. Un receipt de instalación no satisface
`verifyCredentials`, contención final ni `publication-check`.

### 4. Retirada posterior de emisores concretos

Sólo después de migrar y comprobar sus consumidores, releer bajo autoridad la
metadata de las claves antiguas concretas, ligar recurso completo, estado,
uso/dependencias y readback. Deshabilitar únicamente las `USER_MANAGED`
autorizadas, preservando `SYSTEM_MANAGED`, terceros y la candidata. No deshabilitar
ni borrar la cuenta de servicio completa. Ninguna de esas operaciones se aplica
ahora.

Deshabilitar la clave cambia su aceptación por el proveedor; no destruye el
material privado ni evita calcular una firma local. Acreditar por separado la
negativa de aceptación aplicable y la contención de delegación. Retirar B2 o un
binding no trata la firma local. Deshabilitar la clave tampoco revoca credenciales
cortas ya emitidas ni elimina una contraseña vinculada: el cierre de sesiones
sigue pendiente. [Efectos documentados de deshabilitar claves](https://docs.cloud.google.com/iam/docs/keys-disable-enable).

### 5. Conjunto de revisión y recuperación, sin nueva autorización

Bajo lectura futura autorizada, usar registros pertinentes sólo si existen y
cubren la ventana de la clave: `accounts:update`, `signUp` y emisión custom cuando
haya evidencia disponible. No asumir que la firma local de `createCustomToken`
genera un registro remoto, ni fabricar historial desde un log vacío o el proveedor
actual del ID token.

Sin una base confiable, preparar como conjunto administrativo inicial la **unión**
de cuentas con claims booleanos `admin === true` o `superadmin === true` y de las
identidades referidas por `adminUsers`, resolviendo correo/UID y discrepancias.
Ese conjunto es para revisión/recuperación: no constituye una allowlist nueva de
autorización ni prueba que nunca hubo otro UID afectado. No listar usuarios reales
ni enviar recuperaciones en esta preparación.

Tratar aparte vínculos/contraseñas derivados identificados, recuperación legítima
y sesiones del conjunto aprobado, conservando UID, roles legítimos, pedidos y
datos. Firebase documenta revocación automática en resets de contraseña y cambios
importantes de cuenta; comprobar la operación concreta y su readback, sin inferir
que una contraseña nueva por sí sola demuestra el cierre aplicable al SDK y a
Rules. [Gestión de sesiones y revocación](https://firebase.google.com/docs/auth/admin/manage-sessions).

El tratamiento de compradores necesita alcance y autorización aparte: un custom
token puede elegir cualquier UID. Recuperar sólo administradores no permite
marcar cierre universal. Si no se delimita el conjunto ni se distingue una
credencial derivada de una legítima, conservar sin resolver las rutas de ese
conjunto y de compradores; la aceptación final permanece bloqueada.

`accounts:update` vive en `https://identitytoolkit.googleapis.com/v1/accounts:update`;
permite vincular o cambiar password con un ID token según la
[API Auth oficial](https://firebase.google.com/docs/reference/rest/auth).
Ese host está fuera del WAF de la tienda y de las Rules de Firestore. Cerrar
entradas de Mutter no demuestra que se haya detenido esa frontera externa.

### 6. Evidencia separada para SDK y Firestore Rules

El SDK que verifica con `verifyIdToken(token, true)` consulta la revocación;
conservar prueba aplicable y timestamp de revocación/readback. Firestore Rules
no consulta automáticamente `tokensValidAfterTime`: un ID token todavía válido
puede conservar acceso según las Rules mientras no venza. El ejemplo oficial
de metadata de revocación usa **Realtime Database**, no este Firestore.

Mantener barreras hasta evidenciar rechazo/caducidad de los ID tokens aplicables
y fin de su emisión/renovación. Una espera aislada sin emisión/renovación
contenidas, un log vacío, una contraseña nueva o retiro de binding no bastan.
Si se necesita un mecanismo adicional para Rules, revisarlo y autorizarlo como
delta aparte; no atribuirlo a este target ni abrir acceso para ensayar.

### 7. Cierre efectivo y decisiones futuras

Sólo después del tratamiento y su evidencia, completar los recibos finales de
las cinco familias y pasar `verifyCredentials`/`verifyContainment`; se conservan
los snapshots de instalación para ligar el orden, sin reescribirlos como cerrado.
No declarar `unresolved: 0` ni `REVIEWED_NO_UNRESOLVED_ROUTE` por la provisión,
el filtro directo o pruebas demo. La aceptación final de publicación conserva
todos sus prerrequisitos y gates existentes. El residual aceptado sólo cubre
escritura antigua previamente admitida con respuesta perdida; no absorbe sesiones
activas, contraseñas derivadas ni autoridad recuperable.

Las decisiones futuras para Rodrigo se consolidan por sus consecuencias: ventana
y barreras reales, retirada de claves tras migración comprobada, recuperación y
revocación del conjunto acotado, eventual alcance de compradores y reapertura
tras todos los gates. Retirar claves puede interrumpir consumidores no migrados;
recuperar/revocar accesos puede exigir volver a entrar. Esta remediación no pausa,
revoca, cambia contraseñas, desvincula proveedores, borra cuentas ni modifica
cantidades/permisos productivos. El acceso actual de John y compradores no se toca.

## Selección exacta de Rules

En el repositorio Tienda, la publicación futura de Rules usa exclusivamente
`firebase.stock-release.json` y `--only firestore:rules`, proyecto literal
mutter-games. Ese archivo selecciona
`firebase.catalog-cutover.rules`, probado directamente por la suite y ligado por
hash al informe del target. No usar `firebase.json` histórico ni un deploy general.
La configuración de emuladores conserva R1B para el harness; la suite carga
además los bytes exactos de cutover. Ambas variantes cierran catálogo y custom.
Antes/después de aplicar: comparar fuente/hash del target con la release remota,
sin publicar índices o funciones por una configuración implícita.

## Preparativos conservados, sin uso remoto en esta etapa

| Preparativo | Canal/autoridad previa | Antes del corte | Sólo tras aplicación |
|---|---|---|---|
| Login Google aislado | Cliente oficial Mutter, alcance previo delimitado | Identidad/proyecto/políticas con etags frescos | Retirada del canal propio comprobada |
| B2 | Rol exacto getAccessToken, dos cuentas literales; ventana máxima 20 min | Helpers ensayados, base por URL/etag, plan cleanup | Una emisión por cuenta de 600 s, readback/negativas/retirada inmediata |
| Provisión | Una clave candidata en memoria; stdin oficial a los dos destinos Production | Metadata/scopes/identidades y fallos parciales | Identidad/aceptación/lectura posterior sin mostrar secretos |
| Acceso candidato | Deployment ID literal, máximo 1200 s, retirada explícita | Transporte loopback, rechazo redirects/cookies/destino cruzado | Acceso limitado y rechazo posterior de cliente fresco y sesión utilizada |
| Lectura Admin legítima | Login ordinario existente aislado | Código y pruebas demo, no sesión real | GET acotado con identidad real autorizada |
| Contención, respaldo final, operaciones | Gates/procedimientos existentes | Evidencia previa conservada, sin repetir respaldo | Recibos bajo barreras y comparación final |
| Runtime, cron y reapertura | Aplicación futura y confirmación temporal vigente | Artefactos nuevos y revisión independiente | Atestaciones, dos ticks reales, diferencias resueltas |

Los cuatro helpers/tests privados del paquete de aplicación anterior se conservan
por hash. La copia propia ensaya las 14 pruebas históricas, el loopback del CLI y
las regresiones de secuencia; sus hashes nuevos pertenecen al target nuevo.
No se incorporan credenciales ni capturas privadas al repositorio público. Se mantienen los TTL y
los límites de B2/provisión; ninguna evidencia histórica concede autoridad
vigente. No se reutiliza una ventana histórica ni se programa la aplicación.

Cleanup anterior: caché local retirada y comprobada; **revocación OAuth remota
no acreditada**. No revocar el grant global ni otras sesiones para convertir ese
límite en PASS. La exigencia final de `verifyCredentials` y publicación se
mantiene intacta; la separación temporal IAM/instalación no altera la reparación
braces ni la excepción Edge.

Referencias de comportamiento, no evidencia de producción:
[vinculación](https://firebase.google.com/docs/auth/web/account-linking),
[API Auth](https://firebase.google.com/docs/reference/rest/auth),
[revocación](https://firebase.google.com/docs/auth/admin/manage-sessions).
