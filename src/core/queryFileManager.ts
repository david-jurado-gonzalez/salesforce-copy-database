import * as fs from 'fs/promises';
import * as path from 'path';

const QUERIES_BASE_DIR = 'queries'; // Relative to the project root

/**
 * Asegura que un directorio exista, creándolo si es necesario.
 * @param dirPath La ruta del directorio a asegurar.
 */
async function ensureDirectoryExists(dirPath: string): Promise<void> {
    try {
        await fs.mkdir(dirPath, { recursive: true });
    } catch (error: any) {
        // Manejar el error si la creación del directorio falla por alguna razón que no sea que ya existe
        if (error.code !== 'EEXIST') {
            throw error;
        }
    }
}

/**
 * Guarda las consultas de respaldo para un alias de organización dado.
 * Las consultas se almacenan en `queries/<org_alias>/backup_queries.json`.
 * @param orgAlias El alias de la organización.
 * @param queries Un array de objetos de consulta a guardar.
 */
export async function saveBackupQueries(orgAlias: string, queries: any[]): Promise<void> {
    const orgDir = path.join(QUERIES_BASE_DIR, orgAlias);
    await ensureDirectoryExists(orgDir);
    const filePath = path.join(orgDir, 'backup_queries.json');
    await fs.writeFile(filePath, JSON.stringify(queries, null, 2), 'utf8');
}

/**
 * Carga las consultas de respaldo para un alias de organización dado.
 * @param orgAlias El alias de la organización.
 * @returns Un array de objetos de consulta o un array vacío si el archivo no existe.
 */
export async function loadBackupQueries(orgAlias: string): Promise<any[]> {
    const filePath = path.join(QUERIES_BASE_DIR, orgAlias, 'backup_queries.json');
    try {
        const data = await fs.readFile(filePath, 'utf8');
        return JSON.parse(data);
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            // Archivo no encontrado, devolver un array vacío
            return [];
        }
        throw error;
    }
}

/**
 * Guarda el historial de consultas para un alias de organización dado.
 * El historial se almacena en `queries/<org_alias>/query_history.json`.
 * @param orgAlias El alias de la organización.
 * @param history Un array de objetos de historial de consultas a guardar.
 */
export async function saveQueryHistory(orgAlias: string, history: any[]): Promise<void> {
    const orgDir = path.join(QUERIES_BASE_DIR, orgAlias);
    await ensureDirectoryExists(orgDir);
    const filePath = path.join(orgDir, 'query_history.json');
    await fs.writeFile(filePath, JSON.stringify(history, null, 2), 'utf8');
}

/**
 * Carga el historial de consultas para un alias de organización dado.
 * @param orgAlias El alias de la organización.
 * @returns Un array de objetos de historial de consultas o un array vacío si el archivo no existe.
 */
export async function loadQueryHistory(orgAlias: string): Promise<any[]> {
    const filePath = path.join(QUERIES_BASE_DIR, orgAlias, 'query_history.json');
    try {
        const data = await fs.readFile(filePath, 'utf8');
        return JSON.parse(data);
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            // Archivo no encontrado, devolver un array vacío
            return [];
        }
        throw error;
    }
}