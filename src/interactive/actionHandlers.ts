/**
 * @file actionHandlers.ts
 * @description Contiene las funciones que manejan las acciones seleccionadas en el modo interactivo.
 */

import inquirer from 'inquirer';
import { SessionManager, SessionState } from './sessionState.js'; // Añadido .js
import { Logger } from '../core/logger.js';
import { Auth } from '../core/auth.js';
import { extractData } from '../commands/extractCommand.js';
import { deployData } from '../commands/deployCommand.js';
import { listObjects } from '../commands/listObjectsCommand.js';

const logger = new Logger('ActionHandlers');
const auth = new Auth(); // Instanciar Auth
const sessionManager = SessionManager.getInstance();

/**
 * Maneja la selección de una organización (origen o destino).
 * @param type 'source' o 'target' para indicar qué tipo de organización se está seleccionando.
 */
export async function handleSelectOrg(type: 'source' | 'target'): Promise<void> {
    logger.info(`Seleccionando organización de ${type === 'source' ? 'origen' : 'destino'}...`);
    try {
        const orgAliases = await auth.getOrgAliases(); // Usar la instancia de Auth
        if (orgAliases.length === 0) {
            logger.warn('No se encontraron alias de organizaciones de Salesforce. Asegúrese de haber autenticado organizaciones.');
            return;
        }

        const { selectedOrg } = await inquirer.prompt([
            {
                type: 'list',
                name: 'selectedOrg',
                message: `Seleccione la organización de ${type === 'source' ? 'origen' : 'destino'}:`,
                choices: orgAliases,
            },
        ]);

        if (type === 'source') {
            sessionManager.updateState({ sourceOrgAlias: selectedOrg });
            logger.info(`Organización de origen seleccionada: ${selectedOrg}`);
        } else {
            sessionManager.updateState({ targetOrgAlias: selectedOrg });
            logger.info(`Organización de destino seleccionada: ${selectedOrg}`);
        }
    } catch (error: any) {
        logger.error(`Error al seleccionar la organización: ${error.message}`);
    }
}

/**
 * Maneja la acción de extraer datos.
 * @param currentState El estado actual de la sesión.
 */
export async function handleExtractData(currentState: SessionState): Promise<void> {
    logger.info('Iniciando extracción de datos...');
    if (!currentState.sourceOrgAlias) {
        logger.warn('No se ha seleccionado una organización de origen. Por favor, selecciónela primero.');
        await handleSelectOrg('source');
        currentState = sessionManager.getState(); // Actualizar el estado después de la selección
        if (!currentState.sourceOrgAlias) {
            logger.error('No se pudo seleccionar una organización de origen. Abortando extracción.');
            return;
        }
    }

    const { queryOrObject } = await inquirer.prompt([
        {
            type: 'input',
            name: 'queryOrObject',
            message: 'Ingrese la consulta SOQL o el nombre del objeto principal (ej. Account):',
            default: currentState.lastQuery || '',
        },
    ]);

    const { outputPath } = await inquirer.prompt([
        {
            type: 'input',
            name: 'outputPath',
            message: 'Ingrese la ruta de salida para los datos (ej. ./data/):',
            default: currentState.lastExtractionPath || './data/',
        },
    ]);

    try {
        logger.info(`Invocando extracción de datos de ${currentState.sourceOrgAlias} con query/objeto: "${queryOrObject}" a "${outputPath}"`);
        await extractData({
            sourceOrgAlias: currentState.sourceOrgAlias,
            query: queryOrObject,
            outputPath: outputPath,
            apiType: 'auto' // O se podría preguntar al usuario
        });
        sessionManager.updateState({ lastQuery: queryOrObject, lastExtractionPath: outputPath });
        logger.info('Extracción de datos completada.');
    } catch (error: any) {
        logger.error(`Error durante la extracción de datos: ${error.message}`);
    }
}

/**
 * Maneja la acción de desplegar datos.
 * @param currentState El estado actual de la sesión.
 */
export async function handleDeployData(currentState: SessionState): Promise<void> {
    logger.info('Iniciando despliegue de datos...');
    if (!currentState.targetOrgAlias) {
        logger.warn('No se ha seleccionado una organización de destino. Por favor, selecciónela primero.');
        await handleSelectOrg('target');
        currentState = sessionManager.getState(); // Actualizar el estado después de la selección
        if (!currentState.targetOrgAlias) {
            logger.error('No se pudo seleccionar una organización de destino. Abortando despliegue.');
            return;
        }
    }

    const { inputPath } = await inquirer.prompt([
        {
            type: 'input',
            name: 'inputPath',
            message: 'Ingrese la ruta de los datos a desplegar (ej. ./data/):',
            default: currentState.lastExtractionPath || './data/',
        },
    ]);

    try {
        logger.info(`Invocando despliegue de datos a ${currentState.targetOrgAlias} desde "${inputPath}"`);
        await deployData({
            targetOrgAlias: currentState.targetOrgAlias,
            inputPath: inputPath,
            force: false // O se podría preguntar al usuario
        });
        logger.info('Despliegue de datos completado.');
    } catch (error: any) {
        logger.error(`Error durante el despliegue de datos: ${error.message}`);
    }
}

/**
 * Maneja la acción de listar objetos.
 * @param currentState El estado actual de la sesión.
 */
export async function handleListObjects(currentState: SessionState): Promise<void> {
    logger.info('Listando objetos...');
    let orgAliasToList = currentState.sourceOrgAlias;

    if (!orgAliasToList) {
        logger.warn('No se ha seleccionado una organización de origen. Seleccionando una para listar objetos...');
        await handleSelectOrg('source');
        orgAliasToList = sessionManager.getState().sourceOrgAlias;
        if (!orgAliasToList) {
            logger.error('No se pudo seleccionar una organización para listar objetos. Abortando.');
            return;
        }
    }

    try {
        logger.info(`Invocando listado de objetos en ${orgAliasToList}`);
        const objects = await listObjects({ orgAlias: orgAliasToList });
        logger.info('Objetos listados:');
        objects.forEach(obj => console.log(`- ${obj}`));
        logger.info('Listado de objetos completado.');
    } catch (error: any) {
        logger.error(`Error durante el listado de objetos: ${error.message}`);
    }
}

/**
 * Maneja la acción de gestionar consultas.
 * @param currentState El estado actual de la sesión.
 */
export async function handleManageQueries(currentState: SessionState): Promise<void> {
    logger.info('Gestionando consultas...');
    // Lógica para listar, re-ejecutar, eliminar consultas.
    // Esto es una nueva funcionalidad.
    logger.info('Funcionalidad "Gestionar Consultas" aún no implementada completamente.');
    // Ejemplo:
    // const { queryAction } = await inquirer.prompt([...]);
    // switch (queryAction) { ... }
}

/**
 * Maneja la acción de sugerir una query de backup.
 * @param currentState El estado actual de la sesión.
 */
export async function handleSuggestBackupQuery(currentState: SessionState): Promise<void> {
    logger.info('Sugiriendo query de backup...');
    // Lógica para guiar al usuario y generar una query de backup.
    // Esto es una nueva funcionalidad.
    logger.info('Funcionalidad "Sugerir Query de Backup" aún no implementada completamente.');
    // Ejemplo:
    // const { orgForBackup } = await inquirer.prompt([...]);
    // const suggestedQuery = await generateBackupQuery(orgForBackup);
    // logger.info(`Query de backup sugerida: ${suggestedQuery}`);
}