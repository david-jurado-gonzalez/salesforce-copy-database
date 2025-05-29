---
creado: 2025-05-29
actualizado: 2025-05-29
---
# Guía de Usuario: Modo Interactivo - Sugerir Consultas de Backup

Esta guía describe cómo utilizar la funcionalidad "Sugerir Consultas de Backup" dentro del modo interactivo de `salesforce-copy-database`. Esta herramienta te ayuda a generar un conjunto inicial de consultas SOQL para realizar un backup completo o selectivo de los datos de una organización Salesforce.

## Acceso a la Funcionalidad

Para acceder a la funcionalidad de sugerencia de consultas de backup:

1.  Inicia la herramienta en modo interactivo:
    ```bash
    npx salesforce-copy-database interactive
    ```
2.  En el menú principal del modo interactivo, selecciona la opción "Sugerir Consultas de Backup" (o el nombre similar que se haya implementado, por ejemplo, "Analizar Metadatos y Sugerir Consultas para Backup").

## Proceso de Sugerencia de Consultas

Una vez seleccionada la opción, el proceso es el siguiente:

### 1. Selección de Organización

*   Se te pedirá que selecciones la organización Salesforce (alias) para la cual deseas generar las consultas de backup.
*   La herramienta listará los alias de las organizaciones autenticadas disponibles.

### 2. Análisis del Esquema y Generación

*   Tras seleccionar la organización, la herramienta realizará un análisis del esquema de datos (metadata de los SObjects).
*   Utilizará la información del `DependencyGraph` (si está disponible y es aplicable para identificar objetos raíz o prioritarios) y potencialmente el uso de campos para determinar los objetos y campos más relevantes a incluir en el backup.
*   El objetivo es sugerir un conjunto de consultas que cubran los datos esenciales, respetando las relaciones entre objetos.

## Presentación de Consultas SOQL

*   Una vez finalizado el análisis, la herramienta presentará una lista de consultas SOQL sugeridas.
*   Cada consulta estará diseñada para extraer datos de un SObject específico, incluyendo campos relevantes y, si es posible, relaciones con objetos padres o hijos (aunque las sugerencias iniciales podrían centrarse en consultas simples por objeto).
    ```sql
    SELECT Id, Name, Industry, AnnualRevenue FROM Account
    SELECT Id, FirstName, LastName, Email, AccountId FROM Contact
    -- ... y más consultas
    ```

## Opciones Disponibles

Después de que se muestren las consultas sugeridas, tendrás varias opciones:

*   **Ejecutar Extracción Directamente:** Iniciar el proceso de extracción de datos utilizando las consultas sugeridas.
*   **Copiar Consultas al Portapapeles:** Copiar todas las consultas sugeridas para usarlas externamente.
*   **Guardar Consultas en un Archivo:** Guardar las consultas en un archivo de texto (por ejemplo, `backup-queries.txt`) para su posterior edición o uso.
*   **Modificar Consultas (si la funcionalidad lo permite):** Podría existir una opción para editar las consultas antes de proceder.
*   **Volver al Menú Principal:** Regresar al menú principal del modo interactivo.

## Consideraciones

*   Las consultas sugeridas son un punto de partida. Es recomendable revisarlas y ajustarlas según las necesidades específicas de tu backup.
*   La calidad de las sugerencias dependerá de la complejidad del esquema y de la lógica implementada en el analizador.
*   Para backups muy grandes o complejos, considera dividir las consultas o utilizar herramientas especializadas adicionales.

---
Para más información sobre la gestión de consultas, consulta la guía: [[Modo_Interactivo_Gestion_Consultas]].