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
| Tienda quote, availability, start, status, verify | ID token verificado con revocación; password o anonymous | Flujo comercial y guardas existentes, sin nuevos privilegios |
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

## Delta operativo mínimo para revisión independiente

No ejecutar en esta preparación. El contrato vigente no autoriza retirar
claves antiguas, cambiar cuentas reales ni revocar sesiones.

1. Bajo una aplicación futura autorizada, coordinar ventana actual y cerrar
   todas las entradas existentes. Migrar consumidores legítimos a la identidad
   dedicada por el transporte revisado antes de retirar su credencial antigua.
2. Releer sólo metadata de las claves USER_MANAGED de la cuenta Firebase antigua
   inventariada en el paquete privado; ligar nombres completos, estado, usos,
   dependencias y readback. Deshabilitar las claves concretas tras autorización
   expresa, preservando claves SYSTEM_MANAGED y terceros. Mantener retirada IAM
   y negativas de firma/delegación. No probar emisión con una clave real antigua
   sin alcance adicional. La firma local no queda resuelta sólo retirando B2.
3. Tratar por separado sesiones y credenciales derivadas. Una clave deshabilitada
   no revoca ID/refresh tokens ya emitidos, ni elimina una contraseña vinculada.
   Identificar bajo acceso autorizado los usuarios/providers relevantes y una
   base legítima verificable; restaurar sólo vínculos/credenciales no legítimos
   identificados, recuperar el acceso ordinario del titular y revocar las
   sesiones correspondientes mediante el proveedor. No borrar cuentas o roles
   ni presuponer que sólo John pudo ser destino: custom puede elegir otro UID.
4. Si no se puede delimitar confiablemente ese conjunto o distinguir una
   contraseña derivada de una legítima, **sigue bloqueada la declaración de
   cierre**. La mínima alternativa requiere recuperación coordinada de acceso
   para el conjunto afectado, con alcance/impacto aprobado y revisión previa;
   no se inventa una procedencia histórica a partir de sign_in_provider.
5. Acreditar también la invalidación en los escritores directos: Rules no aplica
   por sí sola la revocación SDK. Mantener barreras hasta contar con evidencia
   de rechazo de las sesiones aplicables y del fin de su capacidad de renovación,
   incluyendo la validez de ID tokens emitidos. Un log vacío, espera aislada,
   contraseña nueva o retiro de binding no son ese recibo. Si se requiere un
   mecanismo adicional de revocación por Rules, revisarlo como delta antes de
   aplicar, sin atribuirlo a este target.
6. Sólo con cierres comprobados, login ordinario legítimo y negativas reales
   dentro del alcance autorizado, completar las familias del gate. Conservar
   el residual aceptado exclusivamente de escritura previa admitida con
   respuesta perdida; no absorber aquí autoridad activa de cuentas antiguas.

Consecuencia prevista: retirar claves puede interrumpir consumidores no
migrados; recuperar credenciales/revocar sesiones puede requerir que usuarios
vuelvan a entrar. Por eso esas acciones se proponen y no se aplican ni se
confunden con un cambio invisible del login.

## Selección exacta de Rules

La publicación futura de Rules usa exclusivamente `firebase.stock-release.json`
y `--only firestore:rules`, proyecto literal mutter-games. Ese archivo selecciona
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
por hash y se vuelven a ensayar (14 pruebas y loopback del CLI). No se incorporan
credenciales ni capturas privadas al repositorio público. No se reducen TTL ni
se duplica la autorización previa de B2/provisión. No se reutiliza una ventana
histórica ni se programa la aplicación.

Cleanup anterior: caché local retirada y comprobada; **revocación OAuth remota
no acreditada**. No revocar el grant global ni otras sesiones para convertir ese
límite en PASS. Este cambio no modifica `verifyCredentials`, el gate, el parser,
la reparación braces ni la excepción Edge.

Referencias de comportamiento, no evidencia de producción:
[vinculación](https://firebase.google.com/docs/auth/web/account-linking),
[API Auth](https://firebase.google.com/docs/reference/rest/auth),
[revocación](https://firebase.google.com/docs/auth/admin/manage-sessions).
