/**
 * @file backupQuerySuggester.ts
 * @description Lógica para sugerir consultas SOQL para backups.
 */

import { Connection } from 'jsforce';
import { SObjectDescribe, Field /*ChildRelationship, Field*/ } from '../core/typeDefs.js'; // Added Field for explicit typing
import { sfdcApi } from '../core/sfdc-api.js'; // Updated import
import { Logger } from '../core/logger.js';

const logger = new Logger('BackupQuerySuggester');

const STANDARD_AUDIT_FIELDS = ['CreatedDate', 'LastModifiedDate', 'CreatedById', 'LastModifiedById', 'SystemModstamp']; // SystemModstamp es común
const EXCLUDED_FIELD_TYPES_FOR_SELECT = ['base64', 'address', 'location', 'complexvalue']; // Tipos a excluir del SELECT principal

// Nuevas constantes para el modo conservador
const FUNDAMENTAL_OBJECTS = ['Account', 'Case', 'Contact', 'Opportunity', 'User', 'RecordType', 'Task', 'Event'];
const CONSERVATIVE_MODE_SAMPLE_LIMIT = 100;
const MIN_POPULATED_THRESHOLD = 0.1; // 10% de los registros de muestra deben tener el campo poblado para considerarlo "usado"

interface SuggestedQuery {
    objectName: string;
    query: string;
    reason: string;
}

interface ObjectProcessingInfo {
    name: string;
    usedFields: Set<string>;
    processed: boolean;
    isFundamental: boolean;
}


/**
 * Realiza una consulta de sondeo para un objeto, identifica campos con datos y lookups poblados.
 * Esta función es clave para el modo conservador.
 * @param conn Conexión jsforce.
 * @param objectName Nombre del SObject.
 * @param sObjectDescribe Descripción del SObject.
 * @returns Un objeto con conjuntos de nombres de campos de datos poblados y nombres de objetos de lookup poblados.
 */
async function getPopulatedFieldsAndLookups(
    conn: Connection,
    objectName: string,
    sObjectDescribe: SObjectDescribe
): Promise<{ populatedDataFields: Set<string>, populatedLookupObjects: Set<string> }> {
    const populatedDataFields = new Set<string>();
    const populatedLookupObjects = new Set<string>();
    const fieldsToQuery = new Set<string>();
    fieldsToQuery.add('Id'); // Siempre incluir Id

    sObjectDescribe.fields.forEach(field => {
        // Incluir campos de lookup para verificar si están poblados y qué referencian
        if (field.type === 'reference' && field.referenceTo && field.referenceTo.length > 0 && field.queryable) {
            fieldsToQuery.add(field.name);
        }
        // Incluir otros campos consultables que no sean de tipos excluidos, auditoría o Id para el sondeo de datos
        else if (
            field.queryable &&
            !EXCLUDED_FIELD_TYPES_FOR_SELECT.includes(field.type) &&
            !STANDARD_AUDIT_FIELDS.includes(field.name) &&
            field.name.toLowerCase() !== 'id' && // Ya añadido
            !field.name.toLowerCase().endsWith('__r') // No campos de relación directa aquí
        ) {
            fieldsToQuery.add(field.name);
        }
    });

    if (fieldsToQuery.size <= 1 && sObjectDescribe.fields.some(f => f.name.toLowerCase() === 'id')) {
        logger.debug(`Objeto ${objectName} solo tiene 'Id' o ningún otro campo adecuado para el sondeo de datos. No se realizará consulta de sondeo.`);
        return { populatedDataFields, populatedLookupObjects };
    }

    const sampleQueryFields = Array.from(fieldsToQuery);
    const sampleQuery = `SELECT ${sampleQueryFields.join(', ')} FROM ${objectName} LIMIT ${CONSERVATIVE_MODE_SAMPLE_LIMIT}`;
    logger.debug(`Ejecutando consulta de sondeo para ${objectName}: ${sampleQuery}`);

    try {
        const result = await conn.query<{ [key: string]: any }>(sampleQuery);
        if (result.records.length > 0) {
            const fieldPopulationCounts: { [key: string]: number } = {};
            sampleQueryFields.forEach(f => fieldPopulationCounts[f] = 0);

            for (const record of result.records) {
                for (const fieldName of sampleQueryFields) {
                    if (record[fieldName] !== null && record[fieldName] !== undefined) {
                        // Para campos de relación, un valor no nulo significa que el lookup está poblado.
                        // Para otros campos, significa que el campo tiene datos.
                        fieldPopulationCounts[fieldName]++;
                    }
                }
            }

            const minRecordsWithValue = Math.max(1, Math.floor(result.records.length * MIN_POPULATED_THRESHOLD));

            sObjectDescribe.fields.forEach(field => {
                if (fieldPopulationCounts[field.name] >= minRecordsWithValue) {
                    if (field.type === 'reference' && field.referenceTo && field.referenceTo.length > 0) {
                        // Si un campo de lookup (ej. AccountId) está poblado, añadirlo a usedFields
                        // y los objetos que referencia a populatedLookupObjects.
                        populatedDataFields.add(field.name); // Añadir el campo de ID del lookup
                        field.referenceTo.forEach(refTo => {
                            if (!refTo.endsWith('__Tag')) { // Excluir objetos de Tagging por ahora
                                populatedLookupObjects.add(refTo);
                            }
                        });
                        logger.debug(`Campo de lookup ${objectName}.${field.name} está consistentemente poblado, referenciando: ${field.referenceTo.join(', ')}`);
                    } else if (field.name.toLowerCase() !== 'id' && !STANDARD_AUDIT_FIELDS.includes(field.name)) {
                        // Otros campos (no lookup, no Id, no auditoría) que están poblados
                        populatedDataFields.add(field.name);
                        logger.debug(`Campo de datos ${objectName}.${field.name} está consistentemente poblado.`);
                    }
                }
            });
        } else {
            logger.debug(`Consulta de sondeo para ${objectName} no devolvió registros. No se pueden determinar campos poblados.`);
        }
    } catch (error) {
        logger.warn(`Error al ejecutar consulta de sondeo para ${objectName} o analizar sus resultados: ${(error as Error).message}.`);
    }
    return { populatedDataFields, populatedLookupObjects };
}


/**
 * Identifica los campos "interesantes" para un SObject dado.
 * Esta función se usa como fallback o para subconsultas donde no se realiza el sondeo profundo.
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
 * Construye una consulta SOQL para un SObject.
 * Integra campos determinados por el modo conservador y evita redundancia en subconsultas.
 * @param conn Conexión jsforce.
 * @param sObjectDescribe Descripción del SObject.
 * @param fieldsToSelectInitially Lista de campos ya determinados como "usados" (incluye Id, auditoría, y poblados).
 * @param allProcessedObjectNames Lista de todos los objetos que se procesarán como principales (para evitar subconsultas redundantes).
 * @returns La consulta SOQL generada.
 */
async function buildSOQLQuery(
    conn: Connection,
    sObjectDescribe: SObjectDescribe,
    fieldsToSelectInitially: string[],
    allProcessedObjectNames: ReadonlySet<string> // Usar ReadonlySet para indicar que no se modifica aquí
): Promise<string> {
    const selectFields = new Set<string>(fieldsToSelectInitially);

    // Asegurar que Id y campos de auditoría estándar estén presentes
    selectFields.add('Id');
    STANDARD_AUDIT_FIELDS.forEach(af => {
        if (sObjectDescribe.fields.some(f => f.name === af)) {
            selectFields.add(af);
        }
    });

    // Asegurar que el campo Name (si existe y es string) esté presente
    const nameFieldOriginal = sObjectDescribe.fields.find(f => f.name.toLowerCase() === 'name' && f.type === 'string');
    if (nameFieldOriginal) {
        selectFields.add(nameFieldOriginal.name);
    }

    // Añadir campos de relaciones padre (e.g., Account.Name) para campos de lookup que están en selectFields
    const lookupFieldsInSelection = sObjectDescribe.fields.filter(field =>
        field.type === 'reference' &&
        selectFields.has(field.name) && // El campo de ID del lookup (ej. AccountId) debe estar en los campos "usados"
        field.referenceTo && field.referenceTo.length > 0 &&
        field.relationshipName && field.queryable
    );

    for (const field of lookupFieldsInSelection) {
        const parentObjectName = field.referenceTo![0]; // Asumimos una sola referencia por simplicidad
        try {
            const parentDescribe = await sfdcApi.describeSObject(conn, parentObjectName);
            let parentDisplayFieldName = 'Id';
            const nameField = parentDescribe.fields.find(f => f.name.toLowerCase() === 'name' && f.queryable);
            if (nameField) {
                parentDisplayFieldName = nameField.name;
            } else {
                const commonDisplayFields = ['Username', 'CaseNumber', 'Subject']; // Añadido Subject
                for (const dfName of commonDisplayFields) {
                    if (parentDescribe.fields.some(f => f.name === dfName && f.type === 'string' && f.queryable)) {
                        parentDisplayFieldName = dfName;
                        break;
                    }
                }
                if (parentDisplayFieldName === 'Id') {
                    const firstStringField = parentDescribe.fields.find(f => f.type === 'string' && f.name !== 'Id' && f.queryable);
                    if (firstStringField) parentDisplayFieldName = firstStringField.name;
                }
            }
            // Añadir el campo referenciado del padre (ej. Account.Name)
            selectFields.add(`${field.relationshipName}.${parentDisplayFieldName}`);
            // Opcional: decidir si quitar el ID del lookup (field.name) si se añade el campo referenciado.
            // Por ahora, se mantiene para asegurar que el ID siempre esté si el campo de lookup fue seleccionado.
            // selectFields.delete(field.name);
        } catch (error) {
            logger.warn(`No se pudo describir el objeto padre ${parentObjectName} para el campo ${sObjectDescribe.name}.${field.name}. Se usará solo el ID del lookup. Error: ${(error as Error).message}`);
        }
    }

    // Construir subconsultas para relaciones hijo directas
    const subQueries: string[] = [];
    if (sObjectDescribe.childRelationships) {
        for (const childRel of sObjectDescribe.childRelationships) {
            if (!childRel.relationshipName || !childRel.childSObject || !childRel.field) continue;

            // REQUISITO 1: Evitar subconsulta si el objeto hijo ya se procesa como principal
            if (allProcessedObjectNames.has(childRel.childSObject)) {
                logger.info(`Omitiendo subconsulta para ${sObjectDescribe.name}.${childRel.relationshipName} (objeto ${childRel.childSObject}) porque ${childRel.childSObject} se procesará como objeto principal.`);
                continue;
            }

            try {
                let childObjectNameToDescribe = childRel.childSObject;
                // Corrección específica para la peculiaridad de metadatos de AccountContactRelations
                if (childObjectNameToDescribe === 'AccountContactRelations') {
                    childObjectNameToDescribe = 'AccountContactRelation';
                    logger.warn(`Corrigiendo nombre de objeto hijo de 'AccountContactRelations' a 'AccountContactRelation' para la descripción.`);
                }
                const childDescribe = await sfdcApi.describeSObject(conn, childObjectNameToDescribe);
                if (!childDescribe.queryable) {
                    logger.debug(`Objeto hijo ${childObjectNameToDescribe} de la relación ${childRel.relationshipName} no es consultable. Omitiendo subconsulta.`);
                    continue;
                }

                // Para subconsultas, usamos getInterestingFields. Un sondeo profundo aquí sería demasiado.
                let childFieldsForSubquery = getInterestingFields(childDescribe);

                // Excluir el campo de relación al padre de los campos del hijo para evitar redundancia
                // y también el campo Id si ya está (getInterestingFields lo añade)
                const childRelationFieldParts = childRel.field.split('.'); // Manejar campos como Junction__r.Parent__c
                const baseChildRelationField = childRelationFieldParts[childRelationFieldParts.length-1];

                childFieldsForSubquery = childFieldsForSubquery.filter(f =>
                    f.toLowerCase() !== baseChildRelationField.toLowerCase() &&
                    f.toLowerCase() !== 'id' // Id se añade por defecto por getInterestingFields, pero la subconsulta ya lo tiene implícito
                );
                
                // Re-añadir Id explícitamente si no hay otros campos, o si se quiere ser explícito.
                // Por ahora, si childFieldsForSubquery queda vacío, no se hace la subconsulta.
                // Si solo queda 'Id', la subconsulta sería (SELECT Id FROM ...)
                // Vamos a asegurar que Id esté si hay otros campos, o solo Id si no hay más.
                const finalChildFields = new Set<string>();
                if (childFieldsForSubquery.length > 0) {
                    finalChildFields.add('Id'); // Asegurar Id en la subconsulta
                    childFieldsForSubquery.forEach(f => finalChildFields.add(f));
                }


                if (finalChildFields.size > 0) {
                    subQueries.push(`(SELECT ${Array.from(finalChildFields).join(', ')} FROM ${childRel.relationshipName})`);
                } else {
                    logger.debug(`No se encontraron campos interesantes (después de excluir el campo de relación) para la subconsulta a ${childRel.childSObject} desde ${sObjectDescribe.name}.`);
                }
            } catch (error) {
                logger.warn(`No se pudo describir o procesar el objeto hijo ${childRel.childSObject} para la relación ${childRel.relationshipName} en ${sObjectDescribe.name}. Se omitirá la subconsulta. Error: ${(error as Error).message}`);
            }
        }
    }

    const finalSelectFields = Array.from(selectFields);
    let queryString = `SELECT ${finalSelectFields.join(', ')}`;
    if (subQueries.length > 0) {
        queryString += `, ${subQueries.join(', ')}`;
    }
    queryString += ` FROM ${sObjectDescribe.name}`;

    return queryString;
}


/**
 * Genera consultas SOQL sugeridas para backup utilizando un enfoque conservador.
 * @param conn Conexión jsforce.
 * @param prioritizedObjectNames Lista opcional de nombres de SObject a priorizar.
 * @returns Una lista de objetos SuggestedQuery.
 */
export async function generateSuggestedQueries(conn: Connection, prioritizedObjectNames: string[] = []): Promise<SuggestedQuery[]> {
    logger.info('Generando consultas de backup sugeridas (modo conservador)...');
    const suggestedQueries: SuggestedQuery[] = [];
    const objectsInfo = new Map<string, ObjectProcessingInfo>(); // Almacena información sobre cada objeto procesado

    try {
        const allSObjectNamesFromAPI = await sfdcApi.listAllSObjects(conn);
        const nonNamespacedPool = new Set(allSObjectNamesFromAPI.filter(name => name.split('__').length <= 2));

        const namespacedObjectsFilteredOut = allSObjectNamesFromAPI.filter(name => !nonNamespacedPool.has(name));
        if (namespacedObjectsFilteredOut.length > 0) {
            logger.info(`Se excluyen por defecto de las sugerencias los siguientes objetos con namespace: ${namespacedObjectsFilteredOut.join(', ')}`);
        }

        const customObjectNames = Array.from(nonNamespacedPool).filter(name => name.endsWith('__c'));
        let initialProcessingQueueSet = new Set<string>();

        // 1. Añadir objetos fundamentales
        for (const fundamentalObj of FUNDAMENTAL_OBJECTS) {
            if (nonNamespacedPool.has(fundamentalObj)) {
                initialProcessingQueueSet.add(fundamentalObj);
                objectsInfo.set(fundamentalObj, { name: fundamentalObj, usedFields: new Set(), processed: false, isFundamental: true });
            }
        }

        // 2. Añadir objetos priorizados
        prioritizedObjectNames.forEach(name => {
            if (nonNamespacedPool.has(name)) {
                initialProcessingQueueSet.add(name);
                if (!objectsInfo.has(name)) {
                    objectsInfo.set(name, { name, usedFields: new Set(), processed: false, isFundamental: FUNDAMENTAL_OBJECTS.includes(name) });
                }
            } else {
                logger.warn(`El objeto priorizado '${name}' no se encontró (o es namespaced y excluido por defecto) y será ignorado.`);
            }
        });

        // 3. Añadir objetos personalizados (si no están ya)
        customObjectNames.forEach(name => {
            if (nonNamespacedPool.has(name)) { // Asegurar que esté en el pool sin namespace
                initialProcessingQueueSet.add(name);
                if (!objectsInfo.has(name)) {
                    objectsInfo.set(name, { name, usedFields: new Set(), processed: false, isFundamental: FUNDAMENTAL_OBJECTS.includes(name) });
                }
            }
        });

        // 4. Lógica de Fallback si la cola inicial está vacía
        if (initialProcessingQueueSet.size === 0 && nonNamespacedPool.size > 0) {
            logger.info('La cola de procesamiento inicial está vacía. Aplicando fallback...');
            const fallbackStandard = ['Account', 'Contact', 'Opportunity', 'Case', 'Lead']
                .filter(s => nonNamespacedPool.has(s) && !initialProcessingQueueSet.has(s)); // Excluir ya añadidos

            for (const objName of fallbackStandard.slice(0, 3)) { // Tomar hasta 3
                initialProcessingQueueSet.add(objName);
                if (!objectsInfo.has(objName)) {
                     objectsInfo.set(objName, { name: objName, usedFields: new Set(), processed: false, isFundamental: FUNDAMENTAL_OBJECTS.includes(objName) });
                }
            }
            if (initialProcessingQueueSet.size === 0) { // Si sigue vacía
                const firstCandidate = Array.from(nonNamespacedPool).find(objName => !initialProcessingQueueSet.has(objName));
                if (firstCandidate) {
                    initialProcessingQueueSet.add(firstCandidate);
                    if (!objectsInfo.has(firstCandidate)) {
                        objectsInfo.set(firstCandidate, { name: firstCandidate, usedFields: new Set(), processed: false, isFundamental: FUNDAMENTAL_OBJECTS.includes(firstCandidate) });
                    }
                }
            }
        }
        
        let processingQueue = Array.from(initialProcessingQueueSet);
        const finalObjectNamesToProcess = new Set<string>(); // Objetos para los que se generará una query final

        logger.info(`Cola de procesamiento inicial para sondeo y descubrimiento: ${processingQueue.join(', ')}`);

        let currentObjectName;
        const MAX_DISCOVERY_ITERATIONS = 10; // Prevenir bucles infinitos en descubrimiento
        let discoveryIterations = 0;

        // Bucle de descubrimiento: procesa la cola, añadiendo objetos relacionados encontrados
        while ((currentObjectName = processingQueue.shift()) !== undefined && discoveryIterations < MAX_DISCOVERY_ITERATIONS) {
            discoveryIterations++;
            if (finalObjectNamesToProcess.has(currentObjectName) && objectsInfo.get(currentObjectName)?.processed) {
                continue; // Ya completamente procesado
            }

            let objectInfo = objectsInfo.get(currentObjectName);
            if (!objectInfo) { // Debería existir si está en la cola
                logger.warn(`Información no encontrada para ${currentObjectName} en la cola de procesamiento. Omitiendo.`);
                continue;
            }
            if (objectInfo.processed) continue; // Ya sondeado

            logger.info(`Sondeando objeto para campos y relaciones: ${currentObjectName}`);
            try {
                const sObjectDescribe = await sfdcApi.describeSObject(conn, currentObjectName);
                if (!sObjectDescribe.queryable) {
                    logger.info(`Objeto ${currentObjectName} no es consultable, omitiendo de sugerencias.`);
                    objectInfo.processed = true; // Marcar como procesado para no reintentar
                    finalObjectNamesToProcess.delete(currentObjectName); // Asegurar que no se procese para query
                    continue;
                }
                
                finalObjectNamesToProcess.add(currentObjectName); // Marcar para query final si es consultable
                objectInfo.processed = true; // Marcar como sondeado

                const { populatedDataFields, populatedLookupObjects } = await getPopulatedFieldsAndLookups(conn, currentObjectName, sObjectDescribe);

                objectInfo.usedFields.add('Id'); // Id siempre
                STANDARD_AUDIT_FIELDS.forEach(af => { // Campos de auditoría siempre
                    if (sObjectDescribe.fields.some(f => f.name === af)) objectInfo.usedFields.add(af);
                });
                const nameField = sObjectDescribe.fields.find(f => f.name.toLowerCase() === 'name' && f.type === 'string');
                if (nameField) objectInfo.usedFields.add(nameField.name); // Name siempre si existe

                populatedDataFields.forEach(f => objectInfo.usedFields.add(f));
                logger.debug(`Campos con datos para ${currentObjectName} (después del sondeo): ${Array.from(objectInfo.usedFields).join(', ')}`);

                for (const lookupObjName of populatedLookupObjects) {
                    if (nonNamespacedPool.has(lookupObjName)) {
                        if (!objectsInfo.has(lookupObjName) || !objectsInfo.get(lookupObjName)!.processed) {
                            if (!processingQueue.includes(lookupObjName) && !finalObjectNamesToProcess.has(lookupObjName)) { // Evitar añadir si ya está en cola o procesado final
                                logger.info(`Añadiendo objeto relacionado ${lookupObjName} (desde ${currentObjectName}) a la cola de sondeo.`);
                                processingQueue.push(lookupObjName);
                            }
                            if (!objectsInfo.has(lookupObjName)) {
                                objectsInfo.set(lookupObjName, { name: lookupObjName, usedFields: new Set(), processed: false, isFundamental: FUNDAMENTAL_OBJECTS.includes(lookupObjName) });
                            }
                        }
                    }
                }
            } catch (error) {
                logger.error(`Error al sondear o descubrir relaciones para ${currentObjectName}: ${(error as Error).message}`);
                if (objectInfo) objectInfo.processed = true; // Evitar reintentos si falla
                finalObjectNamesToProcess.delete(currentObjectName); // No generar query si el sondeo falló
            }
        }
        if (discoveryIterations >= MAX_DISCOVERY_ITERATIONS) {
            logger.warn('Se alcanzó el número máximo de iteraciones de descubrimiento de objetos relacionados.');
        }

        logger.info(`Objetos finales determinados para generar consultas: ${Array.from(finalObjectNamesToProcess).join(', ')}`);

        if (finalObjectNamesToProcess.size === 0) {
            logger.warn('No se encontraron objetos consultables para procesar después de aplicar filtros y descubrimiento. No se generarán sugerencias.');
            return [];
        }

        for (const objectName of finalObjectNamesToProcess) {
            try {
                const objectInfo = objectsInfo.get(objectName);
                const sObjectDescribe = await sfdcApi.describeSObject(conn, objectName); // Re-obtener describe para buildSOQLQuery

                if (!sObjectDescribe.queryable) { // Doble check
                    logger.info(`Objeto ${objectName} no es consultable (verificación final), omitiendo query.`);
                    continue;
                }

                let fieldsForQuery: string[];
                if (objectInfo && objectInfo.usedFields.size > 0) {
                    fieldsForQuery = Array.from(objectInfo.usedFields);
                } else {
                    // Fallback si no hay info de sondeo o no se encontraron campos usados (además de Id/auditoría)
                    logger.info(`No se determinaron campos específicos con datos para ${objectName} o faltó información de sondeo; usando getInterestingFields como fallback.`);
                    fieldsForQuery = getInterestingFields(sObjectDescribe);
                }
                
                // Asegurar que al menos Id y campos de auditoría estén, si no, no tiene sentido la query
                const finalFieldsCheck = new Set(fieldsForQuery);
                finalFieldsCheck.add('Id');
                STANDARD_AUDIT_FIELDS.forEach(af => {
                     if (sObjectDescribe.fields.some(f => f.name === af)) finalFieldsCheck.add(af);
                });

                if (finalFieldsCheck.size === 0 || (finalFieldsCheck.size === 1 && finalFieldsCheck.has('Id') && !STANDARD_AUDIT_FIELDS.some(af => sObjectDescribe.fields.some(f => f.name === af)))) {
                     logger.info(`No se encontraron campos suficientes para generar una consulta útil para ${objectName} (solo Id o ninguno tras análisis), omitiendo.`);
                     continue;
                }


                const query = await buildSOQLQuery(conn, sObjectDescribe, Array.from(finalFieldsCheck), finalObjectNamesToProcess);
                suggestedQueries.push({
                    objectName,
                    query,
                    reason: `Modo conservador: Incluye campos con datos detectados, Id, auditoría, Name (si existe), campos de relaciones padre (para lookups poblados) y subconsultas (evitando redundancia con objetos principales) para ${objectName}.`
                });
                logger.info(`Query sugerida para ${objectName}: ${query}`);

            } catch (error) {
                logger.error(`Error al generar la query final para el objeto ${objectName}: ${(error as Error).message}`);
            }
        }

        if (suggestedQueries.length === 0) {
            logger.warn('No se pudieron generar consultas de backup sugeridas después de todo el proceso.');
        }

    } catch (error) {
        logger.error(`Error general al generar consultas de backup sugeridas: ${(error as Error).message}`);
        // Decidir si relanzar o devolver array vacío. El original relanza.
        throw error;
    }
    return suggestedQueries;
}