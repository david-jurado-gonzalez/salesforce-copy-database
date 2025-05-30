/**
 * @file menuDefinitions.ts
 * @description Define las estructuras de los menús y las secuencias de preguntas para el modo interactivo.
 */

import inquirer from 'inquirer';
import { SessionManager, SessionState } from './sessionState.js';
import {
    handleExtractData,
    handleDeployData,
    handleListObjects,
    handleManageQueries,
    handleSuggestBackupQuery,
    handleSelectOrg,
    handleExecuteSOSLQuery,
    handleManageOrgAliases // Importar el manejador de alias
} from './actionHandlers.js';
import { Logger } from '../core/logger.js';
import { AppConfig } from '../core/typeDefs.js'; // Importar AppConfig

const logger = new Logger('InteractiveMode');

/**
 * Define las opciones del menú principal.
 */
export enum MainMenuChoices {
    SelectSourceOrg = 'Seleccionar Organización de Origen',
    SelectTargetOrg = 'Seleccionar Organización de Destino',
    ExtractData = 'Extraer Datos',
    DeployData = 'Desplegar Datos',
    ManageQueries = 'Gestionar Consultas',
    SuggestBackupQuery = 'Sugerir Query de Backup',
    ListObjects = 'Listar Objetos',
    ExecuteSOSLQuery = 'Ejecutar Consulta SOSL', // Nueva opción de menú
    ManageOrgAliases = 'Gestionar Alias de Organización', // Nueva opción para gestionar alias
    Exit = 'Salir',
}

/**
 * Muestra el menú principal y maneja la selección del usuario.
 * @returns La opción seleccionada por el usuario.
 */
export async function promptMainMenu(): Promise<MainMenuChoices> {
    const answers = await inquirer.prompt([
        {
            type: 'list',
            name: 'mainMenuChoice',
            message: '¿Qué acción desea realizar?',
            choices: Object.values(MainMenuChoices),
        },
    ]);
    return answers.mainMenuChoice as MainMenuChoices;
}

/**
 * Define las opciones del menú de gestión de alias de organización.
 */
export enum ManageOrgAliasesMenuChoices {
    ListAliases = 'Listar alias de organización',
    SelectActiveAlias = 'Seleccionar alias activo para la sesión',
    AddOrAuthenticateAlias = 'Añadir/Autenticar nueva organización (login web)',
    RemoveOrLogoutAlias = 'Eliminar alias/Cerrar sesión de organización',
    SetProjectDefaultAlias = 'Establecer alias como predeterminado para el proyecto',
    UnsetProjectDefaultAlias = 'Quitar alias predeterminado del proyecto',
    BackToMainMenu = 'Volver al menú principal',
}

/**
 * Muestra el menú de gestión de alias y maneja la selección del usuario.
 * @returns La opción seleccionada por el usuario.
 */
export async function promptManageOrgAliasesMenu(): Promise<ManageOrgAliasesMenuChoices> {
    const answers = await inquirer.prompt([
        {
            type: 'list',
            name: 'manageOrgAliasesChoice',
            message: 'Gestionar Alias de Organización:',
            choices: Object.values(ManageOrgAliasesMenuChoices),
        },
    ]);
    return answers.manageOrgAliasesChoice as ManageOrgAliasesMenuChoices;
}

/**
 * Inicia el bucle principal del modo interactivo.
 * @param appConfig La configuración de la aplicación.
 */
export async function startInteractiveMode(appConfig: AppConfig): Promise<void> {
    const sessionManager = SessionManager.getInstance();

    logger.info('Iniciando el modo interactivo de Salesforce Data Copier.');

    let running = true;
    while (running) {
        const choice = await promptMainMenu();
        const currentState = sessionManager.getState();

        try {
            switch (choice) {
                case MainMenuChoices.SelectSourceOrg: // Considerar si esto se reemplaza/integra con ManageOrgAliases
                    await handleSelectOrg('source', appConfig);
                    break;
                case MainMenuChoices.SelectTargetOrg: // Considerar si esto se reemplaza/integra con ManageOrgAliases
                    await handleSelectOrg('target', appConfig);
                    break;
                case MainMenuChoices.ManageOrgAliases:
                    await handleManageOrgAliases(currentState, appConfig);
                    break;
                case MainMenuChoices.ExtractData:
                    await handleExtractData(currentState, appConfig);
                    break;
                case MainMenuChoices.DeployData:
                    await handleDeployData(currentState, appConfig);
                    break;
                case MainMenuChoices.ManageQueries:
                    await handleManageQueries(currentState, appConfig);
                    break;
                case MainMenuChoices.SuggestBackupQuery:
                    await handleSuggestBackupQuery(currentState, appConfig);
                    break;
                case MainMenuChoices.ListObjects:
                    await handleListObjects(currentState, appConfig);
                    break;
                case MainMenuChoices.ExecuteSOSLQuery:
                    await handleExecuteSOSLQuery(currentState, appConfig);
                    break;
                case MainMenuChoices.Exit:
                    logger.info('Saliendo del modo interactivo. ¡Hasta pronto!');
                    running = false;
                    break;
                default:
                    logger.warn('Opción no reconocida. Por favor, intente de nuevo.');
                    break;
            }
        } catch (error: any) {
            logger.error(`Error en la operación: ${error.message}`);
            const { retry } = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'retry',
                    message: '¿Desea volver al menú principal?',
                    default: true,
                },
            ]);
            if (!retry) {
                running = false;
            }
        }
        logger.info(`Estado actual de la sesión: ${JSON.stringify(sessionManager.getState(), null, 2)}`);
    }
}