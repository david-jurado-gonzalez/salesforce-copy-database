---
creado: 2025-05-30
actualizado: 2025-05-30
---
# Guía de Usuario: Extracción de Datos en Modo Interactivo

Este documento detalla cómo utilizar la funcionalidad de extracción de datos dentro del modo interactivo de la herramienta Salesforce Data Copier. El modo interactivo te guía paso a paso para configurar y ejecutar extracciones de datos complejas, incluyendo la gestión de consultas SOQL y la selección de la API adecuada.

## 1. Iniciar la Extracción de Datos

Para iniciar el modo interactivo, ejecuta el siguiente comando:

```bash
npm start -- interactive
```
O su forma abreviada:
```bash
npm start -- i
```

Una vez en el menú principal, selecciona la opción "Extraer datos".

```
¿Qué acción te gustaría realizar?
1. Extraer datos
2. Desplegar datos
3. Listar objetos SObject
4. Gestionar Alias de Organización
5. Salir
Elige una opción: 1
```

## 2. Selección de la Organización de Origen

La herramienta te pedirá que introduzcas el alias de la organización de origen desde la que deseas extraer los datos.

```
--- Configuración de Extracción ---
Introduce el alias de la organización de ORIGEN (ej: orgFuente):
```

### Uso del Alias Activo de la Sesión

Si previamente has utilizado la opción "Gestionar Alias de Organización" y has seleccionado un alias como "activo" para la sesión, la herramienta te sugerirá automáticamente ese alias. Puedes aceptarlo presionando `Enter` o introducir uno diferente.

## 3. Introducir la Consulta SOQL o SOSL

A continuación, se te pedirá que introduzcas la consulta SOQL o SOSL que deseas ejecutar.

```
Introduce la consulta SOQL para la extracción (ej: SELECT Name FROM Account):
```

*   **Consultas SOQL:** Puedes introducir cualquier consulta SOQL válida, incluyendo subconsultas (relaciones padre-hijo). La herramienta detectará automáticamente si se necesitan subconsultas y ajustará la API de extracción. Además, si la consulta se dirige a un SObject que solo es accesible a través de la API de Herramientas (Tooling API), la herramienta cambiará automáticamente a esta API para ejecutar la consulta, sin necesidad de intervención manual.
*   **Consultas SOSL:** Para realizar búsquedas de texto libre, introduce una consulta SOSL. Los resultados se guardarán en archivos CSV separados por cada SObject encontrado.

### Asistente Interactivo de Consultas SOQL

Dentro de la extracción de datos en modo interactivo, ahora puedes construir tus consultas SOQL paso a paso. El asistente te ayuda a seleccionar SObjects, campos (incluyendo campos de relaciones) y a definir condiciones `WHERE`, minimizando errores y facilitando la exploración de datos.

## 4. Selección del Tipo de API (Opcional)

La herramienta te preguntará si deseas forzar un tipo de API específico para la extracción.

```
¿Quieres forzar un tipo de API específico (auto/bulk/rest)? (Presiona Enter para 'auto'):
```

*   `auto` (por defecto): La herramienta intentará usar la API `BULK` por defecto. Si detecta características incompatibles con la API Bulk (como subconsultas en la SOQL) o si el SObject de la consulta requiere la API de Herramientas, cambiará automáticamente a la API `REST` (Query API) o a la API de Herramientas, respectivamente.
*   `bulk`: Fuerza el uso de la API `BULK`.
*   `rest`: Fuerza el uso de la API `REST` (Query API).

## 5. Alias de Destino para Guardar Datos (Parámetro `--target-alias`)

Aunque no se te preguntará directamente en el flujo interactivo, es importante entender que los datos extraídos se guardarán en un directorio asociado a un alias.

*   Por defecto, los datos se guardarán en `workdir/<alias_origen>/data/`.
*   Si hubieras iniciado la extracción desde la CLI con el parámetro `--target-alias <otro_alias>`, los datos se habrían guardado en `workdir/<otro_alias>/data/`. En el modo interactivo, la selección del alias de origen es la que determina la ruta de guardado.

## 6. Proceso de Extracción y Resultados

Una vez confirmados todos los parámetros, la herramienta iniciará el proceso de extracción. Verás mensajes de progreso en la consola.

```
[INFO] Iniciando extracción desde 'uat' con la consulta proporcionada...
(Progreso de la extracción...)
[SUCCESS] Extracción completada. Datos guardados en workdir/uat/data/
```

Al finalizar, se te informará sobre la ubicación de los archivos CSV generados. Estos archivos se organizarán en el directorio `workdir/<alias_origen>/data/`, con un archivo CSV por cada SObject extraído (y subconsultas "desenrolladas" en archivos separados).

## 7. Siguientes Pasos

Después de una extracción exitosa, puedes volver al menú principal para realizar otras operaciones, como:

*   **Desplegar datos:** Utilizar los datos extraídos para cargarlos en otra organización Salesforce.
*   **Gestionar Alias de Organización:** Cambiar el alias activo de la sesión o refrescar la lista de alias.
*   **Salir:** Finalizar la aplicación.