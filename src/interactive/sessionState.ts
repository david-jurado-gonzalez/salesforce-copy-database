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
    lastQuery: string | undefined;
    lastExtractionPath: string | undefined;
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
            lastQuery: undefined,
            lastExtractionPath: undefined,
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
            lastQuery: undefined,
            lastExtractionPath: undefined,
        };
    }
}