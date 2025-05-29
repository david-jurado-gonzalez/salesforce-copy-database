import { Command } from 'commander';
import ora from 'ora';
import { Connection, DescribeGlobalResult } from 'jsforce';
import { logger } from '../core/logger.js';
import { loadConfig } from '../core/fileManager.js';
import { getSalesforceConnection } from '../core/auth.js';
import { CommandOptions, AppConfig } from '../core/typeDefs.js';

// const logger = getLogger('listObjectsCommand'); // Original logger usage, replaced by direct logger import

interface ListObjectsCommandOptions extends CommandOptions {
  target: string;
}

async function listSObjects(conn: Connection): Promise<string[]> {
  const spinner = ora('Obteniendo lista de objetos...').start();
  try {
    const describeGlobalResult: DescribeGlobalResult = await conn.describeGlobal();
    spinner.succeed('Lista de objetos obtenida.');
    return describeGlobalResult.sobjects
      .filter(sobject => sobject.queryable && sobject.retrieveable) // Filtrar solo objetos consultables y recuperables
      .map(sobject => sobject.name);
  } catch (err: any) {
    spinner.fail('Error al obtener la lista de objetos.');
    logger.error('Error al ejecutar describeGlobal:', err.message);
    throw err; // Re-lanzar para manejo superior
  }
}

export async function listObjectsCommand(options: ListObjectsCommandOptions): Promise<void> {
  logger.info('Iniciando el comando list-objects...');
  logger.debug('Opciones recibidas:', options);

  if (!options.target) {
    logger.error("La opción '--target' es obligatoria.");
    console.error("Error: La opción '--target <alias>' es obligatoria.");
    process.exit(1);
  }

  const spinner = ora(`Cargando configuración para el alias: ${options.target}...`).start();
  let config: AppConfig;
  let conn: Connection;

  try {
    config = await loadConfig();
    spinner.succeed('Configuración cargada.');
    logger.debug('Configuración de usuario cargada:', config);

    const targetOrgAlias = options.target;
    // const targetOrgConfig = config.orgs[targetOrgAlias]; // No se necesita para getSalesforceConnection

    // if (!targetOrgConfig) { // Comprobación movida a getSalesforceConnection o no necesaria si se usa SFDX
    //   spinner.fail(`Error: Alias de organización '${targetOrgAlias}' no encontrado en la configuración.`);
    //   logger.error(`Alias de organización '${targetOrgAlias}' no encontrado en la configuración.`);
    //   process.exit(1);
    // }

    spinner.text = `Conectando a la organización Salesforce con alias: ${targetOrgAlias}...`;
    conn = await getSalesforceConnection(targetOrgAlias, config); // Usar config directamente
    spinner.succeed(`Conexión exitosa a la organización: ${targetOrgAlias}`);
    logger.info(`Conexión exitosa a la organización: ${targetOrgAlias}`);

    const sObjectNames = await listSObjects(conn);

    if (sObjectNames.length > 0) {
      console.log('\nSObjects disponibles en la organización:');
      sObjectNames.forEach(name => console.log(name));
    } else {
      console.log('No se encontraron SObjects consultables en la organización.');
    }

    logger.info('Comando list-objects completado exitosamente.');
    process.exit(0);
  } catch (error: any) {
    spinner.fail('Error durante la ejecución del comando list-objects.');
    logger.error('Error detallado:', error.message);
    if (error.stack) {
      logger.debug('Stack trace:', error.stack);
    }
    process.exit(1);
  }
}

export const createListObjectsCommand = (): Command => {
  const command = new Command('list-objects')
    .description('Lista todos los SObjects disponibles en la organización Salesforce de destino.')
    .requiredOption('-t, --target <alias>', 'Alias de la organización Salesforce de destino')
    .action(async (options: ListObjectsCommandOptions) => {
      await listObjectsCommand(options);
    });
  return command;
};