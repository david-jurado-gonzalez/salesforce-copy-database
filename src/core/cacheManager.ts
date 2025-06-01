import * as fs from 'fs-extra';
import * as path from 'path';
import { Org } from '@salesforce/core';
import { SObjectDescribe, Field, ChildRelationship } from './typeDefs.js'; // Todos estos tipos vienen de typeDefs
import { Logger } from './logger.js'; // Solo la clase Logger

// const logger: Logger = new Logger('cacheManager'); // Ya no se necesita el logger global aquí

const CACHE_DIR_NAME = '.sfdc-cdb';
const CACHE_SUBDIR_NAME = 'cache';
const METADATA_FILE_NAME = 'metadata.json';
const DEFAULT_TTL_HOURS = 24;
const CACHE_SCHEMA_VERSION = '1.0'; // Según el diseño

// Interfaz para la estructura del archivo de caché (basada en el diseño)
export interface CachedOrgMetadata {
    orgId: string;
    userId: string;
    cacheSchemaVersion: string;
    toolVersion: string; // Versión de Salesforce Copy Database
    generatedTimestamp: string; // ISO8601
    metadataFetchedTimestamp: string; // ISO8601
    sObjects: {
        [sObjectApiName: string]: CachedSObjectDetail;
    };
    // Podría incluir otros metadatos globales si es necesario
}

export interface CachedSObjectDetail {
    name: string;
    label: string;
    custom: boolean;
    fields: CachedField[];
    childRelationships: CachedChildRelationship[];
    recordTypeInfos: CachedRecordTypeInfo[];
    // Otros atributos relevantes del SObject del diseño
}

export interface CachedField {
    name: string;
    label: string;
    type: string;
    custom: boolean;
    length?: number;
    precision?: number;
    scale?: number;
    picklistValues?: { value: string; label: string; active: boolean }[];
    referenceTo?: string[];
    relationshipName?: string;
    filterable?: boolean;
    nillable?: boolean;
    unique?: boolean;
    externalId?: boolean;
    autoNumber?: boolean;
    // Otros atributos relevantes del campo del diseño
}

export interface CachedChildRelationship {
    childSObject: string;
    field: string;
    relationshipName?: string;
}

export interface CachedRecordTypeInfo {
    recordTypeId: string;
    name: string;
    available: boolean;
    defaultRecordTypeMapping: boolean;
}

export interface CacheManagerOptions {
    org: Org;
    toolVersion: string; // Versión actual de la herramienta
    ttlHours?: number; // TTL en horas, si se quiere sobrescribir el global
    logger?: Logger; // Permitir pasar un logger
}

export class CacheManager {
    private org: Org;
    private orgId: string;
    private userId!: string; // Se obtendrá del Org
    private toolVersion: string;
    private ttlMilliseconds: number;
    private cacheBasePath: string;
    private orgCachePath: string;
    private metadataFilePath: string;
    private instanceLogger: Logger; // Logger específico para esta instancia

    constructor(options: CacheManagerOptions) {
        this.org = options.org;
        this.orgId = this.org.getOrgId();
        this.instanceLogger = options.logger || new Logger(`CacheManager:${this.orgId.substring(0,5)}`);
        // Nota: options.org.getUsername() podría ser null si no es una org autenticada con username.
        // Se debe asegurar que userId se obtiene correctamente.
        // Por ahora, usaremos el OrgId como placeholder si el username no está disponible,
        // aunque el diseño especifica userId. Esto podría necesitar ajuste.
        const username = this.org.getUsername();
        if (!username) {
            this.instanceLogger.warn(`No se pudo obtener el username para la Org ${this.orgId}. Usando OrgId como userId para la caché.`);
            this.userId = this.orgId;
        } else {
            this.userId = username;
        }

        this.toolVersion = options.toolVersion;
        this.ttlMilliseconds = (options.ttlHours || this.loadGlobalTtlHours() || DEFAULT_TTL_HOURS) * 60 * 60 * 1000;
        
        // Asumiendo que la caché se guarda relativa al directorio de trabajo actual (proyecto)
        this.cacheBasePath = path.join(process.cwd(), CACHE_DIR_NAME, CACHE_SUBDIR_NAME);
        this.orgCachePath = path.join(this.cacheBasePath, this.orgId);
        this.metadataFilePath = path.join(this.orgCachePath, METADATA_FILE_NAME);
    }

    private loadGlobalTtlHours(): number | undefined {
        // TODO: Implementar la carga del TTL desde .sfdc-cdb/config.json o ~/.sfdc-cdb/config.json
        // Por ahora, retorna undefined para usar el default de la clase o el provisto en options.
        // Ejemplo de cómo podría ser:
        // const configPathProject = path.join(process.cwd(), CACHE_DIR_NAME, 'config.json');
        // const configPathUser = path.join(require('os').homedir(), CACHE_DIR_NAME, 'config.json');
        // let config;
        // if (fs.existsSync(configPathProject)) config = fs.readJsonSync(configPathProject);
        // else if (fs.existsSync(configPathUser)) config = fs.readJsonSync(configPathUser);
        // return config?.cache?.defaultTTLHours;
        return undefined;
    }

    public async getMetadata(forceRefresh: boolean = false, noCache: boolean = false): Promise<CachedOrgMetadata | null> {
        if (noCache) {
            this.instanceLogger.info(`Opción --no-cache activada. Omitiendo lectura de caché para Org ${this.orgId}.`);
            return null; // Indica que se debe obtener de Salesforce y no guardar en caché.
        }

        if (forceRefresh) {
            this.instanceLogger.info(`Refresco de caché forzado para Org ${this.orgId}.`);
            // No retorna la caché, se procederá a obtener de Salesforce y luego guardar.
            // El llamador debe manejar la obtención y luego llamar a saveMetadata.
            return null;
        }

        if (!fs.existsSync(this.metadataFilePath)) {
            this.instanceLogger.info(`No se encontró caché de metadatos para Org ${this.orgId} en ${this.metadataFilePath}.`);
            return null;
        }

        try {
            const cachedData: CachedOrgMetadata = await fs.readJson(this.metadataFilePath);
            
            // Validaciones
            if (cachedData.cacheSchemaVersion !== CACHE_SCHEMA_VERSION) {
                this.instanceLogger.warn(`Versión de esquema de caché (${cachedData.cacheSchemaVersion}) no coincide con la esperada (${CACHE_SCHEMA_VERSION}) para Org ${this.orgId}. Invalidando caché.`);
                await this.clearCache(); // Opcional: limpiar caché antigua
                return null;
            }

            // Podría haber una validación más sofisticada para toolVersion si es necesario (e.g. semver)
            // if (cachedData.toolVersion !== this.toolVersion) {
            //     this.instanceLogger.warn(`Versión de herramienta (${cachedData.toolVersion}) no coincide con la actual (${this.toolVersion}) para Org ${this.orgId}. Considerar refrescar.`);
            // }

            const metadataFetchedTime = new Date(cachedData.metadataFetchedTimestamp).getTime();
            const now = Date.now();

            if ((now - metadataFetchedTime) > this.ttlMilliseconds) {
                this.instanceLogger.info(`Caché de metadatos para Org ${this.orgId} desactualizada (generada el ${cachedData.metadataFetchedTimestamp}, TTL: ${this.ttlMilliseconds / (60*60*1000)}h).`);
                return null; // Indica que está obsoleta
            }

            this.instanceLogger.info(`Usando caché de metadatos para Org ${this.orgId} (generada el ${cachedData.metadataFetchedTimestamp}).`);
            return cachedData;
        } catch (error: any) {
            this.instanceLogger.error(`Error al leer o parsear el archivo de caché ${this.metadataFilePath}: ${error.message}. Tratando como caché inválida.`);
            await this.clearCache(); // Limpiar caché corrupta
            return null;
        }
    }

    public async saveMetadata(sObjectDetails: { [sObjectApiName: string]: CachedSObjectDetail }, metadataFetchedTime: Date): Promise<void> {
        const dataToCache: CachedOrgMetadata = {
            orgId: this.orgId,
            userId: this.userId,
            cacheSchemaVersion: CACHE_SCHEMA_VERSION,
            toolVersion: this.toolVersion,
            generatedTimestamp: new Date().toISOString(),
            metadataFetchedTimestamp: metadataFetchedTime.toISOString(),
            sObjects: sObjectDetails,
        };

        try {
            await fs.ensureDir(this.orgCachePath);
            await fs.writeJson(this.metadataFilePath, dataToCache, { spaces: 2 });
            this.instanceLogger.info(`Caché de metadatos guardada para Org ${this.orgId} en ${this.metadataFilePath}.`);
        } catch (error: any) {
            this.instanceLogger.error(`Error al guardar el archivo de caché ${this.metadataFilePath}: ${error.message}`);
            // No relanzar para no romper el flujo principal si la caché falla, pero sí loguear.
        }
    }
    
    // Método para transformar datos de la API a la estructura de caché
    // 'describe' aquí es del tipo SObjectDescribe importado de sfdc-api.js, que a su vez usa SObjectDescribe de typeDefs.js
    public static transformSObjectDescribeToCache(describe: SObjectDescribe): CachedSObjectDetail {
        return {
            name: describe.name,
            label: describe.label,
            custom: describe.custom,
            fields: describe.fields.map((f: Field) => ({ // Field importado de typeDefs.js
                name: f.name,
                label: f.label,
                type: f.type,
                custom: f.custom,
                length: f.length,
                precision: f.precision,
                scale: f.scale,
                // SObjectDescribe.fields[].picklistValues es any[] en typeDefs.ts, así que pv es any
                picklistValues: f.picklistValues?.map((pv: any) => ({ value: pv.value, label: pv.label, active: pv.active })),
                referenceTo: f.referenceTo || undefined, // Asegurar que es string[] o undefined
                relationshipName: f.relationshipName || undefined, // Asegurar que es string o undefined
                filterable: f.queryable, // Asumiendo que filterable se mapea desde queryable a nivel de campo si no hay un 'filterable' directo
                nillable: f.nillable,
                unique: f.unique,
                externalId: f.externalId,
                autoNumber: f.autoNumber,
            })),
            childRelationships: describe.childRelationships?.map((cr: ChildRelationship) => ({ // ChildRelationship importado de typeDefs.js
                childSObject: cr.childSObject,
                field: cr.field,
                relationshipName: cr.relationshipName || undefined,
            })) || [],
            // SObjectDescribe.recordTypeInfos es any[] en typeDefs.ts, así que rti es any
            recordTypeInfos: describe.recordTypeInfos?.map((rti: any) => ({
                recordTypeId: rti.recordTypeId,
                name: rti.name,
                available: rti.available,
                defaultRecordTypeMapping: rti.defaultRecordTypeMapping,
            })) || [],
        };
    }


    public async clearCache(): Promise<void> {
        try {
            if (await fs.pathExists(this.metadataFilePath)) {
                await fs.remove(this.metadataFilePath);
                this.instanceLogger.info(`Archivo de caché ${this.metadataFilePath} eliminado.`);
            }
            // Opcionalmente, eliminar el directorio del OrgID si está vacío
            // const files = await fs.readdir(this.orgCachePath);
            // if (files.length === 0) {
            //     await fs.remove(this.orgCachePath);
            //     this.instanceLogger.info(`Directorio de caché ${this.orgCachePath} eliminado por estar vacío.`);
            // }
        } catch (error: any) {
            this.instanceLogger.error(`Error al limpiar la caché para ${this.orgId} en ${this.orgCachePath}: ${error.message}`);
        }
    }

    public static getCacheDirectoryPath(orgId?: string): string {
        const base = path.join(process.cwd(), CACHE_DIR_NAME, CACHE_SUBDIR_NAME);
        return orgId ? path.join(base, orgId) : base;
    }

    public static getMetadataFilePath(orgId: string): string {
        return path.join(CacheManager.getCacheDirectoryPath(orgId), METADATA_FILE_NAME);
    }
}

// Ejemplo de cómo se podría usar (esto iría en los comandos)
// async function exampleUsage(org: Org, toolVersion: string, sfdcApiService: SfdcApiService) {
//     const cacheManager = new CacheManager({ org, toolVersion });
//
//     let metadata = await cacheManager.getMetadata();
//
//     if (!metadata) {
//         logger.info('Obteniendo metadatos de Salesforce...');
//         // Aquí se harían las llamadas a sfdcApiService.describeGlobal(), sfdcApiService.describeSObjects(), etc.
//         // const describeGlobalResult: GlobalDescribe = await sfdcApiService.describeGlobal();
//         // const sObjectNamesToDescribe: string[] = describeGlobalResult.sobjects.map(s => s.name);
//         // const describeResults: DescribeSObjectResult[] = await sfdcApiService.describeSObjects(sObjectNamesToDescribe);
//         const fetchedTimestamp = new Date();
//
//         // const sObjectDetailsToCache: { [sObjectApiName: string]: CachedSObjectDetail } = {};
//         // describeResults.forEach(desc => {
//         //     sObjectDetailsToCache[desc.name] = CacheManager.transformSObjectDescribeToCache(desc);
//         // });
//         // await cacheManager.saveMetadata(sObjectDetailsToCache, fetchedTimestamp);
//         // metadata = await cacheManager.getMetadata(); // Releer para asegurar que se cargó bien
//         // if (!metadata) {
//         //     logger.error('No se pudieron cargar los metadatos incluso después de intentar refrescar.');
//         //     return;
//         // }
//         logger.warn('Ejemplo: La obtención real de metadatos no está implementada aquí.');
//         return; // Salir si no hay metadatos (simulación)
//     }
//
//     // Usar metadata.sObjects...
//     logger.info(`Primer SObject en caché: ${Object.keys(metadata.sObjects)[0]}`);
// }