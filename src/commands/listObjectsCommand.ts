import ora from 'ora';
import { Connection, DescribeGlobalResult } from 'jsforce';
import { Logger } from '../core/logger.js'; // Importar la clase Logger
import { fileManagerAPI } from '../core/fileManager.js';
import { Auth } from '../core/auth.js'; // Importar la clase Auth
import { AppConfig } from '../core/typeDefs.js';

const logger = new Logger('ListObjectsCommand');
const auth = new Auth();

/**
 * Obtiene una lista de todos los SObjects "consultables" y "recuperables" de la organización.
 * @param conn Conexión de jsforce.
 * @returns Un array de strings con los nombres de los SObjects.
 */
async function listSObjectsInternal(conn: Connection): Promise<string[]> {
  const spinner = ora('Obteniendo lista de objetos...').start();
  try {
    const describeGlobalResult: DescribeGlobalResult = await conn.describeGlobal();
    spinner.succeed('Lista de objetos obtenida.');
    return describeGlobalResult.sobjects
      .filter(sobject => sobject.queryable && sobject.retrieveable)
      .map(sobject => sobject.name);
  } catch (err: any) {
    spinner.fail('Error al obtener la lista de objetos.');
    logger.error('Error al ejecutar describeGlobal:', err.message);
    throw err;
  }
}

/**
 * Parámetros para la función de listado de objetos.
 */
export interface ListObjectsParams {
  orgAlias: string;
}

/**
 * Función principal para listar objetos.
 * Puede ser llamada desde la CLI o programáticamente.
 * @param params Los parámetros para listar objetos.
 * @returns Un array de strings con los nombres de los SObjects.
 */
export async function listObjects(params: ListObjectsParams): Promise<string[]> {
  logger.info('Iniciando el listado de objetos...');
  logger.debug('Parámetros recibidos:', params);

  if (!params.orgAlias) {
    throw new Error("El alias de la organización es obligatorio para listar objetos.");
  }

  const spinner = ora(`Cargando configuración para el alias: ${params.orgAlias}...`).start();
  let config: AppConfig;
  let conn: Connection;

  try {
    config = await fileManagerAPI.loadConfig('./config.json'); // Cargar config.json por defecto
    spinner.succeed('Configuración cargada.');
    logger.debug('Configuración de usuario cargada:', config);

    spinner.text = `Conectando a la organización Salesforce con alias: ${params.orgAlias}...`;
    conn = await auth.getSalesforceConnection(params.orgAlias, config); // Usar la instancia de Auth
    spinner.succeed(`Conexión exitosa a la organización: ${params.orgAlias}`);
    logger.info(`Conexión exitosa a la organización: ${params.orgAlias}`);

    const sObjectNames = await listSObjectsInternal(conn);

    if (sObjectNames.length > 0) {
      console.log('\nSObjects disponibles en la organización:');
      sObjectNames.forEach(name => console.log(name));
    } else {
      console.log('No se encontraron SObjects consultables en la organización.');
    }

    logger.info('Listado de objetos completado exitosamente.');
    return sObjectNames;
  } catch (error: any) {
    spinner.fail('Error durante el listado de objetos.');
    logger.error('Error detallado:', error.message);
    if (error.stack) {
      logger.debug('Stack trace:', error.stack);
    }
    throw error; // Relanzar el error para que el modo interactivo lo capture
  }
}