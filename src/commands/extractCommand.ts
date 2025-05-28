// src/commands/extractCommand.ts
import { getSalesforceConnection } from '../core/auth.js';
import { loadConfig, getOrgDataDir, ensureDir } from '../core/fileManager.js';
import { logger } from '../core/logger.js';
import { CommandOptions, DEFAULT_ORG_CONFIG } from '../core/typeDefs.js';
import { extractDataBulk, extractDataQuery } from '../core/sfdc-api.js'; // Importar nuevas funciones
import ora from 'ora';
import path from 'path';
import { createWriteStream } from 'fs';

// Función para detectar subconsultas en una cadena SOQL
function hasSubquery(soql: string): boolean {
  // Expresión regular para detectar patrones de subconsulta (SELECT ... FROM ...)
  // Busca un paréntesis de apertura seguido de SELECT, luego cualquier cosa, luego FROM, luego cualquier cosa,
  // y finalmente un paréntesis de cierre.
  const subqueryRegex = /\(\s*SELECT\s+[^)]+\s+FROM\s+\w+\s*\)/i;
  return subqueryRegex.test(soql);
}

export async function extractCommand(options: CommandOptions) {
  logger.info(`--- Iniciando Extracción de Datos ---`);
  const spinner = ora('Cargando configuración...').start();

  try {
    let config = await loadConfig(options.config === '' ? undefined : options.config ? options.config : './config.json', {
      username: options.username,
      password: options.password,
      loginUrl: options.loginUrl,
      source: options.source,
      target: options.target
    });
    const sourceAlias = options.source;

    
    // Permitimos que no exista la org en config - se usará la org por defecto de SFDX
    if (!config || !config.orgs || !config.orgs[options.source]) {
      logger.warn('No se encontró configuración de organización. Se utilizará la configuración por defecto o SFDX.');
      config = config || { orgs: {} };
      config.orgs[options.source] = { ...DEFAULT_ORG_CONFIG };
    }
    if (!options.query) {
      throw new Error("La opción '--query' es obligatoria para la extracción.");
    }

    spinner.text = `Autenticando con la organización de origen: ${sourceAlias}...`;
    const conn = await getSalesforceConnection(sourceAlias, config);
    spinner.succeed(`Autenticado con ${conn.instanceUrl}`);

    const dataDir = getOrgDataDir(sourceAlias);
    await ensureDir(dataDir);
    
    // Extraemos el nombre del objeto principal de la query (simplificación)
    const objectNameMatch = options.query.match(/FROM\s+(\w+)/i);
    if (!objectNameMatch) {
      throw new Error("No se pudo determinar el objeto principal de la consulta SOQL.");
    }
    const mainObjectName = objectNameMatch[1];
    
    const queryHasSubquery = hasSubquery(options.query);
    let apiToUse: 'bulk' | 'rest';

    if (options.apiType === 'bulk') {
      if (queryHasSubquery) {
        spinner.warn('La consulta contiene subconsultas, pero se ha forzado el uso de la API Bulk. Esto probablemente fallará.');
      }
      apiToUse = 'bulk';
    } else if (options.apiType === 'rest') {
      apiToUse = 'rest';
    } else { // apiType es 'auto' o no está definido
      apiToUse = queryHasSubquery ? 'rest' : 'bulk';
      spinner.info(`Detección automática: La consulta ${queryHasSubquery ? 'contiene subconsultas' : 'no contiene subconsultas'}. Se usará la API ${apiToUse.toUpperCase()}.`);
    }

    spinner.start(`Ejecutando consulta y extrayendo datos para '${mainObjectName}' usando la API ${apiToUse.toUpperCase()}...`);

    if (apiToUse === 'bulk') {
      const outputFile = path.join(dataDir, `${mainObjectName}.csv`);
      const recordStream = await extractDataBulk(conn, options.query, outputFile);
      
      let recordCount = 0;
      recordStream.on('data', (data: any) => { // Añadido tipo 'any' para evitar error implícito
          recordCount++;
          spinner.text = `Procesando registros de '${mainObjectName}'... (${recordCount} encontrados)`;
      });
      recordStream.on('end', () => {
          spinner.succeed(`Extracción completada. ${recordCount} registros guardados en ${outputFile}`);
      });
      recordStream.on('error', (err: Error) => {
          spinner.fail(`Error durante la extracción: ${err.message}`);
      });
    } else { // apiToUse === 'rest'
      // La lógica para la Query API (REST) se implementará en sfdc-api.ts
      // Aquí solo llamamos a la función y manejamos el resultado
      const result = await extractDataQuery(conn, options.query, dataDir);
      spinner.succeed(`Extracción completada. Datos guardados en ${dataDir}.`);
      // Aquí podrías añadir más detalles sobre los archivos generados si es necesario
    }

  } catch (error) {
    spinner.fail('La extracción ha fallado.');
    logger.error((error as Error).message);
    process.exit(1);
  }
}