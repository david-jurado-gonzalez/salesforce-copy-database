// src/commands/extractCommand.ts
// src/commands/extractCommand.ts
import { Auth } from '../core/auth.js'; // Importar la clase Auth
import { fileManagerAPI } from '../core/fileManager.js';
import { Logger } from '../core/logger.js'; // Importar la clase Logger
// import { CommandOptions, DEFAULT_ORG_CONFIG, OrgAliasInfo } from '../core/typeDefs.js';
import { extractDataBulk, extractDataQuery, executeSoslQuery, extractSObjectNameFromSoql } from '../core/sfdc-api.js'; // Importar executeSoslQuery y extractSObjectNameFromSoql
// writeRecordsToCsv ahora se importa a través de fileManagerAPI
import { AliasManagerService } from '../core/aliasManagerService.js';
import ora from 'ora';
import path from 'path';
// import { createWriteStream } from 'fs';

const logger = new Logger('ExtractCommand');
const auth = new Auth();
const aliasManagerService = new AliasManagerService();


/**
 * Parámetros para la función de extracción de datos.
 */
export interface ExtractDataParams {
  username?: string; // Proveniente de -u <username> o selección interactiva (puede ser alias o username)
  targetAlias?: string; // Proveniente de --target-alias (CLI) o selección interactiva
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
    let config = await fileManagerAPI.loadConfig('./config.json'); // Cargar config.json por defecto

    let orgToUse: string | undefined = undefined;

    // Lógica de selección de Org según el diseño técnico
    if (params.targetAlias) {
      orgToUse = params.targetAlias;
      logger.info(`Usando alias especificado por --target-alias: ${orgToUse}`);
    } else if (params.username) {
      orgToUse = params.username;
      logger.info(`Usando username/alias especificado por -u: ${orgToUse}`);
    } else {
      spinner.text = 'Determinando organización predeterminada del proyecto...';
      const defaultOrg = await aliasManagerService.getProjectDefaultOrg();
      if (defaultOrg && defaultOrg.alias) {
        orgToUse = defaultOrg.alias;
        logger.info(`Usando alias predeterminado del proyecto: ${orgToUse}`);
      } else {
        spinner.fail('No se especificó organización y no hay predeterminada en el proyecto.');
        throw new Error("Debe especificar una organización de origen con --target-alias <alias> o -u <username>, o configurar una organización predeterminada para el proyecto.");
      }
    }

    if (!orgToUse) { // Doble chequeo, aunque la lógica anterior debería cubrirlo
        throw new Error("No se pudo determinar la organización de origen.");
    }
    
    const sourceAlias = orgToUse; // Renombrar para mantener consistencia con el resto del código existente
    const soqlQuery = params.query;
    const soslQueryString = params.soslQuery;
    let outputPath = params.outputPath;
    
    // La validación de config.orgs[sourceAlias] se omite aquí porque 'auth.getSalesforceConnection'
    // ya maneja la obtención de la conexión basada en el alias/username,
    // y 'AliasManagerService' se encarga de la validez del alias.

    if (!soqlQuery && !soslQueryString) {
      throw new Error("Se debe proporcionar una consulta SOQL (query) o SOSL (soslQuery) para la extracción.");
    }
    if (soqlQuery && soslQueryString) {
      throw new Error("No se pueden proporcionar ambas, una consulta SOQL (query) y una SOSL (soslQuery) simultáneamente.");
    }

    if (!outputPath) {
      if (soslQueryString) {
        // Para SOSL, crear un subdirectorio 'sosl' si no se especifica outputPath
        const soslDir = path.join(fileManagerAPI.getOrgDataDir(sourceAlias), 'sosl');
        await fileManagerAPI.ensureDir(soslDir); // Asegurar que el directorio 'sosl' exista
        // Usar un nombre de archivo por defecto para SOSL si outputPath no se proporciona completo
        outputPath = path.join(soslDir, `sosl_results_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`);
      } else {
        outputPath = fileManagerAPI.getOrgDataDir(sourceAlias); // Comportamiento por defecto para SOQL
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

    await fileManagerAPI.ensureDir(path.dirname(outputPath!)); // Asegurar el directorio del archivo de salida

    if (soslQueryString) {
        spinner.start(`Ejecutando consulta SOSL y extrayendo datos...`);
        const results = await executeSoslQuery(conn, soslQueryString);
        if (results.length === 0) {
            spinner.succeed('La consulta SOSL no devolvió resultados.');
        } else {
            await fileManagerAPI.writeRecordsToCsv(results, outputPath!);
            spinner.succeed(`Extracción SOSL completada. ${results.length} registros guardados en ${outputPath}`);
        }
    } else if (soqlQuery) {
        const mainObjectName = extractSObjectNameFromSoql(soqlQuery);

        if (!mainObjectName) {
          throw new Error("No se pudo determinar el objeto principal de la consulta SOQL. Verifique la sintaxis de su consulta.");
        }
        
        // Determinar qué API usar: si se fuerza 'bulk', usar bulk; de lo contrario, usar REST/auto-detección
        const useBulkApi = params.apiType === 'bulk';
        const apiTypeLabel = useBulkApi ? 'Bulk' : 'REST (con detección automática de Tooling API)';

        spinner.start(`Ejecutando consulta SOQL y extrayendo datos para '${mainObjectName}' usando la API ${apiTypeLabel}...`);

        if (useBulkApi) {
          // Para BULK, outputPath es un directorio, el nombre del archivo se deriva de mainObjectName
          const bulkOutputFile = path.join(outputPath!, `${mainObjectName}.csv`);
          await fileManagerAPI.ensureDir(path.dirname(bulkOutputFile)); // Asegurar que el directorio exista
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
        } else { // apiType es 'rest', 'auto' o no especificado, se delega a extractDataQuery
          // extractDataQuery ahora maneja la detección de Tooling API internamente
          const result = await extractDataQuery(conn, soqlQuery, outputPath!, mainObjectName);
          spinner.succeed(`Extracción SOQL (REST/Tooling API) completada. Datos guardados en ${outputPath}. Archivo principal: ${result.parentFile}`);
        }
    }

  } catch (error) {
    spinner.fail('La extracción ha fallado.');
    logger.error((error as Error).message);
    // No hacer process.exit(1) aquí para permitir que el modo interactivo maneje el error
    throw error; // Relanzar el error para que el modo interactivo lo capture
  }
}