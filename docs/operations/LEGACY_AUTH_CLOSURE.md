# Cierre de accesos y regreso de las mismas cuentas

Candidato de preparación 2026-10-10, contrato `MUTTER_BUYER_AND_ADMIN_CREDENTIAL_CLOSURE_20261010`.
SESSION_ROLE=EXECUTOR. REAL_CREDENTIAL_CLOSURE=NOT_PERFORMED.
PRODUCTION_APPLICATION=NOT_PERFORMED. Revisión independiente y coordinación temporal
pendientes antes de aplicar. El contrato actual incluye compradores; reemplaza la
exclusión administrativa anterior, conservada en los snapshots históricos.

## Frontera elegida

Se conserva Firebase Auth y la verificación SDK con revocación. El filtro histórico
`password`/`anonymous` no decide la admisión: una credencial derivada custom → password
puede seguir autenticándose. Esa autenticación por sí sola no autoriza datos ni
acciones protegidas del candidato.

La autoridad exige una capability aleatoria por sesión, emitida sólo por servidor,
con claims adicionales `mutterCredentialSession` (64 hex) y `mutterCredentialEpoch`.
No se escribe `setCustomUserClaims`: nunca hay un desbloqueo de UID para que todos
sus futuros logins hereden autoridad. Cada capability se liga a UID, epoch, vigencia,
prueba legítima y roles booleanos fijados; no al proveedor aparente ni a claims
aportados por quien solicita recuperar.

| Estado protegido | Contenido / efecto |
|---|---|
| `operations/credentialAccessCutover` | schema 1, phase ENFORCED, epoch, legacyCutoffMs; cliente sin escritura |
| `credentialAccess/{uid}` | schema 1, UID/epoch, PENDING, RECOVERED o NATIVE_POST_CUTOVER, recoveryEmail y prueba independiente cuando existe, roles legítimos; cliente no libera restricciones |
| `credentialSessions/{capability}` | schema 1, ACTIVE, UID/epoch/expiresAtMs, proofKind NEW_POST_CUTOVER o RECOVERY_CHANNEL y roles booleanos; sólo servidor |

Los consumidores SDK de Admin/Tienda y las Rules candidatas comprueban esa misma
frontera. Los datos públicos del catálogo permanecen públicos. Lecturas/escrituras
privadas de carritos, pedidos, perfiles y registros administrativos exigen sesión
válida de ese UID y capability. Las escrituras comerciales siguen pasando por sus
transacciones y reservas existentes. Las guardas de cutover, firma, CORS, runtime,
cron y los bearers dedicados no se sustituyen ni amplían.

El servidor conserva `verifyIdToken(token, true)`. Firestore Rules no presuponen
que `tokensValidAfterTime` sea aplicado por el motor: verifican control y documento
de capability protegidos, UID, epoch, expiración y roles. Las mutaciones de estados
y capabilities están negadas a clientes, incluyendo quien tenga una sesión previa.
Antes de deshabilitar una cuenta o revocar su sesión en una aplicación posterior,
marcar su estado protegido PENDING o revocar su capability en el destino, y comprobar
Rules y SDK por readback. Sólo entonces ejecutar la revocación oficial de Auth.
`disabled` o la revocación de Firebase por sí solos no contienen tokens en Rules.
La capability dura hasta siete días; se renueva sólo dentro de sus últimas doce horas
cuando todavía es válida. Una capability vencida se rechaza sin renovación.

## Inventario y tratamiento por cuenta

Inventario Auth completo y paginado de metadata mínima; no exportar passwords,
hashes, salts, claves ni tokens. Mantener UID, clasificación, estado, proveedores,
fechas necesarias y correo únicamente para recuperación. Errores o páginas
incompletas bloquean el resultado; ningún error se convierte en lista vacía.

Ante historia insuficiente, el conjunto conservador contiene todas las cuentas
anteriores al corte futuro. Una fecha vieja, proveedor password o logs vacíos no
acreditan procedencia y tampoco prueban intrusión. Todos esos UIDs reciben estado
protegido PENDING. Conservar usuarios y vínculos por UID, pedidos, publicaciones,
cantidades y carritos; no borrar/recrear, fusionar por email ni trasladar datos.

Distinguir registrados, anónimos, sin canal acreditado y deshabilitados. Los roles
privilegiados requieren la autoridad existente contrastada; no conceder claims a
Rodrigo ni copiar roles del token bajo revisión. El plan privado incluye evidencia,
ruta de retorno, medida mínima, UID/datos preservados y prueba de cierre. No subir
su inventario ni correos a Git, CI o artefactos públicos.

No se cambian todas las contraseñas. La restricción de destino contiene las
credenciales anteriores incluso cuando el titular todavía no volvió. Revocar
sesiones sólo conforme al plan por cuenta y después de preparar el regreso y
coordinar; no revocar/recrear anónimos a ciegas. Anónimos y cuentas sin canal
legítimo quedan identificados, con datos intactos y sin declarar recuperación.
Conocer un UID, un pedido o presentar la propia sesión no libera ese estado.
Para anónimos o cuentas sin canal, una identificación independiente del titular
legítimo puede permitir un regreso al mismo UID; es una posibilidad, no una garantía.
Sin esa evidencia, conservar el UID y los datos sin recrear ni liberar la cuenta.
Los documentos sin vínculo suficiente con un UID inventariado permanecen
intactos, sin asignación, traslado ni migración de sincronización. Sus counts quedan
en el inventario privado; la ausencia de vínculo no autoriza inferir un propietario.
Las cuentas nuevas posteriores al corte usan el bootstrap acotado del servidor,
que contrasta la creación oficial y proveedor permitido, sin dar roles de Admin.
El bootstrap crea el estado protegido NATIVE_POST_CUTOVER antes de la capability;
sin ese documento, una cuenta nueva tampoco accede a destinos privados.
La compra anónima nueva sigue disponible; no obliga a registrarse ni usar MFA.

## Recuperación y John

John conserva su UID, cuenta y catálogo existentes. Su identidad, correo y roles
observados quedan únicamente en el registro privado para readback; no acreditan
control actual de la casilla ni de la sesión. Antes de interrumpir su acceso,
confirmar que puede abrir el correo registrado o el panel que usa; nunca pedir
contraseña, token, código, instalación ni comandos. No usarlo como cuenta de ensayo.

Sólo una dirección independientemente vinculada al titular habilita recuperación.
La metadata email/emailVerified y un email escrito en la página no bastan. Un canal
sin evidencia permanece UNVERIFIED; no recibe capability ni se declara recuperado.
Resolver diferencias por lectura y conservar el UID; no cambiar email o permisos
para facilitar una prueba.

El flujo preparado usa PASSWORD_RESET oficial, locale es y retorno aprobado.
Un nonce aleatorio de correo se liga a UID/epoch/TTL; se persiste sólo su hash.
Su valor viaja exclusivamente en el enlace de correo, como fragmento del retorno,
y no en terminal, chat, logs, Git o CI. No hay contraseña común o temporal: la
elige el titular en Firebase. El servidor exige prueba del correo ligada al mismo
UID y una sesión posterior al reset oficial antes de emitir la capability.
Un reset no completado, OOB anterior, enlace vencido/reutilizado o UID/email
incorrectos no libera la restricción. Una contraseña cambiada no prueba quién la
eligió. Las respuestas públicas de solicitud no revelan existencia ni datos.

Mensaje de John, un paso humano por vez, sin enviarlo en esta preparación:
«Abrí el correo de Mutter.» Después: «Elegí y guardá tu contraseña nueva; volvé al
panel con Iniciar sesión.» Comprobar el retorno real y la conservación del catálogo
cuando se aplique. Un HTTP 200 del handler vacío no es un reset logrado.

## Secuencia única aplicable después de revisión

1. Adoptar targets exactos revisados, preflight fresco, desconexión Git y ausencia de
   deploy hooks/automatismos, destinos literales, inventario privado y regreso de
   John preparado. No iniciar pausa en la preparación actual. Mantener las demás
   condiciones del runbook y el riesgo de escritura antigua con respuesta perdida
   separado del cierre de credenciales.
2. Obtener una única coordinación temporal vigente. Cerrar WAF de los cuatro
   proyectos, Rules/escritores/control y scheduling interlock; probar/readback y
   drenar con las cotas/margen existentes. Auth `identitytoolkit.googleapis.com`
   y `accounts:update` permanecen fuera de WAF/Rules: no atribuirles un bloqueo.
3. Aislar IAM/delegación con el método revisado ALLOW_ABSENCE_V1 o PROJECT_DENY.
   `installationReview` IAM precede alta/restricción/grant de la candidata.
   Verificar `verifyInstallationIsolation` después del grant y antes de la clave.
4. Usar `CONTROLLED_INSTALL_PENDING_CLOSURE`. `provisionOneKey` conserva
   `credentialRoutesClosed: false`, `installationCredentials`, familias
   FIREBASE_SESSIONS/SIGNED_JWT_AND_BLOB PENDING_TREATMENT y `unresolved > 0`.
   DELETE exacto sin cuerpo mediante confirmación normal del CLI en TTY; POST
   secreto únicamente por stdin; readback. Creación única, ningún retry ciego ni
   flags que omitan permisos. El snapshot de transporte final mantiene sus bytes.
5. Configurar/aplicar Admin compatible y Tienda prebuilt bajo barreras; demostrar
   que ambos runtimes consumen la candidata. PROVISION_METADATA_VERIFIED_RUNTIME_PENDING
   acredita metadata, no runtime ni cierre. Un fallo o provisión parcial conserva
   barreras y journal; no retirar el emisor previo ni crear otra clave por rutina.
6. Sólo con migración comprobada, deshabilitar las USER_MANAGED antiguas exactas,
   preservando SYSTEM_MANAGED. Aplicar control/estados protegidos y Rules del target
   revisado bajo las barreras, cubrir todos los UIDs del inventario final y comprobar
   cada readback antes de tratar sesiones. No alterar el catálogo ni las reservas.
7. Ejecutar tratamiento mínimo por cuenta con journal privado duradero. Mantener
   restricción PENDING mientras no exista la prueba legítima de regreso. No liberar
   por password/login/refresh/custom/link/change ni por revocar o mandar un correo.
   Las carreras Auth pueden modificar una contraseña, pero no escribir el estado
   protegido ni acuñar otra capability. Un reset anterior tampoco incluye la prueba
   de correo de esta operación. Revalidar estas fronteras sin levantar barreras.
8. Formar `authDestinationContainment`: inventario completo, control/estados,
   política de capabilities, Rules activas, runtime SDK y continuidad de UID/datos.
   El inventario completo distingue UIDs previos al corte y UIDs creados después:
   todos los previos deben tener restricción; los nuevos se registran por separado
   y sus capabilities exigen creación oficial posterior y NATIVE_POST_CUTOVER.
   Los counts de cierre legacy no absorben cuentas nuevas ni ocultan pendientes.
   Sus capturas tienen tipos propios y archivos primarios privados: no se camuflan
   como `reviewSources` IAM. Ligar hashes, pareja y cronología posterior a migración.
   Para FIREBASE_SESSIONS/SIGNED_JWT_AND_BLOB, DESTINATION_AUTHORITY_CONTAINED exige
   esta prueba; `verifyCredentials` rechaza counts inventados, estado parcial,
   antigua Rules o pruebas sintéticas presentadas como producción.
9. Una cuenta pendiente puede contarse contenida sólo cuando ninguna credencial
   anterior accede o renueva autoridad protegida y no puede quitar su restricción.
   `RETURN_COMPLETE`, `PENDING_RETURN`, `NO_VERIFIED_CHANNEL` y `DISABLED` permanecen
   separados. No se exige que todos vuelvan a la vez; no se mapea un abierto a cerrado.
10. Verificar contención final de las cinco familias, respaldo/comparación,
    índice READY, cron/reconciling y los demás gates del runbook. `publication-check`
    exige la revisión independiente de esta pareja/artefacto y autorización fresca;
    ningún PASS sintético, de instalación o CI sustituye sus recibos. Sólo entonces
    reabrir compras/Admin y comprobar el acceso y catálogo de John y flujo normal.

## Journal y fallos parciales

`private-snapshot/operations/credential-plan.mjs` compone el plan sin clientes remotos.
`credential-journal.mjs` registra antes de cada operación, con archivos 0600 y raíz
0700, secuencia/hash previo, operación/plan y hash de evidencia; fsync antes de
avanzar. No guarda passwords, códigos, enlaces, nonce ni tokens. El único runner
incluido exige un adaptador demo; no tiene modo de aplicación productiva.

CONFIRMED no se repite. STARTED, UNCERTAIN, FAILED_NOT_SENT, journal incompleto,
lock de proceso interrumpido o drift paran el avance. Reanudar exige lectura primaria:
APPLIED_EXACT_MATCH confirma sin reenviar; NO_EFFECT_EXACT_MATCH permite preparar
una acción nueva comprobada. Efecto desconocido mantiene barreras; no repetir correo,
reset, revocación, clave ni provisioning a ciegas. No hacer rollback a credenciales
inseguras ni perder datos para fabricar un PASS. La ausencia de logs no prueba que
no se entregó un correo ni que una operación no ocurrió.

## Pruebas y límites

La matriz nueva usa consumidores reales, Auth/Firestore demo y ambas Rules candidatas.
Reproduce primero la ruta derivada anterior y prueba sesión-capability por UID/epoch,
roles, expiración, recuperación, carreras y acceso directo. Se conservan los tests
existentes de edición autorizada/descuento único. Los controles del gate prueban
rechazo de prueba parcial y la secuencia completa pendiente → migración → destino
contenido, sin convertir autorrevisión en auditoría independiente.

Los emuladores no acreditan comportamiento remoto exacto de mail, firma/aceptación
productiva, delivery ni revocación de sesiones productivas. La revisión y aplicación
futuras requieren evidencia primaria del proveedor y readbacks. Durante esta etapa
REAL_CREDENTIAL_CLOSURE=NOT_PERFORMED y PRODUCTION_APPLICATION=NOT_PERFORMED.
No se envían correos reales, revocan sesiones, conceden roles, provisionan secretos,
deshabilitan claves, aplican WAF/Rules/índice/cron, hacen merge/deploy ni pausas.
