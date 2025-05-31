/**
 * @file backupQuerySuggester.ts
 * @description Lógica para sugerir consultas SOQL para backups.
 */

import { Connection } from 'jsforce';
import { SObjectDescribe, /*ChildRelationship, Field*/ } from '../core/typeDefs.js';
import { listAllSObjects, describeSObject } from '../core/sfdc-api.js';
import { Logger } from '../core/logger.js';

const logger = new Logger('BackupQuerySuggester');

const STANDARD_AUDIT_FIELDS = ['CreatedDate', 'LastModifiedDate', 'CreatedById', 'LastModifiedById'];
const EXCLUDED_FIELD_TYPES_FOR_SELECT = ['base64', 'address', 'location', 'complexvalue']; // Tipos a excluir del SELECT principal

interface SuggestedQuery {
    objectName: string;
    query: string;
    reason: string;
}

/**
 * Identifica los campos "interesantes" para un SObject dado.
 * @param sObjectDescribe Descripción del SObject.
 * @returns Lista de nombres de campos.
 */
function getInterestingFields(sObjectDescribe: SObjectDescribe): string[] {
    const fieldsToInclude: Set<string> = new Set();

    // Incluir Id siempre
    fieldsToInclude.add('Id');

    // Incluir campos de auditoría estándar
    STANDARD_AUDIT_FIELDS.forEach(field => fieldsToInclude.add(field));

    sObjectDescribe.fields.forEach(field => {
        // Incluir campo Name si existe y es un string
        if (field.name.toLowerCase() === 'name' && field.type === 'string') {
            fieldsToInclude.add(field.name);
        }

        // Incluir todos los campos personalizados que no sean de un tipo excluido
        if (field.custom && !EXCLUDED_FIELD_TYPES_FOR_SELECT.includes(field.type)) {
            fieldsToInclude.add(field.name);
        }

        // Incluir campos de búsqueda a objetos padre (lookup/master-detail)
        // Se añadirán como Object__r.Name o Object__r.Id si Name no existe
        if (field.type === 'reference' && field.referenceTo && field.referenceTo.length > 0 && field.relationshipName) {
            // La lógica para añadir el campo del padre se manejará en la construcción de la query
            // Aquí solo nos aseguramos de que el campo de ID de la relación se incluya si no es ya un campo estándar
            if (!STANDARD_AUDIT_FIELDS.includes(field.name) && field.name.toLowerCase() !== 'id' && field.name.toLowerCase() !== 'name') {
                 fieldsToInclude.add(field.name); // Incluye el ID del lookup
            }
        }
    });
    logger.debug(`Campos interesantes para ${sObjectDescribe.name}: ${Array.from(fieldsToInclude).join(', ')}`);
    return Array.from(fieldsToInclude);
}

/**
 * Construye una consulta SOQL para un SObject, incluyendo campos interesantes y subconsultas.
 * @param conn Conexión jsforce.
 * @param sObjectDescribe Descripción del SObject.
 * @param interestingFields Lista de campos interesantes.
 * @returns La consulta SOQL generada.
 */
async function buildSOQLQuery(conn: Connection, sObjectDescribe: SObjectDescribe, interestingFields: string[]): Promise<string> {
    const selectFields: string[] = [...interestingFields];

    // Añadir campos de relaciones padre (e.g., Account.Name, CreatedBy.Username)
    for (const field of sObjectDescribe.fields) {
        if (field.type === 'reference' && field.referenceTo && field.referenceTo.length > 0 && field.relationshipName) {
            const parentObjectName = field.referenceTo[0]; // Asumimos una sola referencia por simplicidad
            try {
                const parentDescribe = await describeSObject(conn, parentObjectName);
                let parentDisplayFieldName = 'Id'; // Por defecto, si no se encuentra 'Name' u otro
                const nameField = parentDescribe.fields.find(f => f.name.toLowerCase() === 'name');
                if (nameField) {
                    parentDisplayFieldName = nameField.name;
                } else {
                    // Si no hay 'Name', buscar 'Username', 'CaseNumber', etc. o primer string no ID
                    const commonDisplayFields = ['Username', 'CaseNumber'];
                    for (const dfName of commonDisplayFields) {
                        if (parentDescribe.fields.some(f => f.name === dfName && f.type === 'string')) {
                            parentDisplayFieldName = dfName;
                            break;
                        }
                    }
                    if (parentDisplayFieldName === 'Id') { // Si sigue siendo Id, buscar primer string no Id
                        const firstStringField = parentDescribe.fields.find(f => f.type === 'string' && f.name !== 'Id');
                        if (firstStringField) parentDisplayFieldName = firstStringField.name;
                    }
                }
                selectFields.push(`${field.relationshipName}.${parentDisplayFieldName}`);
            } catch (error) {
                logger.warn(`No se pudo describir el objeto padre ${parentObjectName} para el campo ${field.name}. Se omitirá el campo de relación. Error: ${(error as Error).message}`);
                // Incluir solo el ID si falla la descripción del padre
                if (!selectFields.includes(field.name)) {
                    selectFields.push(field.name);
                }
            }
        }
    }

    // Construir subconsultas para relaciones hijo directas
    const subQueries: string[] = [];
    if (sObjectDescribe.childRelationships) {
        for (const childRel of sObjectDescribe.childRelationships) {
            if (childRel.relationshipName && childRel.childSObject) {
                try {
                    const childDescribe = await describeSObject(conn, childRel.childSObject);
                    const childInterestingFields = getInterestingFields(childDescribe);
                    // Excluir el campo de relación al padre de los campos del hijo para evitar redundancia
                    const childFieldsForSubquery = childInterestingFields.filter(f => f !== childRel.field);
                    if (childFieldsForSubquery.length > 0) {
                        subQueries.push(`(SELECT ${childFieldsForSubquery.join(', ')} FROM ${childRel.relationshipName})`);
                    }
                } catch (error) {
                    logger.warn(`No se pudo describir el objeto hijo ${childRel.childSObject} para la relación ${childRel.relationshipName}. Se omitirá la subconsulta. Error: ${(error as Error).message}`);
                }
            }
        }
    }

    const allFieldsToSelect = [...new Set(selectFields)]; // Eliminar duplicados
    let queryString = `SELECT ${allFieldsToSelect.join(', ')}`;
    if (subQueries.length > 0) {
        queryString += `, ${subQueries.join(', ')}`;
    }
    queryString += ` FROM ${sObjectDescribe.name}`;

    return queryString;
}


/**
 * Genera consultas SOQL sugeridas para backup.
 * @param conn Conexión jsforce.
 * @param prioritizedObjectNames Lista opcional de nombres de SObject a priorizar.
 * @returns Una lista de objetos SuggestedQuery.
 */
export async function generateSuggestedQueries(conn: Connection, prioritizedObjectNames: string[] = ['Account']): Promise<SuggestedQuery[]> {
    logger.info('Generando consultas de backup sugeridas...');
    const suggestedQueries: SuggestedQuery[] = [];

    try {
        const allSObjectNames = await listAllSObjects(conn);
        const customObjectNames = allSObjectNames.filter(name => name.endsWith('__c'));
        
        const objectNamesToProcess: Set<string> = new Set();
        prioritizedObjectNames.forEach(name => objectNamesToProcess.add(name));
        customObjectNames.forEach(name => objectNamesToProcess.add(name));

        // Filtrar para asegurar que los objetos a procesar realmente existen en la org
        const existingObjectsToProcess = Array.from(objectNamesToProcess).filter(name => allSObjectNames.includes(name));
        if (existingObjectsToProcess.length === 0 && allSObjectNames.length > 0) {
            // Si no hay objetos priorizados o custom, o los priorizados no existen, tomar algunos estándar como fallback
            const fallbackStandard = ['Account', 'Contact', 'Opportunity', 'Case', 'Lead'].filter(s => allSObjectNames.includes(s));
            fallbackStandard.slice(0, 3).forEach(s => existingObjectsToProcess.push(s)); // Tomar hasta 3 como máximo
             if (existingObjectsToProcess.length === 0 && allSObjectNames.length > 0) { // Si sigue vacío, tomar el primero que encuentre
                existingObjectsToProcess.push(allSObjectNames[0]);
            }
        }


        logger.info(`Objetos a procesar para sugerencias: ${existingObjectsToProcess.join(', ')}`);

        for (const objectName of existingObjectsToProcess) {
            try {
                logger.info(`Analizando objeto: ${objectName}`);
                const sObjectDescribe = await describeSObject(conn, objectName);

                if (!sObjectDescribe.queryable) {
                    logger.info(`Objeto ${objectName} no es consultable, omitiendo.`);
                    continue;
                }

                const interestingFields = getInterestingFields(sObjectDescribe);
                if (interestingFields.length === 0) {
                    logger.info(`No se encontraron campos interesantes para ${objectName}, omitiendo.`);
                    continue;
                }

                const query = await buildSOQLQuery(conn, sObjectDescribe, interestingFields);
                suggestedQueries.push({
                    objectName,
                    query,
                    reason: `Incluye campos estándar, todos los campos personalizados, campos de relaciones padre y subconsultas para relaciones hijo directas de ${objectName}.`
                });
                logger.info(`Query sugerida para ${objectName}: ${query}`);

            } catch (error) {
                logger.error(`Error al procesar el objeto ${objectName} para sugerencia de query: ${(error as Error).message}`);
            }
        }

        if (suggestedQueries.length === 0) {
            logger.warn('No se pudieron generar consultas de backup sugeridas.');
        }

    } catch (error) {
        logger.error(`Error al generar consultas de backup sugeridas: ${(error as Error).message}`);
        throw error; // Re-lanzar para que el manejador de acciones lo capture
    }

    return suggestedQueries;
}