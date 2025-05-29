---
creado: 2025-05-29
actualizado: 2025-05-29
etiquetas: [salesforce-copy-database, modo interactivo, gestión de consultas, historial de consultas, guía de usuario]
---

# Modo Interactivo: Gestión de Consultas (Historial)

La funcionalidad de "Gestión de Consultas" en el modo interactivo de `salesforce-copy-database` te permite guardar, reutilizar y administrar las consultas SOQL que ejecutas, optimizando tu flujo de trabajo y ahorrando tiempo.

## Acceso a la Gestión de Consultas

Puedes acceder a esta funcionalidad desde el menú principal del modo interactivo. Busca la opción:

```
Gestionar Consultas (Historial)
```

## Operaciones Disponibles

Una vez dentro de la sección de "Gestión de Consultas", podrás realizar las siguientes operaciones:

### 1. Listar Consultas del Historial

Al seleccionar una organización (alias de Salesforce), se mostrará una lista de todas las consultas SOQL que se han ejecutado previamente para esa organización. Cada entrada del historial incluirá:
*   La consulta SOQL.
*   La fecha de la última ejecución.
*   El número de veces que se ha utilizado.

### 2. Re-ejecutar una Consulta del Historial

Puedes seleccionar una consulta del historial para volver a ejecutarla. Al hacerlo, tendrás la opción de:
*   **Ejecutar con la misma organización de origen:** La consulta se ejecutará nuevamente contra la organización Salesforce para la cual fue guardada originalmente.
*   **Ejecutar con una organización de origen diferente:** Podrás seleccionar una organización de origen distinta para ejecutar la consulta. Si es la primera vez que esta consulta se ejecuta para la nueva organización, se guardará una nueva entrada en el historial para esa organización.

Al re-ejecutar una consulta, su fecha de última ejecución y el contador de uso se actualizarán.

### 3. Eliminar Consultas del Historial

Si ya no necesitas una consulta específica en el historial de una organización, puedes seleccionarla para eliminarla. El sistema te pedirá una confirmación antes de borrarla permanentemente.

## Guardado Automático de Consultas

Es importante destacar que todas las consultas SOQL que ejecutes a través de la opción "**Extraer Datos**" del modo interactivo se guardarán automáticamente en el historial de la organización de origen seleccionada. Esto asegura que cualquier consulta útil quede registrada para futuras referencias sin necesidad de una acción manual.

## Beneficios de Usar la Gestión de Consultas

*   **Ahorro de Tiempo:** Evita tener que reescribir consultas complejas o que usas con frecuencia.
*   **Reutilización Fácil:** Accede y ejecuta rápidamente consultas previas con unos pocos clics.
*   **Consistencia:** Asegura que estás utilizando la misma consulta para tareas repetitivas.
*   **Organización:** Mantén un registro de las consultas importantes por cada organización Salesforce.

## Almacenamiento

El historial de consultas se almacena localmente en tu máquina, en el archivo `.sfdc-copier-history.json`, ubicado en el directorio raíz del proyecto `salesforce-copy-database`. Este archivo guarda la consulta, la fecha de la última ejecución y un contador de uso para cada consulta asociada a un alias de organización.