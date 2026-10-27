# Fuentes de la versión publicada

Esta consolidación conserva las fuentes de `dpl_DH3tviTCAP6yAWxAASph2mm8dmN3`.
Inventario del paquete: `8f32af1a499c2963d0b8ed5400468413ca65d4060c081a3554bdf97d8877a448`.
La configuración y los datos efectivos de producción permanecen fuera de Git.
Actualizar este repositorio no modifica publicaciones, cuentas, stock ni compras.

## Trabajo local y comprobaciones

Usar Node **24.22.1**, el constructor exacto del paquete conservado:

```sh
npm run install:controlled
npm run typecheck:frontend
npm run typecheck:server
npm run build
```

La instalación controlada conserva el parche de dependencias ya requerido por el
proyecto; no sustituirla por una instalación que ejecute ciclos antes de verificarlo.
No modificar dependencias instaladas que estén compartidas con otro trabajo.

El constructor local de `scripts/published/build.mjs` conserva el emisor revisado,
el entorno público explícito y los controles de exclusión de Edge. Compara fuentes,
módulos y los seis archivos emitidos con el paquete publicado. No lee `.env` ni
usa credenciales de servidor. Requiere un destino `dist` inexistente para no borrar
archivos existentes. `dist/` y `build-evidence/` son resultados locales ignorados.
Un cambio funcional posterior necesita su propio target y actualizar esa referencia
tras su revisión; nunca regenerar hashes para ocultar una diferencia inesperada.

El gate actual de comercio y stock usa `npm run test:published -- native-<etiqueta-unica>`, con los mismos
ocho archivos y 180 casos del control revisado para esta versión, emuladores
locales y Java 21. Separa el proyecto y las reglas vigentes de las suites de etapas
anteriores; no modifica sus assertions. El descubrimiento general
`npm run test:catalog` conserva pruebas históricas de contratos incompatibles y no
representa por sí solo el gate de esta versión. Su fallo local se conserva en los
registros de ejecución; no se presenta como aprobado.

Para ejecutarlo en una copia propia, instalar también el SDK de comparación con
`npm ci --prefix verification/retained-admin-api --omit=dev --ignore-scripts`.
Definir `JAVA_HOME` con un Java 21 ya instalado y `FIREBASE_EMULATORS_PATH` con una
caché explícita del emulador Firestore 1.22.0; el runner verifica su hash antes de
ejecutarlo. `node node_modules/firebase-tools/lib/bin/firebase.js setup:emulators:firestore`
prepara esa caché antes del aislamiento. Cada ejecución necesita una etiqueta
nueva; no reutilizar un resultado anterior. macOS usa el aislamiento local del
runner y Linux requiere un espacio de red que sólo tenga `lo`, como muestra CI.

La referencia `verification/retained-admin-api` conserva cuatro módulos y sus
dependencias exactas del commit local histórico
`2a7521cdfd096f7a9b0531814f3ccaa5fe430d1b`, únicamente para repetir la comparación
de fuentes del gate existente. No es un mock ni una implementación nueva. No
acredita la versión publicada del Admin API separado y no se importa desde el
producto. Su procedencia y sus hashes están en `PROVENANCE.json`.

Estas comprobaciones no requieren datos productivos ni un cobro real. La
configuración Firebase del navegador es
pública; las cuentas de servicio, secretos de pagos y demás credenciales no se
guardan en este repositorio.

## Publicación separada

`vercel.json` desactiva los despliegues automáticos disparados por Git. CI sólo
verifica código y no dispone de pasos de publicación. La web continúa usando el
despliegue ya aplicado por el mecanismo controlado; no publicar desde este checkout
como consecuencia de actualizar GitHub.

El servidor usa un runtime personalizado `provided.al2023`, con Node incluido en
el paquete de despliegue. Sus lanzadores, configuración de rutas y hashes de las
dependencias del runtime están en `scripts/published/runtime/`. Los binarios y las
dependencias instaladas no se incluyen en Git. `npm run build` reconstruye la SPA;
no genera ni publica ese paquete de servidor. El antiguo constructor
`build:prebuilt`, fijado a Node22, no representa esta versión y no debe utilizarse
para publicarla. Esta consolidación no habilita ese flujo antiguo.

Las fuentes del producto y los tests se conservan sin cambios funcionales. Las
adaptaciones propias de esta consolidación se limitan al constructor local, CI,
metadatos de comprobación y exclusiones de Git. Las herramientas históricas del
primer corte que contienen identidades IAM personales permanecen en el registro
local protegido y se excluyen de esta publicación de fuentes.
