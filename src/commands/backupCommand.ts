// src/commands/backupCommand.ts
import { Auth } from '../core/auth.js';
import { loadConfig, ensureDir, writeRecordsToCsv } from '../core/fileManager.js'; // Removido getRelativePath
import { Logger } from '../core/logger.js';
import { extractDataBulk, extractDataQuery, extractSObjectNameFromSoql, describeSObject } from '../core/sfdc-api.js'; // Removido SObjectDescribe y Field
import { SObjectDescribe, Field as SObjectField } from '../core/typeDefs.js'; // Añadido import directo de tipos
import { AliasManagerService } from '../core/aliasManagerService.js';
import ora, { Ora } from 'ora';
import path from 'path';
import { promises as fs } from 'fs';
import { Connection } from 'jsforce';

const logger = new Logger('BackupCommand');
const auth = new Auth();
const aliasManagerService = new AliasManagerService();

// Placeholder para obtener todos los SObjects consultables
async function getAllSObjectNames(conn: Connection, spinner: Ora): Promise<string[]> {
  spinner.text = 'Obteniendo lista de todos los SObjects recuperables...';
  logger.info('Obteniendo lista de todos los SObjects recuperables...');
  try {
    const describeGlobalResult = await conn.describeGlobal();
    const sObjectNames = describeGlobalResult.sobjects
      .filter(s => s.queryable && s.retrieveable) // Considerar solo los que se pueden consultar y recuperar
      .map(s => s.name);
    spinner.succeed(`Se encontraron ${sObjectNames.length} SObjects recuperables.`);
    logger.info(`SObjects recuperables encontrados: ${sObjectNames.length}`);
    return sObjectNames;
  } catch (error) {
    const errMsg = `Error al obtener la lista de SObjects globales: ${(error as Error).message}`;
    spinner.fail(errMsg);
    logger.error(errMsg);
    throw error;
  }
}

// Placeholder functions - these would need proper implementation
async function generateAndSaveDependencyGraph(
  allSObjectDescribes: Map<string, SObjectDescribe>,
  backupDir: string,
  spinner: Ora // Añadido spinner para feedback
): Promise<void> {
  spinner.text = 'Generando grafo de dependencias...';
  logger.info('Iniciando generación de grafo de dependencias...');

  const dependencyGraphJson: Record<string, string[]> = {};
  const objectsInScope = new Set(allSObjectDescribes.keys());

  allSObjectDescribes.forEach((describe, objectName) => {
    const objectDependencies = new Set<string>();
    describe.fields.forEach(field => {
      if (field.type === 'reference' && field.referenceTo && field.referenceTo.length > 0) {
        field.referenceTo.forEach(relatedObjectName => {
          if (objectsInScope.has(relatedObjectName)) {
            objectDependencies.add(relatedObjectName);
          }
        });
      }
    });

    if (objectDependencies.size > 0) {
      // Ordenar para consistencia en el archivo JSON
      dependencyGraphJson[objectName] = Array.from(objectDependencies).sort();
    }
  });

  try {
    const depDir = path.join(backupDir, 'dependencies');
    // ensureDir para depDir ya se hace al inicio de backupData si !noDependencyGraph
    const filePath = path.join(depDir, 'dependency-graph.json');
    await fs.writeFile(filePath, JSON.stringify(dependencyGraphJson, null, 2));
    spinner.succeed('Grafo de dependencias guardado.');
    logger.info(`Grafo de dependencias guardado en: ${filePath}`);
  } catch (error) {
    const errMsg = `Error al guardar el grafo de dependencias: ${(error as Error).message}`;
    spinner.fail(errMsg);
    logger.error(errMsg);
    // Relanzar para que el bloque catch en backupData lo maneje y actualice el manifest.
    throw error;
  }
}

async function getToolVersion(): Promise<string> {
  // Idealmente, leer desde package.json
  try {
    // Asumiendo que package.json está en la raíz del proyecto desde donde se ejecuta el comando
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(packageJsonContent);
    return packageJson.version || 'unknown';
  } catch (error) {
    logger.warn(`No se pudo leer la versión de package.json (${(error as Error).message}), usando "unknown".`);
    return 'unknown';
  }
}

// Helper para obtener el nombre principal de un SObject (ej. 'Name' para Account, 'Username' para User)
// Esto es una simplificación; una implementación robusta podría necesitar describir el objeto o tener mapeos.
function getPrimaryNameFieldForSObject(sObjectName: string): string {
    if (sObjectName.toLowerCase() === 'user') return 'Username';
    if (sObjectName.toLowerCase() === 'case') return 'CaseNumber';
    if (sObjectName.toLowerCase() === 'contentversion') return 'Title';
    // Añadir más mapeos según sea necesario
    return 'Name'; // Default
}

async function getFieldsToQuery(conn: Connection, sObjectName: string): Promise<{ soqlFields: string[], fieldMapForCsv: Record<string, string> }> {
    const describe = await describeSObject(conn, sObjectName);
    const soqlFields: string[] = [];
    const fieldMapForCsv: Record<string, string> = {};

    for (const field of describe.fields) {
        if (field.type === 'address' || !field.queryable) { // Omitir campos de dirección compuestos y no consultables
            continue;
        }
        soqlFields.push(field.name);

        if (field.type === 'reference' && field.relationshipName) {
            // Para campos de relación, intentar obtener el campo de nombre del objeto relacionado
            // Asumimos que referenceTo[0] es el objeto principal si hay varios
            const relatedSObjectName = field.referenceTo && field.referenceTo.length > 0 ? field.referenceTo[0] : null;
            if (relatedSObjectName) {
                const primaryNameField = getPrimaryNameFieldForSObject(relatedSObjectName);
                const relatedQueryField = `${field.relationshipName}.${primaryNameField}`;
                soqlFields.push(relatedQueryField);
                // Convención de nombre de columna: AccountId -> Account__Name (si el campo de nombre es Name)
                // O MyLookup__c -> MyLookup__r__PrimaryNameField
                let csvColumnName = '';
                // field.relationshipName está garantizado por la comprobación en la línea 66
                if (field.relationshipName && field.relationshipName.endsWith('__r')) {
                    // Relación personalizada (ej. MyLookup__c -> relationshipName es MyLookup__r)
                    // El diseño especifica: MyCustomLookup__c__Name
                    csvColumnName = `${field.name}__${primaryNameField}`;
                } else {
                    // Relación estándar (ej. AccountId -> relationshipName es Account)
                    // El diseño especifica: Account__Name
                    // O cualquier otro caso donde relationshipName no termine en __r pero sea una referencia válida.
                    csvColumnName = `${field.relationshipName}__${primaryNameField}`;
                }
                fieldMapForCsv[relatedQueryField] = csvColumnName;
            }
        }
    }
    return { soqlFields: [...new Set(soqlFields)], fieldMapForCsv }; // Eliminar duplicados si los hubiera
}


/**
 * Parámetros para la función de backup de datos.
 */
export interface BackupDataParams {
  // Parámetros de la CLI de main.ts
  sourceOrgIdentifier: string; // Nuevo nombre para el identificador de la org (username o alias)
  outputDir: string; // Ruta del directorio de salida para el backup
  manifestPath?: string; // Ruta al archivo backup-manifest.json (opcional)
  includeMetadata?: boolean; // Incluir metadatos (descripciones de SObject y grafo de dependencia)
  dataOnly?: boolean; // Extraer solo datos
  metadataOnly?: boolean; // Extraer solo metadatos
  apiVersion?: string; // Versión de la API de Salesforce a utilizar
  maxFileSize?: string; // Tamaño máximo de archivo para los CSV de datos
  excludeFields?: string[]; // Lista de campos a excluir
  sObjectList?: string[]; // Lista de SObjects a incluir (de --sobjects)
  allSObjects?: boolean; // Incluir todos los SObjects recuperables
  nameFieldsOnly?: boolean; // Incluir solo campos de nombre para registros relacionados

  // Parámetros de la interfaz original que podrían ser útiles internamente o necesitar adaptación
  // query?: string; // Si se decide soportar query directa internamente en algún momento
  // tag?: string; // Si se decide reintroducir para nombres de subdirectorios
  // noMetadata y noDependencyGraph se gestionan ahora con includeMetadata, dataOnly, metadataOnly
}

/**
 * Función principal para el backup de datos.
 */
export async function backupData(params: BackupDataParams): Promise<string> {
  const commandStartTime = new Date();
  logger.info(`--- Iniciando Proceso de Backup ---`);
  const spinner = ora('Cargando configuración...').start();

  let backupFullPath: string | undefined; // Declarado aquí para acceso en catch
  let backupManifest: any = {
    sourceOrgIdentifier: params.sourceOrgIdentifier,
    sourceOrgId: '', // Se llenará después de la conexión
    timestampUtc: commandStartTime.toISOString(),
    tag: '', // Tag ya no se pasa desde CLI, se puede omitir o dejar vacío
    query: '', // Query general ya no se pasa desde CLI para control de flujo
    sObjectList: [], // Se llenará con los SObjects procesados
    toolVersion: await getToolVersion(),
    // La lógica de includeMetadata, dataOnly, metadataOnly se maneja en main.ts
    // params.includeMetadata ya refleja la intención final
    includedMetadata: params.includeMetadata || params.metadataOnly,
    // El grafo de dependencias es un tipo de metadato
    includedDependencyGraph: (params.includeMetadata || params.metadataOnly) && !params.dataOnly,
    status: 'PENDING',
    summary: '',
    sObjectsData: {},
    sObjectsMetadata: {},
    errors: []
  };
  // Ajustar based en dataOnly y metadataOnly
  if (params.dataOnly) {
    backupManifest.includedMetadata = false;
    backupManifest.includedDependencyGraph = false;
  }
  if (params.metadataOnly) {
    backupManifest.includedMetadata = true;
    backupManifest.includedDependencyGraph = true;
  }


  try {
    const config = await loadConfig('./config.json');

    if (!params.sourceOrgIdentifier) {
      throw new Error("Debe especificar una organización de origen.");
    }
    if (!(params.sObjectList && params.sObjectList.length > 0) && !params.allSObjects) {
      throw new Error("Debe especificar una lista de SObjects con --sobjects o usar --all-sobjects.");
    }

    const baseOutputDir = params.outputDir; // outputDir es requerido por la CLI
    const timestamp = commandStartTime.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    const backupDirName = timestamp; // Sin tag desde CLI
    backupFullPath = path.resolve(baseOutputDir, backupDirName);
    
    spinner.text = `Creando snapshot en: ${backupFullPath}`;
    await ensureDir(backupFullPath);

    // Crear subdirectorios condicionalmente
    const shouldProcessData = !params.metadataOnly;
    const shouldProcessMetadata = backupManifest.includedMetadata; // Usar el valor ya calculado para el manifest

    if (shouldProcessData) {
      await ensureDir(path.join(backupFullPath, 'data'));
    }
    if (shouldProcessMetadata) {
      await ensureDir(path.join(backupFullPath, 'metadata'));
      if (backupManifest.includedDependencyGraph) { // Solo crear si se va a generar
         await ensureDir(path.join(backupFullPath, 'dependencies'));
      }
    }
    spinner.succeed(`Snapshot creado en: ${backupFullPath}`);

    spinner.start(`Autenticando con la organización de origen: ${params.sourceOrgIdentifier}...`);
    const conn = await auth.getSalesforceConnection(params.sourceOrgIdentifier, config);
    try {
        const orgDetails: any = await conn.query("SELECT Id FROM Organization LIMIT 1");
        if (orgDetails.records && orgDetails.records.length > 0) {
            backupManifest.sourceOrgId = orgDetails.records[0].Id;
        }
    } catch (e) {
        logger.warn(`No se pudo obtener el OrgId: ${(e as Error).message}`);
        backupManifest.sourceOrgId = 'N/A';
    }
    spinner.succeed(`Autenticado con ${conn.instanceUrl} (Org ID: ${backupManifest.sourceOrgId})`);
    
    let sObjectListToProcess: string[] = [];
    if (params.sObjectList && params.sObjectList.length > 0) {
      sObjectListToProcess = params.sObjectList;
    } else if (params.allSObjects) {
      sObjectListToProcess = await getAllSObjectNames(conn, spinner);
    }

    if (sObjectListToProcess.length === 0) {
        throw new Error("No hay SObjects para procesar. Verifique las opciones --sobjects o --all-sobjects.");
    }
    backupManifest.sObjectList = sObjectListToProcess; // Actualizar manifest con la lista final
    logger.info(`SObjects a procesar: ${sObjectListToProcess.join(', ')}`);

    let totalRecordsExtractedMap: Record<string, number> = {};
    let allSObjectDescribes: Map<string, SObjectDescribe> = new Map();

    for (const sObjectName of sObjectListToProcess) {
      spinner.start(`Procesando SObject: ${sObjectName}`);
      totalRecordsExtractedMap[sObjectName] = 0;

      // 1. Extracción de Datos
      if (shouldProcessData) {
        try {
          spinner.text = `[${sObjectName}] Extrayendo datos...`;
          const { soqlFields, fieldMapForCsv } = await getFieldsToQuery(conn, sObjectName);
          
          if (soqlFields.length === 0) {
              logger.warn(`[${sObjectName}] No se encontraron campos consultables. Saltando extracción de datos.`);
              backupManifest.sObjectsData[sObjectName] = {
                file: path.join('data', `${sObjectName}.csv`),
                recordsExtracted: 0,
                status: 'SkippedNoFields'
              };
              continue;
          }
          const currentQuery = `SELECT ${soqlFields.join(',')} FROM ${sObjectName}`;
          logger.debug(`[${sObjectName}] Query para extracción: ${currentQuery}`);
          
          const csvFilePath = path.join(backupFullPath, 'data', `${sObjectName}.csv`);
          const queryResult = await conn.query<any>(currentQuery).autoFetch(true).maxFetch(500000).run(); // Añadido maxFetch

          const transformedRecords = queryResult.records.map((record: any) => {
              const newRecord: any = { ...record };
              for (const soqlField in fieldMapForCsv) {
                  const csvColumn = fieldMapForCsv[soqlField];
                  const parts = soqlField.split('.');
                  let value = record;
                  for (const part of parts) {
                      if (value && typeof value === 'object' && part in value) {
                          value = (value as any)[part];
                      } else {
                          value = undefined;
                          break;
                      }
                  }
                  if (value !== undefined) {
                      newRecord[csvColumn] = value;
                  }
                  if (parts.length > 1 && newRecord[parts[0]] !== undefined) delete newRecord[parts[0]];
              }
              delete newRecord.attributes;
              return newRecord;
          });

          if (transformedRecords.length > 0) {
              await writeRecordsToCsv(transformedRecords, csvFilePath);
              totalRecordsExtractedMap[sObjectName] = transformedRecords.length;
              spinner.succeed(`[${sObjectName}] ${transformedRecords.length} registros guardados en data/${sObjectName}.csv`);
            backupManifest.sObjectsData[sObjectName] = {
              file: path.join('data', `${sObjectName}.csv`),
              recordsExtracted: transformedRecords.length,
              status: 'Extracted'
            };
          } else {
              spinner.warn(`[${sObjectName}] No se encontraron registros. Archivo data/${sObjectName}.csv no creado o vacío.`);
                    backupManifest.sObjectsData[sObjectName] = {
                      file: path.join('data', `${sObjectName}.csv`),
                      recordsExtracted: 0,
                      status: 'NoData'
                    };
          }
        } catch (error) {
          const errMsg = `[${sObjectName}] Error durante la extracción de datos: ${(error as Error).message}`;
          logger.error(errMsg);
          backupManifest.errors.push({ type: 'DataExtractionError', object: sObjectName, message: errMsg });
          backupManifest.sObjectsData[sObjectName] = {
              file: path.join('data', `${sObjectName}.csv`),
              recordsExtracted: 0,
              status: 'Error',
              errorDetails: errMsg
          };
          spinner.fail(errMsg);
        }
      } else {
        logger.info(`[${sObjectName}] Extracción de datos omitida debido a --metadata-only.`);
        backupManifest.sObjectsData[sObjectName] = { status: 'SkippedMetadataOnly' };
      }

      // 2. Extracción de Metadatos (SObject Describe)
      if (shouldProcessMetadata) {
        try {
          spinner.text = `[${sObjectName}] Extrayendo metadatos (describe)...`;
          const describeResult = await describeSObject(conn, sObjectName);
          allSObjectDescribes.set(sObjectName, describeResult);
          
          const metadataOutput: any = { /* ... (igual que antes) ... */
            name: describeResult.name,
            label: describeResult.label,
            labelPlural: describeResult.labelPlural,
            keyPrefix: describeResult.keyPrefix,
            custom: describeResult.custom,
            feedEnabled: describeResult.feedEnabled,
            fields: describeResult.fields.map((f: SObjectField) => ({
              name: f.name, label: f.label, type: f.type, length: f.length, precision: f.precision,
              scale: f.scale, digits: f.digits, nillable: f.nillable, custom: f.custom, unique: f.unique,
              externalId: f.externalId, autoNumber: f.autoNumber, calculated: f.calculated,
              formula: f.calculatedFormula, formulaTreatNullNumberAsZero: f.formulaTreatNullNumberAsZero,
              defaultValue: f.defaultValueFormula,
              picklistValues: f.picklistValues?.map((pv: any) => ({ value: pv.value, label: pv.label, active: pv.active, defaultValue: pv.defaultValue })),
              referenceTo: f.referenceTo, relationshipName: f.relationshipName, cascadeDelete: f.cascadeDelete,
              restrictedDelete: f.restrictedDelete, writeRequiresMasterRead: f.writeRequiresMasterRead
            })),
            childRelationships: describeResult.childRelationships?.map(cr => ({
                childSObject: cr.childSObject, deprecatedAndHidden: cr.deprecatedAndHidden, field: cr.field,
                junctionIdListNames: cr.junctionIdListNames, junctionReferenceTo: cr.junctionReferenceTo,
                relationshipName: cr.relationshipName, cascadeDelete: cr.cascadeDelete, restrictedDelete: cr.restrictedDelete,
            })),
            recordTypeInfos: describeResult.recordTypeInfos?.map((rti: any) => ({
                name: rti.name, developerName: rti.developerName, recordTypeId: rti.recordTypeId, active: rti.active,
                available: rti.available, defaultRecordTypeMapping: rti.defaultRecordTypeMapping, master: rti.master,
            })),
          };

          const metadataFilePath = path.join(backupFullPath, 'metadata', `${sObjectName}.json`);
          await fs.writeFile(metadataFilePath, JSON.stringify(metadataOutput, null, 2));
          spinner.succeed(`[${sObjectName}] Metadatos guardados en metadata/${sObjectName}.json`);
          backupManifest.sObjectsMetadata[sObjectName] = {
            file: path.join('metadata', `${sObjectName}.json`),
            fields: describeResult.fields.length,
            status: 'Saved'
          };
        } catch (error) {
          const errMsg = `[${sObjectName}] Error durante la extracción de metadatos: ${(error as Error).message}`;
          logger.error(errMsg);
          backupManifest.errors.push({ type: 'MetadataExtractionError', object: sObjectName, message: errMsg });
          backupManifest.sObjectsMetadata[sObjectName] = {
            file: path.join('metadata', `${sObjectName}.json`),
            fields: 0,
            status: 'Error',
            errorDetails: errMsg
          };
          spinner.fail(errMsg);
        }
      } else {
         logger.info(`[${sObjectName}] Extracción de metadatos (describe) omitida.`);
         backupManifest.sObjectsMetadata[sObjectName] = { status: 'SkippedNoMetadata' };
      }
    }

    // 3. Generación del Grafo de Dependencias
    if (backupManifest.includedDependencyGraph && allSObjectDescribes.size > 0) {
      try {
        // spinner.start() es llamado dentro de generateAndSaveDependencyGraph
        await generateAndSaveDependencyGraph(allSObjectDescribes, backupFullPath, spinner);
        // backupManifest.includedDependencyGraph ya está seteado correctamente.
        backupManifest.dependencyGraphFile = path.join('dependencies', 'dependency-graph.json');
      } catch (graphError) {
        const errMsg = `Fallo al generar o guardar el grafo de dependencias: ${(graphError instanceof Error ? graphError.message : String(graphError))}`;
        logger.error(errMsg);
        backupManifest.errors.push({
          type: 'DependencyGraphError',
          message: errMsg
        });
        backupManifest.includedDependencyGraph = false; // Actualizar si falla específicamente aquí
      }
    } else if (shouldProcessMetadata && !backupManifest.includedDependencyGraph) {
        logger.info('Generación de grafo de dependencias omitida (ej. por --data-only o no se procesaron metadatos).');
        backupManifest.includedDependencyGraph = false; // Confirmar
    } else if (!shouldProcessMetadata) {
        logger.info('Generación de grafo de dependencias omitida porque los metadatos no fueron procesados.');
        backupManifest.includedDependencyGraph = false; // Confirmar
    }
    
    // 4. Creación del backup-manifest.json
    spinner.start('Creando manifiesto del backup...');
    // Determinar el manifestPath final
    const finalManifestPath = params.manifestPath ? path.resolve(params.manifestPath) : path.join(backupFullPath, 'backup-manifest.json');
    // Si params.manifestPath es un directorio, adjuntar 'backup-manifest.json'
    // Esta lógica debería estar en main.ts o ser más robusta aquí. Por ahora, asume que es un path de archivo o se usa el default.
    // Para simplificar, si params.manifestPath existe, lo usamos, sino el default.
    // La CLI ya define outputDir como directorio de backup, y manifest como path opcional.
    // Si manifestPath es provisto, se usa ese. Sino, dentro de outputDir.
    // La lógica actual de backupFullPath ya crea el directorio del snapshot.
    // Si params.manifestPath es provisto, ¿debería ir DENTRO de backupFullPath o es una ruta absoluta/relativa independiente?
    // El diseño de CLI: .option('-m, --manifest <path>', 'Ruta al archivo backup-manifest.json (opcional, para especificar uno existente o ubicación no estándar)')
    // Esto sugiere que puede ser una ubicación no estándar.
    // Si es así, backupFullPath no debería usarse para el manifest si params.manifestPath está presente.
    // Sin embargo, el resto de los archivos (data, metadata) SÍ van a backupFullPath.
    // Esto podría ser confuso. Por ahora, si params.manifestPath se da, se usa. Si no, se pone en backupFullPath.

    const manifestFileToWrite = params.manifestPath
        ? path.resolve(params.manifestPath)
        : path.join(backupFullPath, 'backup-manifest.json');

    // Asegurar que el directorio para un manifestPath personalizado exista
    if (params.manifestPath) {
        await ensureDir(path.dirname(manifestFileToWrite));
    }
    backupManifest.status = backupManifest.errors.length > 0 ? 'PARTIAL' : 'COMPLETED';
    let summaryParts: string[] = [];
    sObjectListToProcess.forEach(sObjectName => {
      if (totalRecordsExtractedMap[sObjectName] !== undefined) {
        summaryParts.push(`${totalRecordsExtractedMap[sObjectName]} registros de ${sObjectName}`);
      } else if (backupManifest.sObjectsData[sObjectName]?.status === 'SkippedMetadataOnly') {
        summaryParts.push(`${sObjectName} (solo metadatos)`);
      } else if (backupManifest.sObjectsData[sObjectName]?.status === 'SkippedNoFields') {
        summaryParts.push(`${sObjectName} (sin campos consultables)`);
      }
    });
    
    backupManifest.summary = `Backup ${backupManifest.status}. ${summaryParts.join('; ')}.`;
    if (backupManifest.errors.length > 0) {
        backupManifest.summary += ` Errores encontrados: ${backupManifest.errors.length}.`;
    }

    await fs.writeFile(manifestFileToWrite, JSON.stringify(backupManifest, null, 2));
    spinner.succeed(`Manifiesto del backup guardado en: ${manifestFileToWrite}`);

    logger.info(`> ✓ Backup ${backupManifest.status}. Snapshot disponible en: ${backupFullPath}`);
    logger.info(`> info: Total objetos procesados: ${sObjectListToProcess.length}. Detalles: ${summaryParts.join('; ')}.`);
    logger.info(`> info: Metadatos incluidos: ${backupManifest.includedMetadata ? 'Sí' : 'No'}. Grafo de dependencias incluido: ${backupManifest.includedDependencyGraph ? 'Sí' : 'No'}.`);

    if (backupManifest.status !== 'COMPLETED') {
        logger.warn(`El backup NO se completó satisfactoriamente (estado: ${backupManifest.status}). Revise los logs y el archivo manifiesto para más detalles.`);
    }
    
    return backupFullPath; // Devuelve la ruta del directorio del snapshot (datos, metadata, etc.)
  } catch (error) {
    const finalErrorMessage = `El backup ha fallado críticamente: ${(error as Error).message}`;
    spinner.fail(finalErrorMessage);
    logger.error(finalErrorMessage);
    logger.error("Stack trace:", (error as Error).stack); // Log stack trace for critical failures
    backupManifest.status = 'FAILED';
    backupManifest.summary = finalErrorMessage;
    // Asegurar que errors sea un array de objetos o strings consistentes
    if (typeof finalErrorMessage === 'string') {
        backupManifest.errors.push({ type: 'CriticalError', message: finalErrorMessage });
    }


    const manifestFileOnError = params.manifestPath
        ? path.resolve(params.manifestPath)
        : (backupFullPath ? path.join(backupFullPath, 'backup-manifest.json') : './backup-manifest-error.json');
    
    try {
        if (params.manifestPath || backupFullPath) { // Solo intentar escribir si tenemos una ruta base
            if (params.manifestPath) await ensureDir(path.dirname(manifestFileOnError));
            else if (backupFullPath) await ensureDir(backupFullPath); // Asegurar que el directorio del snapshot exista
        }
        await fs.writeFile(manifestFileOnError, JSON.stringify(backupManifest, null, 2));
        logger.info(`Manifiesto de error del backup guardado en ${manifestFileOnError}`);
    } catch (manifestError) {
        logger.error(`No se pudo guardar el manifiesto de error en ${manifestFileOnError}: ${(manifestError as Error).message}`);
    }
    throw error;
  }
}

// Aquí iría la lógica para registrar este comando con yargs o el manejador CLI del proyecto.
// Ejemplo (conceptual):
// export const command = 'backup';
// export const desc = 'Crea un backup de datos y metadatos de una organización Salesforce.';
// export const builder = (yargs) => {
//   yargs.option('source-org', { alias: 's', describe: 'Alias de la organización de origen', type: 'string', demandOption: true });
//   yargs.option('query', { alias: 'q', describe: 'Consulta SOQL para especificar registros', type: 'string' });
//   yargs.option('objects', { describe: 'Lista de SObjects a extraer (separados por coma)', type: 'string' });
//   yargs.option('tag', { describe: 'Etiqueta para el directorio del backup', type: 'string' });
//   yargs.option('output-dir', { describe: 'Directorio base para los backups (default: ./backups)', type: 'string' });
//   yargs.option('no-metadata', { describe: 'No incluir metadatos de SObjects', type: 'boolean', default: false });
//   yargs.option('no-dependency-graph', { describe: 'No incluir grafo de dependencias', type: 'boolean', default: false });
//   yargs.check((argv) => {
//     if (!argv.query && !argv.objects) throw new Error('Debe especificar --query o --objects');
//     if (argv.query && argv.objects) throw new Error('No puede usar --query y --objects simultáneamente');
//     return true;
//   });
// };
// export const handler = async (argv) => {
//   await backupData({
//     sourceOrg: argv.sourceOrg,
//     query: argv.query,
//     objects: argv.objects,
//     tag: argv.tag,
//     outputDir: argv.outputDir,
//     noMetadata: argv.noMetadata,
//     noDependencyGraph: argv.noDependencyGraph,
//   });
// };