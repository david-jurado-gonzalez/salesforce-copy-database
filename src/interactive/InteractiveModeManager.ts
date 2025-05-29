/**
 * @file InteractiveModeManager.ts
 * @description Clase principal para orquestar el modo interactivo de la herramienta.
 */

import { startInteractiveMode } from './menuDefinitions.js'; // Añadido .js
import { SessionManager } from './sessionState.js'; // Añadido .js
import { Logger } from '../core/logger.js'; // Añadido .js - Asumiendo que Logger está en ../core/logger
import { AppConfig } from '../core/typeDefs.js'; // Importar AppConfig

const logger = new Logger('InteractiveModeManager');

/**
 * Clase para gestionar el ciclo de vida y la orquestación del modo interactivo.
 */
export class InteractiveModeManager {
    private sessionManager: SessionManager;
    private appConfig: AppConfig; // Añadir propiedad para almacenar la configuración

    constructor(appConfig: AppConfig) { // Aceptar AppConfig en el constructor
        this.sessionManager = SessionManager.getInstance();
        this.appConfig = appConfig; // Guardar la configuración
    }

    /**
     * Inicia el modo interactivo.
     */
    public async start(): Promise<void> {
        logger.info('Iniciando InteractiveModeManager...');
        this.sessionManager.resetState(); // Asegurarse de que el estado esté limpio al inicio
        await startInteractiveMode(this.appConfig); // Pasar la configuración a startInteractiveMode
        logger.info('InteractiveModeManager finalizado.');
    }
}