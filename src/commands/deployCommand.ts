import { AppConfig, IdMap, SObjectDescribe } from '../core/typeDefs.js';
import { Auth } from '../core/auth.js'; // Importar la clase Auth
import {
  loadConfig,
  getOrgDataDir,
  getOrgMappingsDir,
  getOrgErrorsDir,
  ensureDir,
  readIdMap,
  writeIdMap,
  writeErrorLog,
  getObjectListFromDataDir,
} from '../core/fileManager.js';
import { Logger } from '../core/logger.js'; // Importar la clase Logger
import { describeSObject } from '../core/sfdc-api.js';
import { DependencyGraph } from './dependencyGraph.js';
import { Connection } from 'jsforce';
import ora from 'ora';
import inquirer from 'inquirer';
import chalk from 'chalk';
import path from 'path';
import fs from 'fs';
import { parse } from 'csv-parse';

const logger = new Logger('DeployCommand');
const auth = new Auth();

/**
 * Este fichero es el núcleo de la herramienta y contiene la lógica más compleja:
 *   el análisis de dependencias, el despliegue en dos fases y el manejo de los mapeos de IDs.
 * Añadida una documentación en formato JSDoc y comentarios en español para explicar cada paso.
 */

// --- Interfaces y Tipos Específicos para el Despliegue ---

interface DeploymentContext {
  sourceAlias: string;
  targetAlias: string;
  sourceConn: Connection;
  targetConn: Connection;
  config: AppConfig;
}

interface DeploymentSummary {
  [objectName: string]: {
    processed: number;
    success: number;
    errors: number;
  };
}

/**
 * Parámetros para la función de despliegue de datos.
 */
export interface DeployDataParams {
  targetOrgAlias: string;
  inputPath?: string; // Opcional para el modo interactivo, se puede inferir
  force?: boolean;
}

/**
 * Orquesta el proceso completo de despliegue de datos.
 * @param params Parámetros del despliegue.
 */
export async function deployData(params: DeployDataParams): Promise<void> {
  logger.info(chalk.cyan('--- Iniciando Proceso de Despliegue de Datos ---'));
  const spinner = ora('Cargando configuración...').start();

  try {
    // --- 1. Inicialización y Validación ---
    if (!params.targetOrgAlias) {
      throw new Error("El alias de la organización de destino es obligatorio para el despliegue.");
    }

    const config = await loadConfig('./config.json'); // Cargar config.json por defecto
    const { targetOrgAlias, inputPath, force } = params;
    const sourceAlias = config.defaultSourceOrgAlias || 'defaultSourceOrg'; // Asumir un alias de origen si no se especifica

    spinner.stop();
    await confirmDeployment(targetOrgAlias, force);
    spinner.start();

    // --- 2. Preparación del Entorno ---
    spinner.text = 'Preparando directorios de trabajo...';
    await prepareWorkspace(targetOrgAlias);

    spinner.text = 'Estableciendo conexiones con las organizaciones...';
    // Se necesita conexión al origen para obtener metadatos si no existen localmente
    const sourceConn = await auth.getSalesforceConnection(sourceAlias, config); // Usar la instancia de Auth
    const targetConn = await auth.getSalesforceConnection(targetOrgAlias, config); // Usar la instancia de Auth
    const context: DeploymentContext = { sourceAlias, targetAlias: targetOrgAlias, sourceConn, targetConn, config };
    spinner.succeed('Conexiones establecidas.');

    // --- 3. Análisis de Dependencias ---
    spinner.start('Analizando dependencias de objetos...');
    const dataDir = inputPath || getOrgDataDir(sourceAlias); // Usar inputPath si se proporciona
    const objectsToDeploy = await getObjectListFromDataDir(dataDir);
    const { deploymentOrder, twoPassObjects } = await runDependencyAnalysis(context, objectsToDeploy);
    spinner.succeed(`Orden de despliegue calculado: ${chalk.yellow(deploymentOrder.join(' -> '))}`);
    if (twoPassObjects.size > 0) {
      spinner.info(`Objetos que requieren 2 fases (actualización): ${chalk.yellow([...twoPassObjects].join(', '))}`);
    }

    // --- 4. Ejecución del Despliegue ---
    const summary: DeploymentSummary = {};

    logger.info(chalk.cyan('\n--- FASE 1: Inserción de Registros ---'));
    for (const objectName of deploymentOrder) {
      const result = await processInsertPass(context, objectName, deploymentOrder);
      summary[objectName] = { ...(summary[objectName] || {}), ...result };
    }
    
    logger.info(chalk.cyan('\n--- FASE 2: Actualización de Relaciones (Lookups) ---'));
    for (const objectName of twoPassObjects) {
      const result = await processUpdatePass(context, objectName);
      // Sumar los resultados de la actualización a los existentes
      summary[objectName].processed += result.processed;
      summary[objectName].success += result.success;
      summary[objectName].errors += result.errors;
    }

    // --- 5. Informe Final ---
    printFinalSummary(summary);

  } catch (error) {
    spinner.fail('El despliegue ha fallado.');
    logger.error((error as Error).message);
    throw error; // Relanzar el error para que el modo interactivo lo capture
  }
}

// --- Funciones de Ayuda y Orquestación ---

/**
 * Pide confirmación al usuario antes de proceder con el despliegue.
 * @param targetAlias El alias de la organización de destino.
 * @param force Si es true, se salta la confirmación.
 */
async function confirmDeployment(targetAlias: string, force: boolean | undefined): Promise<void> {
  if (force) {
    logger.warn(chalk.yellow(`Flag --force detectado. Procediendo sin confirmación al despliegue en '${targetAlias}'.`));
    return;
  }
  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: `Vas a desplegar datos en la organización con alias ${chalk.bold.red(
        targetAlias
      )}. Esta acción puede crear y/o actualizar un gran número de registros.\n  ${chalk.bold('¿Estás seguro de que quieres continuar?')}`,
      default: false,
    },
  ]);
  if (!confirm) {
    logger.warn('Despliegue cancelado por el usuario.');
    throw new Error('Despliegue cancelado por el usuario.'); // Lanzar error en lugar de salir
  }
}

/**
 * Crea los directorios necesarios para los mapeos y errores en el `workdir`.
 * @param targetAlias El alias de la organización de destino.
 */
async function prepareWorkspace(targetAlias: string): Promise<void> {
  await ensureDir(getOrgMappingsDir(targetAlias));
  await ensureDir(getOrgErrorsDir(targetAlias));
}

/**
 * Ejecuta el análisis de metadatos para determinar el orden de despliegue.
 * @param context El contexto de despliegue.
 * @param objectsToDeploy La lista de objetos a procesar.
 * @returns El orden de despliegue y los objetos que necesitan una segunda fase.
 */
async function runDependencyAnalysis(context: DeploymentContext, objectsToDeploy: string[]) {
  const graph = new DependencyGraph();
  const describePromises = objectsToDeploy.map(obj => describeSObject(context.sourceConn, obj));
  const descriptions = await Promise.all(describePromises);

  descriptions.forEach((desc: SObjectDescribe) => graph.addNode(desc.name, desc));
  objectsToDeploy.forEach(obj => graph.buildEdges(obj, new Set(objectsToDeploy)));
  
  const { order: deploymentOrder, cycles } = graph.topologicalSort();
  
  // Los objetos que requieren 2 fases son aquellos en ciclos o que tienen lookups opcionales a objetos posteriores.
  const twoPassObjects = graph.getTwoPassObjects(deploymentOrder, cycles);

  return { deploymentOrder, twoPassObjects };
}

// --- Lógica de las Fases de Despliegue ---

/**
 * Procesa la FASE 1 (INSERT) para un único objeto.
 * Lee su CSV, resuelve las dependencias de padres ya procesados, e inserta los registros.
 * @param context El contexto de despliegue.
 * @param objectName El nombre del objeto a procesar.
 * @param deploymentOrder El orden completo de despliegue.
 * @returns Un resumen de la operación para este objeto.
 */
async function processInsertPass(context: DeploymentContext, objectName: string, deploymentOrder: string[]) {
  const spinner = ora(`[FASE 1 - INSERT] Procesando ${objectName}...`).start();
  const { sourceAlias, targetAlias, targetConn } = context;

  const dataPath = path.join(getOrgDataDir(sourceAlias), `${objectName}.csv`);
  if (!fs.existsSync(dataPath)) {
    spinner.warn(`No se encontró el archivo ${objectName}.csv. Saltando...`);
    return { processed: 0, success: 0, errors: 0 };
  }

  // Cargar los mapas de ID de los objetos padre que ya han sido procesados
  const parentObjects = deploymentOrder.slice(0, deploymentOrder.indexOf(objectName));
  const parentIdMaps: { [obj: string]: IdMap } = {};
  for (const parent of parentObjects) {
    parentIdMaps[parent] = await readIdMap(targetAlias, parent);
  }

  const recordsToInsert: any[] = [];
  const sourceRecords: { [key: string]: any } = {}; // Guardamos el registro original para el mapeo

  const parser = fs.createReadStream(dataPath).pipe(parse({ columns: true, skip_empty_lines: true }));
  for await (const record of parser) {
    // El ID original es la clave para todo el proceso de mapeo
    const sourceId = record.Id;
    if (!sourceId) continue;

    // Filtramos el Id original y otros campos de solo lectura que no se pueden insertar
    const { Id, ...fieldsToProcess } = record;
    sourceRecords[sourceId] = record;
    
    // Transformamos el registro, reemplazando IDs de lookup de origen por los de destino
    const transformedRecord = transformRecord(fieldsToProcess, parentIdMaps);
    recordsToInsert.push(transformedRecord);
  }

  if (recordsToInsert.length === 0) {
    spinner.succeed(`[FASE 1 - INSERT] ${objectName}: No hay registros para procesar.`);
    return { processed: 0, success: 0, errors: 0 };
  }

  spinner.text = `[FASE 1 - INSERT] Insertando ${recordsToInsert.length} registros de ${objectName}...`;
  const jobResults = await targetConn.bulk.load(objectName, 'insert', recordsToInsert);
  
  // Procesamos los resultados para crear el mapa de IDs y el log de errores
  const newIdMap = await readIdMap(targetAlias, objectName);
  const errors: any[] = [];
  
  jobResults.forEach((result, i) => {
    const sourceId = recordsToInsert[i].Legacy_Source_Id__c || Object.keys(sourceRecords)[i];
    if (result.success) {
      if (result.id) {
        newIdMap[sourceId] = result.id;
      }
    } else {
      errors.push({ sourceRecord: sourceRecords[sourceId], error: result.errors.join(', ') });
    }
  });

  await writeIdMap(targetAlias, objectName, newIdMap);
  if (errors.length > 0) {
    await writeErrorLog(targetAlias, objectName, 'insert-errors', errors);
  }

  spinner.succeed(`[FASE 1 - INSERT] ${objectName}: ${jobResults.filter(r => r.success).length} creados, ${errors.length} fallidos.`);
  return { processed: recordsToInsert.length, success: jobResults.filter(r => r.success).length, errors: errors.length };
}

/**
 * Procesa la FASE 2 (UPDATE) para un objeto.
 * Vuelve a leer su CSV y rellena los lookups que se omitieron en la fase 1.
 * @param context El contexto de despliegue.
 * @param objectName El nombre del objeto a actualizar.
 * @returns Un resumen de la operación de actualización.
 */
// Interfaces para la configuración de SObjects esperada por el diseño para processUpdatePass
interface SObjectFieldConfigForUpdatePass {
  apiName: string;
  type: string;
  referenceTo?: string[];
}

interface SObjectDefinitionForUpdatePass {
  apiName: string;
  fields: SObjectFieldConfigForUpdatePass[];
}

interface ConfigWithSObjectDefinitionsForUpdatePass extends AppConfig {
  objects?: SObjectDefinitionForUpdatePass[];
}

async function processUpdatePass(context: DeploymentContext, objectName: string): Promise<{ processed: number; success: number; errors: number; }> {
  const currentConfig = context.config as ConfigWithSObjectDefinitionsForUpdatePass;
  const spinner = ora(`[FASE 2 - UPDATE] Procesando ${objectName}...`).start();
  const summary = { processed: 0, success: 0, errors: 0 };
  const errorRecordsForFile: Array<{ sourceRecord: any, error: string }> = [];
  const allIdMaps: { [sObjName: string]: IdMap } = {};
  const { targetAlias, sourceAlias, targetConn } = context; // config ya no se desestructura aquí

  // 1. Cargar Todos los Mapas de IDs
  spinner.text = `[FASE 2 - UPDATE] [${objectName}] Cargando todos los IdMaps...`;
  logger.info(`[${objectName}] Iniciando Fase 2: Pasada de Actualización. Cargando todos los IdMaps...`);
  try {
    let deployedObjectNamesForIdMapLoading: string[] = [];
    if (currentConfig.objects && Array.isArray(currentConfig.objects)) {
      deployedObjectNamesForIdMapLoading = currentConfig.objects
        .map((obj) => obj.apiName)
        .filter((name) => typeof name === 'string' && name);
    } else {
      logger.warn(`[${objectName}] currentConfig.objects no está definido o no es un array. Intentando listar mapas de IDs desde el directorio de mapeos.`);
      const mappingDir = getOrgMappingsDir(targetAlias);
      if (fs.existsSync(mappingDir)) {
        deployedObjectNamesForIdMapLoading = fs.readdirSync(mappingDir)
          .filter(file => file.endsWith('.json'))
          .map(file => file.replace('.json', ''));
      }
    }
    if (deployedObjectNamesForIdMapLoading.length === 0 && objectName) {
        const currentObjectMap = await readIdMap(targetAlias, objectName).catch(() => null);
        if (currentObjectMap) {
            allIdMaps[objectName] = currentObjectMap;
            logger.info(`[${objectName}] Mapa de IDs cargado para el objeto actual ${objectName} con ${Object.keys(currentObjectMap).length} entradas.`);
        }
    }

    for (const mappedObjectName of deployedObjectNamesForIdMapLoading) {
      if (!mappedObjectName) continue;
      try {
        const idMap = await readIdMap(targetAlias, mappedObjectName);
        if (idMap && Object.keys(idMap).length > 0) {
          allIdMaps[mappedObjectName] = idMap;
          logger.info(`[${objectName}] Mapa de IDs cargado para ${mappedObjectName} con ${Object.keys(idMap).length} entradas.`);
        }
      } catch (e: any) {
        logger.warn(`[${objectName}] No se pudo cargar el mapa de IDs para ${mappedObjectName}: ${e.message}`);
      }
    }
    if (Object.keys(allIdMaps).length === 0) {
      logger.warn(`[${objectName}] No se cargaron mapas de IDs. La pasada de actualización podría no ser efectiva.`);
    }
  } catch (e: any) {
    logger.error(`[${objectName}] Error crítico durante la fase de carga de mapas de IDs: ${e.message}`);
    spinner.fail(`[FASE 2 - UPDATE] [${objectName}] Error cargando IdMaps.`);
    return { ...summary, errors: summary.processed > 0 ? summary.processed : 1 };
  }

  // 2. Leer Datos de Origen
  spinner.text = `[FASE 2 - UPDATE] [${objectName}] Leyendo datos CSV de origen...`;
  const sourceRecordsAccumulator: any[] = [];
  const dataPath = path.join(getOrgDataDir(sourceAlias), `${objectName}.csv`);

  if (!fs.existsSync(dataPath)) {
    logger.info(`[${objectName}] No se encontró el archivo de datos de origen ${objectName}.csv. Nada que procesar en la pasada de actualización.`);
    spinner.warn(`[FASE 2 - UPDATE] [${objectName}] No se encontró ${objectName}.csv.`);
    return summary;
  }

  try {
    logger.info(`[${objectName}] Leyendo datos CSV de origen desde ${dataPath}...`);
    const parser = fs.createReadStream(dataPath).pipe(parse({ columns: true, skip_empty_lines: true }));
    for await (const record of parser) {
      sourceRecordsAccumulator.push(record);
    }
    
    if (sourceRecordsAccumulator.length === 0) {
      logger.info(`[${objectName}] No se encontraron registros de origen en ${objectName}.csv. Nada que procesar en la pasada de actualización.`);
      spinner.succeed(`[FASE 2 - UPDATE] [${objectName}] No hay registros de origen.`);
      return summary;
    }
    logger.info(`[${objectName}] Se encontraron ${sourceRecordsAccumulator.length} registros de origen para procesar.`);
  } catch (e: any) {
    logger.error(`[${objectName}] Error leyendo CSV de origen (${dataPath}): ${e.message}`);
    spinner.fail(`[FASE 2 - UPDATE] [${objectName}] Error leyendo CSV.`);
    return { processed: 0, success: 0, errors: 1 };
  }
  const sourceRecords = sourceRecordsAccumulator;

  const sObjectConfig = currentConfig.objects?.find((obj) => obj.apiName === objectName);

  if (!sObjectConfig || !sObjectConfig.fields) {
    logger.error(`[${objectName}] La configuración del SObject o las definiciones de campo no se encontraron en config.json para ${objectName}. No se pueden procesar las actualizaciones.`);
    spinner.fail(`[FASE 2 - UPDATE] [${objectName}] Falta configuración del objeto en config.json.`);
    summary.errors = sourceRecords.length;
    sourceRecords.forEach(sr => errorRecordsForFile.push({
      sourceRecord: sr,
      error: `Missing SObject configuration or field definitions in config.json for ${objectName}.`
    }));
    if (errorRecordsForFile.length > 0) {
      await writeErrorLog(targetAlias, objectName, 'update-config-error', errorRecordsForFile);
    }
    return summary;
  }

  const getFieldDef = (fieldName: string): SObjectFieldConfigForUpdatePass | undefined => {
    return sObjectConfig.fields.find((f) => f.apiName === fieldName);
  };

  // 3. Iterar y Transformar Registros
  const recordsToUpdateForBulk: Array<{ Id: string, [key: string]: any }> = [];
  const recordsMetadata: Array<any> = [];

  spinner.text = `[FASE 2 - UPDATE] [${objectName}] Transformando registros para actualización...`;
  logger.info(`[${objectName}] Transformando registros para actualización...`);

  for (const sourceRecord of sourceRecords) {
    summary.processed++;
    const originalSourceId = sourceRecord.Id;

    if (!originalSourceId) {
      logger.warn(`[${objectName}] El registro no tiene 'Id' de origen. Saltando. Datos: ${JSON.stringify(sourceRecord)}`);
      summary.errors++;
      errorRecordsForFile.push({
        sourceRecord: sourceRecord,
        error: "El registro de origen del CSV no tiene el campo 'Id'."
      });
      continue;
    }

    const targetId = allIdMaps[objectName]?.[originalSourceId];
    if (!targetId) {
      logger.warn(`[${objectName}] No se encontró el Id de destino para el Id de origen ${originalSourceId} (objeto ${objectName}) en los mapas de IDs. Saltando actualización para este registro.`);
      summary.errors++;
      errorRecordsForFile.push({
        sourceRecord: sourceRecord,
        error: `No se encontró el Id de destino en el mapa de IDs para el Id de origen ${originalSourceId} (objeto ${objectName}). El registro probablemente no se insertó en la Fase 1.`
      });
      continue;
    }

    const recordForUpdate: { Id: string, [key: string]: any } = { Id: targetId };
    let hasFieldsToUpdate = false;

    for (const fieldName in sourceRecord) {
      if (fieldName === 'Id') continue;

      const fieldValue = sourceRecord[fieldName];
      if (fieldValue === null || fieldValue === undefined || fieldValue === '') continue;

      const fieldDef = getFieldDef(fieldName);

      if (fieldDef && fieldDef.type === 'reference' && fieldDef.referenceTo && fieldDef.referenceTo.length > 0) {
        const referencedObjectName = fieldDef.referenceTo[0];
        const sourceLookupId = fieldValue as string;

        if (allIdMaps[referencedObjectName]) {
          const targetLookupId = allIdMaps[referencedObjectName][sourceLookupId];
          if (targetLookupId) {
            recordForUpdate[fieldName] = targetLookupId;
            hasFieldsToUpdate = true;
          } else {
            logger.warn(`[${objectName}] Registro (Id Origen ${originalSourceId}), Lookup ${fieldName} (Refiere a ${referencedObjectName}, Id Lookup Origen ${sourceLookupId}): No se encontró Id de destino en el mapa para ${referencedObjectName}. El campo no se actualizará.`);
          }
        } else {
          logger.warn(`[${objectName}] Registro (Id Origen ${originalSourceId}), Lookup ${fieldName} (Refiere a ${referencedObjectName}): Mapa de IDs para ${referencedObjectName} no cargado/disponible. El campo no se actualizará.`);
        }
      }
    }

    if (hasFieldsToUpdate) {
      recordsToUpdateForBulk.push(recordForUpdate);
      recordsMetadata.push(sourceRecord);
    } else {
      logger.info(`[${objectName}] Registro (Id Origen ${originalSourceId}, Id Destino ${targetId}) no tenía campos de lookup resolubles para actualizar en Fase 2.`);
      summary.success++;
    }
  }

  // 4. Realizar Actualización Masiva
  if (recordsToUpdateForBulk.length > 0) {
    spinner.text = `[FASE 2 - UPDATE] [${objectName}] Intentando actualización masiva para ${recordsToUpdateForBulk.length} registros...`;
    logger.info(`[${objectName}] Intentando actualización masiva para ${recordsToUpdateForBulk.length} registros...`);
    try {
      const bulkResults = await targetConn.bulk.load(objectName, 'update', recordsToUpdateForBulk);

      for (let i = 0; i < bulkResults.length; i++) {
        const result = bulkResults[i];
        const originalRecordData = recordsMetadata[i];

        if (result.success) {
          summary.success++;
        } else {
          summary.errors++;
          const errorMessage = result.errors ? (Array.isArray(result.errors) ? result.errors.join('; ') : JSON.stringify(result.errors)) : "Error desconocido";
          errorRecordsForFile.push({
            sourceRecord: originalRecordData,
            error: errorMessage
          });
          logger.error(`[${objectName}] Error actualizando registro (Id Destino ${result.id || recordsToUpdateForBulk[i].Id}): ${errorMessage}. Datos Origen: ${JSON.stringify(originalRecordData)}`);
        }
      }
      logger.info(`[${objectName}] Procesamiento de actualización masiva completado para ${recordsToUpdateForBulk.length} registros.`);
    } catch (e: any) {
      logger.error(`[${objectName}] La operación de actualización masiva falló por completo: ${e.message}`);
      summary.errors += recordsToUpdateForBulk.length;
      recordsToUpdateForBulk.forEach((rec, index) => {
        errorRecordsForFile.push({
          sourceRecord: recordsMetadata[index],
          error: `La operación masiva falló: ${e.message}`
        });
      });
    }
  } else {
    logger.info(`[${objectName}] No se requirió una actualización DML para ningún registro en la Fase 2.`);
  }

  // 5. Manejo de Errores (Registro en Archivo)
  if (errorRecordsForFile.length > 0) {
    try {
      await writeErrorLog(targetAlias, objectName, 'update-errors', errorRecordsForFile);
      logger.info(`[${objectName}] Errores de actualización escritos para ${objectName}.`);
    } catch (e: any) {
      logger.error(`[${objectName}] Fallo al escribir el log de errores de actualización: ${e.message}`);
    }
  }

  // 6. Devolver Resumen
  if (summary.errors > 0) {
    spinner.fail(`[FASE 2 - UPDATE] ${objectName}: ${summary.success} actualizados, ${chalk.red(summary.errors)} fallidos de ${summary.processed} procesados.`);
  } else {
    spinner.succeed(`[FASE 2 - UPDATE] ${objectName}: ${summary.success} actualizados, ${summary.errors} fallidos de ${summary.processed} procesados.`);
  }
  logger.info(`[${objectName}] Resumen Pasada de Actualización: Procesados: ${summary.processed}, Éxito: ${summary.success}, Errores: ${summary.errors}`);
  return summary;
}


// --- Funciones de Transformación de Datos ---

/**
 * Transforma un registro individual reemplazando los IDs de origen por IDs de destino.
 * @param record El registro a transformar (sin su campo 'Id' original).
 * @param parentIdMaps Los mapas de IDs de los objetos padre ya procesados.
 * @returns El registro transformado, listo para ser insertado.
 */
function transformRecord(record: any, parentIdMaps: { [obj: string]: IdMap }): any {
  const transformed: any = {};
  
  // Guardamos una referencia al ID de origen para poder mapear los resultados del bulk job
  // Guardamos una referencia al ID de origen para poder mapear los resultados del bulk job
  // Aseguramos que 'Id' exista y sea una cadena antes de asignarlo
  if (record.Id && typeof record.Id === 'string') {
    transformed.Legacy_Source_Id__c = record.Id;
  }

  for (const field in record) {
    if (field.endsWith('Id') && record[field]) { // Asumimos que los lookups terminan en 'Id'
        // Intentamos encontrar el objeto al que pertenece este lookup
        let found = false;
        for (const parentObject in parentIdMaps) {
            if (parentIdMaps[parentObject][record[field]]) {
                transformed[field] = parentIdMaps[parentObject][record[field]];
                found = true;
                break;
            }
        }
        if (!found) {
            // Si no se encuentra el mapeo (porque es para la fase 2), no se incluye el campo.
            // Opcionalmente, se podría loggear esto.
        }
    } else if (field !== 'Id') { // Ignoramos el campo Id del CSV
        transformed[field] = record[field];
    }
  }
  return transformed;
}


// --- Funciones de Reporte ---

/**
 * Imprime en la consola un resumen final de todo el proceso de despliegue.
 * @param summary El objeto que contiene las estadísticas de la operación.
 */
function printFinalSummary(summary: DeploymentSummary): void {
  logger.info(chalk.cyan.bold('\n--- Resumen Final del Despliegue ---'));
  const headers = ['Objeto', 'Procesados', 'Creados/Actualizados', 'Fallidos'].map(h => chalk.bold(h));
  const rows: string[][] = [];

  for (const objectName in summary) {
    const { processed, success, errors } = summary[objectName];
    rows.push([
      chalk.blue(objectName),
      processed.toString(),
      chalk.green(success.toString()),
      errors > 0 ? chalk.red(errors.toString()) : chalk.gray(errors.toString()),
    ]);
  }

  if (rows.length === 0) {
      logger.info('No se procesaron objetos en este despliegue.');
      return;
  }
  
  // Formato de tabla simple
  const colWidths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length)));
  const headerLine = headers.map((h, i) => h.padEnd(colWidths[i])).join(' | ');
  const separator = colWidths.map(w => '-'.repeat(w)).join('-|-');
  
  console.log(`\n${headerLine}`);
  console.log(separator);
  
  rows.forEach(row => {
      const rowLine = row.map((cell, i) => cell.padEnd(colWidths[i])).join(' | ');
      console.log(rowLine);
  });
  console.log('\n');
}