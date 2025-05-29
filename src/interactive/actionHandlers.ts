/**
 * @file actionHandlers.ts
 * @description Contiene las funciones que manejan las acciones seleccionadas en el modo interactivo.
 */

import inquirer from 'inquirer';
import { SessionManager, SessionState } from './sessionState.js'; // Añadido .js
import { Logger } from '../core/logger.js';
import { Auth } from '../core/auth.js';
import { Connection } from 'jsforce';
import { executeSoslQuery } from '../core/sfdc-api.js'; // Importar executeSoslQuery
import { writeRecordsToCsv } from '../core/fileManager.js'; // Importar writeRecordsToCsv
import { extractData as coreExtractData } from '../commands/extractCommand.js';
import { deployData } from '../commands/deployCommand.js';
import { listObjects } from '../commands/listObjectsCommand.js';
import {
    addQueryToHistory,
    deleteQueryFromHistory,
    getQueriesForOrg,
    QueryHistoryEntry
} from './queryHistoryManager.js';
import { generateSuggestedQueries } from './backupQuerySuggester.js';
import { buildSoqlQueryInteractive } from '../interactive/queryAssistant.js'; // Añadida importación
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { AppConfig } from '../core/typeDefs.js'; // Importar AppConfig

const logger = new Logger('ActionHandlers');
const auth = new Auth(); // Instanciar Auth
const sessionManager = SessionManager.getInstance();

/**
 * Maneja la selección de una organización (origen o destino).
 * @param type 'source' o 'target' para indicar qué tipo de organización se está seleccionando.
 * @param appConfig La configuración de la aplicación.
 */
export async function handleSelectOrg(type: 'source' | 'target', appConfig: AppConfig): Promise<void> {
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
 * @param appConfig La configuración de la aplicación.
 * @param query Consulta SOQL opcional para ejecutar directamente.
 * @param targetOrgAliasForHistory Alias de la organización de destino para el historial (opcional).
 */
export async function handleExtractData(currentState: SessionState, appConfig: AppConfig, query?: string, targetOrgAliasForHistory?: string): Promise<void> {
    logger.info('Iniciando extracción de datos...');
    let sourceOrg = currentState.sourceOrgAlias;
    let effectiveQuery = query;

    if (!sourceOrg) {
        logger.warn('No se ha seleccionado una organización de origen. Por favor, selecciónela primero.');
        await handleSelectOrg('source', appConfig); // Pasar appConfig
        currentState = sessionManager.getState(); // Actualizar el estado después de la selección
        sourceOrg = currentState.sourceOrgAlias;
        if (!sourceOrg) {
            logger.error('No se pudo seleccionar una organización de origen. Abortando extracción.');
            return;
        }
    }

    if (!effectiveQuery) {
        const { queryInputMode } = await inquirer.prompt([
            {
                type: 'list',
                name: 'queryInputMode',
                message: '¿Cómo desea proporcionar la consulta SOQL?',
                choices: [
                    { name: 'Construir consulta con asistente', value: 'assistant' },
                    { name: 'Ingresar SOQL manualmente', value: 'manual' },
                ],
                default: 'assistant',
            },
        ]);

        if (queryInputMode === 'assistant') {
            try {
                const connection = await auth.getSalesforceConnection(sourceOrg, appConfig);
                effectiveQuery = await buildSoqlQueryInteractive(connection);
            } catch (assistError: any) {
                logger.error(`Error al usar el asistente de consultas: ${assistError.message}`);
                // Preguntar si quiere intentarlo manualmente
                const { tryManual } = await inquirer.prompt([
                    {
                        type: 'confirm',
                        name: 'tryManual',
                        message: 'Hubo un error con el asistente. ¿Desea ingresar la consulta manualmente?',
                        default: true,
                    }
                ]);
                if (!tryManual) return; // Abortar si no quiere manual
                // Si tryManual es true, caerá en el bloque 'manual' o el siguiente prompt
            }
        }

        // Si no se usó el asistente o falló y el usuario quiere manual, o si eligió manual directamente
        if (queryInputMode === 'manual' || !effectiveQuery) {
            const { queryOrObject } = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'queryOrObject',
                    message: 'Ingrese la consulta SOQL o el nombre del objeto principal (ej. Account):',
                    default: currentState.lastQuery || '',
                },
            ]);
            effectiveQuery = queryOrObject;
        }
    }

    if (!effectiveQuery) {
        logger.warn('No se proporcionó ninguna consulta. Abortando extracción.');
        return;
    }

    const { outputPath } = await inquirer.prompt([
        {
            type: 'input',
            name: 'outputPath',
            message: 'Ingrese la ruta de salida para los datos (ej. ./data/):',
            default: currentState.lastExtractionPath || './workdir/' + (targetOrgAliasForHistory || sourceOrg) + '/data/',
        },
    ]);

    try {
        logger.info(`Invocando extracción de datos de ${sourceOrg} con query: "${effectiveQuery}" a "${outputPath}"`);
        await coreExtractData({ // Renombrado para evitar conflicto de nombres
            sourceOrgAlias: sourceOrg,
            query: effectiveQuery,
            outputPath: outputPath,
            apiType: 'auto'
        });
        sessionManager.updateState({ lastQuery: effectiveQuery, lastExtractionPath: outputPath });
        // Guardar en el historial de la organización DESDE la que se ejecutó la query,
        // o la targetOrgAliasForHistory si se está re-ejecutando desde el historial
        await addQueryToHistory(targetOrgAliasForHistory || sourceOrg, effectiveQuery);
        logger.info('Extracción de datos completada.');
    } catch (error: any) {
        logger.error(`Error durante la extracción de datos: ${error.message}`);
    }
}

/**
 * Maneja la acción de desplegar datos.
 * @param currentState El estado actual de la sesión.
 * @param appConfig La configuración de la aplicación.
 */
export async function handleDeployData(currentState: SessionState, appConfig: AppConfig): Promise<void> {
    logger.info('Iniciando despliegue de datos...');
    if (!currentState.targetOrgAlias) {
        logger.warn('No se ha seleccionado una organización de destino. Por favor, selecciónela primero.');
        await handleSelectOrg('target', appConfig); // Pasar appConfig
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
 * @param appConfig La configuración de la aplicación.
 */
export async function handleListObjects(currentState: SessionState, appConfig: AppConfig): Promise<void> {
    logger.info('Listando objetos...');
    let orgAliasToList = currentState.sourceOrgAlias;

    if (!orgAliasToList) {
        logger.warn('No se ha seleccionado una organización de origen. Seleccionando una para listar objetos...');
        await handleSelectOrg('source', appConfig); // Pasar appConfig
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
 * @param appConfig La configuración de la aplicación.
 */
export async function handleManageQueries(currentState: SessionState, appConfig: AppConfig): Promise<void> {
    logger.info('Gestionando consultas...');

    const orgAliases = await auth.getOrgAliases();
    if (orgAliases.length === 0) {
        logger.warn('No se encontraron alias de organizaciones de Salesforce. Asegúrese de haber autenticado organizaciones.');
        return;
    }

    const { orgAliasForHistory } = await inquirer.prompt([
        {
            type: 'list',
            name: 'orgAliasForHistory',
            message: '¿Para qué organización desea ver el historial de consultas?',
            choices: orgAliases,
        },
    ]);

    if (!orgAliasForHistory) {
        logger.warn('No se seleccionó ninguna organización.');
        return;
    }

    let keepManagingOrgHistory = true;
    while (keepManagingOrgHistory) {
        const queries = await getQueriesForOrg(orgAliasForHistory);

        if (queries.length === 0) {
            logger.info(`No hay consultas en el historial para la organización: ${orgAliasForHistory}`);
            const { goBack } = await inquirer.prompt({
                type: 'confirm',
                name: 'goBack',
                message: '¿Volver al menú anterior?',
                default: true,
            });
            if (goBack) keepManagingOrgHistory = false;
            else { // Podría ofrecer seleccionar otra org o volver al menú principal
                 keepManagingOrgHistory = false; // Por ahora, simplemente sale del bucle de gestión de esta org
            }
            continue;
        }

        const queryChoices = queries.map((q, index) => ({
            name: `[${new Date(q.date).toLocaleDateString()}] ${q.query.substring(0, 70)}${q.query.length > 70 ? '...' : ''} (Usos: ${q.usageCount || 1})`,
            value: index,
        }));

        const MANAGE_QUERIES_ACTIONS = {
            EXECUTE: 'Ejecutar consulta seleccionada',
            DELETE: 'Eliminar consulta seleccionada',
            BACK: 'Volver al menú principal',
        };

        const { action } = await inquirer.prompt([
            {
                type: 'list',
                name: 'action',
                message: `Historial para ${orgAliasForHistory}. ¿Qué desea hacer?`,
                choices: [
                    ...queryChoices.map(qc => ({ name: qc.name, value: qc.value })), // Las queries como acciones directas
                    new inquirer.Separator(),
                    MANAGE_QUERIES_ACTIONS.DELETE,
                    MANAGE_QUERIES_ACTIONS.BACK,
                ],
                pageSize: 15,
            },
        ]);

        if (action === MANAGE_QUERIES_ACTIONS.BACK) {
            keepManagingOrgHistory = false;
        } else if (action === MANAGE_QUERIES_ACTIONS.DELETE) {
            const { queryIndexToDelete } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'queryIndexToDelete',
                    message: 'Seleccione la consulta a eliminar:',
                    choices: queryChoices, // Reutiliza los choices formateados
                },
            ]);
            const queryToDelete = queries[queryIndexToDelete];
            const { confirmDelete } = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'confirmDelete',
                    message: `¿Está seguro de que desea eliminar la consulta: "${queryToDelete.query}"?`,
                    default: false,
                },
            ]);
            if (confirmDelete) {
                const deleted = await deleteQueryFromHistory(orgAliasForHistory, queryIndexToDelete);
                if (deleted) {
                    logger.info('Consulta eliminada del historial.');
                } else {
                    logger.warn('No se pudo eliminar la consulta.');
                }
            }
        } else if (typeof action === 'number' && action >= 0 && action < queries.length) { // Es un índice de query
            const selectedQueryEntry = queries[action];
            logger.info(`Consulta seleccionada: ${selectedQueryEntry.query}`);

            const { subAction } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'subAction',
                    message: '¿Qué desea hacer con esta consulta?',
                    choices: [
                        { name: 'Ejecutar esta consulta', value: 'execute' },
                        // { name: 'Copiar al portapapeles', value: 'copy' }, // Futura implementación
                        { name: 'Volver', value: 'back_to_history' },
                    ],
                },
            ]);

            if (subAction === 'execute') {
                const { executionOrg } = await inquirer.prompt([
                    {
                        type: 'list',
                        name: 'executionOrg',
                        message: `Ejecutar contra '${orgAliasForHistory}' o seleccionar otra organización:`,
                        choices: [orgAliasForHistory, ...orgAliases.filter(oa => oa !== orgAliasForHistory)],
                    },
                ]);
                
                // Preparamos un estado temporal para la ejecución, usando la org de ejecución como source
                // y pasamos la query y la org original del historial para el guardado correcto
                const tempStateForExecution: SessionState = {
                    ...currentState, // Copiamos el estado actual por si hay otras cosas (targetOrg, etc.)
                    sourceOrgAlias: executionOrg, // La org de ejecución es la 'source' para esta extracción
                    lastQuery: selectedQueryEntry.query // La query a ejecutar
                };
                
                // Llamamos a handleExtractData, pasándole la query, appConfig y la org original del historial
                // para que addQueryToHistory sepa dónde registrar el uso (o nueva entrada si es otra org)
                await handleExtractData(tempStateForExecution, appConfig, selectedQueryEntry.query, orgAliasForHistory);
                // Después de ejecutar, es bueno volver a cargar el historial de la org original
                // por si el contador de uso se actualizó o si se ejecutó en la misma org.
            } else if (subAction === 'back_to_history') {
                // No hacer nada, el bucle while continuará y recargará el historial
            }
        }
    }
}

/**
 * Maneja la acción de sugerir una query de backup.
 * @param currentState El estado actual de la sesión.
 * @param appConfig La configuración de la aplicación.
 */
export async function handleSuggestBackupQuery(currentState: SessionState, appConfig: AppConfig): Promise<void> {
    logger.info('Iniciando sugerencia de query de backup...');
    let sourceOrgAlias = currentState.sourceOrgAlias;

    if (!sourceOrgAlias) {
        logger.warn('No se ha seleccionado una organización de origen. Por favor, selecciónela primero.');
        await handleSelectOrg('source', appConfig); // Pasar appConfig
        currentState = sessionManager.getState(); // Actualizar el estado después de la selección
        sourceOrgAlias = currentState.sourceOrgAlias;
        if (!sourceOrgAlias) {
            logger.error('No se pudo seleccionar una organización de origen. Abortando sugerencia de query.');
            return;
        }
    }

    try {
        const conn: Connection = await auth.getSalesforceConnection(sourceOrgAlias, appConfig); // Usar getSalesforceConnection y pasar appConfig
        logger.info(`Conectado a la organización de origen: ${sourceOrgAlias} para generar sugerencias.`);

        const { prioritizedObjectsStr } = await inquirer.prompt([
            {
                type: 'input',
                name: 'prioritizedObjectsStr',
                message: 'Opcional: Ingrese nombres de SObjects a priorizar, separados por comas (ej. Account,MyCustomObject__c):',
                default: 'Account',
            }
        ]);
        const prioritizedObjectNames = prioritizedObjectsStr ? prioritizedObjectsStr.split(',').map((s: string) => s.trim()).filter((s: string) => s) : ['Account'];


        const suggestedQueries = await generateSuggestedQueries(conn, prioritizedObjectNames);

        if (suggestedQueries.length === 0) {
            logger.info('No se pudieron generar consultas de backup sugeridas para la organización actual con los criterios dados.');
            return;
        }

        logger.info('Consultas de backup sugeridas:');
        suggestedQueries.forEach((sq, index) => {
            console.log(`\n--- Query ${index + 1} para ${sq.objectName} ---`);
            console.log(sq.query);
            console.log(`Razón: ${sq.reason}`);
        });

        const ACTIONS = {
            EXECUTE: 'Ejecutar una consulta sugerida',
            COPY: 'Copiar una consulta al portapapeles (mostrar en consola)',
            SAVE: 'Guardar todas las consultas sugeridas a un archivo',
            BACK: 'Volver al menú principal',
        };

        const { action } = await inquirer.prompt([
            {
                type: 'list',
                name: 'action',
                message: '¿Qué desea hacer con las consultas sugeridas?',
                choices: Object.values(ACTIONS),
            },
        ]);

        switch (action) {
            case ACTIONS.EXECUTE:
                if (suggestedQueries.length === 1) {
                    const queryToExecute = suggestedQueries[0].query;
                    logger.info(`Ejecutando la única consulta sugerida para ${suggestedQueries[0].objectName}`);
                    await handleExtractData({ ...currentState, lastQuery: queryToExecute }, appConfig, queryToExecute, sourceOrgAlias);
                } else {
                    const { queryToExecuteIndex } = await inquirer.prompt([
                        {
                            type: 'list',
                            name: 'queryToExecuteIndex',
                            message: 'Seleccione la consulta a ejecutar:',
                            choices: suggestedQueries.map((sq, index) => ({
                                name: `Query ${index + 1} para ${sq.objectName}: ${sq.query.substring(0, 100)}${sq.query.length > 100 ? '...' : ''}`,
                                value: index,
                            })),
                        },
                    ]);
                    const queryToExecute = suggestedQueries[queryToExecuteIndex].query;
                    await handleExtractData({ ...currentState, lastQuery: queryToExecute }, appConfig, queryToExecute, sourceOrgAlias);
                }
                break;

            case ACTIONS.COPY:
                 if (suggestedQueries.length === 1) {
                    const queryToCopy = suggestedQueries[0].query;
                    logger.info(`\n--- Consulta para ${suggestedQueries[0].objectName} (copiar manualmente) ---\n${queryToCopy}\n------------------------------------------`);
                    console.log(`\n--- Consulta para ${suggestedQueries[0].objectName} (copiar manualmente) ---\n${queryToCopy}\n------------------------------------------`);
                    // Aquí se podría añadir la lógica para copiar al portapapeles si se instala 'clipboardy'
                    // import clipboardy from 'clipboardy'; // Descomentar si se usa
                    // await clipboardy.write(queryToCopy);
                    // logger.info('Consulta copiada al portapapeles.');
                } else {
                    const { queryToCopyIndex } = await inquirer.prompt([
                        {
                            type: 'list',
                            name: 'queryToCopyIndex',
                            message: 'Seleccione la consulta a copiar (se mostrará en consola):',
                            choices: suggestedQueries.map((sq, index) => ({
                                name: `Query ${index + 1} para ${sq.objectName}`,
                                value: index,
                            })),
                        },
                    ]);
                    const queryToCopy = suggestedQueries[queryToCopyIndex].query;
                    logger.info(`\n--- Consulta para ${suggestedQueries[queryToCopyIndex].objectName} (copiar manualmente) ---\n${queryToCopy}\n------------------------------------------`);
                    console.log(`\n--- Consulta para ${suggestedQueries[queryToCopyIndex].objectName} (copiar manualmente) ---\n${queryToCopy}\n------------------------------------------`);
                }
                break;

            case ACTIONS.SAVE:
                const now = new Date();
                const timestamp = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}-${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}`;
                
                const defaultDir = path.join('./workdir', sourceOrgAlias, 'suggested-queries');
                if (!existsSync(defaultDir)) {
                    mkdirSync(defaultDir, { recursive: true });
                }
                
                const { fileName } = await inquirer.prompt([
                    {
                        type: 'input',
                        name: 'fileName',
                        message: `Ingrese el nombre del archivo para guardar las consultas (ej. ${defaultDir}/backup-queries-${sourceOrgAlias}-${timestamp}.soql):`,
                        default: path.join(defaultDir, `backup-queries-${sourceOrgAlias}-${timestamp}.soql`),
                    },
                ]);

                const contentToSave = suggestedQueries.map(sq =>
                    `--- Query para ${sq.objectName} ---\n${sq.query}\nRazón: ${sq.reason}\n`
                ).join('\n');

                try {
                    writeFileSync(fileName, contentToSave);
                    logger.info(`Consultas guardadas exitosamente en: ${fileName}`);
                } catch (fileError: any) {
                    logger.error(`Error al guardar las consultas en el archivo ${fileName}: ${fileError.message}`);
                }
                break;

            case ACTIONS.BACK:
                logger.info('Volviendo al menú principal.');
                break;
        }

    } catch (error: any) {
        logger.error(`Error al sugerir query de backup: ${error.message}`);
    }
}

/**
 * Maneja la acción de ejecutar una consulta SOSL.
 * @param currentState El estado actual de la sesión.
 * @param appConfig La configuración de la aplicación.
 */
export async function handleExecuteSOSLQuery(currentState: SessionState, appConfig: AppConfig): Promise<void> {
    logger.info('Iniciando ejecución de consulta SOSL...');
    let sourceOrg = currentState.sourceOrgAlias;

    if (!sourceOrg) {
        logger.warn('No se ha seleccionado una organización de origen. Por favor, selecciónela primero.');
        await handleSelectOrg('source', appConfig);
        currentState = sessionManager.getState(); // Actualizar el estado después de la selección
        sourceOrg = currentState.sourceOrgAlias;
        if (!sourceOrg) {
            logger.error('No se pudo seleccionar una organización de origen. Abortando ejecución de SOSL.');
            return;
        }
    }

    const { soslQueryString } = await inquirer.prompt([
        {
            type: 'input',
            name: 'soslQueryString',
            message: 'Ingrese la consulta SOSL (ej. FIND {Test} IN ALL FIELDS RETURNING Account(Id, Name), Contact(Id, Name)):',
            default: currentState.lastSoslQuery || '',
            validate: (input: string) => input.trim().toLowerCase().startsWith('find ') ? true : 'La consulta SOSL debe comenzar con "FIND ".',
        },
    ]);

    if (!soslQueryString) {
        logger.warn('No se proporcionó ninguna consulta SOSL. Abortando.');
        return;
    }

    const defaultOutputFileName = `sosl_results_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
    const defaultOutputPath = path.join(currentState.lastSoslExtractionPath || `./workdir/${sourceOrg}/data/sosl/`, defaultOutputFileName);
    
    const { outputPath } = await inquirer.prompt([
        {
            type: 'input',
            name: 'outputPath',
            message: 'Ingrese la ruta del archivo CSV de salida para los resultados SOSL:',
            default: defaultOutputPath,
        },
    ]);

    try {
        const connection = await auth.getSalesforceConnection(sourceOrg, appConfig);
        logger.info(`Ejecutando consulta SOSL en ${sourceOrg}: "${soslQueryString}"`);
        
        const results = await executeSoslQuery(connection, soslQueryString);

        if (results.length === 0) {
            logger.info('La consulta SOSL no devolvió resultados.');
        } else {
            // Asegurarse de que el directorio de salida exista
            const outputDir = path.dirname(outputPath);
            if (!existsSync(outputDir)) {
                mkdirSync(outputDir, { recursive: true });
                logger.info(`Directorio de salida creado: ${outputDir}`);
            }
            await writeRecordsToCsv(results, outputPath);
            logger.info(`Resultados de la consulta SOSL guardados en: ${outputPath}`);
        }
        
        sessionManager.updateState({ lastSoslQuery: soslQueryString, lastSoslExtractionPath: path.dirname(outputPath) });
        // Opcional: Guardar en historial específico de SOSL si se implementa
        // await addSoslQueryToHistory(sourceOrg, soslQueryString);
        logger.info('Ejecución de consulta SOSL completada.');

    } catch (error: any) {
        logger.error(`Error durante la ejecución de la consulta SOSL: ${error.message}`);
        if (error.stack) {
            logger.debug(error.stack);
        }
    }
}