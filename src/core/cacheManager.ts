import * as fs from 'fs-extra';
import * as path from 'path';
import { Org } from '@salesforce/core';
import { SObjectDescribe, Field, ChildRelationship } from './typeDefs.js'; // Todos estos tipos vienen de typeDefs
import { Logger } from './logger.js'; // Solo la clase Logger

// const logger: Logger = new Logger('cacheManager'); // Ya no se necesita el logger global aquí

const CACHE_DIR_NAME = '.sfdc-cdb';
const CACHE_SUBDIR_NAME = 'cache';
export const METADATA_FILE_NAME = 'metadata.json';
export const CACHE_BASE_DIR = path.join(CACHE_DIR_NAME, CACHE_SUBDIR_NAME); // e.g., '.sfdc-cdb/cache'
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
    labelPlural: string; // Added this line
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
    // orgAlias: string; // Removed as it's no longer used
    toolVersion: string; // Versión actual de la herramienta
    ttlHours?: number; // TTL en horas, si se quiere sobrescribir el global
    logger?: Logger; // Permitir pasar un logger
    cacheBasePath?: string; // Allow overriding the base path for testing or specific configurations
}

export class CacheManager {
    private org: Org;
    private orgId: string;
    private userId!: string; // Se obtendrá del Org
    // private orgAlias: string; // Removed as it's no longer used
    private toolVersion: string;
    private ttlMilliseconds: number;
    private cacheBasePath: string;
    private currentSnapshotPath: string | null = null; // To store the path of the current snapshot being used/created
    private currentMetadataFilePath: string | null = null; // To store the path of the metadata file for the current snapshot
    private instanceLogger: Logger; // Logger específico para esta instancia

    constructor(options: CacheManagerOptions) {
        this.org = options.org;
        this.orgId = this.org.getOrgId();
        // this.orgAlias = options.orgAlias; // Removed as it's no longer used
        this.instanceLogger = options.logger || new Logger(`CacheManager:${this.orgId.substring(0,5)}`);
        // Note: options.org.getUsername() could be null if it's not an authenticated org with a username.
        // We must ensure userId is obtained correctly.
        // For now, we will use the OrgId as a placeholder if the username is not available,
        // although the design specifies userId. This might need adjustment.
        const username = this.org.getUsername();
        if (!username) {
            this.instanceLogger.warn(`No se pudo obtener el username para la Org ${this.orgId}. Usando OrgId como userId para la caché.`);
            this.userId = this.orgId;
        } else {
            this.userId = username;
        }

        this.toolVersion = options.toolVersion;
        this.ttlMilliseconds = (options.ttlHours || this.loadGlobalTtlHours() || DEFAULT_TTL_HOURS) * 60 * 60 * 1000;
        
        // Assuming the cache is saved relative to the current working directory (project)
        this.cacheBasePath = options.cacheBasePath || path.join(process.cwd(), CACHE_DIR_NAME, CACHE_SUBDIR_NAME);
    }

    private formatTimestamp(date: Date): string {
        const year = date.getUTCFullYear();
        const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
        const day = date.getUTCDate().toString().padStart(2, '0');
        const hours = date.getUTCHours().toString().padStart(2, '0');
        const minutes = date.getUTCMinutes().toString().padStart(2, '0');
        const seconds = date.getUTCSeconds().toString().padStart(2, '0');
        return `${year}${month}${day}_${hours}${minutes}${seconds}`;
    }

    private getSnapshotDirectoryName(timestamp: Date): string { // Removed orgAlias from parameters
        return this.formatTimestamp(timestamp); // Return only the formatted timestamp
    }

    private loadGlobalTtlHours(): number | undefined {
        // TODO: Implement the loading of TTL from .sfdc-cdb/config.json or ~/.sfdc-cdb/config.json
        // For now, return undefined to use the class default or the one provided in options.
        // Example of how it could be:
        // const configPathProject = path.join(process.cwd(), CACHE_DIR_NAME, 'config.json');
        // const configPathUser = path.join(require('os').homedir(), CACHE_DIR_NAME, 'config.json');
        // let config;
        // if (fs.existsSync(configPathProject)) config = fs.readJsonSync(configPathProject);
        // else if (fs.existsSync(configPathUser)) config = fs.readJsonSync(configPathUser);
        // return config?.cache?.defaultTTLHours;
        return undefined;
    }

    public async getMetadata(forceRefresh: boolean = false, noCache: boolean = false, specificSnapshotName?: string): Promise<CachedOrgMetadata | null> {
        if (noCache) {
            this.instanceLogger.info(`Opción --no-cache activada. Omitiendo lectura de caché para Org ${this.orgId}.`);
            return null; // Indicates that it should be obtained from Salesforce and not cached.
        }

        if (forceRefresh) {
            this.instanceLogger.info(`Refresco de caché forzado para Org ${this.orgId}.`);
            // Does not return the cache, will proceed to get from Salesforce and then save.
            // The caller must handle the fetching and then call saveMetadata.
            return null;
        }

        let snapshotToLoad: string | null = null;
        if (specificSnapshotName) {
            snapshotToLoad = specificSnapshotName;
            this.instanceLogger.info(`Intentando cargar snapshot específico: ${specificSnapshotName} para Org ${this.orgId}.`);
        } else {
            // Find the latest snapshot
            const snapshots = await this.listSnapshots();
            if (snapshots.length === 0) {
                this.instanceLogger.info(`No se encontraron snapshots de caché para Org ${this.orgId}.`);
                return null;
            }
            snapshotToLoad = snapshots[0]; // Assuming listSnapshots returns them sorted descending
            this.instanceLogger.info(`Cargando el snapshot más reciente: ${snapshotToLoad} para Org ${this.orgId}.`);
        }

        if (!snapshotToLoad) {
            return null;
        }

        try {
            const snapshotPath = path.join(this.cacheBasePath, this.orgId, snapshotToLoad);
            const metadataFilePath = path.join(snapshotPath, METADATA_FILE_NAME);

// Removed conflict markers
            if (!fs.existsSync(metadataFilePath)) {
                this.instanceLogger.info(`No se encontró el archivo de metadatos para el snapshot ${snapshotToLoad} en ${metadataFilePath}.`);
                return null;
            }

            const cachedData: CachedOrgMetadata = await fs.readJson(metadataFilePath);
            
            // Validations
            if (cachedData.cacheSchemaVersion !== CACHE_SCHEMA_VERSION) {
                this.instanceLogger.warn(`Versión de esquema de caché (${cachedData.cacheSchemaVersion}) no coincide con la esperada (${CACHE_SCHEMA_VERSION}) para Org ${this.orgId}. Invalidando caché.`);
                // Clear only the specific snapshot if it's corrupted, or all if it's a schema mismatch for the org.
                // For now, clearing all for schema mismatch seems safer.
                await this.clearCache();
                return null;
            }

            // There could be a more sophisticated validation for toolVersion if necessary (e.g. semver)
            // if (cachedData.toolVersion !== this.toolVersion) {
            //     this.instanceLogger.warn(`Tool version (${cachedData.toolVersion}) does not match current (${this.toolVersion}) for Org ${this.orgId}. Consider refreshing.`);
            // }

            const metadataFetchedTime = new Date(cachedData.metadataFetchedTimestamp).getTime();
            const now = Date.now();

            // Only consider TTL if we are looking for the latest snapshot, not a specific historical one.
            if (!specificSnapshotName && (now - metadataFetchedTime) > this.ttlMilliseconds) {
                this.instanceLogger.info(`Caché de metadatos para Org ${this.orgId} (snapshot ${snapshotToLoad}) desactualizada (generada el ${cachedData.metadataFetchedTimestamp}, TTL: ${this.ttlMilliseconds / (60*60*1000)}h).`);
                return null; // Indicates it is outdated
            }

            this.currentSnapshotPath = snapshotPath;
            this.currentMetadataFilePath = metadataFilePath;
            this.instanceLogger.info(`Usando caché de metadatos para Org ${this.orgId} (generada el ${cachedData.metadataFetchedTimestamp}).`);
            return cachedData;
        } catch (error: any) {
            // Use metadataFilePath if it was determined, otherwise a generic message
            const errorPath = specificSnapshotName ? path.join(this.cacheBasePath, this.orgId, specificSnapshotName, METADATA_FILE_NAME) : 'un archivo de caché';
            this.instanceLogger.error(`Error al leer o parsear ${errorPath}: ${error.message}. Tratando como caché inválida.`);
            // If a specific snapshot is corrupt, clear only that one. If no specific snapshot, clear all for the org.
            if (specificSnapshotName) {
                await this.clearCache(specificSnapshotName);
            } else {
                await this.clearCache();
            }
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

        const snapshotName = this.getSnapshotDirectoryName(new Date()); // Pass only the date
        const orgSpecificCachePath = path.join(this.cacheBasePath, this.orgId);
        const newSnapshotPath = path.join(orgSpecificCachePath, snapshotName);
        const newMetadataFilePath = path.join(newSnapshotPath, METADATA_FILE_NAME);

        try {
            await fs.ensureDir(newSnapshotPath);
            await fs.writeJson(newMetadataFilePath, dataToCache, { spaces: 2 });
            this.instanceLogger.info(`Caché de metadatos guardada para Org ${this.orgId} en ${newMetadataFilePath}.`);
            this.currentSnapshotPath = newSnapshotPath;
            this.currentMetadataFilePath = newMetadataFilePath;
        } catch (error: any) {
            this.instanceLogger.error(`Error al guardar el archivo de caché ${newMetadataFilePath}: ${error.message}`);
            // Do not re-throw to avoid breaking the main flow if caching fails, but do log.
        }
    }
    
    // Method to transform API data to cache structure
    // 'describe' here is of type SObjectDescribe imported from sfdc-api.js, which in turn uses SObjectDescribe from typeDefs.js
    public static transformSObjectDescribeToCache(describe: SObjectDescribe): CachedSObjectDetail {
        return {
            name: describe.name,
            label: describe.label,
            labelPlural: describe.labelPlural, // Added this line
            custom: describe.custom,
            fields: describe.fields.map((f: Field) => ({ // Field imported from typeDefs.js
                name: f.name,
                label: f.label,
                type: f.type,
                custom: f.custom,
                length: f.length,
                precision: f.precision,
                scale: f.scale,
                // SObjectDescribe.fields[].picklistValues is any[] in typeDefs.ts, so pv is any
                picklistValues: f.picklistValues?.map((pv: any) => ({ value: pv.value, label: pv.label, active: pv.active })),
                referenceTo: f.referenceTo || undefined, // Ensure it is string[] or undefined
                relationshipName: f.relationshipName || undefined, // Ensure it is string or undefined
                filterable: f.filterable, // Assuming filterable maps from queryable at field level if there is no direct 'filterable'
                nillable: f.nillable,
                unique: f.unique,
                externalId: f.externalId,
                autoNumber: f.autoNumber,
            })),
            childRelationships: describe.childRelationships?.map((cr: ChildRelationship) => ({ // ChildRelationship imported from typeDefs.js
                childSObject: cr.childSObject,
                field: cr.field,
                relationshipName: cr.relationshipName || undefined,
            })) || [],
            // SObjectDescribe.recordTypeInfos is any[] in typeDefs.ts, so rti is any
            recordTypeInfos: describe.recordTypeInfos?.map((rti: any) => ({
                recordTypeId: rti.recordTypeId,
                name: rti.name,
                available: rti.available,
                defaultRecordTypeMapping: rti.defaultRecordTypeMapping,
            })) || [],
        };
    }


    public async clearCache(snapshotName?: string): Promise<void> {
        try {
            const orgSpecificCachePath = path.join(this.cacheBasePath, this.orgId);
            if (snapshotName) {
                const snapshotPath = path.join(orgSpecificCachePath, snapshotName);
                if (await fs.pathExists(snapshotPath)) {
                    await fs.remove(snapshotPath);
                    this.instanceLogger.info(`Snapshot de caché ${snapshotPath} eliminado.`);
                } else {
                    this.instanceLogger.warn(`No se encontró el snapshot de caché ${snapshotName} para eliminar.`);
                }
            } else {
                // Clear all snapshots for this org
                if (await fs.pathExists(orgSpecificCachePath)) {
                    await fs.remove(orgSpecificCachePath);
                    this.instanceLogger.info(`Todos los snapshots de caché para Org ${this.orgId} en ${orgSpecificCachePath} eliminados.`);
                } else {
                    this.instanceLogger.warn(`No se encontró el directorio de caché para Org ${this.orgId} en ${orgSpecificCachePath}.`);
                }
            }
        } catch (error: any) {
            this.instanceLogger.error(`Error al limpiar la caché para ${this.orgId}: ${error.message}`);
        }
    }

    /**
     * Lists all available snapshot directory names for the current OrgId, sorted by timestamp descending.
     * @returns A promise that resolves to an array of snapshot directory names.
     */
    public async listSnapshots(): Promise<string[]> {
        const orgSpecificCachePath = path.join(this.cacheBasePath, this.orgId);
        if (!await fs.pathExists(orgSpecificCachePath)) {
            return [];
        }
        try {
            const entries = await fs.readdir(orgSpecificCachePath);
            // Filter for directories that match the snapshot naming convention (YYYYMMDD_HHMMSS)
            // and sort them in descending order (latest first)
            const snapshotRegex = /^\d{8}_\d{6}$/; // Regex matches only YYYYMMDD_HHMMSS
            const snapshots = entries.filter(name => snapshotRegex.test(name))
                                     .sort((a, b) => b.localeCompare(a)); // Descending sort
            return snapshots;
        } catch (error: any) {
            this.instanceLogger.error(`Error al listar snapshots para Org ${this.orgId} en ${orgSpecificCachePath}: ${error.message}`);
            return [];
        }
    }

    public getCurrentSnapshotPath(): string | null {
        return this.currentSnapshotPath;
    }

    public getCurrentMetadataFilePath(): string | null {
        return this.currentMetadataFilePath;
    }

    /**
     * Returns the base path for the cache directory.
     * @returns The base cache directory path.
     */
    public getBaseCachePath(): string {
        return this.cacheBasePath;
    }

    /**
     * Returns the organization-specific cache path.
     * @returns The organization-specific cache path.
     */
    public getOrgSpecificCachePath(): string {
        return path.join(this.cacheBasePath, this.orgId);
    }

    // Static methods for general path retrieval (might need adjustment or removal if only instance methods are used)
    public static getCacheDirectoryPath(orgId?: string): string {
        const base = path.join(process.cwd(), CACHE_DIR_NAME, CACHE_SUBDIR_NAME);
        return orgId ? path.join(base, orgId) : base;
    }

    public static getMetadataFilePath(orgId: string, snapshotName: string): string {
        return path.join(CacheManager.getCacheDirectoryPath(orgId), snapshotName, METADATA_FILE_NAME);
    }
}

// Example usage (this would go in commands)
// async function exampleUsage(org: Org, orgAlias: string, toolVersion: string, sfdcApiService: SfdcApiService) {
//     const cacheManager = new CacheManager({ org, orgAlias, toolVersion });
//
//     let metadata = await cacheManager.getMetadata();
//
//     if (!metadata) {
//         // ... (existing logic for fetching from Salesforce) ...
//         // await cacheManager.saveMetadata(sObjectDetailsToCache, fetchedTimestamp);
//         // metadata = await cacheManager.getMetadata(); // Re-read to ensure it loaded correctly
//         // if (!metadata) {
//         //     logger.error('Could not load metadata even after attempting to refresh.');
//         //     return;
//         // }
//         // logger.warn('Example: Actual metadata fetching is not implemented here.');
//         // return; // Exit if no metadata (simulation)
//     }
//
//     // Use metadata.sObjects...
//     // logger.info(`First SObject in cache: ${Object.keys(metadata.sObjects)[0]}`);
// }