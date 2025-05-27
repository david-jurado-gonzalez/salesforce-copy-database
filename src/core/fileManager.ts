// src/core/fileManager.ts
import fs from 'fs/promises';
import path from 'path';
import { logger } from './logger';
import { AppConfig, IdMap } from './typeDefs';

const WORK_DIR = path.join(process.cwd(), 'workdir');

/**
 * Asegura que un directorio exista, creándolo si es necesario.
 * @param dirPath La ruta del directorio.
 */
export async function ensureDir(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    logger.error(`Error al crear el directorio ${dirPath}: ${error.message}`);
    throw error;
  }
}

/**
 * Carga y parsea el archivo de configuración principal.
 * @param configPath Ruta al archivo config.json.
 */
export async function loadConfig(configPath: string): Promise<AppConfig> {
  try {
    const rawData = await fs.readFile(configPath, 'utf-8');
    return JSON.parse(rawData);
  } catch (error) {
    logger.error(`No se pudo cargar o parsear el archivo de configuración en ${configPath}: ${error.message}`);
    throw new Error('Archivo de configuración no encontrado o inválido.');
  }
}

// Funciones para gestionar el directorio de trabajo
export const getOrgWorkDir = (alias: string) => path.join(WORK_DIR, alias);
export const getOrgDataDir = (alias: string) => path.join(getOrgWorkDir(alias), 'data');
export const getOrgMetadataDir = (alias: string) => path.join(getOrgWorkDir(alias), 'metadata');
export const getOrgMappingsDir = (alias: string) => path.join(getOrgWorkDir(alias), 'mappings');

/**
 * Lee un archivo de mapeo de IDs.
 * @param orgAlias Alias de la organización de destino.
 * @param objectName Nombre del SObject.
 * @returns El mapa de IDs o un mapa vacío si no existe.
 */
export async function readIdMap(orgAlias: string, objectName: string): Promise<IdMap> {
  const mapPath = path.join(getOrgMappingsDir(orgAlias), `${objectName}-map.json`);
  try {
    const rawData = await fs.readFile(mapPath, 'utf-8');
    return JSON.parse(rawData);
  } catch (error) {
    // Es normal que el archivo no exista al principio
    if (error.code === 'ENOENT') {
      return {};
    }
    logger.error(`Error al leer el archivo de mapa ${mapPath}: ${error.message}`);
    throw error;
  }
}

/**
 * Escribe (o sobreescribe) un archivo de mapeo de IDs.
 * @param orgAlias Alias de la organización de destino.
 * @param objectName Nombre del SObject.
 * @param map El mapa de IDs a guardar.
 */
export async function writeIdMap(orgAlias: string, objectName: string, map: IdMap): Promise<void> {
  const mappingsDir = getOrgMappingsDir(orgAlias);
  await ensureDir(mappingsDir);
  const mapPath = path.join(mappingsDir, `${objectName}-map.json`);
  await fs.writeFile(mapPath, JSON.stringify(map, null, 2));
}

// ... Podrías añadir funciones similares para leer/escribir errores (-errors.json)