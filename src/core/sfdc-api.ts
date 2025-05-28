// src/core/sfdc-api.ts
import { Connection } from 'jsforce';
import { SObjectDescribe } from './typeDefs.js';
import { createWriteStream } from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { logger } from './logger.js';
import { writeRecordsToCsv } from './fileManager.js'; // Se necesitará esta función

/**
 * Obtiene la descripción de metadatos de un SObject.
 * @param conn Conexión de jsforce.
 * @param objectName El nombre de API del objeto.
 */
export async function describeSObject(conn: Connection, objectName: string): Promise<SObjectDescribe> {
  return await conn.sobject(objectName).describe();
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
export async function extractDataQuery(conn: Connection, soqlQuery: string, dataDir: string): Promise<{ parentFile: string, childFiles: string[] }> {
  logger.info(`Ejecutando consulta con Query API: ${soqlQuery}`);
  const records = await conn.query(soqlQuery);
  const parentRecords: any[] = [];
  const childRecordsMap: { [childObjectName: string]: any[] } = {};
  const childFiles: string[] = [];

  const mainObjectNameMatch = soqlQuery.match(/FROM\s+(\w+)/i);
  if (!mainObjectNameMatch) {
    throw new Error("No se pudo determinar el objeto principal de la consulta SOQL.");
  }
  const mainObjectName = mainObjectNameMatch[1];

  for (const record of records.records) {
    const parentId = record.Id;
    const parentRecord: any = { ...record };
    delete parentRecord.attributes; // Eliminar atributos de jsforce

    for (const key in parentRecord) {
      if (parentRecord[key] && typeof parentRecord[key] === 'object' && parentRecord[key].records) {
        // Es una subconsulta (relación padre-hijo)
        const childObjectName = key; // El nombre de la relación es la clave
        const childRecords = parentRecord[key].records;
        
        delete parentRecord[key]; // Eliminar la subconsulta del registro padre

        if (!childRecordsMap[childObjectName]) {
          childRecordsMap[childObjectName] = [];
        }

        for (const childRecord of childRecords) {
          const processedChildRecord: any = { ...childRecord };
          delete processedChildRecord.attributes; // Eliminar atributos de jsforce
          // Añadir el ID del padre al registro hijo
          processedChildRecord[`${mainObjectName}Id`] = parentId;
          childRecordsMap[childObjectName].push(processedChildRecord);
        }
      }
    }
    parentRecords.push(parentRecord);
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