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
  const subqueryRegex = /\(\s*SELECT\s[^)]*?FROM\s+\w+[^)]*\)/i;
  return subqueryRegex.test(soql);
}

// Helper function to extract the main SObject name from a SOQL query, handling subqueries.
function extractMainSObjectNameFromQuery(soqlQuery: string): string | null {
    const fromKeywordRegex = /\bFROM\b/gi; // Case-insensitive, global search for "FROM"
    let match;

    while ((match = fromKeywordRegex.exec(soqlQuery)) !== null) {
        const fromStartIndex = match.index; // Index where "FROM" starts
        
        // Calculate parenthesis depth just before this "FROM" keyword
        let currentDepthBeforeFrom = 0;
        for (let k = 0; k < fromStartIndex; k++) { // Corrected line
            if (soqlQuery[k] === '(') {
                currentDepthBeforeFrom++;
            } else if (soqlQuery[k] === ')') {
                // Ensure depth doesn't go below zero for malformed queries
                if (currentDepthBeforeFrom > 0) {
                    currentDepthBeforeFrom--;
                }
            }
        }

        // If depth is 0, this "FROM" is part of the main query
        if (currentDepthBeforeFrom === 0) {
            // Extract the SObject name following "FROM "
            const substringAfterFromKeyword = soqlQuery.substring(fromStartIndex + 'FROM'.length);
            const trimmedSubstring = substringAfterFromKeyword.trimStart(); // Remove leading spaces
            
            const objectNameMatchRegex = /^(\w+)/; // Regex to match the first word (SObject name)
            const objectNameMatch = trimmedSubstring.match(objectNameMatchRegex);
            
            if (objectNameMatch && objectNameMatch[1]) {
                return objectNameMatch[1]; // Return the found SObject name
            }
        }
    }
    return null; // Should not be reached for a valid SOQL query with a FROM clause
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
    
    // Utilizar la nueva función para extraer el nombre del objeto principal
    const mainObjectName = extractMainSObjectNameFromQuery(options.query);

    if (!mainObjectName) {
      throw new Error("No se pudo determinar el objeto principal de la consulta SOQL. Verifique la sintaxis de su consulta.");
    }
    
    const queryHasSubquery = hasSubquery(options.query);
    let apiToUse: 'bulk' | 'rest';

    // 1. Prioridad de la Selección Manual
    if (options.apiType === 'rest') {
      apiToUse = 'rest';
      logger.info('Se utilizará la API REST según la selección explícita del usuario (--apiType REST).');
    } else if (options.apiType === 'bulk') {
      apiToUse = 'bulk';
      if (queryHasSubquery) {
        logger.warn('ADVERTENCIA: La consulta contiene subconsultas, pero se ha forzado el uso de la API Bulk (--apiType BULK). La API de Salesforce podría rechazar esta consulta.');
      } else {
        logger.info('Se utilizará la API Bulk según la selección explícita del usuario (--apiType BULK).');
      }
    } else {
      // 2. Detección de Incompatibilidad y Cambio Automático (apiType no especificado o es 'auto')
      // Por defecto, se intenta BULK (Requisito 1)
      if (queryHasSubquery) {
        apiToUse = 'rest';
        logger.info('Detección automática: Consulta con subconsultas identificada. Cambiando a API REST para su ejecución.');
      } else {
        // Aquí podrían ir otras comprobaciones de incompatibilidad con BULK en el futuro
        apiToUse = 'bulk';
        logger.info('Detección automática: La consulta parece compatible con API Bulk. Se utilizará API Bulk por defecto.');
      }
    }
    // El spinner.info original sobre la detección automática se ha movido a logger.info dentro de la lógica.
    // El spinner.start en la línea 112 (ahora desplazada) ya indica la API que se usará.

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
      const result = await extractDataQuery(conn, options.query, dataDir, mainObjectName);
      spinner.succeed(`Extracción completada. Datos guardados en ${dataDir}.`);
      // Aquí podrías añadir más detalles sobre los archivos generados si es necesario
    }

  } catch (error) {
    spinner.fail('La extracción ha fallado.');
    logger.error((error as Error).message);
    process.exit(1);
  }
}