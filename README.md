---
creado: 2025-05-30
actualizado: 2025-06-01
---
# Salesforce Database Copier

Herramienta CLI para desarrolladores de Salesforce, diseñada para extraer y desplegar conjuntos de datos entre organizaciones, manteniendo la integridad de las relaciones sin necesidad de modificar el esquema.

## Propósito

Migrar datos entre entornos de Salesforce (ej: de Producción a una Sandbox, o entre Sandboxes) es una tarea compleja, especialmente cuando se trata de mantener las relaciones entre registros. Herramientas como los Data Loaders requieren una gestión manual de IDs y un orden de carga preciso.

**Salesforce Data Copier** automatiza este proceso. Analiza las dependencias entre los objetos, calcula el orden de despliegue correcto y gestiona el mapeo de IDs de forma interna, permitiendo migraciones de datos complejas con comandos simples.

## ✨ Características Clave

  * **Gestión Inteligente de Relaciones:** Mapea las relaciones entre registros sin necesidad de crear campos de "ID Externo" en tus objetos de Salesforce.
  * **Análisis Automático de Dependencias:** Calcula el orden de despliegue correcto (ej: `Account` antes que `Contact`) analizando los metadatos de los objetos.
  * **Integración con Salesforce CLI:** Utiliza tus alias de `sfdx` o `sf` ya autenticados para una conexión segura y sin esfuerzo.
  * **Selección Inteligente de API:** Detecta automáticamente si una consulta SOQL contiene subconsultas y elige la API de Salesforce adecuada (Query API para subconsultas, Bulk API para consultas simples) para optimizar la extracción. Permite forzar el uso de una API específica con `--api-type`.
  * **Manejo de Subconsultas (Padre-Hijo):** Cuando se usan subconsultas, la herramienta "desenrolla" los datos JSON anidados de la Query API en archivos CSV separados para objetos padre e hijo. Para mantener la vinculación de la relación, se añade una columna artificial al CSV del objeto hijo con el patrón `NombreCampoRelacion` (ej. `AccountId`). Esta columna contiene el `Id` del registro padre de la organización de origen, siendo vital para el mapeo durante el despliegue.
  * **Despliegue en Dos Fases:** Maneja dependencias circulares o complejas mediante un proceso de dos fases. La **Fase 1 (`processInsertPass`)** realiza la inserción inicial de registros y genera mapas de IDs. La **Fase 2 (`processUpdatePass`)** utiliza estos mapas de IDs para resolver y actualizar las relaciones de búsqueda (lookups) que no pudieron ser establecidas durante la Fase 1, asegurando la integridad referencial. Esta fase también genera logs de errores específicos para las actualizaciones (ej. `<ObjectName>-update-errors.json`).
  * **Interfaz de Usuario Clara:** Ofrece feedback constante con indicadores de progreso, logs de colores y resúmenes de operación.
  * **Seguro por Defecto:** Pide confirmación antes de ejecutar operaciones que modifiquen datos en un entorno de destino.
  * **Modo Interactivo Guiado:** Una interfaz paso a paso para configurar y ejecutar operaciones, incluyendo la gestión de consultas SOQL y la generación asistida de consultas para backups. Ideal para usuarios nuevos o para tareas complejas.
  * **Listado Directo de Objetos:** Accede rápidamente a una lista de todos los SObjects disponibles en tu organización de origen a través del modo interactivo. Consulta la [Guía de Listar Objetos](.localdevserver/docs/user_guide/Modo_Interactivo_Listar_Objetos.md) para más detalles.
*   **Gestión Centralizada de Alias de Organización:** Permite gestionar y visualizar los alias de Salesforce CLI directamente desde la herramienta, facilitando la selección de la organización activa para operaciones como la extracción de datos, tanto en modo CLI como interactivo.
*   **Extracción de Datos Asistida (Modo Interactivo):** Configura y ejecuta extracciones de datos complejas, incluyendo la gestión de consultas SOQL y la selección de API, de forma guiada. Consulta la [Guía de Extraer Datos (Modo Interactivo)](projects/salesforce-copy-database/docs/user_guides/interactive_mode/extract_data.md) para más detalles.
  * **¡Nuevo! Asistente Interactivo de Consultas SOQL:** Dentro de la extracción de datos en modo interactivo, ahora puedes construir tus consultas SOQL paso a paso. El asistente te ayuda a seleccionar SObjects, campos (incluyendo campos de relaciones) y a definir condiciones `WHERE`, minimizando errores y facilitando la exploración de datos.
  * **Soporte Automático de la API de Herramientas para Consultas SOQL:** La herramienta ahora detecta automáticamente cuando una consulta SOQL se dirige a un SObject que solo es accesible a través de la API de Herramientas (Tooling API) y cambia de forma transparente a esta API para ejecutar la consulta. Esto significa que no necesitas modificar tus consultas SOQL ni especificar el tipo de API; la funcionalidad `extract` y la opción interactiva "Extraer Datos" lo gestionarán automáticamente.

* **Soporte para Consultas SOSL:** Permite ejecutar búsquedas SOSL (Salesforce Object Search Language) directamente a través del comando `extract` usando el parámetro `--sosl`. Ideal para buscar términos específicos a través de múltiples SObjects simultáneamente. Los resultados de cada SObject encontrado se guardan en archivos CSV separados.
## 🗂️ Gestión de Alias de Organización

La herramienta ahora ofrece una gestión mejorada de los alias de organización de Salesforce, permitiendo una selección más sencilla y una visualización clara de las organizaciones disponibles. Esto simplifica las operaciones al asegurar que siempre se trabaje con el alias correcto.

### Uso en CLI: Parámetro `--target-alias` para `extract`

El comando `extract` ahora soporta el parámetro `--target-alias` para especificar la organización de destino para la extracción de datos. Esto es útil cuando se desea extraer datos de una organización y guardarlos en un directorio de trabajo asociado a un alias específico, incluso si no es la organización de origen.

*   `--target-alias, -T`: (Opcional) El alias de la organización de destino para la extracción. Si se proporciona, los datos extraídos se guardarán en el directorio `workdir/<target-alias>/data/`. Si no se especifica, se usará el alias de la organización de origen (`--source`) para determinar la ruta de guardado.

**Ejemplos:**

1.  **Extraer datos de `dev1` y guardarlos en `workdir/dev1/data/` (comportamiento por defecto):**
    ```bash
    node dist/src/main.js extract -s dev1 -q "SELECT Id, Name FROM Account"
    ```

2.  **Extraer datos de `dev1` pero guardarlos en `workdir/qa-org/data/`:**
    ```bash
    node dist/src/main.js extract -s dev1 -q "SELECT Id, Name FROM Account" --target-alias qa-org
    ```

### Uso en Modo Interactivo: "Gestionar Alias de Organización"

El modo interactivo ha sido mejorado con una nueva opción de menú principal para gestionar los alias de organización, lo que proporciona una experiencia de usuario más intuitiva.

1.  **Menú Principal:** Al iniciar el modo interactivo (`npm start -- interactive`), ahora encontrarás la opción "Gestionar Alias de Organización".
    ```
    ¿Qué acción te gustaría realizar?
    1. Extraer datos
    2. Desplegar datos
    3. Listar objetos SObject
    4. Gestionar Alias de Organización
    5. Salir
    Elige una opción: 4
    ```

2.  **Sub-menús y Acciones:** Dentro de esta opción, podrás:
    *   **Listar Alias de Organización:** Ver todos los alias de Salesforce CLI disponibles en tu entorno, junto con su estado de autenticación.
    *   **Seleccionar Alias Activo:** Elegir un alias para que sea el "alias activo" de la sesión. Este alias se utilizará por defecto en operaciones posteriores, como la "Extracción de Datos", simplificando la entrada de parámetros.
    *   **Refrescar Alias:** Actualizar la lista de alias disponibles, útil si has autenticado nuevas organizaciones o modificado alias fuera de la herramienta.

3.  **Impacto en Operaciones Interactivas:**
    *   **Extracción de Datos:** Cuando selecciones la opción "Extraer datos" en el menú principal, si ya has establecido un alias activo, la herramienta te sugerirá automáticamente ese alias como organización de origen, o como alias de destino para guardar los datos, agilizando el proceso.

### Puntos de Integración Clave

Esta funcionalidad se integra con varios módulos existentes para proporcionar una experiencia fluida:

*   [`src/core/aliasManagerService.ts`](src/core/aliasManagerService.ts): Nuevo módulo centralizado para la lógica de gestión de alias (listado, selección, refresco).
*   [`src/commands/extractCommand.ts`](src/commands/extractCommand.ts): Modificado para aceptar el nuevo parámetro `--target-alias`.
*   [`src/interactive/menuDefinitions.ts`](src/interactive/menuDefinitions.ts): Define la nueva opción "Gestionar Alias de Organización" en el menú principal.
*   [`src/interactive/actionHandlers.ts`](src/interactive/actionHandlers.ts): Contiene la lógica para manejar las acciones del menú de gestión de alias.
*   [`src/interactive/sessionState.ts`](src/interactive/sessionState.ts): Almacena el alias de organización activo seleccionado por el usuario durante la sesión interactiva.

## Prerequisites

Antes de empezar, asegúrate de tener instalado:

  * [Node.js](https://nodejs.org/) (versión 18.x o superior)
  * [npm](https://www.npmjs.com/) (normalmente se instala con Node.js)
  * [Salesforce CLI](https://developer.salesforce.com/tools/sfdxcli) (y tener tus organizaciones autenticadas con un alias).

## 🚀 Instalación

1.  **Clona el repositorio:**

    ```bash
    git clone https://github.com/tu-usuario/salesforce-data-copier.git
    cd salesforce-data-copier
    ```

2.  **Instala las dependencias:**

    ```bash
    npm install
    ```

3.  **Compila el proyecto desde TypeScript a JavaScript:**

    ```bash
    npm run build
    ```

    Esto creará un directorio `dist/` con el código ejecutable.

## ⚙️ Configuración

La herramienta ofrece un sistema flexible de configuración con valores por defecto, que se pueden sobrescribir mediante un fichero `config.json` o argumentos de línea de comandos.

### Orden de Precedencia

La configuración se aplica en el siguiente orden (de mayor a menor prioridad):
1. Argumentos de línea de comandos
2. Configuración en `config.json`
3. Valores por defecto del sistema

### Configuración por Defecto

Los siguientes valores se utilizan si no se especifica lo contrario:

```json
{
  "orgs": {
    "default": {
      "loginUrl": "https://test.salesforce.com",
      "instanceUrl": null,
      "username": null,
      "password": null
    }
  },
  "jobConfig": {
    "personAccountsEnabled": false
  }
}
```

### Fichero de Configuración

Crea un fichero `config.json` en la raíz del proyecto (puedes copiar `config.sample.json` como punto de partida):

```json
{
  "orgs": {
    "dev1": {
      "comment": "Este alias se resolverá usando la autenticación local de Salesforce CLI."
    },
    "full-sandbox": {
      "comment": "Este también usará el alias local de SF CLI."
    },
    "org-con-password": {
      "loginUrl": "https://test.salesforce.com",
      "username": "tu-usuario@ejemplo.com.uat",
      "password": "TU_PASSWORD_Y_TOKEN_DE_SEGURIDAD"
    }
  },
  "jobConfig": {
     "personAccountsEnabled": false
  }
}
```

### Configuración de Organizaciones

Cada entrada en `orgs` puede contener:

- **loginUrl** (opcional): URL de login de Salesforce. Por defecto: `https://test.salesforce.com`
- **instanceUrl** (opcional): URL de la instancia. Se configura automáticamente tras el login
- **username** (opcional): Nombre de usuario de Salesforce
- **password** (opcional): Contraseña + token de seguridad

La herramienta sigue este proceso de autenticación:

1. Intenta usar el **alias de Salesforce CLI** si existe localmente
2. Si no encuentra el alias, busca credenciales en `config.json`
3. Si no encuentra credenciales, usa los valores por defecto

### Configuración del Job

El objeto `jobConfig` permite configurar el comportamiento global:

- **personAccountsEnabled** (opcional): Activa el soporte para Person Accounts. Por defecto: `false`

### Ejemplos de Configuración

1. **Configuración Mínima** - Solo alias de CLI:
```json
{
  "orgs": {
    "dev1": {},
    "sandbox": {}
  }
}
```

2. **Configuración Mixta** - CLI y credenciales:
```json
{
  "orgs": {
    "dev1": {},
    "prod": {
      "loginUrl": "https://login.salesforce.com",
      "username": "admin@empresa.com",
      "password": "password+token"
    }
  },
  "jobConfig": {
    "personAccountsEnabled": true
  }
}
```

## 💻 Uso y Comandos

Todos los comandos se ejecutan a través de `node dist/src/main.js` o `npm start --`.

### Opciones Globales

Las siguientes opciones se pueden usar con cualquier comando:

  * `-l, --loglevel <level>`: Especifica el nivel de verbosidad del log. Los niveles válidos son: `error`, `warn`, `info`, `http`, `verbose`, `debug`, `silly`.
    * **Prioridad:** Este argumento de línea de comandos sobrescribe cualquier configuración de `logLevel` en el archivo `config.json`.
    * **Archivo de Configuración:** Si no se proporciona `--loglevel`, la herramienta intentará leer la propiedad `logLevel` del archivo `config.json`.
    * **Por Defecto:** Si no se especifica ni por línea de comandos ni en el archivo de configuración, el nivel de log por defecto es `WARN`.
    * **Ejemplo:**
      ```bash
      node dist/src/main.js extract -s dev1 -q "SELECT Id FROM Account" -l debug
      ```

### `extract`

Extrae datos de una organización de origen utilizando una consulta SOQL o una búsqueda SOSL y los guarda localmente en formato CSV.

**Sintaxis:**
`npm start -- extract --source <alias> (--query <soql> | --sosl <sosl_query>) [--api-type <type>] [--config <ruta>]`

  * `--source, -s`: El alias de la organización de origen (debe coincidir con un alias de SF CLI o una entrada en `config.json`).
  * `--query, -q`: La consulta SOQL a ejecutar. **Debe ir entre comillas.** Mutuamente excluyente con `--sosl`.
* `--sosl`: La consulta SOSL a ejecutar. **Debe ir entre comillas.** Mutuamente excluyente con `--query`. Permite búsquedas de texto libre a través de múltiples SObjects. Los resultados para cada SObject encontrado se guardarán en un archivo CSV separado dentro del directorio de datos de origen.
  * `--api-type, -a`: (Opcional) Fuerza el tipo de API a usar para la extracción. Valores posibles:
    * `auto` (por defecto): Intenta usar la API `BULK` por defecto. Si detecta características incompatibles con la API Bulk (como subconsultas en la SOQL), cambia automáticamente a la API `REST` (Query API) para ejecutar la consulta. Este cambio se informa en los logs.
    * `bulk`: Fuerza el uso de la API `BULK`. La herramienta intentará usar esta API incluso si la consulta contiene características no compatibles (ej. subconsultas), lo que probablemente resultará en un error por parte de Salesforce.
    * `rest`: Fuerza el uso de la API `REST` (Query API). Útil para consultas con subconsultas o para asegurar el uso de esta API independientemente del contenido de la SOQL.
  * `--config, -c`: (Opcional) Ruta al fichero de configuración. Por defecto es `./config.json`. Si este archivo no existe, la herramienta intentará autenticarse usando el alias de SFDX o las credenciales proporcionadas por línea de comandos.

### `deploy`

Despliega los datos extraídos localmente en una organización de destino.

**Sintaxis:**
`npm start -- deploy --source <alias> --target <alias> [--config <ruta>] [--force]`

  * `--source, -s`: El alias que identifica el **directorio de datos de origen** (ej: `dev1` para usar los datos en `./workdir/dev1/data`).
  * `--target, -t`: El alias de la organización de destino donde se cargarán los datos.
  * `--force, -f`: (Opcional) Salta la pregunta de confirmación de seguridad. Úsalo con precaución.

### `restore`

Despliega datos previamente extraídos (desde un directorio local) hacia una organización de Salesforce de destino. Se encarga de recrear los registros y mantener las relaciones entre ellos.

**Sintaxis completa:**
```bash
npm start -- restore --source-dir <alias_datos_locales> --target-org <alias_destino> [--config <ruta>] [--force]
```

**Descripción de sus opciones:**
*   `--source-dir, -s <alias_datos_locales>`: (Requerido) Alias o nombre que identifica el directorio local que contiene los datos previamente extraídos con el comando `extract`. Por ejemplo, si los datos se extrajeron de `dev1`, este sería `dev1`, y la herramienta buscará los datos en `workdir/dev1/data/`.
*   `--target-org, -t <alias_destino>`: (Requerido) El alias de la organización de Salesforce de destino donde se cargarán los datos.
*   `--config, -c <ruta>`: (Opcional) Ruta al fichero de configuración JSON. Por defecto es `./config.json`.
*   `--force, -f`: (Opcional) Salta la pregunta de confirmación de seguridad antes de modificar datos en la organización de destino. Úsalo con precaución.

**Ejemplo de uso:**
```bash
# Desplegar datos desde workdir/dev1/data/ hacia la organización qa-sandbox
npm start -- restore --source-dir dev1 --target-org qa-sandbox
```
```bash
# Desplegar datos forzando la operación y usando un config específico
npm start -- restore -s uat_backup -t new_dev_env -c ./conf/my_special_config.json -f
```

### `list-objects`

Muestra una lista de todos los objetos que se pueden consultar (`queryable`) en una organización.

**Sintaxis:**
`npm start -- list-objects --target <alias> [--config <ruta>]`

  * `--target, -t`: El alias de la organización a inspeccionar.

### `interactive` (o `i`)

Inicia el modo interactivo de la herramienta, que guía al usuario a través de la configuración y ejecución de operaciones de extracción y despliegue de datos.

**Sintaxis:**
`npm start -- interactive`
O también:
`npm start -- i`

Este modo es especialmente útil para:
  * Usuarios que se familiarizan con la herramienta.
  * Configurar operaciones complejas de forma asistida.
  * Evitar errores comunes al introducir parámetros en la línea de comandos.

Al iniciar, se presentará un menú principal para elegir la acción (Extraer, Desplegar, Listar Objetos, etc.) y se solicitarán los parámetros necesarios paso a paso.

### `backup`

Crea un backup completo o parcial de una organización de Salesforce, incluyendo metadatos de SObjects, datos (en formato CSV), y un grafo de dependencias. El backup se guarda en un directorio estructurado.

**Sintaxis:**
`npm start -- backup --source-org <alias> --output-dir <directorio> [opciones]`

  * `--source-org, -s <alias>`: (Requerido) El alias de la organización de Salesforce de origen desde la cual se realizará el backup. También se puede usar `--target-alias` o `--username`.
  * `--output-dir, -o <directorio>`: (Requerido) El directorio donde se guardará la estructura del backup.
  * `--manifest, -m <ruta>`: (Opcional) Ruta a un archivo de manifiesto existente para guiar el proceso de backup. Si se omite, se generará uno nuevo.
  * `--include-metadata`: (Opcional) Incluye los metadatos de los SObjects (descripciones de campos, etc.) en el backup. Por defecto es `true` si no se especifica `--data-only`.
  * `--data-only`: (Opcional) Realiza solo el backup de los datos (archivos CSV), excluyendo metadatos y el grafo de dependencias.
  * `--metadata-only`: (Opcional) Realiza solo el backup de los metadatos de los SObjects y el grafo de dependencias, excluyendo los datos.
  * `--api-version <version>`: (Opcional) Versión de la API de Salesforce a utilizar.
  * `--max-file-size <tamaño>`: (Opcional) Tamaño máximo para los archivos CSV generados (ej: '10MB', '1GB').
  * `--exclude-fields <campos>`: (Opcional) Lista de campos separados por comas a excluir del backup (ej: `CreatedDate,LastModifiedDate`).
  * `--sobjects <lista_sobjects>`: (Opcional) Lista de SObjects separados por comas a incluir en el backup (ej: `Account,Contact,MyCustomObject__c`). Mutuamente excluyente con `--all-sobjects`.
  * `--all-sobjects`: (Opcional) Realiza el backup de todos los SObjects accesibles en la organización. Mutuamente excluyente con `--sobjects`.
  * `--name-fields-only`: (Opcional) Para los campos de relación (lookup/master-detail), extrae solo los campos de nombre del registro relacionado en lugar de todos sus campos.
### `schema:visualize`

Genera representaciones visuales del esquema de SObjects, como diagramas de entidad-relación, ayudando a comprender la estructura y las interconexiones de los datos.

**Sintaxis:**
`npm start -- schema:visualize --target-org <alias> [opciones]`

  * `--target-org, -t <alias>`: (Requerido) El alias de la organización de Salesforce cuyo esquema se visualizará.
  * (Consulta la guía detallada para ver todas las opciones disponibles, incluyendo formatos de salida, selección de objetos y modo interactivo).

Para una descripción completa de sus capacidades, parámetros detallados y ejemplos de uso, consulta la [Guía del Comando schema:visualize](projects/salesforce-copy-database/docs/user_guide/schema_visualize_command.md).
## 💡 Casos de Uso y Ejemplos

### Escenario 1: Hacer un backup de todas las Cuentas de un entorno

Quieres guardar todas tus Cuentas del entorno `dev1` en ficheros locales.

**Comando:**

```bash
node dist/src/main.js extract -s dev1 -q "SELECT Id, Name, Phone, Website, Industry FROM Account"
```

**Resultado en la consola:**

```
> info: --- Iniciando Extracción de Datos ---
> ✓ Autenticado con https://mi-dominio.my.salesforce.com
> ✓ Ejecutando consulta y extrayendo datos para 'Account'...
> ✓ Extracción completada. 427 registros guardados en workdir/dev1/data/Account.csv
```

**Ficheros creados:**

  * `./workdir/dev1/data/Account.csv`

-----

### Escenario 2: Migrar Cuentas y sus Contactos a una Sandbox

Quieres mover un subconjunto de Cuentas de `dev1` y todos sus Contactos asociados a la sandbox `full-sandbox`.

**Paso 1: Extraer los datos relacionados**
Usamos una subconsulta para traer Cuentas y Contactos en un solo comando. La herramienta detectará automáticamente la subconsulta y usará la Query API.

**Comando:**

```bash
node dist/src/main.js extract -s dev1 -q "SELECT Name, Phone, (SELECT LastName, FirstName, Email, Phone FROM Contacts) FROM Account WHERE Type = 'Customer - Direct'" --api-type auto
```

**Resultado en la consola (Ejemplo):**

```
> info: --- Iniciando Extracción de Datos ---
> ✓ Autenticado con https://mi-dominio.my.salesforce.com
> > info: Detección automática: La consulta contiene subconsultas. Se usará la API REST.
> ✓ Ejecutando consulta y extrayendo datos para 'Account' usando la API REST...
> info: Registros de Account guardados en workdir/dev1/data/Account.csv
> info: Registros de Contacts guardados en workdir/dev1/data/Contacts.csv
> ✓ Extracción completada. Datos guardados en workdir/dev1/data.
```

**Ficheros creados:**

  * `./workdir/dev1/data/Account.csv`
  * `./workdir/dev1/data/Contacts.csv` (La herramienta "desenrolla" la subconsulta automáticamente, añadiendo la columna artificial `AccountId` para vincular los contactos con sus cuentas padre durante el despliegue)

**Paso 2: Desplegar los datos en la sandbox**
La herramienta se encargará de crear primero las Cuentas, guardar sus nuevos IDs, y luego asociar los Contactos a esas nuevas Cuentas.

**Comando:**

```bash
node dist/src/main.js deploy -s dev1 -t full-sandbox
```

**Resultado en la consola (Ejemplo):**

```
> Vas a desplegar datos en la organización con alias full-sandbox. Esta acción puede crear y actualizar un gran número de registros.
> ¿Estás seguro de que quieres continuar? (y/N) y

> info: --- Iniciando Proceso de Despliegue de Datos ---
> ✓ Conexiones establecidas.
> ✓ Analizando dependencias de objetos...
> ✓ Orden de despliegue calculado: Account -> Contact
> info: Objetos que requieren 2 fases (actualización): Contact

> info: --- FASE 1: Inserción de Registros ---
> ✓ [FASE 1 - INSERT] Account: 52 creados, 0 fallidos.
> ✓ [FASE 1 - INSERT] Contact: 118 creados, 2 fallidos.

> info: --- FASE 2: Actualización de Relaciones (Lookups) ---
> ✓ [FASE 2 - UPDATE] Account: 0 actualizados, 0 fallidos de 0 procesados.
> ✓ [FASE 2 - UPDATE] Contact: 8 actualizados, 2 fallidos de 10 procesados.

> info: --- Resumen Final del Despliegue ---
>
> Objeto  | Procesados | Creados/Actualizados | Fallidos
> --------|------------|----------------------|---------
> Account | 52         | 52                   | 0
> Contact | 130        | 126                  | 4
```

-----

### Escenario 3: Ver qué objetos puedo consultar en un entorno

Antes de planificar una migración, quieres ver qué objetos están disponibles en `full-sandbox`.

**Comando:**

```bash
node dist/src/main.js list-objects -t full-sandbox
```

**Resultado en la consola:**

```
> info: --- Listado de SObjects Consultables en 'full-sandbox' ---
> Account
> AccountChangeEvent
> Contact
> ContactChangeEvent
> Lead
> Opportunity
> MyCustomObject__c
> ... (y muchos más)
```

-----

### Escenario 4: Primera Migración de Datos con Asistencia (Modo Interactivo)

Eres nuevo en la herramienta y quieres migrar Oportunidades y sus Productos de Oportunidad relacionados desde tu entorno `uat` a una nueva sandbox de desarrollo `dev-sbx`. No estás seguro de todos los parámetros o la sintaxis exacta de la SOQL.

**Acción:**
Inicia el modo interactivo para que te guíe en el proceso.

**Comando:**

```bash
node dist/src/main.js interactive
```
O más corto:
```bash
npm start -- i
```

**Interacción Guiada (Ejemplo):**

```
> Bienvenido al Modo Interactivo de Salesforce Data Copier.
> ¿Qué acción te gustaría realizar?
> 1. Extraer datos
> 2. Desplegar datos
> 3. Listar objetos SObject
> 4. Salir
> Elige una opción: 1

> --- Configuración de Extracción ---
> Introduce el alias de la organización de ORIGEN (ej: orgFuente): uat
> Introduce la consulta SOQL para la extracción (ej: SELECT Name FROM Account): SELECT Name, Amount, CloseDate, (SELECT Quantity, UnitPrice, Product2.Name FROM OpportunityLineItems) FROM Opportunity WHERE StageName = 'Closed Won'

> ¿Quieres forzar un tipo de API específico (auto/bulk/rest)? (Presiona Enter para 'auto'):
> [INFO] Iniciando extracción desde 'uat' con la consulta proporcionada...
> (Progreso de la extracción...)
> [SUCCESS] Extracción completada. Datos guardados en workdir/uat/data/

> ¿Qué acción te gustaría realizar?
> 1. Extraer datos
> 2. Desplegar datos
> 3. Listar objetos SObject
> 4. Salir
> Elige una opción: 2

> --- Configuración de Despliegue ---
> Introduce el alias de la organización de ORIGEN de los datos (directorio local donde se guardaron los datos extraídos, ej: orgFuente): uat
> Introduce el alias de la organización de DESTINO (ej: orgDestino): dev-sbx
> ¿Quieres forzar la operación sin confirmación previa? (s/N): N

> Vas a desplegar datos desde 'workdir/uat/data/' en la organización con alias 'dev-sbx'.
> Esta acción puede crear y actualizar un gran número de registros.
> ¿Estás seguro de que quieres continuar? (y/N): y
> [INFO] Iniciando despliegue hacia 'dev-sbx'...
> (Progreso del despliegue...)
> [SUCCESS] Despliegue completado.
```

**Resultado:**
-----

### Escenario 5: Realizar Backups de Datos y Metadatos

La funcionalidad de `backup` te permite crear instantáneas estructuradas de tu organización de Salesforce, incluyendo datos, metadatos de SObjects y grafos de dependencia.

#### 5.1 Backup Completo de SObjects Específicos (Account y Contact)

Quieres hacer un backup completo (metadatos y datos) de los objetos `Account` y `Contact` de tu organización `dev-org` y guardarlo en el directorio `./my-backups/dev-org-backup-full`.

**Comando:**

```bash
node dist/src/main.js backup -s dev-org -o ./my-backups/dev-org-backup-full --sobjects "Account,Contact"
```

**Resultado Esperado:**

Se creará la siguiente estructura de directorios y archivos dentro de `./my-backups/dev-org-backup-full`:

```
./my-backups/dev-org-backup-full/
├── backup-manifest.json
├── sfdc-test-data/
│   ├── Account.csv
│   └── Contact.csv
├── sfdc-metadata/
│   ├── sobjects/
│   │   ├── Account.json
│   │   └── Contact.json
│   └── dependencyGraph.json
└── logs/
    └── backup-log.txt
```
*   `backup-manifest.json`: Contiene metainformación sobre el proceso de backup.
*   `sfdc-test-data/`: Contiene los datos exportados en formato CSV.
*   `sfdc-metadata/sobjects/`: Contiene la descripción de los metadatos de cada SObject.
*   `sfdc-metadata/dependencyGraph.json`: Contiene el grafo de dependencias entre los SObjects del backup.
*   `logs/`: Contiene logs detallados de la operación.

#### 5.2 Backup de Solo Datos para Todos los SObjects

Necesitas una copia de todos los datos de todos los SObjects de la organización `prod-clone` para un análisis, sin necesidad de los metadatos ni el grafo de dependencias. El backup se guardará en `./my-backups/prod-clone-data-only`.

**Comando:**

```bash
node dist/src/main.js backup -s prod-clone -o ./my-backups/prod-clone-data-only --all-sobjects --data-only
```

**Resultado Esperado:**

La estructura en `./my-backups/prod-clone-data-only` contendrá:

```
./my-backups/prod-clone-data-only/
├── backup-manifest.json
├── sfdc-test-data/
│   ├── Account.csv
│   ├── Contact.csv
│   ├── Opportunity.csv
│   └── ... (todos los demás SObjects con datos)
└── logs/
    └── backup-log.txt
```
No se crearán los directorios `sfdc-metadata/sobjects` ni el archivo `dependencyGraph.json`.

#### 5.3 Backup de Solo Metadatos para SObjects Específicos

Quieres obtener la definición de metadatos y el grafo de dependencias para los objetos `Order` y `OrderItem` de la organización `uat-org`, sin extraer los datos. El backup se guardará en `./my-backups/uat-metadata-backup`.

**Comando:**

```bash
node dist/src/main.js backup -s uat-org -o ./my-backups/uat-metadata-backup --sobjects "Order,OrderItem" --metadata-only
```

**Resultado Esperado:**

La estructura en `./my-backups/uat-metadata-backup` contendrá:

```
./my-backups/uat-metadata-backup/
├── backup-manifest.json
├── sfdc-metadata/
│   ├── sobjects/
│   │   ├── Order.json
│   │   └── OrderItem.json
│   └── dependencyGraph.json
└── logs/
    └── backup-log.txt
```
No se creará el directorio `sfdc-test-data/`.

#### 5.4 Backup de SObjects Específicos Excluyendo Campos Sensibles

Se requiere un backup de `Account` y `CustomObject__c` de la organización `staging-org`, pero excluyendo los campos `AnnualRevenue` de `Account` y `SecretToken__c` de `CustomObject__c`. El backup se guardará en `./my-backups/staging-backup-filtered`.

**Comando:**

```bash
node dist/src/main.js backup -s staging-org -o ./my-backups/staging-backup-filtered --sobjects "Account,CustomObject__c" --exclude-fields "Account.AnnualRevenue,CustomObject__c.SecretToken__c"
```

**Resultado Esperado:**

*   Los archivos CSV para `Account` y `CustomObject__c` en `./my-backups/staging-backup-filtered/sfdc-test-data/` no contendrán las columnas `AnnualRevenue` y `SecretToken__c` respectivamente.
*   Los archivos JSON de metadatos en `sfdc-metadata/sobjects/` seguirán describiendo todos los campos, pero los datos correspondientes a los campos excluidos no estarán presentes en los CSV.
Las Oportunidades y sus Líneas de Producto se han extraído de `uat` y desplegado correctamente en `dev-sbx`, todo ello guiado por la interfaz interactiva, simplificando el proceso y reduciendo la posibilidad de errores.

## 🛠️ Desarrollo y Depuración

  * **Ejecución en modo desarrollo:** Para ejecutar el programa sin necesidad de compilar tras cada cambio, usa `ts-node`:
    ```bash
    npm run dev -- <comando> [opciones]
    # Ejemplo: npm run dev -- extract -s dev1 -q "SELECT Id FROM Account LIMIT 1"
    ```
  * **Logs de depuración:** La herramienta genera automáticamente un fichero `debug.log` en la raíz del proyecto. Este fichero contiene logs muy detallados de cada operación, incluyendo consultas SOQL, análisis de dependencias y resultados de la API, lo que es invaluable para depurar problemas.
  * **Estructura del código:** La lógica está separada en `src/core` (lógica de negocio como autenticación, gestión de ficheros, logging, grafos de dependencia) y `src/commands` (lógica específica de cada comando de la CLI). Recientemente, módulos clave como `Logger` y `Auth` han sido refactorizados a clases para mejorar la testeabilidad y la organización del código. Las funciones principales de los comandos también han sido extraídas para una mayor modularidad (ej. `extractData`, `deployData`). El nuevo `InteractiveModeManager` en `src/interactive` gestiona el flujo del modo interactivo.

## 🗺️ Futuras Mejoras

  * Implementación completa de la fase de `UPDATE` para manejar dependencias circulares.
  * Funcionalidad de "data masking" para anonimizar datos sensibles.
  * Modo `--validate` o "dry run" para simular un despliegue sin hacer cambios.
  * Soporte para relaciones polimórficas complejas.
  * Mejoras en el parseo de SOQL para una detección de objetos más precisa.

## 📜 Licencia

Distribuido bajo la licencia MIT. Ver `LICENSE` para más información.