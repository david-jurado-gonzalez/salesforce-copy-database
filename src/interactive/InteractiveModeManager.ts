/**
 * @file InteractiveModeManager.ts
 * @description Clase principal para orquestar el modo interactivo de la herramienta.
 */

import { startInteractiveMode } from './menuDefinitions.js'; // Añadido .js
import { SessionManager } from './sessionState.js'; // Añadido .js
import { Logger } from '../core/logger.js'; // Añadido .js - Asumiendo que Logger está en ../core/logger

const logger = new Logger('InteractiveModeManager');

/**
 * Clase para gestionar el ciclo de vida y la orquestación del modo interactivo.
 */
export class InteractiveModeManager {
    private sessionManager: SessionManager;

    constructor() {
        this.sessionManager = SessionManager.getInstance();
    }

    /**
     * Inicia el modo interactivo.
     */
    public async start(): Promise<void> {
        logger.info('Iniciando InteractiveModeManager...');
        this.sessionManager.resetState(); // Asegurarse de que el estado esté limpio al inicio
        await startInteractiveMode();
        logger.info('InteractiveModeManager finalizado.');
    }
}