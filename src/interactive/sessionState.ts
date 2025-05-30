/**
 * @file sessionState.ts
 * @description Define la interfaz para el estado de la sesión interactiva y una clase para gestionarlo.
 */

/**
 * Interfaz que define la estructura del estado de la sesión interactiva.
 */
export interface SessionState {
    sourceOrgAlias: string | undefined;
    targetOrgAlias: string | undefined;
    selectedOrgAlias?: string; // Organización activa para la sesión interactiva
    availableOrgAliases?: string[]; // Caché de alias de organización disponibles
    lastQuery: string | undefined;
    lastExtractionPath: string | undefined;
    lastSoslQuery: string | undefined; // Nueva propiedad para la última consulta SOSL
    lastSoslExtractionPath: string | undefined; // Nueva propiedad para la última ruta de extracción SOSL
}

/**
 * Clase para gestionar el estado de la sesión interactiva.
 */
export class SessionManager {
    private static instance: SessionManager;
    private state: SessionState;

    private constructor() {
        this.state = {
            sourceOrgAlias: undefined,
            targetOrgAlias: undefined,
            selectedOrgAlias: undefined,
            availableOrgAliases: undefined,
            lastQuery: undefined,
            lastExtractionPath: undefined,
            lastSoslQuery: undefined, // Inicializar nueva propiedad
            lastSoslExtractionPath: undefined, // Inicializar nueva propiedad
        };
    }

    /**
     * Obtiene la instancia única de SessionManager (Singleton).
     * @returns La instancia de SessionManager.
     */
    public static getInstance(): SessionManager {
        if (!SessionManager.instance) {
            SessionManager.instance = new SessionManager();
        }
        return SessionManager.instance;
    }

    /**
     * Obtiene el estado actual de la sesión.
     * @returns El objeto SessionState.
     */
    public getState(): SessionState {
        return this.state;
    }

    /**
     * Actualiza una parte del estado de la sesión.
     * @param newState Un objeto parcial con las propiedades a actualizar.
     */
    public updateState(newState: Partial<SessionState>): void {
        this.state = { ...this.state, ...newState };
    }

    /**
     * Reinicia el estado de la sesión a sus valores iniciales.
     */
    public resetState(): void {
        this.state = {
            sourceOrgAlias: undefined,
            targetOrgAlias: undefined,
            selectedOrgAlias: undefined,
            availableOrgAliases: undefined,
            lastQuery: undefined,
            lastExtractionPath: undefined,
            lastSoslQuery: undefined, // Reiniciar nueva propiedad
            lastSoslExtractionPath: undefined, // Reiniciar nueva propiedad
        };
    }
}