// src/core/sfdc-api.ts
import { Connection } from 'jsforce';
import { SObjectDescribe, ChildRelationship } from './typeDefs.js'; // Importar ChildRelationship
import { createWriteStream } from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { Logger } from './logger.js';

const logger = new Logger('SfdcApi');
import { writeRecordsToCsv } from './fileManager.js'; // Se necesitará esta función

// Caché para descripciones de SObject
const sObjectDescribeCache = new Map<string, SObjectDescribe>();
const sObjectDisplayFieldCache = new Map<string, string | undefined>();
const sObjectUniqueFieldsCache = new Map<string, { name: string, type: string }[]>();

// Caché para los valores de los campos de visualización de IDs
const idDisplayValueCache = new Map<string, Map<string, string>>(); // Map<SObjectName, Map<Id, DisplayValue>>

/**
 * Obtiene la descripción de metadatos de un SObject, utilizando caché.
 * @param conn Conexión de jsforce.
 * @param objectName El nombre de API del objeto.
 */
export async function describeSObject(conn: Connection, objectName: string): Promise<SObjectDescribe> {
  logger.debug(`DEBUG: Describiendo SObject: ${objectName}`);
  if (sObjectDescribeCache.has(objectName)) {
    logger.debug(`DEBUG: Usando caché para la descripción de ${objectName}`);
    return sObjectDescribeCache.get(objectName)!;
  }
  try {
    const describe = await conn.sobject(objectName).describe();
    sObjectDescribeCache.set(objectName, describe);
    logger.debug(`DEBUG: Descripción de ${objectName} obtenida y cacheada.`);
    return describe;
  } catch (error) {
    logger.error(`ERROR: Fallo al describir el objeto ${objectName}: ${(error as Error).message}`);
    throw error;
  }
}

/**
 * Determina el campo más adecuado para mostrar como identificador legible para un SObject.
 * Prioriza Name, luego Username, luego CaseNumber, luego cualquier campo único no nulo.
 * @param describe La descripción del SObject.
 * @returns El nombre del campo identificador.
 */
export function getSObjectDisplayField(describe: SObjectDescribe): string | undefined {
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
export async function listAllSObjects(conn: Connection): Promise<string[]> {
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
export async function extractDataBulk(conn: Connection, soqlQuery: string, outputFile: string): Promise<Readable> {
  const recordStream = (await conn.bulk.query(soqlQuery)).stream();
  const fileWriteStream = createWriteStream(outputFile);
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
export async function extractDataQuery(conn: Connection, soqlQuery: string, dataDir: string, mainObjectName: string): Promise<{ parentFile: string, childFiles: string[] }> {
  logger.info(`Ejecutando consulta con Query API: ${soqlQuery}`);
  
  const allRelatedIdsToFetch = new Map<string, Set<string>>(); // Map<SObjectName, Set<Id>>
  const sObjectMetadataMap = new Map<string, { describe: SObjectDescribe, referenceFields: any[] }>();

  async function ensureMetadata(objectName: string): Promise<{ describe: SObjectDescribe, referenceFields: any[] }> {
    if (sObjectMetadataMap.has(objectName)) {
      return sObjectMetadataMap.get(objectName)!;
    }
    logger.debug(`DEBUG: ensureMetadata - Describiendo SObject: ${objectName} ya que no está en sObjectMetadataMap.`);
    const describe = await describeSObject(conn, objectName); // describeSObject tiene su propia caché interna
    const referenceFields = describe.fields.filter(f => f.type === 'reference' && f.referenceTo && f.referenceTo.length > 0);
    const metadata = { describe, referenceFields };
    sObjectMetadataMap.set(objectName, metadata);
    logger.debug(`DEBUG: Metadatos para ${objectName} asegurados y cacheados en sObjectMetadataMap.`);
    return metadata;
  }

  // Asegurar metadatos para el objeto principal
  await ensureMetadata(mainObjectName);
  // const mainObjectDescribe = sObjectMetadataMap.get(mainObjectName)!.describe; // Se usará metadata.describe directamente

  // Execute the original SOQL query
  const records = await conn.query(soqlQuery);
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
    const displayField = getSObjectDisplayField(metadata.describe);
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
        logger.debug(`DEBUG: Consultando campos de visualización/únicos para ${objName}: ${query}`);
        let displayRecords; // Declare displayRecords outside try block
        try {
          displayRecords = await conn.query(query);
        } catch (error) {
          logger.error(`ERROR: Fallo al consultar campos de visualización/únicos para ${objName} con la query "${query}": ${(error as Error).message}`);
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
  await writeRecordsToCsv(parentRecords, parentOutputFile);
  logger.info(`Registros de ${mainObjectName} guardados en ${parentOutputFile}`);

  // Escribir los archivos CSV de los objetos hijos
  for (const childObjectName in childRecordsMap) {
    const childOutputFile = path.join(dataDir, `${childObjectName}.csv`);
    await writeRecordsToCsv(childRecordsMap[childObjectName], childOutputFile);
    logger.info(`Registros de ${childObjectName} guardados en ${childOutputFile}`);
    childFiles.push(childOutputFile);
  }

  return { parentFile: parentOutputFile, childFiles };
}