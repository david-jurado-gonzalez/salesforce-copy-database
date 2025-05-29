import * as fs from 'fs-extra';
import * as path from 'path';
import { Logger } from '../core/logger.js';

const logger = new Logger('QueryHistoryManager');
const HISTORY_FILE_PATH = path.join(process.cwd(), '.sfdc-copier-history.json');

export interface QueryHistoryEntry {
  query: string;
  date: string;
  usageCount?: number;
}

export interface QueryHistory {
  [orgAlias: string]: QueryHistoryEntry[];
}

/**
 * Loads the query history from the JSON file.
 * If the file doesn't exist, returns an empty history.
 */
export async function loadQueryHistory(): Promise<QueryHistory> {
  try {
    if (await fs.pathExists(HISTORY_FILE_PATH)) {
      const history = await fs.readJson(HISTORY_FILE_PATH) as QueryHistory;
      // Basic validation
      if (typeof history === 'object' && history !== null) {
        return history;
      }
      logger.warn('Formato de historial de consultas inválido. Se iniciará un historial nuevo.');
      return {};
    }
    return {};
  } catch (error) {
    logger.error('Error al cargar el historial de consultas:', error);
    return {}; // Return empty history on error
  }
}

/**
 * Saves the query history to the JSON file.
 * @param history The query history to save.
 */
export async function saveQueryHistory(history: QueryHistory): Promise<void> {
  try {
    await fs.writeJson(HISTORY_FILE_PATH, history, { spaces: 2 });
  } catch (error) {
    logger.error('Error al guardar el historial de consultas:', error);
  }
}

/**
 * Adds a query to the history for a specific org alias.
 * @param orgAlias The alias of the organization.
 * @param query The SOQL/SOSL query string.
 */
export async function addQueryToHistory(orgAlias: string, query: string): Promise<void> {
  if (!orgAlias || !query) {
    logger.warn('No se puede agregar al historial: orgAlias o consulta no proporcionados.');
    return;
  }
  const history = await loadQueryHistory();
  if (!history[orgAlias]) {
    history[orgAlias] = [];
  }

  // Evitar duplicados exactos recientes, actualizar fecha y contador si ya existe
  const existingEntryIndex = history[orgAlias].findIndex(entry => entry.query === query);
  if (existingEntryIndex > -1) {
    history[orgAlias][existingEntryIndex].date = new Date().toISOString();
    history[orgAlias][existingEntryIndex].usageCount = (history[orgAlias][existingEntryIndex].usageCount || 0) + 1;
    // Mover al principio de la lista para que aparezca como más reciente
    const entry = history[orgAlias].splice(existingEntryIndex, 1)[0];
    history[orgAlias].unshift(entry);
  } else {
    history[orgAlias].unshift({
      query,
      date: new Date().toISOString(),
      usageCount: 1,
    });
  }


  // Limitar el historial por organización (ej. a 20 entradas)
  const MAX_HISTORY_PER_ORG = 20;
  if (history[orgAlias].length > MAX_HISTORY_PER_ORG) {
    history[orgAlias] = history[orgAlias].slice(0, MAX_HISTORY_PER_ORG);
  }

  await saveQueryHistory(history);
}

/**
 * Gets the query history for a specific org alias.
 * @param orgAlias The alias of the organization.
 * @returns An array of query history entries, or an empty array if none.
 */
export async function getQueriesForOrg(orgAlias: string): Promise<QueryHistoryEntry[]> {
  if (!orgAlias) return [];
  const history = await loadQueryHistory();
  return history[orgAlias] || [];
}

/**
 * Deletes a query from the history for a specific org alias by its index.
 * @param orgAlias The alias of the organization.
 * @param queryIndex The index of the query to delete in the org's history.
 */
export async function deleteQueryFromHistory(orgAlias: string, queryIndex: number): Promise<boolean> {
  if (!orgAlias) return false;
  const history = await loadQueryHistory();
  if (history[orgAlias] && history[orgAlias][queryIndex]) {
    history[orgAlias].splice(queryIndex, 1);
    await saveQueryHistory(history);
    return true;
  }
  return false;
}