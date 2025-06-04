import fs from 'fs';
import path from 'path';
import { Logger } from './logger.js'; // Para logging interno si es necesario

const logger = new Logger('ConfigManager');
const DEFAULT_DEBUG_LOG_FILE = 'logs/copy-database.log';
const BACKUP_QUERY_CONFIG_PATH = path.resolve(process.cwd(), 'config/backupQueryConfig.json');

interface BackupQueryConfig {
  debugLogFile?: string;
  // otras configuraciones futuras
}

function loadBackupQueryConfig(): BackupQueryConfig {
  if (fs.existsSync(BACKUP_QUERY_CONFIG_PATH)) {
    try {
      const configFileContent = fs.readFileSync(BACKUP_QUERY_CONFIG_PATH, 'utf-8');
      return JSON.parse(configFileContent) as BackupQueryConfig;
    } catch (error: any) {
      logger.warn(`Advertencia: No se pudo leer o parsear ${BACKUP_QUERY_CONFIG_PATH}: ${error.message}. Usando configuración vacía.`);
      return {};
    }
  }
  logger.debug(`Archivo de configuración ${BACKUP_QUERY_CONFIG_PATH} no encontrado. Usando configuración vacía.`);
  return {};
}

/**
 * Obtiene la ruta del archivo de log de depuración.
 * La prioridad es:
 * 1. Opción CLI (si se proporciona a través de cliArgs).
 * 2. Configuración en config/backupQueryConfig.json (propiedad debugLogFile).
 * 3. Valor por defecto: logs/copy-database.log.
 *
 * Asegura que el directorio del log exista.
 * @param cliArgs Argumentos parseados de la línea de comandos.
 * @returns La ruta absoluta al archivo de log de depuración.
 */
export function getDebugLogFilePath(cliArgs?: { debugLogFile?: string }): string {
  let logFilePath: string;
  const config = loadBackupQueryConfig();

  if (cliArgs?.debugLogFile) {
    logFilePath = cliArgs.debugLogFile;
    logger.debug(`Ruta de log de depuración obtenida de CLI: ${logFilePath}`);
  } else if (config.debugLogFile) {
    logFilePath = config.debugLogFile;
    logger.debug(`Ruta de log de depuración obtenida de ${BACKUP_QUERY_CONFIG_PATH}: ${logFilePath}`);
  } else {
    logFilePath = DEFAULT_DEBUG_LOG_FILE;
    logger.debug(`Ruta de log de depuración por defecto: ${logFilePath}`);
  }

  const absoluteLogFilePath = path.resolve(process.cwd(), logFilePath);
  const logDir = path.dirname(absoluteLogFilePath);

  try {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
      logger.debug(`Directorio de log creado: ${logDir}`);
    }
  } catch (error: any) {
    logger.error(`Error al crear el directorio de log ${logDir}: ${error.message}. El log podría no escribirse.`);
    // Devolver la ruta por defecto en caso de error para no bloquear la app, aunque el log falle.
    return path.resolve(process.cwd(), DEFAULT_DEBUG_LOG_FILE);
  }

  return absoluteLogFilePath;
}