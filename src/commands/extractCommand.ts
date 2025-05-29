// src/commands/extractCommand.ts
// src/commands/extractCommand.ts
import { Auth } from '../core/auth.js'; // Importar la clase Auth
import { loadConfig, getOrgDataDir, ensureDir } from '../core/fileManager.js';
import { Logger } from '../core/logger.js'; // Importar la clase Logger
import { CommandOptions, DEFAULT_ORG_CONFIG } from '../core/typeDefs.js';
import { extractDataBulk, extractDataQuery } from '../core/sfdc-api.js';
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
  query: string;
  outputPath?: string; // Opcional para el modo interactivo, se puede inferir
  apiType?: 'bulk' | 'rest' | 'auto';
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
    const query = params.query;
    const outputPath = params.outputPath || getOrgDataDir(sourceAlias); // Usar outputPath si se proporciona, sino el por defecto

    // Asegurarse de que la organización de origen existe en la configuración o es un alias SFDX válido
    if (!config || !config.orgs || !config.orgs[sourceAlias]) {
      logger.warn(`No se encontró configuración de organización para '${sourceAlias}'. Se intentará usar SFDX.`);
      // No es necesario añadir a config.orgs aquí, ya que Auth.getSalesforceConnection lo manejará.
    }
    
    if (!query) {
      throw new Error("La consulta SOQL es obligatoria para la extracción.");
    }

    spinner.text = `Autenticando con la organización de origen: ${sourceAlias}...`;
    const conn = await auth.getSalesforceConnection(sourceAlias, config); // Usar la instancia de Auth
    spinner.succeed(`Autenticado con ${conn.instanceUrl}`);

    await ensureDir(outputPath);
    
    const mainObjectName = extractMainSObjectNameFromQuery(query);

    if (!mainObjectName) {
      throw new Error("No se pudo determinar el objeto principal de la consulta SOQL. Verifique la sintaxis de su consulta.");
    }
    
    const queryHasSubquery = hasSubquery(query);
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
    // El spinner.info original sobre la detección automática se ha movido a logger.info dentro de la lógica.
    // El spinner.start en la línea 112 (ahora desplazada) ya indica la API que se usará.

    spinner.start(`Ejecutando consulta y extrayendo datos para '${mainObjectName}' usando la API ${apiToUse.toUpperCase()}...`);

    if (apiToUse === 'bulk') {
      const outputFile = path.join(outputPath, `${mainObjectName}.csv`);
      const recordStream = await extractDataBulk(conn, query, outputFile);
      
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
      const result = await extractDataQuery(conn, query, outputPath, mainObjectName);
      spinner.succeed(`Extracción completada. Datos guardados en ${outputPath}.`);
    }

  } catch (error) {
    spinner.fail('La extracción ha fallado.');
    logger.error((error as Error).message);
    // No hacer process.exit(1) aquí para permitir que el modo interactivo maneje el error
    throw error; // Relanzar el error para que el modo interactivo lo capture
  }
}