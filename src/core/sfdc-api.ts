// src/core/sfdc-api.ts
import { Connection } from 'jsforce';
import { SObjectDescribe } from './typeDefs.js';

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

// Aquí irían las funciones para Bulk API (extract, insert, update)
// Por simplicidad, el ejemplo las integra directamente en los comandos,
// pero en una app más grande, deberían estar aquí.