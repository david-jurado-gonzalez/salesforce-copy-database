---
creado: 2025-05-30
actualizado: 2025-05-30
---
# Guía de Usuario: Gestión de Alias de Organización en Modo Interactivo

Este documento describe cómo utilizar la funcionalidad de "Gestionar Alias de Organización" dentro del modo interactivo de la herramienta Salesforce Data Copier. Esta característica te permite visualizar, seleccionar y refrescar los alias de tus organizaciones Salesforce, mejorando la eficiencia en tus operaciones.

## 1. Acceder a la Gestión de Alias

Para acceder a la gestión de alias, inicia el modo interactivo de la herramienta:

```bash
npm start -- interactive
```
O su forma abreviada:
```bash
npm start -- i
```

En el menú principal, selecciona la opción "Gestionar Alias de Organización":

```
¿Qué acción te gustaría realizar?
1. Extraer datos
2. Desplegar datos
3. Listar objetos SObject
4. Gestionar Alias de Organización
5. Salir
Elige una opción: 4
```

## 2. Opciones del Menú de Gestión de Alias

Una vez dentro del menú "Gestionar Alias de Organización", tendrás las siguientes opciones:

### 2.1. Listar y Seleccionar Alias

Esta opción te mostrará una lista de todos los alias de Salesforce CLI disponibles en tu entorno. Para cada alias, verás información relevante como su nombre, nombre de usuario asociado y estado de conexión.

```
--- Gestión de Alias de Organización ---
Alias de Organización Disponibles:
1. [CONECTADO] dev1 (usuario@dev1.org)
2. [CONECTADO] full-sandbox (usuario@fullsandbox.org)
3. [DESCONECTADO] mi-org-antigua (usuario@antigua.org)
4. [CONECTADO] prod (usuario@prod.org - Predeterminado del Proyecto)

Elige un alias para establecer como activo para la sesión (o 0 para volver):
```

*   **Seleccionar Alias Activo:** Puedes elegir un alias de la lista introduciendo su número. El alias seleccionado se establecerá como el "alias activo" para tu sesión actual. Esto significa que, en operaciones posteriores (como la extracción de datos), este alias se sugerirá automáticamente como la organización de origen o destino, agilizando el flujo de trabajo.
*   **Estado de Conexión:** La herramienta indicará si el alias está `[CONECTADO]` o `[DESCONECTADO]`.
*   **Alias Predeterminado del Proyecto:** Si un alias está configurado como predeterminado para tu proyecto Salesforce (mediante `sf config set target-org`), se indicará como `(Predeterminado del Proyecto)`.

### 2.2. Refrescar Alias

Si has autenticado nuevas organizaciones, eliminado alias o realizado cualquier cambio en tus alias de Salesforce CLI fuera de la herramienta, puedes usar la opción "Refrescar Alias" para actualizar la lista. Esto volverá a consultar Salesforce CLI y recargará la información más reciente.

```
--- Gestión de Alias de Organización ---
1. Listar y Seleccionar Alias
2. Refrescar Alias
3. Volver al Menú Principal
Elige una opción: 2
```

Después de refrescar, la lista de alias se actualizará automáticamente.

## 3. Impacto del Alias Activo en Operaciones Posteriores

El alias que selecciones como "activo para la sesión" tendrá un impacto directo en otras funcionalidades del modo interactivo:

*   **Extracción de Datos:** Al iniciar una operación de extracción de datos, el alias activo se sugerirá automáticamente como la organización de origen. Esto reduce la necesidad de escribir el alias repetidamente y minimiza errores.
*   **Despliegue de Datos:** De manera similar, al desplegar datos, el alias activo podría ser sugerido como la organización de destino o de origen de los datos, dependiendo del contexto.

## 4. Volver al Menú Principal

En cualquier momento dentro del menú de gestión de alias, puedes seleccionar la opción "Volver al Menú Principal" (o introducir `0` si estás en la selección de alias) para regresar al menú principal de la herramienta y continuar con otras operaciones.