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
  sourceOrg: string; // Alias o username de la organización de origen
  query?: string; // SOQL query (mutuamente excluyente con objects)
  objects?: string; // Lista de SObjects separados por coma (mutuamente excluyente con query)
  tag?: string; // Etiqueta opcional para el directorio del backup
  outputDir?: string; // Directorio base para los backups (default: ./backups)
  noMetadata?: boolean; // Flag para no incluir metadatos
  noDependencyGraph?: boolean; // Flag para no incluir grafo de dependencias
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
    sourceOrgAlias: params.sourceOrg,
    sourceOrgId: '', // Se llenará después de la conexión
    timestampUtc: commandStartTime.toISOString(),
    tag: params.tag || '',
    query: params.query || '',
    objects: [], // Se llenará con los SObjects procesados
    toolVersion: await getToolVersion(),
    includedMetadata: !params.noMetadata,
    includedDependencyGraph: !params.noDependencyGraph,
    status: 'PENDING',
    summary: '',
    sObjectsData: {}, // Añadido para detalles por SObject
    sObjectsMetadata: {}, // Añadido para detalles por SObject
    errors: []
  };

  try {
    const config = await loadConfig('./config.json'); // Cargar config.json por defecto

    // Validación de parámetros
    if (!params.sourceOrg) {
      throw new Error("Debe especificar una organización de origen con -s o --source-org.");
    }
    if (!params.query && !params.objects) {
      throw new Error("Debe especificar una consulta con -q (--query) o una lista de objetos con --objects.");
    }
    if (params.query && params.objects) {
      throw new Error("No puede especificar -q (--query) y --objects simultáneamente.");
    }

    // Determinar directorio de backup
    const baseOutputDir = params.outputDir || './backups';
    const timestamp = commandStartTime.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19); // YYYY-MM-DD_HH-MM-SS
    const backupDirName = params.tag ? `${timestamp}_${params.tag}` : timestamp;
    backupFullPath = path.resolve(baseOutputDir, backupDirName); // Asignar a la variable declarada antes
    
    spinner.text = `Creando snapshot en: ${backupFullPath}`;
    await ensureDir(backupFullPath);
    await ensureDir(path.join(backupFullPath, 'data'));
    if (!params.noMetadata) await ensureDir(path.join(backupFullPath, 'metadata'));
    if (!params.noDependencyGraph) await ensureDir(path.join(backupFullPath, 'dependencies'));
    spinner.succeed(`Snapshot creado en: ${backupFullPath}`);

    // Conexión a la organización
    spinner.start(`Autenticando con la organización de origen: ${params.sourceOrg}...`);
    const conn = await auth.getSalesforceConnection(params.sourceOrg, config);
    // Intentar obtener OrgId (puede que no esté disponible en todas las conexiones jsforce directamente)
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
    if (params.objects) {
      sObjectListToProcess = params.objects.split(',').map(s => s.trim()).filter(s => s);
    } else if (params.query) {
      const mainObject = extractSObjectNameFromSoql(params.query);
      if (!mainObject) {
        throw new Error("No se pudo determinar el objeto principal de la consulta SOQL. Verifique la sintaxis.");
      }
      sObjectListToProcess = [mainObject];
    }

    backupManifest.objects = sObjectListToProcess;
    logger.info(`SObjects a procesar: ${sObjectListToProcess.join(', ')}`);

    let totalRecordsExtractedMap: Record<string, number> = {};
    let allSObjectDescribes: Map<string, SObjectDescribe> = new Map(); // Añadido para acumular descripciones

    for (const sObjectName of sObjectListToProcess) {
      spinner.start(`Procesando SObject: ${sObjectName}`);
      totalRecordsExtractedMap[sObjectName] = 0;

      // 1. Extracción de Datos
      try {
        spinner.text = `[${sObjectName}] Extrayendo datos...`;
        const { soqlFields, fieldMapForCsv } = await getFieldsToQuery(conn, sObjectName);
        
        let currentQuery = params.query;
        if (params.objects) { // Si se usa --objects, construir SELECT * (o todos los campos consultables)
            if (soqlFields.length === 0) {
                logger.warn(`[${sObjectName}] No se encontraron campos consultables. Saltando extracción de datos.`);
                continue;
            }
            currentQuery = `SELECT ${soqlFields.join(',')} FROM ${sObjectName}`;
        } else if (params.query && sObjectName === extractSObjectNameFromSoql(params.query)) {
            // Si es el query original, necesitamos re-escribirlo para incluir los campos de relación
            // Esto es complejo si el query original ya tiene campos seleccionados.
            // Por simplicidad, si es -q, asumimos que el usuario ya incluyó los campos deseados,
            // o podríamos intentar parsear y añadir los campos de relación.
            // Para esta versión, si es -q, usamos el query tal cual para datos, pero los campos de relación podrían no tener el formato __Name.
            // El diseño dice: "Para los campos de tipo lookup y master-detail, además del Id del registro relacionado, se incluirá en una columna adicional el valor del campo de nombre principal"
            // Esto implica que DEBEMOS modificar la query o el post-procesamiento.
            // Modificaremos la query si es posible.
            const originalQueryFields = params.query!.toLowerCase().match(/select (.*?) from/)?.[1].split(',').map(f => f.trim());
            const fieldsToAdd = soqlFields.filter(sf => !originalQueryFields?.includes(sf.toLowerCase()) && !originalQueryFields?.includes(sf.split('.')[0].toLowerCase() + '.' + sf.split('.')[1]?.toLowerCase()));
            
            if (fieldsToAdd.length > 0) {
                const fromClausePosition = params.query!.toLowerCase().indexOf(' from ');
                if (fromClausePosition > -1) {
                    currentQuery = params.query!.substring(0, fromClausePosition) + `, ${fieldsToAdd.join(',')}` + params.query!.substring(fromClausePosition);
                    logger.info(`[${sObjectName}] Query modificado para incluir campos de relación: ${fieldsToAdd.join(',')}`);
                }
            }
        }
        
        if (!currentQuery) {
            logger.warn(`[${sObjectName}] No se pudo determinar la consulta SOQL. Saltando extracción de datos.`);
            continue;
        }

        const csvFilePath = path.join(backupFullPath, 'data', `${sObjectName}.csv`);
        
        // Usar Bulk API si es apropiado (lógica similar a extractCommand)
        // Por ahora, simplificamos y usamos extractDataQuery, que puede manejar Tooling/REST.
        // extractDataQuery en extractCommand.ts guarda en outputPath (que puede ser dir o file)
        // Aquí necesitamos que siempre sea un archivo específico.
        // La función extractDataQuery original podría necesitar refactorización para ser más reutilizable aquí.
        // Por ahora, asumimos que podemos pasarle el path completo del archivo CSV.
        
        // Simulación de conteo de registros y escritura
        // En una implementación real, se usaría extractDataQuery/Bulk y se manejaría el stream.
        const queryResult = await conn.query<any>(currentQuery).autoFetch(true).run(); // Corregido autoFetch y añadido .run()
                                                          // autoFetch(true) carga todo en memoria, ¡cuidado con grandes volúmenes!
                                                          // Se debería usar conn.bulk.query() o conn.query().stream() para grandes volúmenes.

        // Transformar records para mapear nombres de columna para CSV
        const transformedRecords = queryResult.records.map((record: any) => { // Añadido tipo explícito a record
            const newRecord: any = { ...record };
            for (const soqlField in fieldMapForCsv) {
                const csvColumn = fieldMapForCsv[soqlField];
                // El campo en el record puede ser anidado, ej: record.Account.Name
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
                // Eliminar el campo original anidado si es necesario, o dejarlo.
                // Por ahora, lo dejamos, writeRecordsToCsv debería tomar las claves de newRecord.
                if (parts.length > 1) delete newRecord[parts[0]]; // Elimina el objeto Account si teníamos Account.Name
            }
            // Eliminar atributos que no son datos (como el atributo 'attributes')
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
        } // Cierra el bloque try para la extracción de datos

      } catch (error) {
        const errMsg = `[${sObjectName}] Error durante la extracción de datos: ${(error as Error).message}`;
        logger.error(errMsg);
        backupManifest.errors.push(errMsg); // Error global
        backupManifest.sObjectsData[sObjectName] = { // Estado específico del SObject
            file: path.join('data', `${sObjectName}.csv`), // Ruta intentada
            recordsExtracted: 0,
            status: 'Error',
            errorDetails: errMsg // Opcional: añadir detalles del error aquí también
        };
        spinner.fail(errMsg);
      }

      // 2. Extracción de Metadatos
      if (!params.noMetadata) {
        try {
          spinner.text = `[${sObjectName}] Extrayendo metadatos...`;
          const describeResult = await describeSObject(conn, sObjectName);
          allSObjectDescribes.set(sObjectName, describeResult); // Poblar el Map
          
          // Transformar describeResult al formato especificado en backup_command_design.md
          const metadataOutput: any = {
            name: describeResult.name,
            label: describeResult.label,
            labelPlural: describeResult.labelPlural,
            keyPrefix: describeResult.keyPrefix,
            custom: describeResult.custom,
            feedEnabled: describeResult.feedEnabled,
            fields: describeResult.fields.map((f: SObjectField) => ({
              name: f.name,
              label: f.label,
              type: f.type,
              length: f.length,
              precision: f.precision,
              scale: f.scale,
              digits: f.digits,
              nillable: f.nillable,
              custom: f.custom,
              unique: f.unique,
              externalId: f.externalId,
              autoNumber: f.autoNumber,
              calculated: f.calculated,
              formula: f.calculatedFormula, // Asegurarse que el nombre del campo es correcto
              formulaTreatNullNumberAsZero: f.formulaTreatNullNumberAsZero,
              defaultValue: f.defaultValueFormula, // o f.defaultValue
              picklistValues: f.picklistValues?.map((pv: any) => ({ // Añadido tipo explícito a pv
                value: pv.value,
                label: pv.label,
                active: pv.active,
                defaultValue: pv.defaultValue,
              })),
              referenceTo: f.referenceTo,
              relationshipName: f.relationshipName,
              cascadeDelete: f.cascadeDelete,
              restrictedDelete: f.restrictedDelete,
              writeRequiresMasterRead: f.writeRequiresMasterRead
            })),
            childRelationships: describeResult.childRelationships?.map(cr => ({
                childSObject: cr.childSObject,
                deprecatedAndHidden: cr.deprecatedAndHidden,
                field: cr.field,
                junctionIdListNames: cr.junctionIdListNames,
                junctionReferenceTo: cr.junctionReferenceTo,
                relationshipName: cr.relationshipName,
                cascadeDelete: cr.cascadeDelete,
                restrictedDelete: cr.restrictedDelete,
            })), // Opcional, según diseño
            recordTypeInfos: describeResult.recordTypeInfos?.map((rti: any) => ({ // Añadido tipo explícito a rti
                name: rti.name,
                developerName: rti.developerName,
                recordTypeId: rti.recordTypeId,
                active: rti.active,
                available: rti.available,
                defaultRecordTypeMapping: rti.defaultRecordTypeMapping,
                master: rti.master,
            })), // Opcional, según diseño
          };

          const metadataFilePath = path.join(backupFullPath, 'metadata', `${sObjectName}.json`);
          await fs.writeFile(metadataFilePath, JSON.stringify(metadataOutput, null, 2));
          spinner.succeed(`[${sObjectName}] Metadatos guardados en metadata/${sObjectName}.json`);
          backupManifest.sObjectsMetadata[sObjectName] = {
            file: path.join('metadata', `${sObjectName}.json`),
            fields: describeResult.fields.length, // Asumiendo que describeResult está disponible
            status: 'Saved'
          };
        } catch (error) {
          const errMsg = `[${sObjectName}] Error durante la extracción de metadatos: ${(error as Error).message}`;
          logger.error(errMsg);
          backupManifest.errors.push(errMsg); // Error global
          backupManifest.sObjectsMetadata[sObjectName] = { // Estado específico del SObject
            file: path.join('metadata', `${sObjectName}.json`), // Ruta intentada
            fields: 0, // O el recuento de campos si describeResult se obtuvo parcialmente
            status: 'Error',
            errorDetails: errMsg // Opcional
          };
          spinner.fail(errMsg);
        }
      }
    }

    // 3. Generación del Grafo de Dependencias
    if (!params.noDependencyGraph) {
      try {
        spinner.start('Generando grafo de dependencias...');
        // La llamada a generateAndSaveDependencyGraph se movió más abajo, después de recolectar todos los SObjectDescribes.
        // Esta sección ahora se enfoca en la integración de la llamada real.
        // El spinner.start ya no es necesario aquí si se maneja dentro de la función.
        // El spinner.succeed() o .fail() se maneja dentro de generateAndSaveDependencyGraph.
        // El bloque try-catch aquí es para manejar errores de la llamada y actualizar el manifest.
        await generateAndSaveDependencyGraph(allSObjectDescribes, backupFullPath, spinner);
        backupManifest.includedDependencyGraph = true; // Marcar como incluido si no hay error
        backupManifest.dependencyGraphFile = path.join('dependencies', 'dependency-graph.json');
      } catch (graphError) {
        const errMsg = `Fallo al generar o guardar el grafo de dependencias: ${(graphError instanceof Error ? graphError.message : String(graphError))}`;
        logger.error(errMsg);
        backupManifest.errors.push({
          type: 'DependencyGraphError',
          message: errMsg
        });
        backupManifest.includedDependencyGraph = false;
        // spinner.fail() ya es llamado dentro de generateAndSaveDependencyGraph si hay error allí.
        // Si el error es por otra causa antes de llamar a la función (aunque no debería ser el caso aquí),
        // se podría añadir un spinner.fail(errMsg) aquí.
      }
    } else {
      spinner.info('Generación de grafo de dependencias omitida por parámetro --no-dependency-graph.');
      logger.info('Generación de grafo de dependencias omitida por parámetro --no-dependency-graph.');
      backupManifest.includedDependencyGraph = false;
    }
    
    // 4. Creación del backup-manifest.json
    spinner.start('Creando manifiesto del backup...');
    backupManifest.status = backupManifest.errors.length > 0 ? 'PARTIAL' : 'COMPLETED';
    let summaryParts: string[] = [];
    for(const sObjectName in totalRecordsExtractedMap) {
        summaryParts.push(`${totalRecordsExtractedMap[sObjectName]} registros de ${sObjectName}`);
    }
    backupManifest.summary = `Backup ${backupManifest.status}. ${summaryParts.join(', ')}.`;
    if (backupManifest.errors.length > 0) {
        backupManifest.summary += ` Errores: ${backupManifest.errors.length}.`;
    }

    const manifestFilePath = path.join(backupFullPath, 'backup-manifest.json');
    await fs.writeFile(manifestFilePath, JSON.stringify(backupManifest, null, 2));
    spinner.succeed('Manifiesto del backup guardado.');

    logger.info(`> ✓ Backup ${backupManifest.status}. Snapshot disponible en: ${backupFullPath}`);
    logger.info(`> info: Total objetos procesados: ${sObjectListToProcess.length}. ${summaryParts.join('. ')}.`);
    logger.info(`> info: Metadatos: ${backupManifest.includedMetadata ? 'Sí' : 'No'}. Grafo de dependencias: ${backupManifest.includedDependencyGraph ? 'Sí' : 'No'}.`);

    if (backupManifest.status !== 'COMPLETED') {
        logger.warn(`El backup se completó con estado: ${backupManifest.status}. Revise los logs y el archivo backup-manifest.json para más detalles.`);
    }
    
    return backupFullPath;
  } // Cierra el bloque try principal

catch (error) {
    const finalErrorMessage = `El backup ha fallado: ${(error as Error).message}`;
    spinner.fail(finalErrorMessage);
    logger.error(finalErrorMessage);
    backupManifest.status = 'FAILED';
    backupManifest.summary = finalErrorMessage;
    backupManifest.errors.push(finalErrorMessage);
    
    // Intentar escribir un manifiesto de error si es posible
    if (backupFullPath && typeof backupFullPath === 'string') { // Asegurar que backupFullPath está definido
        try {
            const manifestFilePath = path.join(backupFullPath, 'backup-manifest.json');
            await fs.writeFile(manifestFilePath, JSON.stringify(backupManifest, null, 2));
            logger.info(`Manifiesto de error del backup guardado en ${manifestFilePath}`);
        } catch (manifestError) {
            logger.error(`No se pudo guardar el manifiesto de error: ${(manifestError as Error).message}`);
        }
    }
    throw error; // Relanzar para que el llamador (CLI handler) lo capture
  }
} // Cierre de la función backupData

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