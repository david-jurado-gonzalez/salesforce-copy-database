import { AppConfig, IdMap, SObjectDescribe, /*Field*/ } from '../core/typeDefs.js';
import { Auth } from '../core/auth.js';
import { fileManagerAPI } from '../core/fileManager.js';
// Las funciones comentadas como getOrgDataDir, etc., ahora estarían disponibles a través de fileManagerAPI
// getOrgDataDir, // Similar a esto, pero para backup-path
// getOrgMappingsDir, // Se necesitará para el idMap
// getOrgErrorsDir, // Para logs de errores
// ensureDir,
// readIdMap,
// writeIdMap,
// writeErrorLog,
// getObjectListFromDataDir, // Se necesitará adaptar para leer del backup-manifest.json
import { Logger } from '../core/logger.js';
import { describeSObject, /*listAllSObjects, determineApiForSObject*/ } from '../core/sfdc-api.js';
// import { DependencyGraph } from './dependencyGraph.js'; // Se usará el del backup
import { Connection, /*DescribeSObjectResult*/ } from 'jsforce';
import ora from 'ora';
// import inquirer from 'inquirer';
import chalk from 'chalk';
import path from 'path';
import fs from 'fs-extra'; // Usar fs-extra para asegurar existencia de funciones como readJson
import { parse } from 'csv-parse';

const logger = new Logger('RestoreCommand');
const auth = new Auth();
const DML_BATCH_SIZE = 200; // Tamaño estándar para operaciones DML en Salesforce

// --- Interfaces y Tipos Específicos para la Restauración ---

interface DmlResult {
  success: boolean;
  id?: string;
  oldId?: string;
  errors?: any[];
  originalRecord?: any;
  operationPerformed?: 'insert' | 'upsert_insert' | 'upsert_update' | 'update' | 'skipped' | 'error';
}

export interface RestoreDataParams {
  targetOrgAlias: string;
  backupPath: string;
  sobjects?: string; // Lista separada por comas
  resolveConflicts?: 'SKIP' | 'OVERWRITE';
  maxApiUsage?: number;
  dryRun?: boolean;
  noDependencyCheck?: boolean;
  externalIdField?: string;
  interactive?: boolean; // Para el modo interactivo
}

interface RestoreContext {
  targetOrgAlias: string;
  targetConn: Connection;
  backupPath: string;
  config: AppConfig;
  backupManifest: BackupManifest; // Se definirá más adelante
  idMap: { [objectName: string]: IdMap }; // Mapa de IDs en memoria
  // Otros elementos necesarios para el contexto
}

interface BackupManifestObject {
  name: string;
  path: string; // Ruta al CSV dentro del backup
  metadataPath: string; // Ruta al JSON de metadatos dentro del backup
  count: number;
  fields: string[]; // Nombres de los campos en el CSV
  // Otros campos del manifiesto si son relevantes
}

interface BackupManifest {
  sourceOrgId: string;
  timestampUtc: string;
  toolVersion: string;
  objects: BackupManifestObject[];
  // Otros campos globales del manifiesto
}

interface RestoreSummary {
  [objectName: string]: {
    readFromBackup: number;
    processed: number; // Intentos de DML
    inserted: number;
    updated: number; // Por overwrite o upsert
    skipped: number;
    errors: number;
    errorDetails?: { sourceRecord?: any, error: string, targetId?: string }[];
  };
}

/**
 * Orquesta el proceso completo de restauración de datos.
 * @param params Parámetros de la restauración.
 */
export async function restoreData(params: RestoreDataParams): Promise<void> {
  logger.info(chalk.cyan('--- Iniciando Proceso de Restauración de Datos ---'));
  const spinner = ora('Cargando configuración...').start();

  try {
    // --- 1. Validación de Parámetros y Modo Interactivo ---
    if (params.interactive || !params.targetOrgAlias || !params.backupPath) {
      spinner.stop();
      // Aquí iría la lógica para el modo interactivo si se activa
      // Por ahora, asumimos que los parámetros obligatorios vienen o se lanzará error
      if (!params.targetOrgAlias || !params.backupPath) {
        // TODO: Implementar modo interactivo o mejorar este mensaje
        logger.warn('Modo interactivo aún no implementado. Proporcione --target-org y --backup-path.');
        throw new Error('Parámetros obligatorios faltantes y modo interactivo no disponible.');
      }
    }

    const {
      targetOrgAlias,
      backupPath,
      sobjects,
      resolveConflicts = 'SKIP',
      maxApiUsage = 70,
      dryRun = false,
      noDependencyCheck = false,
      externalIdField,
    } = params;

    spinner.text = 'Validando parámetros...';
    if (!fs.existsSync(backupPath)) {
      throw new Error(`La ruta del backup especificada no existe: ${backupPath}`);
    }
    const backupManifestPath = path.join(backupPath, 'backup-manifest.json');
    if (!fs.existsSync(backupManifestPath)) {
      throw new Error(`No se encontró backup-manifest.json en la ruta del backup: ${backupManifestPath}`);
    }
    // Validar maxApiUsage
    if (maxApiUsage < 1 || maxApiUsage > 100) {
        throw new Error('El valor de --max-api-usage debe estar entre 1 y 100.');
    }

    spinner.succeed('Parámetros validados.');
    spinner.start();

    // --- 2. Preparación del Entorno y Conexión ---
    const config = await fileManagerAPI.loadConfig('./config.json'); // Cargar config.json por defecto
    
    spinner.text = `Estableciendo conexión con la organización destino: ${targetOrgAlias}...`;
    const targetConn = await auth.getSalesforceConnection(targetOrgAlias, config);
    spinner.succeed(`Conexión establecida con ${targetOrgAlias}.`);

    // --- 3. Lectura del Manifiesto del Backup ---
    spinner.text = 'Leyendo manifiesto del backup...';
    const backupManifest: BackupManifest = await fs.readJson(backupManifestPath);
    spinner.succeed(`Manifiesto leído. Backup de la org ${backupManifest.sourceOrgId} del ${backupManifest.timestampUtc}.`);

    const context: RestoreContext = {
      targetOrgAlias,
      targetConn,
      backupPath,
      config,
      backupManifest,
      idMap: {},
    };

    // --- 4. Determinación de SObjects a Procesar y Orden ---
    spinner.text = 'Determinando SObjects a procesar y orden...';
    let objectsToProcessOrdered: BackupManifestObject[] = [];
    let sObjectNamesToProcess: string[] = [];

    if (sobjects) {
      sObjectNamesToProcess = sobjects.split(',').map(s => s.trim());
      // Filtrar y mantener el orden del manifiesto si no hay --no-dependency-check
    } else {
      sObjectNamesToProcess = backupManifest.objects.map(obj => obj.name);
    }
    
    // Validar que los SObjects solicitados existen en el manifiesto
    for (const requestedName of sObjectNamesToProcess) {
        if (!backupManifest.objects.find(bmObj => bmObj.name === requestedName)) {
            throw new Error(`El SObject '${requestedName}' solicitado no se encuentra en el manifiesto del backup.`);
        }
    }

    if (noDependencyCheck) {
      logger.warn(chalk.yellow('Se omitirá la comprobación de dependencias. Los SObjects se procesarán en el orden proporcionado o el del manifiesto.'));
      objectsToProcessOrdered = backupManifest.objects.filter(obj => sObjectNamesToProcess.includes(obj.name));
      // Si se especificó --sobjects, respetar ese orden
      if (sobjects) {
        objectsToProcessOrdered.sort((a, b) => {
            const indexA = sObjectNamesToProcess.indexOf(a.name);
            const indexB = sObjectNamesToProcess.indexOf(b.name);
            return indexA - indexB;
        });
      }
    } else {
      const dependencyGraphPath = path.join(backupPath, 'dependencies', 'dependency-graph.json');
      if (!fs.existsSync(dependencyGraphPath)) {
        throw new Error(`El archivo dependency-graph.json no se encontró en ${path.join(backupPath, 'dependencies')}. Necesario para el orden de restauración.`);
      }
      const dependencyGraph = await fs.readJson(dependencyGraphPath);
      // TODO: Lógica para usar el dependencyGraph y sObjectNamesToProcess para determinar objectsToProcessOrdered
      // Por ahora, una simplificación: tomar los objetos del manifiesto que están en sObjectNamesToProcess y ordenarlos según el grafo.
      // Esta parte necesita una implementación más robusta del DependencyGraph similar a la de deployCommand o una adaptación.
      // Placeholder:
      // const sortedNamesFromGraph = sortObjectsByDependency(sObjectNamesToProcess, dependencyGraph.dependencies); // Esta función necesita ser implementada
      // objectsToProcessOrdered = sortedNamesFromGraph.map(name => backupManifest.objects.find(bmObj => bmObj.name === name)).filter(obj => obj !== undefined) as BackupManifestObject[];
      
      const sortResult = sortObjectsByDependency(sObjectNamesToProcess, dependencyGraph.dependencies);
      
      if (sortResult.cycles.length > 0) {
        // Los ciclos ya se loguean dentro de sortObjectsByDependency con un logger.warn
        // Aquí podríamos decidir si detener el proceso o continuar con el orden parcial.
        // Por ahora, continuamos con el orden parcial, que es el comportamiento anterior implícito.
        logger.info(`[Restore] Continuando con la restauración a pesar de los ciclos detectados. El orden para los objetos en ciclo (${sortResult.cycles.join(', ')}) y sus dependientes puede no ser óptimo.`);
      }
      objectsToProcessOrdered = sortResult.order.map(name => backupManifest.objects.find(bmObj => bmObj.name === name)).filter(obj => obj !== undefined) as BackupManifestObject[];

    }
    
    if (objectsToProcessOrdered.length === 0 && sObjectNamesToProcess.length > 0) { // Modificada la condición para ser más precisos
        spinner.warn('No hay SObjects para procesar después de la ordenación (posiblemente todos en ciclos no resueltos o no encontrados en el manifiesto).');
        // Si sObjectNamesToProcess estaba vacío, el mensaje anterior de "No hay SObjects para procesar" (línea 205 original) ya se habría mostrado.
        // Este caso es si teníamos nombres para procesar, pero el resultado ordenado está vacío.
        return;
    } else if (objectsToProcessOrdered.length === 0 && sObjectNamesToProcess.length === 0) {
        spinner.warn('No hay SObjects para procesar según los parámetros y el manifiesto.');
        return;
    }
    spinner.succeed(`SObjects a restaurar (ordenados): ${objectsToProcessOrdered.map(o => o.name).join(', ')}`);

    // --- 5. Procesamiento por SObject ---
    const summary: RestoreSummary = {};

    for (const sObjectToRestore of objectsToProcessOrdered) {
      const objectName = sObjectToRestore.name;
      logger.info(chalk.blue(`\n--- Procesando SObject: ${objectName} ---`));
      summary[objectName] = { readFromBackup: 0, processed: 0, inserted: 0, updated: 0, skipped: 0, errors: 0, errorDetails: [] };

      let sObjectMetadata: SObjectDescribe; // Cambiado de DescribeSObjectResult a SObjectDescribe
      try {
        spinner.start(`[${objectName}] Obteniendo metadatos desde ${targetOrgAlias}...`);
        sObjectMetadata = await describeSObject(context.targetConn, objectName);
        spinner.succeed(`[${objectName}] Metadatos obtenidos.`);
      } catch (err) {
        logger.error(`[${objectName}] Error al obtener metadatos: ${(err as Error).message}`);
        summary[objectName].errors++;
        summary[objectName].errorDetails?.push({ error: `Error al obtener metadatos: ${(err as Error).message}` });
        spinner.fail(`[${objectName}] Error al obtener metadatos.`);
        continue; // Saltar al siguiente SObject si no se pueden obtener los metadatos
      }
      
      // a. Lectura de Datos CSV del backup (ya implementado abajo)
      // b. Preparación de Registros (mapeo de IDs, exclusión de campos)
      // c. Operaciones DML (insert/upsert/update) en lotes
      // d. Manejo de Errores por Lote
      // e. Actualización del idMap en memoria

      // Placeholder para la lógica de procesamiento
      spinner.start(`[${objectName}] Leyendo datos desde ${sObjectToRestore.path}...`);
      const csvFilePath = path.join(backupPath, sObjectToRestore.path);
      if (!fs.existsSync(csvFilePath)) {
          logger.error(`[${objectName}] Archivo CSV no encontrado: ${csvFilePath}`);
          summary[objectName].errors++;
          summary[objectName].errorDetails?.push({error: `Archivo CSV no encontrado: ${csvFilePath}`});
          spinner.fail(`[${objectName}] Archivo CSV no encontrado.`);
          continue;
      }
      
      // Leer CSV (simplificado, se necesita parseo real y manejo de lotes)
      const fileContent = await fs.readFile(csvFilePath, 'utf8');
      const recordsFromCsv = await new Promise<any[]>((resolve, reject) => {
        parse(fileContent, { columns: true, skip_empty_lines: true }, (err, records) => {
            if (err) reject(err);
            else resolve(records);
        });
      });
      summary[objectName].readFromBackup = recordsFromCsv.length;
      spinner.succeed(`[${objectName}] ${recordsFromCsv.length} registros leídos de ${sObjectToRestore.path}.`);

      if (recordsFromCsv.length === 0) {
        logger.info(`[${objectName}] No hay registros para procesar.`);
        continue;
      }

      spinner.start(`[${objectName}] Preparando ${recordsFromCsv.length} registros para DML...`);
      const preparedRecords = prepareRecordsForDml(
        recordsFromCsv,
        sObjectMetadata,
        context,
        objectName,
        resolveConflicts,
        externalIdField
      );
      spinner.succeed(`[${objectName}] ${preparedRecords.length} registros preparados.`);

      summary[objectName].processed = preparedRecords.length;

      if (preparedRecords.length > 0) {
        for (let i = 0; i < preparedRecords.length; i += DML_BATCH_SIZE) {
          const batch = preparedRecords.slice(i, i + DML_BATCH_SIZE);
          spinner.start(`[${objectName}] Procesando lote DML ${Math.floor(i / DML_BATCH_SIZE) + 1}/${Math.ceil(preparedRecords.length / DML_BATCH_SIZE)} (${batch.length} registros)...`);

          if (dryRun) {
            logger.info(`[${objectName}] (Dry Run) Lote de ${batch.length} registros sería procesado.`);
            summary[objectName].skipped += batch.length;
            // En dry run, simular que todos los oldId se mapearían a un "DRY_RUN_ID_<oldId>"
            const dryRunResults: DmlResult[] = batch.map(record => ({
                success: true,
                id: `DRY_RUN_ID_${record.__OldId__ || 'NEW'}`, // Simular un nuevo ID
                oldId: record.__OldId__,
                originalRecord: record
            }));
            updateIdMapAfterDml(dryRunResults, context, objectName); // Actualizar idMap incluso en dry-run para dependencias
            spinner.succeed(`[${objectName}] (Dry Run) Lote procesado (simulado).`);
          } else {
            const dmlResults = await performDmlOperationBatch(
              batch,
              context,
              objectName,
              externalIdField,
              resolveConflicts,
              dryRun
            );

            updateIdMapAfterDml(dmlResults, context, objectName);

            dmlResults.forEach(result => {
              switch (result.operationPerformed) {
                case 'insert':
                case 'upsert_insert':
                  summary[objectName].inserted++;
                  break;
                case 'update':
                case 'upsert_update':
                  summary[objectName].updated++;
                  break;
                case 'skipped': // Aunque 'skipped' se maneja principalmente en dryRun, lo incluimos por completitud
                  summary[objectName].skipped++;
                  break;
                case 'error':
                  summary[objectName].errors++;
                  summary[objectName].errorDetails?.push({
                    sourceRecord: result.originalRecord,
                    // El error ya debería estar formateado en DmlResult si viene de un error de lote
                    // o ser el array de errores de jsforce.
                    error: Array.isArray(result.errors) ? result.errors.map(e => `${e.message} (Campos: ${e.fields?.join(', ') || 'N/A'})`).join('; ') : (result.errors as any)?.message || 'Error desconocido en DML',
                    targetId: result.id
                  });
                  break;
                default:
                  // Si operationPerformed es undefined o un valor inesperado, y success es false, contar como error.
                  if (!result.success) {
                    summary[objectName].errors++;
                    summary[objectName].errorDetails?.push({
                      sourceRecord: result.originalRecord,
                      error: 'Operación DML fallida sin un operationPerformed claro.',
                      targetId: result.id
                    });
                  }
                  // Si es success pero operationPerformed es inesperado, podría ser un caso no manejado.
                  // Por ahora, no se cuenta explícitamente en otra categoría si es success.
                  break;
              }
            });
            spinner.succeed(`[${objectName}] Lote DML procesado.`);
          }
        }
      } else {
          logger.info(`[${objectName}] No hay registros preparados para DML.`);
      }

      logger.info(chalk.green(`[${objectName}] Restauración (simulada) completada: ${summary[objectName].inserted} insertados, ${summary[objectName].updated} actualizados, ${summary[objectName].skipped} omitidos, ${summary[objectName].errors} errores.`));
    }

    // --- 6. Generación de Informes y Logs ---
    spinner.stop();
    printFinalSummary(summary, dryRun);
    // TODO: Escribir log detallado a archivo

    logger.info(chalk.cyan('--- Proceso de Restauración Finalizado ---'));

  } catch (error) {
    spinner.fail('La restauración ha fallado.');
    logger.error(chalk.red((error as Error).message));
    // logger.debug((error as Error).stack); // Para depuración
    // No relanzar para que el CLI pueda terminar limpiamente
  }
}

/**
 * Imprime en la consola un resumen final de todo el proceso de restauración.
 * @param summary El objeto que contiene las estadísticas de la operación.
 * @param dryRun Indica si fue una ejecución de simulación.
 */
function printFinalSummary(summary: RestoreSummary, dryRun: boolean): void {
  logger.info(chalk.cyan.bold(`\n--- Resumen Final de la Restauración ${dryRun ? '(SIMULACIÓN)' : ''} ---`));
  const headers = ['Objeto', 'Leídos', 'Procesados', 'Insertados', 'Actualizados', 'Omitidos', 'Fallidos'].map(h => chalk.bold(h));
  const rows: string[][] = [];
  let totalErrors = 0;

  for (const objectName in summary) {
    const { readFromBackup, processed, inserted, updated, skipped, errors } = summary[objectName];
    totalErrors += errors;
    rows.push([
      chalk.blue(objectName),
      readFromBackup.toString(),
      processed.toString(),
      chalk.green(inserted.toString()),
      chalk.yellow(updated.toString()),
      skipped.toString(),
      errors > 0 ? chalk.red(errors.toString()) : chalk.gray(errors.toString()),
    ]);
  }

  if (rows.length === 0) {
      logger.info('No se procesaron objetos en esta restauración.');
      return;
  }
  
  // Formato de tabla simple
  const colWidths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => r[i]?.length || 0)));
  const headerLine = headers.map((h, i) => h.padEnd(colWidths[i])).join(' | ');
  const separator = colWidths.map(w => '-'.repeat(w)).join('-|-');
  
  console.log(`\n${headerLine}`);
  console.log(separator);
  
  rows.forEach(row => {
      const rowLine = row.map((cell, i) => cell.padEnd(colWidths[i])).join(' | ');
      console.log(rowLine);
  });
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFileName = `restore-${timestamp}.log`;
  logger.info(`\nInforme detallado (a implementar) en: ${logFileName}`);

  if (totalErrors > 0 && !dryRun) {
    logger.warn(chalk.yellow(`\nADVERTENCIA: Se encontraron ${totalErrors} errores durante la restauración. Revise el log para más detalles.`));
  } else if (dryRun) {
    logger.info(chalk.blue('\nModo simulación (dry-run) completado. No se realizaron cambios en la organización destino.'));
  } else {
    logger.info(chalk.green('\nRestauración completada exitosamente (o sin errores reportados).'));
  }
  console.log('\n');
}

/**
 * Ordena los SObjects según sus dependencias utilizando el algoritmo de Kahn para ordenamiento topológico.
 * @param objectNames Nombres de los SObjects a ordenar (deben estar todos presentes en las claves o valores de `dependencies` si son relevantes para el grafo).
 * @param dependencies Un objeto donde cada clave es un SObject y su valor es un array de SObjects de los que depende directamente (padres).
 *                   Ejemplo: { "Contact": ["Account"], "Opportunity": ["Account", "Contact"] }
 * @returns Un objeto con `order` (array de nombres de SObjects ordenados) y `cycles` (array de nombres de SObjects involucrados en ciclos).
 */
function sortObjectsByDependency(
  objectNames: string[],
  dependencies: { [key: string]: string[] } // child -> array of parents
): { order: string[]; cycles: string[] } {
  const G: { [key: string]: string[] } = {}; // Adjacency list: parent -> children
  const inDegree: { [key: string]: number } = {}; // child -> number of parents it depends on (within objectNames)
  const order: string[] = [];
  const queue: string[] = [];

  // Initialize G and inDegree for all relevant objectNames
  objectNames.forEach(name => {
    G[name] = [];
    inDegree[name] = 0;
  });

  // Build graph G (parent -> children) and calculate initial in-degrees for children
  objectNames.forEach(child => {
    const parents = dependencies[child] || []; // Get parents of the current child
    parents.forEach(parent => {
      if (objectNames.includes(parent)) { // Ensure parent is also in the scope of objects to be processed
        // If G[parent] was not initialized because 'parent' was not in the initial objectNames iteration (e.g. only a dependency)
        // This case should ideally not happen if objectNames includes all nodes participating in the graph.
        // However, to be safe:
        if (!G[parent]) G[parent] = [];
        
        G[parent].push(child); // Add child to parent's list of children
        inDegree[child]++;     // Increment in-degree of the child
      }
    });
  });

  // Enqueue nodes with in-degree 0
  objectNames.forEach(name => {
    if (inDegree[name] === 0) {
      queue.push(name);
    }
  });

  // Kahn's algorithm
  while (queue.length > 0) {
    const u = queue.shift()!; // u is a node with no remaining dependencies among objectNames
    order.push(u);

    (G[u] || []).forEach(v_child => { // For each child v_child that depends on u
      inDegree[v_child]--;
      if (inDegree[v_child] === 0) {
        queue.push(v_child);
      }
    });
  }

  if (order.length < objectNames.length) {
    const cycleNodes = objectNames.filter(name => !order.includes(name));
    logger.warn(`[Restore Sort] Se detectó un ciclo de dependencias o algunas dependencias no se pudieron resolver. Objetos involucrados: ${cycleNodes.join(', ')}. El orden de restauración puede ser incorrecto para estos objetos y sus dependientes.`);
    return { order, cycles: cycleNodes }; // Return partial order and cycle nodes
  }

  logger.debug('[Restore Sort] Ordenación topológica completada sin ciclos detectados.');
  return { order, cycles: [] }; // No cycles
}

/**
 * Prepara los registros leídos del CSV para operaciones DML.
 * - Mapea IDs de campos de referencia.
 * - Filtra campos no escribibles.
 * - Prepara el payload para insert/update/upsert.
 * @param recordsFromCsv Registros crudos del archivo CSV.
 * @param sObjectMetadata Metadatos del SObject de la organización destino.
 * @param context Contexto de la restauración (incluye idMap).
 * @param objectName Nombre del SObject actual.
 * @param resolveConflicts Estrategia de resolución de conflictos.
 * @param externalIdField Campo de ID externo (opcional).
 * @returns Array de registros listos para DML.
 */
function prepareRecordsForDml(
  recordsFromCsv: any[],
  sObjectMetadata: SObjectDescribe,
  context: RestoreContext,
  objectName: string,
  resolveConflicts: 'SKIP' | 'OVERWRITE',
  externalIdField?: string
): any[] {
  const preparedDmlRecords: any[] = [];
  const { idMap } = context;
  const fieldsMap = new Map(sObjectMetadata.fields.map(f => [f.name.toLowerCase(), f]));

  for (const rawRecord of recordsFromCsv) {
    const dmlRecord: { [key: string]: any } = {};
    const oldRecordId = rawRecord['Id'] || rawRecord['id']; // CSV 'Id' es el OldId original

    let currentOperationType: 'insert' | 'update' | 'upsert';

    if (externalIdField) {
      currentOperationType = 'upsert';
    } else if (resolveConflicts === 'OVERWRITE') {
      currentOperationType = 'update';
    } else {
      currentOperationType = 'insert';
    }

    for (const csvFieldName of Object.keys(rawRecord)) {
      const csvValue = rawRecord[csvFieldName];
      const fieldNameLower = csvFieldName.toLowerCase();
      const fieldMetadata = fieldsMap.get(fieldNameLower);

      if (!fieldMetadata) {
        // logger.warn(`[${objectName}] Campo '${csvFieldName}' del CSV no encontrado en metadatos. Se omitirá.`);
        continue;
      }

      // Lógica de omisión de campos basada en el tipo de operación
      if (currentOperationType === 'insert') {
        if (fieldNameLower === 'id') continue; // No incluir 'Id' del CSV en inserts
        if (!fieldMetadata.createable) continue;
      } else if (currentOperationType === 'update') {
        // Para 'update', el campo 'Id' del CSV *es* el Id de Salesforce del registro a actualizar.
        // No se omite aquí, se asigna directamente.
        if (fieldNameLower !== 'id' && !fieldMetadata.updateable) continue;
      } else { // upsert
        // Para 'upsert', no incluimos 'Id' del CSV a menos que sea el externalIdField.
        // Salesforce maneja el Id. El externalIdField sí debe estar.
        if (fieldNameLower === 'id' && fieldMetadata.name !== externalIdField) continue;
        // Para upsert, los campos deben ser createable (si inserta) o updateable (si actualiza).
        // jsforce/Salesforce maneja esto, pero no está mal filtrar por si acaso.
        // Si no es createable NI updateable (y no es el ID externo), se podría omitir.
        // Por ahora, se pasan y se confía en SF, excepto el 'Id' que no sea el extId.
        if (!fieldMetadata.createable && !fieldMetadata.updateable && fieldMetadata.name !== externalIdField) {
            // logger.debug(`[${objectName}] Campo '${fieldMetadata.name}' no es createable ni updateable (y no es extId). Omitiendo para upsert.`);
            continue;
        }
      }
      
      // Asignación y transformación de valores
      if (fieldMetadata.type === 'reference' && csvValue) {
        const referencedSObjectNames = fieldMetadata.referenceTo;
        if (referencedSObjectNames && referencedSObjectNames.length > 0) {
          // Intentar encontrar el ID mapeado para cualquiera de los SObjects referenciados
          // (generalmente es uno solo, pero 'referenceTo' es un array)
          let mappedId: string | undefined = undefined;
          for (const refObjName of referencedSObjectNames) {
            mappedId = idMap[refObjName]?.[csvValue as string];
            if (mappedId) break;
          }

          if (mappedId) {
            dmlRecord[fieldMetadata.name] = mappedId;
          } else {
            // ID no encontrado en el mapa. Podría ser un problema.
            // Por ahora, si el campo es nillable, lo omitimos o ponemos null. Si no, se registrará error en DML.
            if (fieldMetadata.nillable) {
              dmlRecord[fieldMetadata.name] = null;
              // logger.warn(`[${objectName}] ID de referencia '${csvValue}' para el campo '${fieldMetadata.name}' no encontrado en idMap. Se establecerá a null.`);
            } else {
              // logger.warn(`[${objectName}] ID de referencia '${csvValue}' para el campo '${fieldMetadata.name}' no encontrado en idMap. El campo no es nillable, puede causar error DML.`);
              // Se podría optar por no incluir el campo, o dejar que Salesforce falle.
              // Por ahora, lo incluimos tal cual, Salesforce decidirá.
              dmlRecord[fieldMetadata.name] = csvValue; // Esto probablemente causará un error DML si el ID no existe en target.
            }
          }
        } else {
          dmlRecord[fieldMetadata.name] = csvValue; // Campo de referencia sin metadata 'referenceTo'? Improbable.
        }
      } else if (fieldMetadata.type === 'boolean' && csvValue !== null && csvValue !== undefined) {
        const lowerCsvValue = String(csvValue).toLowerCase();
        if (lowerCsvValue === 'true' || lowerCsvValue === '1' || lowerCsvValue === 'yes') {
          dmlRecord[fieldMetadata.name] = true;
        } else if (lowerCsvValue === 'false' || lowerCsvValue === '0' || lowerCsvValue === 'no') {
          dmlRecord[fieldMetadata.name] = false;
        } else {
          dmlRecord[fieldMetadata.name] = null; // O manejar como error si no es nillable
        }
      }
      // TODO: Añadir más coerciones de tipo (Date, DateTime, Number) si es necesario.
      // Salesforce suele ser flexible con strings si el formato es correcto.
      else {
        // Para campos de tipo 'date', 'datetime', 'double', 'int', etc.,
        // Salesforce es generalmente tolerante con strings si el formato es correcto.
        // El parseo de CSV ya debería haber manejado tipos básicos si no son strings.
        // Dejar valores vacíos como null si el campo es nillable.
        dmlRecord[fieldMetadata.name] = (csvValue === '' || csvValue === undefined) && fieldMetadata.nillable ? null : csvValue;
      }
    }
    
    // Asegurar que el externalIdField esté presente en el dmlRecord para upserts
    if (currentOperationType === 'upsert' && externalIdField) {
        if (!dmlRecord.hasOwnProperty(externalIdField) && rawRecord.hasOwnProperty(externalIdField)) {
            // Si no se mapeó por alguna razón (ej. el nombre del campo en CSV tiene casing diferente pero es el mismo campo)
            // y estaba en el rawRecord, lo añadimos.
            // Esto asume que el externalIdField en sí mismo es un campo válido en el SObject.
            const extIdFieldMeta = fieldsMap.get(externalIdField.toLowerCase());
            if (extIdFieldMeta) {
                 dmlRecord[extIdFieldMeta.name] = rawRecord[externalIdField];
            } else {
                logger.warn(`[${objectName}] El campo de ID externo '${externalIdField}' definido no existe en los metadatos del SObject. El upsert podría fallar.`);
            }
        }
        if (!dmlRecord.hasOwnProperty(externalIdField) && !rawRecord.hasOwnProperty(externalIdField)) {
             logger.warn(`[${objectName}] Registro no contiene el campo de ID externo '${externalIdField}'. Se omitirá o el upsert podría fallar.`);
             // Considerar si continuar o no con este registro. Por ahora, se continúa.
        }
    }

    // Para 'update', asegurar que el campo 'Id' esté presente.
    if (currentOperationType === 'update' && !dmlRecord.hasOwnProperty('Id')) {
        logger.warn(`[${objectName}] Registro preparado para update no contiene el campo 'Id'. La operación de actualización probablemente fallará. OldId: ${oldRecordId}`);
        // Podríamos optar por no añadir este registro a preparedDmlRecords si falta el Id.
        // Por ahora, se deja pasar y fallará en Salesforce.
    }


    if (Object.keys(dmlRecord).length > 0 || (currentOperationType === 'update' && dmlRecord.hasOwnProperty('Id'))) {
        // Incluir incluso si solo tiene 'Id' para el caso de 'update' (aunque sería un update vacío).
        if (oldRecordId) {
            dmlRecord['__OldId__'] = oldRecordId;
        }
        preparedDmlRecords.push(dmlRecord);
    } else if (Object.keys(dmlRecord).length === 0 && currentOperationType !== 'update') {
        // logger.info(`[${objectName}] Registro con OldId ${oldRecordId} resultó en un objeto DML vacío después de la preparación y filtrado de campos. Se omitirá.`);
    }
  }
  return preparedDmlRecords;
}

async function performDmlOperationBatch(
  batch: any[],
  context: RestoreContext,
  objectName: string,
  externalIdField: string | undefined,
  resolveConflicts: 'SKIP' | 'OVERWRITE',
  dryRun: boolean
): Promise<DmlResult[]> {
  const { targetConn } = context;
  const results: DmlResult[] = [];

  if (dryRun) {
    logger.info(`[${objectName}] (Dry Run) Simulación de operación DML para ${batch.length} registros.`);
    return batch.map(record => ({
      success: true,
      id: `DRY_RUN_ID_${record.__OldId__ || `NEW_DRY_RUN_${Math.random().toString(36).substring(2, 9)}`}`,
      oldId: record.__OldId__,
      originalRecord: record,
      operationPerformed: 'skipped'
    }));
  }

  // Preparamos los registros eliminando __OldId__ y cualquier otro campo interno que no deba ir a Salesforce
  const recordsToProcess = batch.map(r => {
    const { __OldId__, ...recordData } = r; // Eliminar __OldId__ antes de enviar a SF
    return recordData;
  });

  let operationType: 'insert' | 'update' | 'upsert';

  if (externalIdField) {
    operationType = 'upsert';
  } else if (resolveConflicts === 'OVERWRITE') {
    // Si no hay externalIdField pero resolveConflicts es OVERWRITE, intentamos un update.
    // Se asume que prepareRecordsForDml ha preparado los registros con el 'Id' de Salesforce correcto para la actualización.
    operationType = 'update';
  } else {
    // Por defecto, o si es SKIP sin externalIdField, es un insert.
    operationType = 'insert';
  }
  
  logger.info(`[${objectName}] Ejecutando operación DML: ${operationType} para ${recordsToProcess.length} registros.`);

  try {
    if (recordsToProcess.length === 0) return [];

    let sfResults: any | any[]; // Puede ser un solo objeto o un array

    if (operationType === 'insert') {
      // @ts-ignore jsforce types can be tricky with array results vs single.
      sfResults = await targetConn.sobject(objectName).insert(recordsToProcess, { allOrNone: false, allowRecursive: true });
    } else if (operationType === 'upsert') {
      // externalIdField no puede ser undefined aquí debido a la lógica anterior.
      if (!externalIdField) {
          throw new Error(`[${objectName}] externalIdField es requerido para la operación upsert pero no fue provisto (error lógico).`);
      }
      // @ts-ignore
      sfResults = await targetConn.sobject(objectName).upsert(recordsToProcess, externalIdField, { allOrNone: false, allowRecursive: true });
    } else if (operationType === 'update') {
      // Se asume que recordsToProcess incluye el campo 'Id' con el ID de Salesforce del registro a actualizar.
      // @ts-ignore
      sfResults = await targetConn.sobject(objectName).update(recordsToProcess, { allOrNone: false, allowRecursive: true });
    } else {
        // Esto no debería alcanzarse si la lógica de operationType es exhaustiva.
        throw new Error(`[${objectName}] Tipo de operación DML desconocida o no soportada: ${operationType}`);
    }

    // Asegurarse de que sfResults es siempre un array para un procesamiento uniforme
    const jsforceResults = Array.isArray(sfResults) ? sfResults : [sfResults];

    for (let i = 0; i < jsforceResults.length; i++) {
      const sfResult = jsforceResults[i];
      const originalRecordWithOldId = batch[i]; // Para recuperar __OldId__ y el registro original
      let opPerf: DmlResult['operationPerformed'] = 'error'; // Por defecto 'error'

      if (sfResult.success) {
        if (operationType === 'insert') {
          opPerf = 'insert';
        } else if (operationType === 'update') {
          opPerf = 'update';
        } else if (operationType === 'upsert') {
          // sfResult para upsert individual tiene una propiedad 'created'
          opPerf = sfResult.created ? 'upsert_insert' : 'upsert_update';
        }
      } else {
        opPerf = 'error'; // Si sfResult.success es false
      }
      
      results.push({
        success: sfResult.success,
        id: sfResult.success ? sfResult.id : undefined,
        oldId: originalRecordWithOldId.__OldId__,
        errors: sfResult.success ? [] : sfResult.errors,
        originalRecord: originalRecordWithOldId,
        operationPerformed: opPerf
      });
    }
  } catch (error: any) {
    logger.error(`[${objectName}] Error en lote DML (${operationType}): ${error.message}`);
    // Si todo el lote falla, marcar todos los registros del lote como fallidos
    return batch.map(record => ({
      success: false,
      oldId: record.__OldId__,
      errors: [{ message: `Error de lote DML: ${error.message}`, statusCode: (error as any).errorCode || 'UNKNOWN_ERROR', fields: (error as any).fields || [] }],
      originalRecord: record,
      operationPerformed: 'error'
    }));
  }
  return results;
}

/**
 * Actualiza el idMap en memoria con los resultados de las operaciones DML.
 * @param dmlResults Resultados de las operaciones DML.
 * @param context Contexto de la restauración (para acceder y modificar idMap).
 * @param objectName Nombre del SObject actual.
 */
function updateIdMapAfterDml(
  dmlResults: DmlResult[],
  context: RestoreContext,
  objectName: string
): void {
  if (!context.idMap[objectName]) {
    context.idMap[objectName] = {};
  }

  for (const result of dmlResults) {
    if (result.success && result.id && result.oldId) {
      context.idMap[objectName][result.oldId] = result.id;
      // logger.debug(`[${objectName}] Mapeado OldId ${result.oldId} -> NewId ${result.id}`);
    }
  }
}

// TODO: Implementar handleInteractiveMode(...)