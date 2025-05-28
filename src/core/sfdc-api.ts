// src/core/sfdc-api.ts
import { Connection } from 'jsforce';
import { SObjectDescribe } from './typeDefs.js';
import { createWriteStream } from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { logger } from './logger.js';
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
  
  const mainObjectDescribe = await describeSObject(conn, mainObjectName);
  const allRelatedIdsToFetch = new Map<string, Set<string>>(); // Map<SObjectName, Set<Id>>

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
    const describe = await describeSObject(conn, objName);
    const displayField = getSObjectDisplayField(describe);
    sObjectDisplayFieldCache.set(objName, displayField);
    return displayField;
  }

  // Helper para obtener campos únicos obligatorios de un objeto, con caché
  async function getUniqueNillableFalseFieldsCached(objName: string): Promise<{ name: string, type: string }[]> {
    if (sObjectUniqueFieldsCache.has(objName)) {
      return sObjectUniqueFieldsCache.get(objName)!;
    }
    const describe = await describeSObject(conn, objName);
    const uniqueFields = describe.fields.filter(f => f.unique && !f.nillable && f.type === 'string').map(f => ({ name: f.name, type: f.type }));
    sObjectUniqueFieldsCache.set(objName, uniqueFields);
    return uniqueFields;
  }

  // Función para procesar un registro y extraer IDs de referencia
  async function processRecord(record: any, currentObjectName: string, isParent: boolean = true) {
    logger.debug(`DEBUG: processRecord - INICIO para objeto: ${currentObjectName}, ¿es padre?: ${isParent}, registro: ${JSON.stringify(record)}`);
    const processedRecord: any = {}; // Initialize an empty object for processed record
    const originalRecord = { ...record }; // Keep a copy of the original record
    delete originalRecord.attributes; // Remove attributes from the original record copy

    const objDescribe = await describeSObject(conn, currentObjectName);
    logger.debug(`DEBUG: Campos de la descripción de ${currentObjectName}: ${objDescribe.fields.map(f => f.name + (f.relationshipName ? ` (${f.relationshipName})` : '')).join(', ')}`);

    // Copy all fields from the original record to processedRecord
    for (const fieldName in originalRecord) {
      processedRecord[fieldName] = originalRecord[fieldName];
    }

    // Iterar sobre los campos descritos para identificar y procesar campos de referencia
    for (const field of objDescribe.fields) {
      if (field.type === 'reference' && field.referenceTo && field.referenceTo.length > 0) {
        const refId = originalRecord[field.name]; // Usar originalRecord para obtener el ID
        if (refId) {
          const referencedObjectName = field.referenceTo[0]; // Asumiendo una única referencia por simplicidad
          logger.debug(`DEBUG: Encontrado campo de referencia: ${field.name} (${referencedObjectName}) con ID: ${refId}`);
          if (!allRelatedIdsToFetch.has(referencedObjectName)) {
            allRelatedIdsToFetch.set(referencedObjectName, new Set<string>());
          }
          allRelatedIdsToFetch.get(referencedObjectName)!.add(refId);
        }
      }
      // La lógica de subconsultas se moverá a la iteración de childRelationships
    }

    // Procesar subconsultas utilizando objDescribe.childRelationships
    // Esta es la forma más robusta de identificar relaciones hijo.
    if (objDescribe.childRelationships && objDescribe.childRelationships.length > 0) {
      logger.debug(`DEBUG: Buscando subconsultas en childRelationships de ${currentObjectName}. Total de childRelationships: ${objDescribe.childRelationships.length}`);
      for (const childRel of objDescribe.childRelationships) {
        // childRel: { cascadeDelete: boolean, childSObject: string, deprecatedAndHidden: boolean, field: string, junctionIdListNames: any[], junctionReferenceTo: any[], relationshipName: string, restrictedDelete: boolean }
        const childRelationshipName = childRel.relationshipName; // Ej: "Contacts"
        const childSObjectName = childRel.childSObject;    // Ej: "Contact"
        const fieldOnChildToParent = childRel.field;       // Ej: "AccountId"

        logger.debug(`DEBUG: Evaluando childRelationship: '${childRelationshipName}' (Objeto hijo: ${childSObjectName}, Campo en hijo: ${fieldOnChildToParent})`);

        // Asegurarse de que childRelationshipName es un string antes de usarlo como clave
        if (typeof childRelationshipName === 'string') {
          if (originalRecord[childRelationshipName] &&
              typeof originalRecord[childRelationshipName] === 'object' &&
              originalRecord[childRelationshipName].records !== undefined && // Verificar explícitamente .records
              Array.isArray(originalRecord[childRelationshipName].records)) {
            
            const subqueryData = originalRecord[childRelationshipName];
            const childRecords = subqueryData.records;
            
            logger.debug(`DEBUG: Subconsulta ENCONTRADA para relationshipName: '${childRelationshipName}' (Objeto: ${childSObjectName}). Registros: ${childRecords.length}`);

            // Eliminar la subconsulta del registro procesado del padre, ya que irá a un CSV separado
            delete processedRecord[childRelationshipName];

            if (!childRecordsMap[childSObjectName]) {
              childRecordsMap[childSObjectName] = [];
              logger.debug(`DEBUG: Inicializando childRecordsMap para: ${childSObjectName}`);
            }

            for (const childRecord of childRecords) {
              // Procesar recursivamente el registro hijo
              const processedChildRecord = await processRecord(childRecord, childSObjectName, false);
              
              // Añadir el ID del padre al registro hijo usando el campo correcto de la relación
              logger.debug(`DEBUG: Añadiendo ID del padre (${currentObjectName} Id: ${originalRecord.Id}) al hijo ${childSObjectName} usando el campo '${fieldOnChildToParent}'`);
              processedChildRecord[fieldOnChildToParent] = originalRecord.Id;
              
              childRecordsMap[childSObjectName].push(processedChildRecord);
              logger.debug(`DEBUG: Añadido registro hijo procesado a childRecordsMap para ${childSObjectName}.`);
            }
          } else {
            // Log si la clave existe pero no es una subconsulta válida, o si no existe.
            if (originalRecord.hasOwnProperty(childRelationshipName)) {
              logger.debug(`DEBUG: La clave '${childRelationshipName}' existe en originalRecord para ${currentObjectName}, pero no es una subconsulta con estructura .records válida. Valor: ${JSON.stringify(originalRecord[childRelationshipName])}`);
            } else {
              // Esto es normal si la SOQL no incluyó esta subconsulta específica.
              // logger.debug(`DEBUG: La clave de relación '${childRelationshipName}' no está presente en originalRecord para ${currentObjectName}.`);
            }
          }
        } else {
          logger.warn(`ADVERTENCIA: relationshipName es nulo o indefinido para una childRelationship de ${currentObjectName}. Objeto hijo: ${childSObjectName}, Campo en hijo: ${fieldOnChildToParent}. Se omite esta relación.`);
        }
      }
    } else {
      logger.debug(`DEBUG: No hay childRelationships definidas en la descripción para ${currentObjectName}.`);
    }
    return processedRecord;
  }

  for (const record of records.records) {
    const processedParentRecord = await processRecord(record, mainObjectName);
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
  function addRelatedFieldsToRecord(record: any, objDescribe: SObjectDescribe) {
    for (const field of objDescribe.fields) {
      if (field.type === 'reference' && field.referenceTo && field.referenceTo.length > 0) {
        const refId = record[field.name];
        if (refId) {
          const referencedObjectName = field.referenceTo[0];
          const objCache = idDisplayValueCache.get(referencedObjectName);
          if (objCache) {
            const displayField = sObjectDisplayFieldCache.get(referencedObjectName);
            if (displayField && objCache.has(refId)) {
              record[`${field.name}_${displayField}`] = objCache.get(refId);
            }
            const uniqueFields = sObjectUniqueFieldsCache.get(referencedObjectName);
            if (uniqueFields) {
              uniqueFields.forEach(f => {
                const uniqueValue = objCache.get(`${refId}_${f.name}`);
                if (uniqueValue) {
                  record[`${field.name}_${f.name}`] = uniqueValue;
                }
              });
            }
          }
        }
      }
    }
  }

  // Procesar registros padre
  for (const record of parentRecords) {
    addRelatedFieldsToRecord(record, mainObjectDescribe);
  }

  // Procesar registros hijo
  for (const childObjectName in childRecordsMap) {
    const childObjDescribe = await describeSObject(conn, childObjectName);
    for (const record of childRecordsMap[childObjectName]) {
      addRelatedFieldsToRecord(record, childObjDescribe);
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