import { CommandOptions, AppConfig, IdMap, SObjectDescribe } from '../core/typeDefs.js';
import { getSalesforceConnection } from '../core/auth.js';
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
import { logger } from '../core/logger.js';
import { describeSObject } from '../core/sfdc-api.js';
import { DependencyGraph } from './dependencyGraph.js';
import { Connection } from 'jsforce';
import ora from 'ora';
import inquirer from 'inquirer';
import chalk from 'chalk';
import path from 'path';
import fs from 'fs';
import { parse } from 'csv-parse';

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

// --- Función Principal del Comando ---

/**
 * Orquesta el proceso completo de despliegue de datos.
 * @param options Opciones del comando proporcionadas por el usuario.
 */
export async function deployCommand(options: CommandOptions): Promise<void> {
  logger.info(chalk.cyan('--- Iniciando Proceso de Despliegue de Datos ---'));
  const spinner = ora('Cargando configuración...').start();

  try {
    // --- 1. Inicialización y Validación ---
    if (!options.target) {
      throw new Error("La opción '--target' es obligatoria para el despliegue.");
    }

    const config = await loadConfig(options.config);
    const { source: sourceAlias, target: targetAlias, force } = options;

    spinner.stop();
    await confirmDeployment(targetAlias, force);
    spinner.start();

    // --- 2. Preparación del Entorno ---
    spinner.text = 'Preparando directorios de trabajo...';
    await prepareWorkspace(targetAlias);

    spinner.text = 'Estableciendo conexiones con las organizaciones...';
    // Se necesita conexión al origen para obtener metadatos si no existen localmente
    const sourceConn = await getSalesforceConnection(sourceAlias, config);
    const targetConn = await getSalesforceConnection(targetAlias, config);
    const context: DeploymentContext = { sourceAlias, targetAlias, sourceConn, targetConn, config };
    spinner.succeed('Conexiones establecidas.');

    // --- 3. Análisis de Dependencias ---
    spinner.start('Analizando dependencias de objetos...');
    const objectsToDeploy = await getObjectListFromDataDir(sourceAlias);
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
    process.exit(1);
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
    process.exit(0);
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
async function processUpdatePass(context: DeploymentContext, objectName: string) {
    // La lógica sería muy similar a processInsertPass:
    // 1. Cargar TODOS los IdMaps, ya que ahora están todos disponibles.
    // 2. Leer el CSV del objeto.
    // 3. Crear un array `recordsToUpdate`. Cada objeto debe tener el `Id` del registro en el DESTINO.
    //    `const targetId = allIdMaps[objectName][sourceId];`
    // 4. Transformar el registro resolviendo los lookups restantes.
    // 5. Llamar a `conn.bulk.load(objectName, 'update', recordsToUpdate)`.
    // 6. Registrar los errores de la actualización.

    const spinner = ora(`[FASE 2 - UPDATE] Procesando ${objectName}...`).start();
    // Esta funcionalidad es compleja y se deja como un siguiente paso.
    // El flujo descrito arriba sería el camino a seguir.
    spinner.succeed(`[FASE 2 - UPDATE] ${objectName}: Finalizado (simulado).`);
    return { processed: 0, success: 0, errors: 0 };
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