// src/commands/extractCommand.ts
// src/commands/extractCommand.ts
import { Auth } from '../core/auth.js'; // Importar la clase Auth
import { loadConfig, getOrgDataDir, ensureDir } from '../core/fileManager.js';
import { Logger } from '../core/logger.js'; // Importar la clase Logger
import { CommandOptions, DEFAULT_ORG_CONFIG } from '../core/typeDefs.js';
import { extractDataBulk, extractDataQuery, executeSoslQuery } from '../core/sfdc-api.js'; // Importar executeSoslQuery
import { writeRecordsToCsv } from '../core/fileManager.js'; // Importar writeRecordsToCsv
import ora from 'ora';
import path from 'path';
import { createWriteStream } from 'fs';

const logger = new Logger('ExtractCommand');
const auth = new Auth();

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
    const fromKeywordRegex = /\bFROM\b/gi;
    let match;

    while ((match = fromKeywordRegex.exec(soqlQuery)) !== null) {
        const fromStartIndex = match.index;
        
        // Calculate parenthesis depth just before this "FROM" keyword
        let currentDepthBeforeFrom = 0;
        for (let k = 0; k < fromStartIndex; k++) {
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

/**
 * Parámetros para la función de extracción de datos.
 */
export interface ExtractDataParams {
  sourceOrgAlias: string;
  query?: string; // Hacer SOQL opcional si SOSL se proporciona
  soslQuery?: string; // Nuevo parámetro para consultas SOSL
  outputPath?: string; // Opcional para el modo interactivo, se puede inferir
  apiType?: 'bulk' | 'rest' | 'auto'; // Aplicable solo a SOQL
}

/**
 * Función principal para la extracción de datos.
 * Puede ser llamada desde la CLI o programáticamente.
 * @param params Los parámetros de extracción.
 */
export async function extractData(params: ExtractDataParams) {
  logger.info(`--- Iniciando Extracción de Datos ---`);
  const spinner = ora('Cargando configuración...').start();

  try {
    // La configuración se cargará de forma diferente si se llama desde la CLI
    // Para el modo interactivo, asumimos que el alias ya está validado.
    let config = await loadConfig('./config.json'); // Cargar config.json por defecto
    
    const sourceAlias = params.sourceOrgAlias;
    const soqlQuery = params.query;
    const soslQueryString = params.soslQuery;
    let outputPath = params.outputPath;


    // Asegurarse de que la organización de origen existe en la configuración o es un alias SFDX válido
    if (!config || !config.orgs || !config.orgs[sourceAlias]) {
      logger.warn(`No se encontró configuración de organización para '${sourceAlias}'. Se intentará usar SFDX.`);
    }
    
    if (!soqlQuery && !soslQueryString) {
      throw new Error("Se debe proporcionar una consulta SOQL (query) o SOSL (soslQuery) para la extracción.");
    }
    if (soqlQuery && soslQueryString) {
      throw new Error("No se pueden proporcionar ambas, una consulta SOQL (query) y una SOSL (soslQuery) simultáneamente.");
    }

    if (!outputPath) {
      if (soslQueryString) {
        // Para SOSL, crear un subdirectorio 'sosl' si no se especifica outputPath
        const soslDir = path.join(getOrgDataDir(sourceAlias), 'sosl');
        await ensureDir(soslDir); // Asegurar que el directorio 'sosl' exista
        // Usar un nombre de archivo por defecto para SOSL si outputPath no se proporciona completo
        outputPath = path.join(soslDir, `sosl_results_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`);
      } else {
        outputPath = getOrgDataDir(sourceAlias); // Comportamiento por defecto para SOQL
      }
    }
    // Si outputPath es solo un directorio para SOSL, añadir nombre de archivo
    if (soslQueryString && outputPath) {
        const currentPathForStat = outputPath; // outputPath es string aquí debido a la guarda "&& outputPath"
        const stat = await import('fs').then(fs => fs.promises.stat(currentPathForStat).catch(() => null));
        if (stat && stat.isDirectory()) {
            outputPath = path.join(currentPathForStat, `sosl_results_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`);
        }
    }


    spinner.text = `Autenticando con la organización de origen: ${sourceAlias}...`;
    const conn = await auth.getSalesforceConnection(sourceAlias, config); // Usar la instancia de Auth
    spinner.succeed(`Autenticado con ${conn.instanceUrl}`);

    await ensureDir(path.dirname(outputPath)); // Asegurar el directorio del archivo de salida

    if (soslQueryString) {
        spinner.start(`Ejecutando consulta SOSL y extrayendo datos...`);
        const results = await executeSoslQuery(conn, soslQueryString);
        if (results.length === 0) {
            spinner.succeed('La consulta SOSL no devolvió resultados.');
        } else {
            await writeRecordsToCsv(results, outputPath);
            spinner.succeed(`Extracción SOSL completada. ${results.length} registros guardados en ${outputPath}`);
        }
    } else if (soqlQuery) {
        const mainObjectName = extractMainSObjectNameFromQuery(soqlQuery);

        if (!mainObjectName) {
          throw new Error("No se pudo determinar el objeto principal de la consulta SOQL. Verifique la sintaxis de su consulta.");
        }
        
        const queryHasSubquery = hasSubquery(soqlQuery);
        let apiToUse: 'bulk' | 'rest';

        // 1. Prioridad de la Selección Manual
        if (params.apiType === 'rest') {
          apiToUse = 'rest';
          logger.info('Se utilizará la API REST según la selección explícita.');
        } else if (params.apiType === 'bulk') {
          apiToUse = 'bulk';
          if (queryHasSubquery) {
            logger.warn('ADVERTENCIA: La consulta contiene subconsultas, pero se ha forzado el uso de la API Bulk. La API de Salesforce podría rechazar esta consulta.');
          } else {
            logger.info('Se utilizará la API Bulk según la selección explícita.');
          }
        } else { // apiType es 'auto' o no especificado
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

        spinner.start(`Ejecutando consulta SOQL y extrayendo datos para '${mainObjectName}' usando la API ${apiToUse.toUpperCase()}...`);

        if (apiToUse === 'bulk') {
          // Para BULK, outputPath es un directorio, el nombre del archivo se deriva de mainObjectName
          const bulkOutputFile = path.join(outputPath, `${mainObjectName}.csv`);
           await ensureDir(path.dirname(bulkOutputFile)); // Asegurar que el directorio exista
          const recordStream = await extractDataBulk(conn, soqlQuery, bulkOutputFile);
          
          let recordCount = 0;
          recordStream.on('data', (data: any) => {
              recordCount++;
              spinner.text = `Procesando registros de '${mainObjectName}'... (${recordCount} encontrados)`;
          });
          recordStream.on('end', () => {
              spinner.succeed(`Extracción SOQL (Bulk) completada. ${recordCount} registros guardados en ${bulkOutputFile}`);
          });
          recordStream.on('error', (err: Error) => {
              spinner.fail(`Error durante la extracción SOQL (Bulk): ${err.message}`);
          });
        } else { // apiToUse === 'rest' para SOQL
          // Para REST (Query API), outputPath es un directorio, los archivos se generan dentro
          const result = await extractDataQuery(conn, soqlQuery, outputPath, mainObjectName);
          spinner.succeed(`Extracción SOQL (REST) completada. Datos guardados en ${outputPath}. Archivo principal: ${result.parentFile}`);
        }
    }

  } catch (error) {
    spinner.fail('La extracción ha fallado.');
    logger.error((error as Error).message);
    // No hacer process.exit(1) aquí para permitir que el modo interactivo maneje el error
    throw error; // Relanzar el error para que el modo interactivo lo capture
  }
}