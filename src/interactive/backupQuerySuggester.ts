/**
 * @file backupQuerySuggester.ts
 * @description Lógica para sugerir consultas SOQL para backups.
 */

import { Connection } from 'jsforce';
import { SObjectDescribe, Field, ChildRelationship } from '../core/typeDefs.js';
import { sfdcApi } from '../core/sfdc-api.js';
import { Logger } from '../core/logger.js';
import { saveBackupQueries, loadBackupQueries } from '../core/queryFileManager.js';
import prompts from 'prompts';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

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

interface QuerySuggestionOptions {
    includeNamespacedObjectsInSubqueries?: boolean;
    includeTechnicalFields?: boolean;
    includeNamespacedFields?: boolean;
    maxSubqueryRelationships?: number;
    includeChildRelationshipsInBackupQueries?: boolean; // Nuevo: para consultar solo objetos "sueltos"
}

interface BackupQueryConfig {
    objectPriorities?: {
        [objectName: string]: {
            includeRelationships?: string[];
            excludeRelationships?: string[];
            customOrder?: string[];
        };
    };
    globalExclusions?: string[];
    includeChildRelationshipsInBackupQueries?: boolean;
}

let backupQueryConfig: BackupQueryConfig | null = null;

const DEFAULT_GLOBAL_EXCLUSIONS = [
    'ActivityHistory', 'OpenActivities', 'ProcessInstance', 'FeedItem',
    'ContentDocumentLink', 'NoteAndAttachment', 'CombinedAttachments',
    'Shares', 'Histories', 'Feeds', 'Tags', 'EmailMessageRelations',
    'AttachedContentDocuments', 'ContentDocumentLinks', 'ProcessSteps',
    'ActivityHistories', 'OpenActivities', 'TaskRelations', 'EventRelations',
    'FlowOrchestrationWorkItems', 'FlowOrchestrationWorkItemHistories',
    'WorkPlans', 'WorkPlanTemplates', 'WorkSteps', 'WorkStepTemplates',
    'ServiceAppointments', 'ServiceResources', 'ServiceTerritories',
    'ServiceTerritoryMembers', 'Shift', 'ShiftEngagement', 'TimeSheet',
    'TimeSheetEntry', 'WorkOrder', 'WorkOrderLineItem', 'AssetDowntime',
    'AssetRelationship', 'CaseTeamMember', 'CaseTeamTemplate', 'CaseTeamTemplateMember',
    'CaseTeamTemplateRecord', 'CollaborationGroup', 'CollaborationGroupMember',
    'ContentVersion', 'ContentWorkspace', 'ContentWorkspaceMember',
    'ContractLineItem', 'ContractStatusHistory', 'EntitlementContact',
    'EntitlementTemplate', 'FeedComment', 'FeedTrackedChange', 'ForecastingItem',
    'ForecastingType', 'Idea', 'IdeaComment', 'KnowledgeArticle', 'KnowledgeArticleVersion',
    'LeadShare', 'OpportunityCompetitor', 'OpportunityContactRole', 'OpportunityHistory',
    'OpportunityLineItem', 'OpportunityPartner', 'Order', 'OrderItem', 'Partner',
    'Pricebook2', 'PricebookEntry', 'Product2', 'ProductConsumptionSchedule',
    'ProductItem', 'ProductRequest', 'ProductRequestLineItem', 'ProductRequired',
    'ProductTransfer', 'Quote', 'QuoteLineItem', 'RecordAction', 'RecordActionHistory',
    'ResourceAbsence', 'ResourcePreference', 'ReturnOrder', 'ReturnOrderItem',
    'ServiceCrew', 'ServiceCrewMember', 'ServiceReport', 'ServiceReportTemplate',
    'ShiftPattern', 'ShiftPatternEntry', 'SkillRequirement', 'Solution', 'SolutionHistory',
    'TaskWhoRelation', 'TaskWhatRelation', 'Territory', 'Territory2', 'Territory2Model',
    'Territory2Rule', 'Territory2Type', 'UserTerritory', 'WorkType', 'WorkTypeGroup',
    'WorkTypeGroupMember'
];

/**
 * Carga la configuración de sugerencia de consultas de backup desde un archivo JSON.
 * @returns La configuración cargada o un objeto vacío si no se encuentra o hay un error.
 */
function loadBackupQueryConfig(): BackupQueryConfig {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const configPath = path.resolve(__dirname, '../../config/backupQueryConfig.json');
    try {
        const configContent = readFileSync(configPath, 'utf-8');
        const config = JSON.parse(configContent);
        logger.info(`Configuración de backup cargada desde ${configPath}`);
        return config;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            logger.info(`Archivo de configuración no encontrado en ${configPath}. Usando configuración por defecto.`);
        } else {
            logger.warn(`Error al cargar la configuración de backup desde ${configPath}: ${(error as Error).message}. Usando configuración por defecto.`);
        }
        return {};
    }
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
    sObjectDescribe: SObjectDescribe,
    options: QuerySuggestionOptions // Añadir parámetro de opciones
): Promise<{ populatedDataFields: Set<string>, populatedLookupObjects: Set<string> }> {
    const populatedDataFields = new Set<string>();
    const populatedLookupObjects = new Set<string>();
    const fieldsToQuery = new Set<string>();
    fieldsToQuery.add('Id'); // Siempre incluir Id

    // Helper para identificar campos con namespace
    const isNamespacedField = (fieldName: string): boolean => {
        const parts = fieldName.split('__');
        return parts.length > 2 && parts[0].length > 0;
    };

    // REQUISITO 1: Excluir campos de paquetes gestionados por defecto.
    // Solo incluir si no es namespaced O si la opción para incluir campos namespaced está activada.
    // Esto aplica a campos de datos y lookups.
    sObjectDescribe.fields.forEach(field => {
        // Incluir campos de lookup para verificar si están poblados y qué referencian
        if (field.type === 'reference' && field.referenceTo && field.referenceTo.length > 0 && field.queryable &&
            (!isNamespacedField(field.name) || options.includeNamespacedFields)) {
            fieldsToQuery.add(field.name);
        }
        // Incluir otros campos consultables que no sean de tipos excluidos, auditoría o Id para el sondeo de datos
        else if (
            field.queryable &&
            !EXCLUDED_FIELD_TYPES_FOR_SELECT.includes(field.type) &&
            !STANDARD_AUDIT_FIELDS.includes(field.name) &&
            field.name.toLowerCase() !== 'id' &&
            (!isNamespacedField(field.name) || options.includeNamespacedFields) &&
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
function getInterestingFields(sObjectDescribe: SObjectDescribe, options: QuerySuggestionOptions): string[] {
    const fieldsToInclude: Set<string> = new Set();

    // Incluir Id siempre
    fieldsToInclude.add('Id');

    // REQUISITO 2: Excluir campos técnicos por defecto. Incluir solo si la opción está activada.
    if (options.includeTechnicalFields) {
        STANDARD_AUDIT_FIELDS.forEach(field => fieldsToInclude.add(field));
    }

    // Helper para identificar campos con namespace
    const isNamespacedField = (fieldName: string): boolean => {
        const parts = fieldName.split('__');
        return parts.length > 2 && parts[0].length > 0;
    };

    // Incluir Id siempre
    fieldsToInclude.add('Id');

    // REQUISITO 2: Excluir campos técnicos por defecto. Incluir solo si la opción está activada.
    if (options.includeTechnicalFields) {
        STANDARD_AUDIT_FIELDS.forEach(field => fieldsToInclude.add(field));
    }

    sObjectDescribe.fields.forEach((field: Field) => { // Added type
        // REQUISITO 1: Excluir campos de paquetes gestionados por defecto.
        if (isNamespacedField(field.name) && !options.includeNamespacedFields) {
            logger.debug(`Omitiendo campo con namespace ${sObjectDescribe.name}.${field.name} porque la inclusión no está activada.`);
            return; // Saltar este campo
        }

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
    allProcessedObjectNames: ReadonlySet<string>, // Usar ReadonlySet para indicar que no se modifica aquí
    options: QuerySuggestionOptions // Añadir parámetro de opciones
): Promise<string> {
    const selectFields = new Set<string>(fieldsToSelectInitially);

    // Helper para identificar campos con namespace
    const isNamespacedField = (fieldName: string): boolean => {
        const parts = fieldName.split('__');
        return parts.length > 2 && parts[0].length > 0;
    };

    // Asegurar que Id esté presente
    selectFields.add('Id');
    // REQUISITO 2: Excluir campos técnicos por defecto. Incluir solo si la opción está activada.
    if (options.includeTechnicalFields) {
        STANDARD_AUDIT_FIELDS.forEach(af => {
            if (sObjectDescribe.fields.some(f => f.name === af)) {
                selectFields.add(af);
            }
        });
    }

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
            // REQUISITO 1: Excluir campos de paquetes gestionados por defecto para campos padre.
            if (isNamespacedField(parentDisplayFieldName) && !options.includeNamespacedFields) {
                logger.debug(`Omitiendo campo padre con namespace ${parentObjectName}.${parentDisplayFieldName} porque la inclusión no está activada.`);
            } else {
                selectFields.add(`${field.relationshipName}.${parentDisplayFieldName}`);
            }
            // Opcional: decidir si quitar el ID del lookup (field.name) si se añade el campo referenciado.
            // Por ahora, se mantiene para asegurar que el ID siempre esté si el campo de lookup fue seleccionado.
            // selectFields.delete(field.name);
        } catch (error) {
            logger.warn(`No se pudo describir el objeto padre ${parentObjectName} para el campo ${sObjectDescribe.name}.${field.name}. Se usará solo el ID del lookup. Error: ${(error as Error).message}`);
        }
    }

    // Construir subconsultas para relaciones hijo directas
    const subQueries: string[] = [];
    // REQUISITO 3: Opción para consultar solo objetos "sueltos" (sin subconsultas)
    if (options.includeChildRelationshipsInBackupQueries === false) {
        logger.info(`La opción 'includeChildRelationshipsInBackupQueries' está desactivada. No se generarán subconsultas para ${sObjectDescribe.name}.`);
        // Continuar para construir la consulta principal sin subconsultas
    } else if (sObjectDescribe.childRelationships) {
        // REQUISITO 2: Implementar la priorización de objetos relacionados para subconsultas.
        let relevantChildRelationships: ChildRelationship[] = sObjectDescribe.childRelationships.filter(childRel => {
            if (!childRel.relationshipName || !childRel.childSObject || !childRel.field) return false;
            // Filtrado por accesibilidad y consultabilidad
            // 1. Filtrado por Accesibilidad y Consultabilidad
            // Asegurarse de que el objeto hijo sea consultable y accesible
            if (!sfdcApi.isSObjectQueryable(childRel.childSObject) || !sfdcApi.isSObjectAccessible(childRel.childSObject)) {
                logger.debug(`Omitiendo relación hijo ${childRel.relationshipName} (${childRel.childSObject}) porque el objeto hijo no es consultable o accesible.`);
                return false;
            }

            // REQUISITO 1: Excluir campos de paquetes gestionados por defecto para objetos hijo.
            const isNamespacedChildObject = childRel.childSObject.includes('__') && childRel.childSObject.split('__').length > 2;
            if (isNamespacedChildObject && !options.includeNamespacedObjectsInSubqueries) {
                logger.debug(`Omitiendo subconsulta para ${sObjectDescribe.name}.${childRel.relationshipName} (objeto ${childRel.childSObject}) porque es un objeto con namespace y la inclusión no está activada.`);
                return false;
            }

            if (allProcessedObjectNames.has(childRel.childSObject)) {
                logger.debug(`Omitiendo subconsulta para ${sObjectDescribe.name}.${childRel.relationshipName} (objeto ${childRel.childSObject}) porque ${childRel.childSObject} se procesará como objeto principal.`);
                return false;
            }

            // Exclusión de Relaciones de Sistema Comunes (Lista Negra Configurable)
            const globalExclusions = backupQueryConfig?.globalExclusions || DEFAULT_GLOBAL_EXCLUSIONS;
            if (globalExclusions.includes(childRel.relationshipName) || globalExclusions.includes(childRel.childSObject)) {
                logger.debug(`Omitiendo relación hijo ${childRel.relationshipName} (${childRel.childSObject}) debido a la lista de exclusiones globales.`);
                return false;
            }

            return true;
        });

        // Aplicar priorización y ordenación
        relevantChildRelationships.sort((a, b) => {
            const aIsCustom = a.childSObject.endsWith('__c');
            const bIsCustom = b.childSObject.endsWith('__c');

            // 2. Priorización de Objetos Personalizados (`isCustom`)
            if (aIsCustom && !bIsCustom) return -1;
            if (!aIsCustom && bIsCustom) return 1;

            // 3. Priorización por Tipo de Relación (Master-Detail > Lookup)
            // 3. Priorización por Tipo de Relación (Master-Detail > Lookup)
            // Obtener el campo de la relación en el objeto padre para determinar el tipo
            // El campo 'field' en childRel es el campo de lookup/master-detail en el objeto hijo que apunta al padre.
            // Necesitamos el campo en el objeto padre que representa la relación con el hijo.
            // Sin embargo, el diseño indica que la priorización se basa en el tipo de relación del *hijo* al *padre*.
            // Esto se refleja en el campo 'field' de childRel.
            // Un campo Master-Detail en el hijo que apunta al padre suele ser no nillable.
            const aChildLookupField = sObjectDescribe.fields.find(f => f.name === a.field);
            const aIsMasterDetail = aChildLookupField?.type === 'reference' && aChildLookupField.nillable === false;
            const bChildLookupField = sObjectDescribe.fields.find(f => f.name === b.field);
            const bIsMasterDetail = bChildLookupField?.type === 'reference' && bChildLookupField.nillable === false;

            if (aIsMasterDetail && !bIsMasterDetail) return -1;
            if (!aIsMasterDetail && bIsMasterDetail) return 1;

            // Configuración de Usuario (Anulación Opcional)
            const objectConfig = backupQueryConfig?.objectPriorities?.[sObjectDescribe.name];
            const aRelName = a.relationshipName!;
            const bRelName = b.relationshipName!;

            // customOrder
            if (objectConfig?.customOrder) {
                const aCustomIndex = objectConfig.customOrder.indexOf(aRelName);
                const bCustomIndex = objectConfig.customOrder.indexOf(bRelName);
                if (aCustomIndex !== -1 && bCustomIndex !== -1) {
                    if (aCustomIndex !== bCustomIndex) return aCustomIndex - bCustomIndex;
                } else if (aCustomIndex !== -1) {
                    return -1; // a está en customOrder, b no
                } else if (bCustomIndex !== -1) {
                    return 1; // b está en customOrder, a no
                }
            }

            // includeRelationships (priorizar si están en la lista)
            if (objectConfig?.includeRelationships) {
                const aIncluded = objectConfig.includeRelationships.includes(aRelName);
                const bIncluded = objectConfig.includeRelationships.includes(bRelName);
                if (aIncluded && !bIncluded) return -1;
                if (!aIncluded && bIncluded) return 1;
            }

            // excludeRelationships (despriorizar si están en la lista)
            if (objectConfig?.excludeRelationships) {
                const aExcluded = objectConfig.excludeRelationships.includes(aRelName);
                const bExcluded = objectConfig.excludeRelationships.includes(bRelName);
                if (aExcluded && !bExcluded) return 1;
                if (!aExcluded && bExcluded) return -1;
            }

            // Desempate Determinista: Orden alfabético del relationshipName
            return aRelName.localeCompare(bRelName);
        });

        // La ordenación ya se hizo arriba con la lógica de priorización

        // Aplicar el límite de subconsultas
        const maxSubqueries = options.maxSubqueryRelationships !== undefined ? options.maxSubqueryRelationships : 20; // Default a 20
        const limitedChildRelationships = relevantChildRelationships.slice(0, maxSubqueries);

        if (relevantChildRelationships.length > maxSubqueries) {
            logger.warn(`Se limitaron las subconsultas para ${sObjectDescribe.name} a ${maxSubqueries} relaciones hijo. Se omitieron ${relevantChildRelationships.length - maxSubqueries} relaciones.`);
        }

        for (const childRel of limitedChildRelationships) {
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
                // Pasar las opciones para que getInterestingFields pueda aplicar el filtro de campos técnicos y namespaced.
                let childFieldsForSubquery = getInterestingFields(childDescribe, options);

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
export async function generateSuggestedQueries(
    conn: Connection,
    prioritizedObjectNames: string[] = [],
    options: QuerySuggestionOptions = {}
): Promise<SuggestedQuery[]> {
    logger.info('Generando consultas de backup sugeridas (modo conservador)...');
    const suggestedQueries: SuggestedQuery[] = [];
    const objectsInfo = new Map<string, ObjectProcessingInfo>(); // Almacena información sobre cada objeto procesado

    // Cargar la configuración de backup al inicio
    if (backupQueryConfig === null) {
        backupQueryConfig = loadBackupQueryConfig();
        // Sobrescribir opciones con la configuración del archivo si existen
        if (backupQueryConfig.includeChildRelationshipsInBackupQueries !== undefined) {
            options.includeChildRelationshipsInBackupQueries = backupQueryConfig.includeChildRelationshipsInBackupQueries;
        }
        // Podríamos añadir más opciones aquí si el diseño lo requiere
    }

    let orgIdentifier: string | undefined;
    try {
        // Asegurar que userInfo esté poblado
        if (!conn.userInfo) {
            await conn.identity();
        }

        if (conn.userInfo?.organizationId) {
            // Usar el organizationId como identificador único para la caché
            orgIdentifier = conn.userInfo.organizationId;
            logger.info(`Usando Organization ID '${orgIdentifier}' para la caché de consultas.`);
        } else {
            logger.warn('No se pudo obtener el ID de la organización de la conexión. No se utilizará la caché de consultas.');
        }
    } catch (error) {
        logger.warn(`Error al obtener el ID de la organización: ${(error as Error).message}. No se utilizará la caché de consultas.`);
    }

    if (orgIdentifier) {
        try {
            const cachedQueries = await loadBackupQueries(orgIdentifier);
            if (cachedQueries && cachedQueries.length > 0) {
                logger.info(`Se encontraron ${cachedQueries.length} consultas de backup cacheadas para la organización '${orgIdentifier}'.`);
                const response = await prompts({
                    type: 'confirm',
                    name: 'useCached',
                    message: '¿Desea usar las consultas cacheadas existentes? (No para regenerar)',
                    initial: true
                });

                if (response.useCached) {
                    logger.info('Usando consultas de backup cacheadas.');
                    return cachedQueries;
                } else {
                    logger.info('Regenerando nuevas consultas de backup.');
                }
            }
        } catch (error) {
            logger.warn(`Error al cargar consultas cacheadas para '${orgIdentifier}': ${(error as Error).message}. Se generarán nuevas consultas.`);
        }
    }

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

                const { populatedDataFields, populatedLookupObjects } = await getPopulatedFieldsAndLookups(conn, currentObjectName, sObjectDescribe, options);

                objectInfo.usedFields.add('Id'); // Id siempre
                STANDARD_AUDIT_FIELDS.forEach(af => { // Campos de auditoría siempre
                    if (sObjectDescribe.fields.some(f => f.name === af)) objectInfo.usedFields.add(af);
                });
                const nameField = sObjectDescribe.fields.find(f => f.name.toLowerCase() === 'name' && f.type === 'string');
                if (nameField) objectInfo.usedFields.add(nameField.name); // Name siempre si existe

                populatedDataFields.forEach(f => objectInfo.usedFields.add(f));
                logger.debug(`Campos con datos para ${currentObjectName} (después del sondeo y filtrado de namespaced): ${Array.from(objectInfo.usedFields).join(', ')}`);

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
                } else { // Fallback si no hay info de sondeo o no se encontraron campos usados (además de Id/auditoría)
                    // Fallback si no hay info de sondeo o no se encontraron campos usados (además de Id/auditoría)
                    logger.info(`No se determinaron campos específicos con datos para ${objectName} o faltó información de sondeo; usando getInterestingFields como fallback.`);
                    fieldsForQuery = getInterestingFields(sObjectDescribe, options);
                }
                
                // Asegurar que al menos Id y campos de auditoría estén, si no, no tiene sentido la query
                const finalFieldsCheck = new Set(fieldsForQuery);
                finalFieldsCheck.add('Id');
                // REQUISITO 2: Excluir campos técnicos por defecto. Incluir solo si la opción está activada.
                if (options.includeTechnicalFields) {
                   STANDARD_AUDIT_FIELDS.forEach(af => {
                         if (sObjectDescribe.fields.some(f => f.name === af)) finalFieldsCheck.add(af);
                   });
                } // End of REQUISITO 2 block
 
                 if (finalFieldsCheck.size === 0 || (finalFieldsCheck.size === 1 && finalFieldsCheck.has('Id') && !STANDARD_AUDIT_FIELDS.some(af => sObjectDescribe.fields.some(f => f.name === af)))) {
                      logger.info(`No se encontraron campos suficientes para generar una consulta útil para ${objectName} (solo Id o ninguno tras análisis), omitiendo.`);
                      continue;
                 }


                const query = await buildSOQLQuery(conn, sObjectDescribe, Array.from(finalFieldsCheck), finalObjectNamesToProcess, options);
                suggestedQueries.push({
                    objectName,
                    query,
                    reason: `Modo conservador: Incluye campos con datos detectados, Id, auditoría (configurable), Name (si existe), campos de relaciones padre (para lookups poblados) y subconsultas (evitando redundancia con objetos principales y objetos con namespace configurable) para ${objectName}.`
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

    if (orgIdentifier && suggestedQueries.length > 0) {
        try {
            await saveBackupQueries(orgIdentifier, suggestedQueries);
            logger.info(`Consultas de backup guardadas en caché para la organización '${orgIdentifier}'.`);
        } catch (error) {
            logger.error(`Error al guardar consultas de backup en caché para '${orgIdentifier}': ${(error as Error).message}`);
        }
    }
    return suggestedQueries;
}