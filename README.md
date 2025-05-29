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
  * **Despliegue en Dos Fases:** Maneja dependencias circulares o complejas mediante un proceso de inserción (`INSERT`) seguido de una actualización (`UPDATE`).
  * **Interfaz de Usuario Clara:** Ofrece feedback constante con indicadores de progreso, logs de colores y resúmenes de operación.
  * **Seguro por Defecto:** Pide confirmación antes de ejecutar operaciones que modifiquen datos en un entorno de destino.
  * **Modo Interactivo Guiado:** Una interfaz paso a paso para configurar y ejecutar operaciones, incluyendo la gestión de consultas SOQL y la generación asistida de consultas para backups. Ideal para usuarios nuevos o para tareas complejas.
  * **Listado Directo de Objetos:** Accede rápidamente a una lista de todos los SObjects disponibles en tu organización de origen a través del modo interactivo. Consulta la [Guía de Listar Objetos](.localdevserver/docs/user_guide/Modo_Interactivo_Listar_Objetos.md) para más detalles.
* **Extracción de Datos Asistida (Modo Interactivo):** Configura y ejecuta extracciones de datos complejas, incluyendo la gestión de consultas SOQL y la selección de API, de forma guiada. Consulta la [Guía de Extraer Datos (Modo Interactivo)](.localdevserver/ia-private/projects/salesforce-copy-database/docs/user_guides/interactive_mode/extract_data.md) para más detalles.

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

Extrae datos de una organización de origen y los guarda localmente en formato CSV.

**Sintaxis:**
`npm start -- extract --source <alias> --query <soql> [--config <ruta>]`

  * `--source, -s`: El alias de la organización de origen (debe coincidir con un alias de SF CLI o una entrada en `config.json`).
  * `--query, -q`: La consulta SOQL a ejecutar. **Debe ir entre comillas.**
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

> info: --- FASE 1: Inserción de Registros ---
> ✓ [FASE 1 - INSERT] Account: 52 creados, 0 fallidos.
> ✓ [FASE 1 - INSERT] Contact: 124 creados, 2 fallidos.

> info: --- FASE 2: Actualización de Relaciones (Lookups) ---
> ✓ [FASE 2 - UPDATE] Account: Finalizado (simulado).
> ✓ [FASE 2 - UPDATE] Contact: Finalizado (simulado).

> info: --- Resumen Final del Despliegue ---
>
> Objeto  | Procesados | Creados/Actualizados | Fallidos
> --------|------------|----------------------|---------
> Account | 52         | 52                   | 0
> Contact | 126        | 124                  | 2
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