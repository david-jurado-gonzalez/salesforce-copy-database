/**
 * @file backupQuerySuggester.ts
 * @description Lógica para sugerir consultas SOQL para backups.
 */

import { Connection } from 'jsforce';
import { SObjectDescribe, Field /*ChildRelationship, Field*/ } from '../core/typeDefs.js'; // Added Field for explicit typing
import { sfdcApi } from '../core/sfdc-api.js'; // Updated import
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

    sObjectDescribe.fields.forEach((field: Field) => { // Added type
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
                const parentDescribe = await sfdcApi.describeSObject(conn, parentObjectName); // Updated call
                let parentDisplayFieldName = 'Id'; // Por defecto, si no se encuentra 'Name' u otro
                const nameField = parentDescribe.fields.find((f: Field) => f.name.toLowerCase() === 'name'); // Added type
                if (nameField) {
                    parentDisplayFieldName = nameField.name;
                } else {
                    // Si no hay 'Name', buscar 'Username', 'CaseNumber', etc. o primer string no ID
                    const commonDisplayFields = ['Username', 'CaseNumber'];
                    for (const dfName of commonDisplayFields) {
                        if (parentDescribe.fields.some((f: Field) => f.name === dfName && f.type === 'string')) { // Added type
                            parentDisplayFieldName = dfName;
                            break;
                        }
                    }
                    if (parentDisplayFieldName === 'Id') { // Si sigue siendo Id, buscar primer string no Id
                        const firstStringField = parentDescribe.fields.find((f: Field) => f.type === 'string' && f.name !== 'Id'); // Added type
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
                    const childDescribe = await sfdcApi.describeSObject(conn, childRel.childSObject); // Updated call
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
        const allSObjectNamesFromAPI = await sfdcApi.listAllSObjects(conn); // Updated call

        // 1.a. Crear nonNamespacedPool
        const nonNamespacedPool = allSObjectNamesFromAPI.filter((name: string) => name.split('__').length <= 2); // Added type

        // 1.b. Opcional: namespacedObjectsFilteredOut
        const namespacedObjectsFilteredOut = allSObjectNamesFromAPI.filter((name: string) => !nonNamespacedPool.includes(name)); // Added type

        // 1.c. Registrar objetos con namespace excluidos
        if (namespacedObjectsFilteredOut.length > 0) {
            logger.info(`Se excluyen por defecto de las sugerencias los siguientes objetos con namespace: ${namespacedObjectsFilteredOut.join(', ')}`);
        }

        // 2. Modificar la derivación de customObjectNames
        const customObjectNames = nonNamespacedPool.filter((name: string) => name.endsWith('__c')); // Added type
        
        // 3. Ajustar la lógica para construir la lista final de objetos a procesar
        let objectNamesToConsider: string[] = [];

        // 3.b. Iterar sobre prioritizedObjectNames
        prioritizedObjectNames.forEach((name: string) => { // Added type
            if (allSObjectNamesFromAPI.includes(name)) {
                if (!objectNamesToConsider.includes(name)) {
                    objectNamesToConsider.push(name);
                }
            } else {
                logger.warn(`El objeto priorizado '${name}' no se encontró en la organización y será ignorado.`);
            }
        });

        // 3.c. Iterar sobre customObjectNames
        customObjectNames.forEach((name: string) => { // Added type
            if (!objectNamesToConsider.includes(name)) {
                objectNamesToConsider.push(name);
            }
        });
        
        // 4. Ajustar la lógica de fallback
        if (objectNamesToConsider.length === 0 && nonNamespacedPool.length > 0) {
            // 4.a.i. Filtrar fallbackStandard contra nonNamespacedPool
            const fallbackStandard = ['Account', 'Contact', 'Opportunity', 'Case', 'Lead']
                .filter((s: string) => nonNamespacedPool.includes(s)); // Added type
            
            // 4.a.ii. Añadir objetos estándar de fallback
            fallbackStandard.slice(0, 3).forEach((s: string) => { // Added type
                if (!objectNamesToConsider.includes(s)) {
                    objectNamesToConsider.push(s);
                }
            });

            // 4.a.iii. Si sigue vacía y nonNamespacedPool no está vacía, añadir el primero
            if (objectNamesToConsider.length === 0 && nonNamespacedPool.length > 0) {
                 if (!objectNamesToConsider.includes(nonNamespacedPool[0])) {
                    objectNamesToConsider.push(nonNamespacedPool[0]);
                }
            }
        }

        // 5. Asegurar que la lista final de objetos (sin duplicados) se use para generar las consultas
        const finalObjectNamesToProcess = [...new Set(objectNamesToConsider)]; // Eliminar duplicados por si acaso

        logger.info(`Objetos a procesar para sugerencias: ${finalObjectNamesToProcess.join(', ')}`);

        if (finalObjectNamesToProcess.length === 0) {
            logger.warn('No se encontraron objetos para procesar después de aplicar filtros y prioridades. No se generarán sugerencias.');
        }

        for (const objectName of finalObjectNamesToProcess) {
            try {
                logger.info(`Analizando objeto: ${objectName}`);
                const sObjectDescribe = await sfdcApi.describeSObject(conn, objectName); // Updated call

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