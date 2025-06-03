// src/core/sfdc-api.ts
import { Connection } from 'jsforce';
import { SObjectDescribe, ChildRelationship, Field } from './typeDefs.js'; // Importar ChildRelationship y Field
import * as fs from 'fs'; // Cambiado para importar todo el módulo fs
import path from 'path';
import { Readable } from 'stream';
import { Logger } from './logger.js';

const logger = new Logger('SfdcApi');
import { fileManagerAPI } from './fileManager.js'; // Se necesitará esta función

// Caché para descripciones de SObject
const sObjectDescribeCache = new Map<string, SObjectDescribe>();
const sObjectDisplayFieldCache = new Map<string, string | undefined>();
const sObjectUniqueFieldsCache = new Map<string, { name: string, type: string }[]>();

// Caché para los valores de los campos de visualización de IDs
const idDisplayValueCache = new Map<string, Map<string, string>>(); // Map<SObjectName, Map<Id, DisplayValue>>

// Nuevo caché para el tipo de API de SObject
const sObjectApiTypeCache = new Map<string, 'standard' | 'tooling'>();
// Nuevo caché para todos los SObjects con sus nombres y etiquetas plurales
const allSObjectsWithPluralLabelsCache = new Map<string, { name: string, labelPlural?: string }>();

/**
 * Popula el caché de todos los SObjects consultables con sus nombres y etiquetas plurales.
 * Esto se usa para mapear nombres de relaciones potencialmente plurales a nombres de objetos API singulares.
 * @param conn Conexión de jsforce.
 */
async function _populateAllSObjectsWithPluralLabels(conn: Connection): Promise<void> {
  if (allSObjectsWithPluralLabelsCache.size > 0) {
    logger.debug('DEBUG: Caché de SObjects con etiquetas plurales ya poblado.');
    return;
  }
  try {
    const describeGlobalResult = await conn.describeGlobal();
    describeGlobalResult.sobjects.forEach(sobj => {
      if (sobj.queryable) {
        allSObjectsWithPluralLabelsCache.set(sobj.name.toLowerCase(), { name: sobj.name, labelPlural: sobj.labelPlural });
        // También añadir la etiqueta plural como clave si es diferente del nombre
        if (sobj.labelPlural && sobj.labelPlural.toLowerCase() !== sobj.name.toLowerCase()) {
          allSObjectsWithPluralLabelsCache.set(sobj.labelPlural.toLowerCase(), { name: sobj.name, labelPlural: sobj.labelPlural });
        }
      }
    });
    logger.debug(`DEBUG: Caché de SObjects con etiquetas plurales poblado con ${allSObjectsWithPluralLabelsCache.size} entradas.`);
  } catch (error) {
    logger.error(`ERROR: Fallo al poblar el caché de SObjects con etiquetas plurales: ${(error as Error).message}`);
  }
}

// Lista de SObjects conocidos que son exclusivamente de la API de Tooling
const TOOLING_API_SOBJECTS = new Set([
  'ApexClass', 'ApexTrigger', 'ApexComponent', 'ApexPage',
  'CustomField', 'Layout', 'ValidationRule', 'WorkflowRule',
  'Flow', 'FlowDefinition', 'AuraDefinition', 'LightningComponentBundle',
  'Profile', 'PermissionSet', 'RecordType', 'CompactLayout',
  'EmailTemplate', 'Report', 'Dashboard', 'FlexiPage',
  'CustomObject', 'CustomTab', 'ApexLog', 'DebugLog',
  'UserLicense', 'UserPermissionAccess', 'ObjectPermissions',
  'FieldPermissions', 'TabSet', 'ApexTestResult', 'ApexTestQueueItem',
  'ApexTestRunResult', 'ApexCodeCoverage', 'ApexCodeCoverageAggregate',
  'ApexOrgWideCoverage', 'ApexTestResultLimits', 'ApexTestResultOutcome'
]);

/**
 * Extrae el nombre del SObject principal de una consulta SOQL.
 * Asume un formato SOQL simple para la cláusula FROM.
 * @param soqlQuery La consulta SOQL.
 * @returns El nombre del SObject o undefined si no se encuentra.
 */
function _extractSObjectNameFromSoql(soqlQuery: string): string | undefined {
  const fromClauseMatch = soqlQuery.match(/\bFROM\s+([a-zA-Z0-9_]+)/i);
  if (fromClauseMatch && fromClauseMatch[1]) {
    return fromClauseMatch[1];
  }
  return undefined;
}

/**
 * Determina si un SObject debe ser consultado usando la API estándar o la API de Tooling.
 * Utiliza caché, describeSObject y una lista de SObjects conocidos de Tooling API.
 * @param conn Conexión de jsforce.
 * @param sObjectName El nombre de API del SObject.
 * @returns 'standard' o 'tooling'.
 */
async function _determineApiForSObject(conn: Connection, sObjectName: string): Promise<'standard' | 'tooling'> {
  if (sObjectApiTypeCache.has(sObjectName)) {
    logger.debug(`DEBUG: Usando caché para el tipo de API de ${sObjectName}: ${sObjectApiTypeCache.get(sObjectName)}`);
    return sObjectApiTypeCache.get(sObjectName)!;
  }

  try {
    const describe = await sfdcApi.describeSObject(conn, sObjectName); // Corregido: sin guion bajo
    let apiType: 'standard' | 'tooling' = 'standard';

    // Indicador definitivo: URL de Tooling API en la descripción
    if (describe.url && describe.url.includes('/tooling/')) {
      apiType = 'tooling';
      logger.debug(`DEBUG: ${sObjectName} determinado como Tooling API por URL: ${describe.url}`);
    } else if (TOOLING_API_SOBJECTS.has(sObjectName) && describe.queryable && describe.retrieveable) {
      // Si está en la lista de conocidos y es consultable/recuperable
      apiType = 'tooling';
      logger.debug(`DEBUG: ${sObjectName} determinado como Tooling API por lista de conocidos y propiedades queryable/retrieveable.`);
    } else {
      logger.debug(`DEBUG: ${sObjectName} determinado como Standard API.`);
    }

    sObjectApiTypeCache.set(sObjectName, apiType);
    return apiType;
  } catch (error) {
    logger.warn(`ADVERTENCIA: Fallo al determinar el tipo de API para ${sObjectName}. Asumiendo API estándar. Error: ${(error as Error).message}`);
    sObjectApiTypeCache.set(sObjectName, 'standard'); // Cachear como estándar para evitar reintentos fallidos
    return 'standard';
  }
}

/**
 * Obtiene la descripción de metadatos de un SObject, utilizando caché.
 * @param conn Conexión de jsforce.
 * @param objectName El nombre de API del objeto.
 */
function _transformJsforceDescribe(describeFromJsforce: any): SObjectDescribe {
    const transformedFields: Field[] = describeFromJsforce.fields.map((jsforceField: any) => {
        return {
            name: jsforceField.name,
            label: jsforceField.label,
            type: jsforceField.type,
            custom: jsforceField.custom,
            updateable: jsforceField.updateable,
            createable: jsforceField.createable,
            nillable: jsforceField.nillable,
            relationshipName: jsforceField.relationshipName,
            referenceTo: jsforceField.referenceTo,
            queryable: typeof jsforceField.queryable === 'boolean' ? jsforceField.queryable : false,
        } as Field;
    });

    return {
        name: describeFromJsforce.name,
        label: describeFromJsforce.label,
        custom: describeFromJsforce.custom,
        queryable: describeFromJsforce.queryable,
        retrieveable: describeFromJsforce.retrieveable,
        keyPrefix: describeFromJsforce.keyPrefix,
        labelPlural: describeFromJsforce.labelPlural,
        feedEnabled: describeFromJsforce.feedEnabled,
        fields: transformedFields,
        childRelationships: describeFromJsforce.childRelationships ? describeFromJsforce.childRelationships as ChildRelationship[] : undefined,
        url: describeFromJsforce.urls?.describe,
        recordTypeInfos: describeFromJsforce.recordTypeInfos ? describeFromJsforce.recordTypeInfos as any[] : undefined,
    };
}
async function _describeSObject(conn: Connection, objectName: string): Promise<SObjectDescribe> {
  logger.debug(`DEBUG: Describiendo SObject: ${objectName}`);
  if (sObjectDescribeCache.has(objectName)) {
    logger.debug(`DEBUG: Usando caché para la descripción de ${objectName}`);
    return sObjectDescribeCache.get(objectName)!;
  }

  let describeFromJsforce;
  let finalObjectName = objectName;

  try {
    describeFromJsforce = await conn.sobject(objectName).describe$();
  } catch (initialError: any) {
    if (initialError.message && initialError.message.includes('The requested resource does not exist')) {
      logger.warn(`ADVERTENCIA: Fallo al describir '${objectName}': ${initialError.message}. Intentando encontrar un nombre de objeto API coincidente.`);
      
      await _populateAllSObjectsWithPluralLabels(conn); // Asegurar que el caché esté poblado

      const lowerCaseObjectName = objectName.toLowerCase();
      let correctedObjectName: string | undefined;

      // 1. Buscar una coincidencia directa con nombres API o etiquetas plurales
      const foundInCache = allSObjectsWithPluralLabelsCache.get(lowerCaseObjectName);
      if (foundInCache) {
        correctedObjectName = foundInCache.name;
        logger.info(`INFO: '${objectName}' coincide con el nombre API singular '${correctedObjectName}' o su etiqueta plural.`);
      }

      // 2. Fallback: heurística de singularización si no se encontró una coincidencia directa,
      // pero solo si el resultado de la heurística existe en la lista de SObjects reales.
      if (!correctedObjectName) {
        if (lowerCaseObjectName.endsWith('s')) {
          const potentialSingular = lowerCaseObjectName.slice(0, -1);
          const foundByHeuristic = allSObjectsWithPluralLabelsCache.get(potentialSingular);
          if (foundByHeuristic) {
            correctedObjectName = foundByHeuristic.name;
            logger.info(`INFO: '${objectName}' (plural heurístico) singularizado a '${correctedObjectName}' y encontrado en la lista de SObjects.`);
          }
        } else if (lowerCaseObjectName.endsWith('ies')) {
          const potentialSingular = lowerCaseObjectName.replace(/ies$/, 'y');
          const foundByHeuristic = allSObjectsWithPluralLabelsCache.get(potentialSingular);
          if (foundByHeuristic) {
            correctedObjectName = foundByHeuristic.name;
            logger.info(`INFO: '${objectName}' (plural heurístico) singularizado a '${correctedObjectName}' y encontrado en la lista de SObjects.`);
          }
        }
      }

      if (correctedObjectName) {
        logger.info(`INFO: Se encontró un nombre de objeto API corregido: '${correctedObjectName}'. Reintentando la descripción.`);
        try {
          describeFromJsforce = await conn.sobject(correctedObjectName).describe$();
          finalObjectName = correctedObjectName;
        } catch (retryError: any) {
          logger.error(`ERROR: Fallo al describir el objeto corregido '${correctedObjectName}'. Error: ${retryError.message}`);
          throw initialError; // Relanzar el error original si el reintento también falla
        }
      } else {
        logger.error(`ERROR: No se pudo encontrar un nombre de objeto API coincidente para '${objectName}'. Relanzando el error original.`);
        throw initialError; // Relanzar el error original si no se encuentra un nombre singular
      }
    } else {
      throw initialError; // Relanzar cualquier otro error
    }
  }

  const finalDescribe = _transformJsforceDescribe(describeFromJsforce);
  sObjectDescribeCache.set(objectName, finalDescribe); // Cachear el nombre original (incluso si es plural/incorrecto)
  if (objectName !== finalObjectName) {
    sObjectDescribeCache.set(finalObjectName, finalDescribe); // Cachear también el nombre corregido si es diferente
  }
  logger.debug(`DEBUG: Descripción de ${finalObjectName} (original: ${objectName}) obtenida, transformada y cacheada.`);
  return finalDescribe;
}

/**
 * Determina el campo más adecuado para mostrar como identificador legible para un SObject.
 * Prioriza Name, luego Username, luego CaseNumber, luego cualquier campo único no nulo.
 * @param describe La descripción del SObject.
 * @returns El nombre del campo identificador.
 */
function _getSObjectDisplayField(describe: SObjectDescribe): string | undefined {
  // Prioridad: Name, luego Username, luego CaseNumber
  if (describe.fields.some(f => f.name === 'Name' && f.type === 'string')) {
    return 'Name';
  }
  if (describe.fields.some(f => f.name === 'Username' && f.type === 'string')) {
    return 'Username';
  }
  if (describe.fields.some(f => f.name === 'CaseNumber' && f.type === 'string')) {
    return 'CaseNumber';
  }

  // Si no se encuentran los campos comunes, buscar un campo único y no nulo
  const uniqueNillableFalseField = describe.fields.find(f => f.unique && !f.nillable && f.type === 'string');
  if (uniqueNillableFalseField) {
    return uniqueNillableFalseField.name;
  }

  // Como último recurso, buscar el primer campo de tipo string que no sea un ID
  const firstStringField = describe.fields.find(f => f.type === 'string' && f.name !== 'Id');
  if (firstStringField) {
    return firstStringField.name;
  }

  return undefined; // No se encontró un campo de visualización adecuado
}

/**
 * Obtiene una lista de todos los SObjects "consultables" de la organización.
 * @param conn Conexión de jsforce.
 */
async function _listAllSObjects(conn: Connection): Promise<string[]> {
    const describeGlobalResult = await conn.describeGlobal();
    return describeGlobalResult.sobjects
        .filter(sobj => sobj.queryable)
        .map(sobj => sobj.name);
}

/**
 * Extrae datos utilizando la Bulk API de Salesforce.
 * @param conn Conexión de jsforce.
 * @param soqlQuery La consulta SOQL a ejecutar.
 * @param outputFile Ruta del archivo de salida CSV.
 * @returns Un stream de los registros.
 */
async function _extractDataBulk(
  conn: Connection,
  soqlQuery: string,
  outputFile: string,
  createWriteStreamFn: (path: fs.PathLike, options?: any) => fs.WriteStream = fs.createWriteStream
): Promise<Readable> {
  const recordStream = (await conn.bulk.query(soqlQuery)).stream();
  // Usar la función inyectada para crear el stream de escritura
  const fileWriteStream = createWriteStreamFn(outputFile);
  recordStream.pipe(fileWriteStream);
  return recordStream;
}

/**
 * Extrae datos utilizando la Query API (REST API) de Salesforce, manejando subconsultas.
 * Desenrolla los datos anidados en archivos CSV separados para padre e hijo.
 * @param conn Conexión de jsforce.
 * @param soqlQuery La consulta SOQL a ejecutar.
 * @param dataDir Directorio donde se guardarán los archivos CSV.
 * @returns Un objeto con los nombres de los archivos generados.
 */
async function _extractDataQuery(conn: Connection, soqlQuery: string, dataDir: string, mainObjectName: string): Promise<{ parentFile: string, childFiles: string[] }> {
  logger.info(`Ejecutando consulta con Query API: ${soqlQuery}`);
  
  const allRelatedIdsToFetch = new Map<string, Set<string>>(); // Map<SObjectName, Set<Id>>
  const sObjectMetadataMap = new Map<string, { describe: SObjectDescribe, referenceFields: any[] }>();

  async function ensureMetadata(objectName: string): Promise<{ describe: SObjectDescribe, referenceFields: any[] }> {
    if (sObjectMetadataMap.has(objectName)) {
      return sObjectMetadataMap.get(objectName)!;
    }
    logger.debug(`DEBUG: ensureMetadata - Describiendo SObject: ${objectName} ya que no está en sObjectMetadataMap.`);
    const describe = await sfdcApi.describeSObject(conn, objectName); // Corregido: sin guion bajo
    const referenceFields = describe.fields.filter(f => f.type === 'reference' && f.referenceTo && f.referenceTo.length > 0);
    const metadata = { describe, referenceFields };
    sObjectMetadataMap.set(objectName, metadata);
    logger.debug(`DEBUG: Metadatos para ${objectName} asegurados y cacheados en sObjectMetadataMap.`);
    return metadata;
  }

  // Asegurar metadatos para el objeto principal
  await ensureMetadata(mainObjectName);
  // const mainObjectDescribe = sObjectMetadataMap.get(mainObjectName)!.describe; // Se usará metadata.describe directamente

  // Extraer el nombre del SObject principal de la consulta
  const mainObjectNameFromQuery = sfdcApi.extractSObjectNameFromSoql(soqlQuery); // Corregido: sin guion bajo
  if (!mainObjectNameFromQuery) {
    throw new Error('No se pudo extraer el nombre del SObject principal de la consulta SOQL.');
  }

  // Determinar qué API usar para el SObject principal
  const apiTypeForMainObject = await sfdcApi.determineApiForSObject(conn, mainObjectNameFromQuery); // Corregido: sin guion bajo
  logger.info(`Ejecutando consulta con ${apiTypeForMainObject.toUpperCase()} API para ${mainObjectNameFromQuery}: ${soqlQuery}`);

  let records;
  try {
    if (apiTypeForMainObject === 'tooling') {
      records = await conn.tooling.query(soqlQuery);
    } else {
      records = await conn.query(soqlQuery);
    }
  } catch (error) {
    logger.error(`ERROR: Fallo al ejecutar la consulta SOQL con ${apiTypeForMainObject.toUpperCase()} API para ${mainObjectNameFromQuery}: ${(error as Error).message}`);
    throw error;
  }

  const parentRecords: any[] = [];
  const childRecordsMap: { [childObjectName: string]: any[] } = {};
  const childFiles: string[] = [];

  // Helper para obtener el campo de visualización de un objeto, con caché
  async function getDisplayFieldCached(objName: string): Promise<string | undefined> {
    if (sObjectDisplayFieldCache.has(objName)) {
      return sObjectDisplayFieldCache.get(objName);
    }
    // Necesitamos la descripción para esto, la obtenemos de ensureMetadata para asegurar que se cachea correctamente
    const metadata = await ensureMetadata(objName);
    const displayField = sfdcApi.getSObjectDisplayField(metadata.describe); // Corregido: sin guion bajo
    sObjectDisplayFieldCache.set(objName, displayField);
    return displayField;
  }

  // Helper para obtener campos únicos obligatorios de un objeto, con caché
  async function getUniqueNillableFalseFieldsCached(objName: string): Promise<{ name: string, type: string }[]> {
    if (sObjectUniqueFieldsCache.has(objName)) {
      return sObjectUniqueFieldsCache.get(objName)!;
    }
    // Necesitamos la descripción para esto, la obtenemos de ensureMetadata
    const metadata = await ensureMetadata(objName);
    const uniqueFields = metadata.describe.fields.filter(f => f.unique && !f.nillable && f.type === 'string').map(f => ({ name: f.name, type: f.type }));
    sObjectUniqueFieldsCache.set(objName, uniqueFields);
    return uniqueFields;
  }

  // Función para procesar un registro y extraer IDs de referencia
  async function processRecord(
    record: any,
    currentObjectName: string,
    metadata: { describe: SObjectDescribe, referenceFields: any[] },
    isParent: boolean = true
  ) {
    logger.debug(`DEBUG: processRecord - INICIO para objeto: ${currentObjectName}, ¿es padre?: ${isParent}, registro: ${JSON.stringify(record)}`);
    const processedRecord: any = {}; // Initialize an empty object for processed record
    const originalRecord = { ...record }; // Keep a copy of the original record
    delete originalRecord.attributes; // Remove attributes from the original record copy

    const objDescribe = metadata.describe;
    logger.debug(`DEBUG: Campos de la descripción de ${currentObjectName} (desde metadatos pasados): ${objDescribe.fields.map(f => f.name + (f.relationshipName ? ` (${f.relationshipName})` : '')).join(', ')}`);

    // Copiar todos los campos del registro original al registro procesado
    for (const fieldName in originalRecord) {
      processedRecord[fieldName] = originalRecord[fieldName];
    }

    // Iterar sobre los campos de referencia pre-calculados para identificar y procesar campos de referencia.
    for (const field of metadata.referenceFields) {
      const refId = originalRecord[field.name];
      if (refId) {
        const referencedObjectName = field.referenceTo![0]; // Asumiendo una única referencia
        logger.debug(`DEBUG: Encontrado campo de referencia (desde metadatos pasados): ${field.name} (${referencedObjectName}) con ID: ${refId}`);
        if (!allRelatedIdsToFetch.has(referencedObjectName)) {
          allRelatedIdsToFetch.set(referencedObjectName, new Set<string>());
        }
        allRelatedIdsToFetch.get(referencedObjectName)!.add(refId);
      }
    }

    // Procesar subconsultas utilizando objDescribe.childRelationships
    // SOLO si es un registro padre (isParent === true)
    if (isParent) {
      if (objDescribe.childRelationships && objDescribe.childRelationships.length > 0) {
        logger.debug(`DEBUG: Buscando subconsultas en childRelationships de ${currentObjectName} porque es PADRE. Total de childRelationships: ${objDescribe.childRelationships.length}`);
          // Iterar sobre las claves del registro original que parecen ser subconsultas
          const potentialSubqueryKeys = Object.keys(originalRecord).filter(key =>
            originalRecord[key] &&
            typeof originalRecord[key] === 'object' &&
            originalRecord[key].records !== undefined &&
            Array.isArray(originalRecord[key].records)
          );

          if (potentialSubqueryKeys.length > 0) {
            logger.debug(`DEBUG: Claves de subconsulta potenciales encontradas en el registro de ${currentObjectName}: ${potentialSubqueryKeys.join(', ')}`);
          }
          
          for (const childRelationshipNameFromKey of potentialSubqueryKeys) {
            // Encontrar la metada de childRelationship correspondiente
            // Asegurarse de que objDescribe.childRelationships existe antes de usar find
            const childRel: ChildRelationship | undefined = objDescribe.childRelationships?.find(cr => cr.relationshipName === childRelationshipNameFromKey);

            if (childRel) {
              const childSObjectName = childRel.childSObject;
              const fieldOnChildToParent = childRel.field;

              // Solo proceder si childSObjectName es válido
              if (childSObjectName && typeof childRelationshipNameFromKey === 'string') { // childRelationshipNameFromKey es string por Object.keys
                logger.debug(`DEBUG: Procesando subconsulta (basado en clave de registro): '${childRelationshipNameFromKey}' (Objeto hijo: ${childSObjectName}, Campo en hijo: ${fieldOnChildToParent})`);
                
                const subqueryData = originalRecord[childRelationshipNameFromKey]; // Ya sabemos que es una estructura de subconsulta válida
                const childRecordsData = subqueryData.records;
                
                logger.debug(`DEBUG: Subconsulta ENCONTRADA para relationshipName: '${childRelationshipNameFromKey}' (Objeto: ${childSObjectName}). Registros: ${childRecordsData.length}`);

                const childMetadata = await ensureMetadata(childSObjectName);
                delete processedRecord[childRelationshipNameFromKey];

                if (!childRecordsMap[childSObjectName]) {
                  childRecordsMap[childSObjectName] = [];
                  logger.debug(`DEBUG: Inicializando childRecordsMap para: ${childSObjectName}`);
                }

                for (const childRecord of childRecordsData) {
                  const processedChildRecord = await processRecord(childRecord, childSObjectName, childMetadata, false);
                  logger.debug(`DEBUG: Añadiendo ID del padre (${currentObjectName} Id: ${originalRecord.Id}) al hijo ${childSObjectName} usando el campo '${fieldOnChildToParent}'`);
                  processedChildRecord[fieldOnChildToParent] = originalRecord.Id;
                  childRecordsMap[childSObjectName].push(processedChildRecord);
                  logger.debug(`DEBUG: Añadido registro hijo procesado a childRecordsMap para ${childSObjectName}.`);
                }
              } else {
                // Esto podría ocurrir si childSObject es nulo en los metadatos para una relationshipName que sí está en los datos.
                logger.warn(`ADVERTENCIA: Para la clave de subconsulta '${childRelationshipNameFromKey}' en ${currentObjectName}, los metadatos de childRelationship indican un childSObject nulo ('${childSObjectName}') o relationshipName no es string. Se omite esta subconsulta.`);
              }
            } else {
              // Esto significa que una clave en originalRecord parecía una subconsulta (tenía .records) pero no coincidía con ninguna childRelationshipName conocida en los metadatos.
              logger.warn(`ADVERTENCIA: La clave '${childRelationshipNameFromKey}' en el registro de ${currentObjectName} parece una subconsulta pero no coincide con ninguna childRelationship definida en los metadatos. Se omite.`);
            }
          }
      } else {
        logger.debug(`DEBUG: No hay childRelationships definidas en la descripción para ${currentObjectName} (o no es padre y no se buscan).`);
      }
    } else {
        // Si no es un registro padre, se omite la búsqueda de subconsultas en childRelationships.
        logger.debug(`DEBUG: El registro de ${currentObjectName} no es padre (isParent=${isParent}), se omite la búsqueda de subconsultas en childRelationships.`);
    }
    return processedRecord;
  }

  const parentMetadata = sObjectMetadataMap.get(mainObjectName)!;
  for (const record of records.records) {
    const processedParentRecord = await processRecord(record, mainObjectName, parentMetadata, true);
    parentRecords.push(processedParentRecord);
  }

  // Obtener los valores de los campos de visualización para todos los IDs recopilados
  for (const [objName, ids] of allRelatedIdsToFetch.entries()) {
    const displayField = await getDisplayFieldCached(objName);
    const uniqueNillableFalseFields = await getUniqueNillableFalseFieldsCached(objName);

    if (displayField || uniqueNillableFalseFields.length > 0) {
      const idList = Array.from(ids);
      // Dividir en lotes de 200 para la consulta SOQL
      for (let i = 0; i < idList.length; i += 200) {
        const batchIds = idList.slice(i, i + 200);
        const fieldsToQuery = ['Id'];
        if (displayField) {
          fieldsToQuery.push(displayField);
        }
        uniqueNillableFalseFields.forEach(f => fieldsToQuery.push(f.name));

        const query = `SELECT ${fieldsToQuery.join(',')} FROM ${objName} WHERE Id IN ('${batchIds.join("','")}')`;
        // Determinar qué API usar para el SObject relacionado
        const apiTypeForRelatedObject = await sfdcApi.determineApiForSObject(conn, objName); // Corregido: sin guion bajo
        logger.debug(`DEBUG: Consultando campos de visualización/únicos para ${objName} con ${apiTypeForRelatedObject.toUpperCase()} API: ${query}`);
        let displayRecords;
        try {
          if (apiTypeForRelatedObject === 'tooling') {
            displayRecords = await conn.tooling.query(query);
          } else {
            displayRecords = await conn.query(query);
          }
        } catch (error) {
          logger.error(`ERROR: Fallo al consultar campos de visualización/únicos para ${objName} con la query "${query}" usando ${apiTypeForRelatedObject.toUpperCase()} API: ${(error as Error).message}`);
          throw error;
        }

        if (!idDisplayValueCache.has(objName)) {
          idDisplayValueCache.set(objName, new Map<string, string>());
        }
        const objCache = idDisplayValueCache.get(objName)!;

        for (const dispRec of displayRecords.records) {
          if (displayField && dispRec[displayField] !== undefined && dispRec[displayField] !== null) {
            objCache.set(dispRec.Id!, String(dispRec[displayField])); // Use non-null assertion for dispRec.Id
          }
          uniqueNillableFalseFields.forEach(f => {
            if (dispRec[f.name] !== undefined && dispRec[f.name] !== null) {
              objCache.set(`${dispRec.Id!}_${f.name}`, String(dispRec[f.name])); // Store with a suffix for unique fields
            }
          });
        }
      }
    }
  }

  // Añadir campos de visualización y únicos a los registros
  function addRelatedFieldsToRecord(record: any, referenceFields: any[], objName: string) {
    for (const field of referenceFields) { // Usar los campos de referencia pre-filtrados
      // La condición (field.type === 'reference' && field.referenceTo && field.referenceTo.length > 0) ya se cumplió
      const refId = record[field.name];
      if (refId) {
        const referencedObjectName = field.referenceTo![0]; // Sabemos que referenceTo existe y tiene elementos
        const objCache = idDisplayValueCache.get(referencedObjectName);
        if (objCache) {
          const displayField = sObjectDisplayFieldCache.get(referencedObjectName); // Esta caché es para nombres de campos, está bien
          if (displayField && objCache.has(refId)) {
            record[`${field.name}_${displayField}`] = objCache.get(refId);
          }
          const uniqueFields = sObjectUniqueFieldsCache.get(referencedObjectName); // Esta caché es para nombres de campos, está bien
          if (uniqueFields) {
            uniqueFields.forEach(f_unique => { // Renombrar f para evitar colisión de nombres
              const uniqueValue = objCache.get(`${refId}_${f_unique.name}`);
              if (uniqueValue) {
                record[`${field.name}_${f_unique.name}`] = uniqueValue;
              }
            });
          }
        }
      }
    }
  }

  // Procesar registros padre
  const mainMeta = sObjectMetadataMap.get(mainObjectName)!;
  for (const record of parentRecords) {
    addRelatedFieldsToRecord(record, mainMeta.referenceFields, mainObjectName);
  }

  // Procesar registros hijo
  for (const childObjectName in childRecordsMap) {
    const childMetadata = sObjectMetadataMap.get(childObjectName);
    if (childMetadata) { // Asegurarse de que los metadatos del hijo existen
      for (const record of childRecordsMap[childObjectName]) {
        addRelatedFieldsToRecord(record, childMetadata.referenceFields, childObjectName);
      }
    } else {
      logger.warn(`ADVERTENCIA: No se encontraron metadatos en sObjectMetadataMap para ${childObjectName} al intentar añadir campos relacionados. Se omitirán para este objeto.`);
    }
  }

  // Escribir el archivo CSV del objeto padre
  const parentOutputFile = path.join(dataDir, `${mainObjectName}.csv`);
  await fileManagerAPI.writeRecordsToCsv(parentRecords, parentOutputFile);
  logger.info(`Registros de ${mainObjectName} guardados en ${parentOutputFile}`);

  // Escribir los archivos CSV de los objetos hijos
  for (const childObjectName in childRecordsMap) {
    const childOutputFile = path.join(dataDir, `${childObjectName}.csv`);
    await fileManagerAPI.writeRecordsToCsv(childRecordsMap[childObjectName], childOutputFile);
    logger.info(`Registros de ${childObjectName} guardados en ${childOutputFile}`);
    childFiles.push(childOutputFile);
  }

  return { parentFile: parentOutputFile, childFiles };
}
/**
 * Executes a SOSL query using the Salesforce REST API.
 * @param connection jsforce Connection.
 * @param soslQuery The SOSL query string.
 * @returns A promise that resolves to an array of search result records.
 */
async function _executeSoslQuery(connection: Connection, soslQuery: string): Promise<any[]> { // El tipo de retorno podría ser más específico, ej. SearchResult o un tipo customizado
    try {
        logger.info(`Executing SOSL query: ${soslQuery}`);
        const result = await connection.search(soslQuery);
        // La API de JSForce devuelve 'searchRecords' que es un array de los registros encontrados.
        // Cada elemento puede pertenecer a un SObject diferente.
        // Es importante notar que connection.search() ya parsea el resultado JSON.
        // El resultado directo de connection.search(soslQuery) es un objeto con una propiedad searchRecords que es un array.
        // Ejemplo de un registro en searchRecords: {attributes: {type: 'Account', url: '/services/data/...'}, Id: '001...', Name: 'Test Account'}
        return result.searchRecords || [];
    } catch (error: any) {
        logger.error(`Error executing SOSL query: ${error.message}`, error);
        throw new Error(`SOSL Query execution failed: ${error.message}`);
    }
}

export const sfdcApi = {
  extractSObjectNameFromSoql: _extractSObjectNameFromSoql,
  determineApiForSObject: _determineApiForSObject,
  describeSObject: _describeSObject,
  getSObjectDisplayField: _getSObjectDisplayField,
  listAllSObjects: _listAllSObjects,
  extractDataBulk: _extractDataBulk,
  extractDataQuery: _extractDataQuery,
  executeSoslQuery: _executeSoslQuery,
};