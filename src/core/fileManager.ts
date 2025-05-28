import fs from 'fs/promises';
import path from 'path';
import { logger } from './logger.js';
import { AppConfig, IdMap, OrgConfig, DEFAULT_ORG_CONFIG } from './typeDefs.js';

/**
 * Este módulo se encarga de toda la interacción con el sistema de ficheros. 
 * Está diseñado para ser robusto, seguro y para mantener una estructura de directorios consistente, 
 * tal y como hemos definido en la arquitectura. La gestión de errores y la claridad de las funciones son los puntos clave.
 */

/**
 * Nombre del directorio de trabajo principal. Centralizado para facilitar cambios futuros.
 */
const WORK_DIR_NAME = 'workdir';

// --- Funciones de Ayuda para la Construcción de Rutas ---

/**
 * Devuelve la ruta absoluta al directorio de trabajo principal (`./workdir`).
 * @returns La ruta completa al directorio de trabajo.
 */
export function getWorkDir(): string {
  return path.join(process.cwd(), WORK_DIR_NAME);
}

/**
 * Devuelve la ruta al directorio de trabajo de una organización específica.
 * @param alias El alias de la organización.
 * @returns La ruta completa al directorio de la organización (ej: `./workdir/my-org`).
 */
export function getOrgWorkDir(alias: string): string {
  return path.join(getWorkDir(), alias);
}

/**
 * Devuelve la ruta al subdirectorio `data` de una organización.
 * @param alias El alias de la organización.
 * @returns La ruta al directorio de datos (ej: `./workdir/my-org/data`).
 */
export function getOrgDataDir(alias: string): string {
  return path.join(getOrgWorkDir(alias), 'data');
}

/**
 * Devuelve la ruta al subdirectorio `metadata` de una organización.
 * @param alias El alias de la organización.
 * @returns La ruta al directorio de metadatos (ej: `./workdir/my-org/metadata`).
 */
export function getOrgMetadataDir(alias: string): string {
  return path.join(getOrgWorkDir(alias), 'metadata');
}

/**
 * Devuelve la ruta al subdirectorio `mappings` de una organización.
 * @param alias El alias de la organización.
 * @returns La ruta al directorio de mapeos (ej: `./workdir/my-org/mappings`).
 */
export function getOrgMappingsDir(alias: string): string {
  return path.join(getOrgWorkDir(alias), 'mappings');
}

/**
 * Devuelve la ruta al subdirectorio `errors` de una organización.
 * @param alias El alias de la organización.
 * @returns La ruta al directorio de errores (ej: `./workdir/my-org/errors`).
 */
export function getOrgErrorsDir(alias: string): string {
  return path.join(getOrgWorkDir(alias), 'errors');
}

// --- Funciones Principales de Interacción con el Sistema de Ficheros ---

/**
 * Asegura que un directorio exista en el sistema de ficheros. Si no existe,
 * lo crea de forma recursiva. No falla si el directorio ya existe.
 * @param dirPath La ruta del directorio a crear.
 * @throws Si ocurre un error durante la creación del directorio.
 */
export async function ensureDir(dirPath: string): Promise<void> {
  try {
    // La opción { recursive: true } evita errores si el directorio ya existe
    // y crea directorios padres si es necesario.
    await fs.mkdir(dirPath, { recursive: true });
    logger.debug(`Directorio asegurado: ${dirPath}`);
  } catch (error) {
    logger.error(`Error crítico al asegurar la existencia del directorio ${dirPath}: ${(error as Error).message}`);
    // Este es un error grave, por lo que lo relanzamos para detener la ejecución.
    throw error;
  }
}

/**
 * Crea una configuración por defecto para una organización.
 * @param username Nombre de usuario opcional.
 * @param password Contraseña opcional.
 * @param loginUrl URL de login opcional.
 * @returns Configuración por defecto para la organización.
 */
function createDefaultOrgConfig(username?: string, password?: string, loginUrl?: string): OrgConfig {
  return {
    ...DEFAULT_ORG_CONFIG,
    ...(username && { username }),
    ...(password && { password }),
    ...(loginUrl && { loginUrl })
  };
}

/**
 * Carga y parsea el archivo de configuración principal de la aplicación.
 * Si no se proporciona la ruta o el archivo no existe, retorna una configuración por defecto.
 * @param configPath Ruta al archivo `config.json` (opcional).
 * @param options Opciones adicionales de configuración desde CLI.
 * @returns El objeto de configuración parseado o por defecto.
 */
export async function loadConfig(configPath?: string, options: {
  username?: string;
  password?: string;
  loginUrl?: string;
  source?: string;
  target?: string;
} = {}): Promise<AppConfig> {
  let config: AppConfig = {
    orgs: {}
  };

  // Inicializar las organizaciones con la configuración por defecto
  config = {
    orgs: {},
    jobConfig: {
      deploymentOrder: [],
      twoPassObjects: [],
      personAccountsEnabled: false
    }
  };

  console.log('loadConfig configPath:', configPath);
  // Intentar cargar la configuración del archivo si existe
  if (configPath) {
    logger.debug(`Intentando cargar la configuración desde: ${configPath}`);
    try {
      const rawData = await fs.readFile(configPath, 'utf-8');
      const parsedConfig = JSON.parse(rawData) as AppConfig;
      config = {
        ...config,
        ...parsedConfig,
        orgs: {
          ...config.orgs,
          ...parsedConfig.orgs
        }
      };
      logger.debug('Archivo de configuración cargado correctamente');
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        logger.info(`No se encontró archivo de configuración en ${configPath}, se usará configuración por defecto`);
      } else if (error instanceof SyntaxError) {
        logger.warn(`El archivo de configuración en ${configPath} contiene JSON inválido, se usará configuración por defecto`);
      } else {
        logger.warn(`Error al cargar configuración desde ${configPath}, se usará configuración por defecto`);
      }
      config = { orgs: {} , jobConfig: { deploymentOrder: [], twoPassObjects: [], personAccountsEnabled: false }}; // Inicializar con un objeto vacío para evitar errores posteriores
    }
  } else {
    logger.info('No se especificó la ruta del archivo de configuración, se usará la configuración por defecto.');
    config = { orgs: {}, jobConfig: { deploymentOrder: [], twoPassObjects: [], personAccountsEnabled: false } }; // Inicializar con un objeto vacío si no hay ruta
  }

  // Aplicar configuración por defecto a todas las organizaciones existentes
  for (const [alias, orgConfig] of Object.entries(config.orgs)) {
    config.orgs[alias] = {
      ...DEFAULT_ORG_CONFIG,
      ...orgConfig
    };
  }

  // Procesar opciones CLI para org origen
  if (options.source) {
    config.orgs[options.source] = {
      ...config.orgs[options.source], // Preservar configuración existente si la hay
      ...createDefaultOrgConfig(
        options.username,
        options.password,
        options.loginUrl
      )
    };
  }

  // Procesar opciones CLI para org destino
  if (options.target) {
    config.orgs[options.target] = {
      ...config.orgs[options.target], // Preservar configuración existente si la hay
      ...createDefaultOrgConfig(
        options.username,
        options.password,
        options.loginUrl
      )
    };
  }

  return config;
}

/**
 * Lee y parsea un fichero JSON genérico.
 * @param filePath La ruta completa al fichero JSON.
 * @returns Los datos parseados del fichero.
 * @throws Si el fichero no existe o no se puede parsear.
 */
export async function readJsonFile<T>(filePath: string): Promise<T> {
  const rawData = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(rawData) as T;
}

/**
 * Escribe datos en un fichero JSON, sobreescribiéndolo si ya existe.
 * Formatea el JSON para que sea legible por humanos.
 * @param filePath La ruta completa al fichero JSON.
 * @param data El objeto de datos a escribir.
 */
export async function writeJsonFile(filePath: string, data: object): Promise<void> {
    // `JSON.stringify` con `null, 2` indenta el JSON con 2 espacios, haciéndolo legible.
    const jsonData = JSON.stringify(data, null, 2);
    await fs.writeFile(filePath, jsonData, 'utf-8');
}


// --- Funciones Especializadas para el Proyecto ---

/**
 * Lee un archivo de mapeo de IDs para un objeto específico. Si el archivo no existe,
 * devuelve un objeto vacío, lo cual es un comportamiento esperado al procesar el primer
 * objeto de una dependencia.
 * @param orgAlias Alias de la organización de destino.
 * @param objectName Nombre del SObject (ej: 'Account').
 * @returns El mapa de IDs (`{ sourceId: targetId }`) o un objeto vacío.
 */
export async function readIdMap(orgAlias: string, objectName: string): Promise<IdMap> {
  const mapPath = path.join(getOrgMappingsDir(orgAlias), `${objectName}-map.json`);
  try {
    return await readJsonFile<IdMap>(mapPath);
  } catch (error) {
    // Es normal que el archivo no exista para el primer objeto o si no tuvo inserciones.
    if ((error as any).code === 'ENOENT') {
      logger.debug(`No se encontró el mapa de IDs para '${objectName}', se devolverá un mapa vacío.`);
      return {};
    }
    // Para cualquier otro error, sí es un problema.
    logger.error(`Error al leer el archivo de mapa ${mapPath}: ${(error as Error).message}`);
    throw error;
  }
}

/**
 * Escribe (o sobreescribe) un archivo de mapeo de IDs para un objeto.
 * @param orgAlias Alias de la organización de destino.
 * @param objectName Nombre del SObject.
 * @param map El mapa de IDs a guardar.
 */
export async function writeIdMap(orgAlias: string, objectName: string, map: IdMap): Promise<void> {
  const mapPath = path.join(getOrgMappingsDir(orgAlias), `${objectName}-map.json`);
  await writeJsonFile(mapPath, map);
  logger.debug(`Mapa de IDs para '${objectName}' guardado con ${Object.keys(map).length} entradas.`);
}

/**
 * Escribe un log de errores para una operación específica.
 * @param orgAlias Alias de la organización de destino.
 * @param objectName Nombre del SObject.
 * @param errorType Un identificador para el log (ej: 'insert-errors', 'update-errors').
 * @param errors Un array de objetos de error para guardar.
 */
export async function writeErrorLog(orgAlias: string, objectName: string, errorType: string, errors: any[]): Promise<void> {
  if (errors.length === 0) return;
  const errorPath = path.join(getOrgErrorsDir(orgAlias), `${objectName}-${errorType}.json`);
  await writeJsonFile(errorPath, errors);
  logger.warn(`Se han registrado ${errors.length} errores para '${objectName}' en el fichero: ${errorPath}`);
}

/**
 * Escanea el directorio de datos de una organización de origen y devuelve una lista
 * de los nombres de objeto basados en los ficheros .csv encontrados.
 * @param sourceAlias El alias de la organización de origen.
 * @returns Un array de strings con los nombres de los objetos.
 */
export async function getObjectListFromDataDir(sourceAlias: string): Promise<string[]> {
    const dataDir = getOrgDataDir(sourceAlias);
    try {
        const allFiles = await fs.readdir(dataDir);
        const csvFiles = allFiles
            .filter(file => file.toLowerCase().endsWith('.csv'))
            .map(file => path.basename(file, '.csv')); // Quita la extensión .csv
        
        logger.info(`Objetos detectados en el directorio de datos: ${csvFiles.join(', ')}`);
        return csvFiles;
    } catch (error) {
        if ((error as any).code === 'ENOENT') {
            logger.error(`El directorio de datos para el alias de origen '${sourceAlias}' no existe: ${dataDir}`);
            throw new Error(`Directorio de datos no encontrado para '${sourceAlias}'. ¿Ejecutaste el comando 'extract' primero?`);
        }
        logger.error(`No se pudo leer el directorio de datos para '${sourceAlias}': ${(error as Error).message}`);
        throw error;
    }
}