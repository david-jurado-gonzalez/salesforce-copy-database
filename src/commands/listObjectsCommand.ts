import ora from 'ora';
import { Connection as JsforceConnection, DescribeGlobalResult as JsforceDescribeGlobalResult } from 'jsforce';
import { Org } from '@salesforce/core';
import { Logger } from '../core/logger.js';
// import { fileManagerAPI } from '../core/fileManager.js'; // No se usa
// import { Auth } from '../core/auth.js'; // No se usa
import { SObjectDescribe as AppSObjectDescribe } from '../core/typeDefs.js'; // SObjectDescribe de typeDefs para la API, AppConfig no se usa
import { CacheManager, CachedOrgMetadata, CachedSObjectDetail } from '../core/cacheManager.js';
import { describeSObject as sfdcDescribeSObject } from '../core/sfdc-api.js'; // Para obtener descripciones detalladas
import pkg from '../../package.json' with { type: "json" };

const logger = new Logger('ListObjectsCommand');
// const auth = new Auth(); // auth no se usa en esta función por ahora

/**
 * Obtiene una lista de todos los SObjects "consultables" y "recuperables" de la organización.
 * @param conn Conexión de jsforce.
 * @returns Un array de strings con los nombres de los SObjects.
 */
// Esta función se reemplazará o se integrará en la lógica de caché
// async function listSObjectsInternal(conn: Connection): Promise<string[]> { ... }

/**
 * Parámetros para la función de listado de objetos.
 */
export interface ListObjectsParams {
  orgAlias: string;
  refreshCache?: boolean;
  noCache?: boolean;
  // TODO: Obtener la versión de la herramienta dinámicamente
  toolVersion?: string; // Provisional, idealmente se obtiene del package.json
}

/**
 * Función principal para listar objetos.
 * Puede ser llamada desde la CLI o programáticamente.
 * @param params Los parámetros para listar objetos.
 * @returns Un array de strings con los nombres de los SObjects.
 */
export async function listObjects(params: ListObjectsParams): Promise<string[]> {
  logger.info('Iniciando el listado de objetos...');
  logger.debug('Parámetros recibidos:', params);

  if (!params.orgAlias) {
    throw new Error("El alias de la organización es obligatorio para listar objetos.");
  }

  const spinner = ora('Procesando...').start();
  // let config: AppConfig; // config no se usa directamente aquí
  let conn: JsforceConnection; // Usar el alias JsforceConnection
  let salesforceOrg: Org;
  let sObjectNames: string[] = [];

  try {
    // spinner.text = `Cargando configuración para el alias: ${params.orgAlias}...`;
    // config = await fileManagerAPI.loadConfig('./config.json'); // config no se usa directamente aquí
    // spinner.succeed('Configuración cargada (aunque no se usa directamente para la conexión principal).');

    spinner.text = `Creando instancia de Org (@salesforce/core) para alias: ${params.orgAlias}...`;
    salesforceOrg = await Org.create({ aliasOrUsername: params.orgAlias });
    spinner.succeed(`Instancia de Org (@salesforce/core) creada para: ${params.orgAlias}`);
    
    spinner.text = `Obteniendo detalles de conexión desde Org (@salesforce/core) para: ${params.orgAlias}...`;
    const sfCoreConnection = salesforceOrg.getConnection();
    
    if (!sfCoreConnection.instanceUrl || !sfCoreConnection.accessToken) {
        spinner.fail(`No se pudieron obtener instanceUrl o accessToken de la instancia de Org para ${params.orgAlias}.`);
        throw new Error(`No se pudieron obtener instanceUrl o accessToken de la instancia de Org para ${params.orgAlias}.`);
    }
    spinner.succeed(`Detalles de conexión (instanceUrl, accessToken) obtenidos para: ${params.orgAlias}`);

    spinner.text = `Estableciendo conexión jsforce para: ${params.orgAlias}...`;
    conn = new JsforceConnection({
        instanceUrl: sfCoreConnection.instanceUrl,
        accessToken: sfCoreConnection.accessToken
    });
    
    spinner.text = `Verificando conexión jsforce para: ${params.orgAlias}...`;
    await conn.identity();
    spinner.succeed(`Conexión jsforce establecida y verificada para: ${params.orgAlias}`);


    const toolVersion = params.toolVersion || pkg.version || 'unknown';
    const cacheManager = new CacheManager({ org: salesforceOrg, toolVersion, logger });

    let metadata: CachedOrgMetadata | null = null;

    if (!params.noCache) {
        spinner.text = 'Consultando caché de metadatos...';
        metadata = await cacheManager.getMetadata(params.refreshCache);
        if (metadata) {
            spinner.succeed('Metadatos cargados desde la caché.');
            logger.info(`Usando caché de metadatos para Org ${salesforceOrg.getOrgId()} (generada el ${metadata.metadataFetchedTimestamp}).`);
        } else {
            spinner.warn('Caché no encontrada, inválida o refresco forzado.');
            logger.info(`Caché de metadatos para Org ${salesforceOrg.getOrgId()} no disponible o desactualizada. Obteniendo de Salesforce...`);
        }
    } else {
        spinner.info('Opción --no-cache activada. Omitiendo caché.');
        logger.info('Opción --no-cache activada. Omitiendo caché.');
    }
    

    if (!metadata) { // Si no hay metadatos de la caché (o se ignoró), obtener de Salesforce
      spinner.text = 'Obteniendo metadatos de Salesforce (describeGlobal)...';
      const describeGlobalResult: JsforceDescribeGlobalResult = await conn.describeGlobal();
      spinner.succeed('describeGlobal completado.');

      const sObjectsToDescribe = describeGlobalResult.sobjects
        .filter(sobj => sobj.queryable && sobj.retrieveable) // Según el diseño, queremos todos los "consultables"
        .map(sobj => sobj.name);

      const sObjectDetailsToCache: { [sObjectApiName: string]: CachedSObjectDetail } = {};
      const describePromises: Promise<void>[] = [];

      spinner.text = `Describiendo ${sObjectsToDescribe.length} SObjects... (esto puede tardar)`;
      let describedCount = 0;

      for (const sObjectName of sObjectsToDescribe) {
        describePromises.push(
          sfdcDescribeSObject(conn, sObjectName).then(desc => {
            sObjectDetailsToCache[sObjectName] = CacheManager.transformSObjectDescribeToCache(desc as AppSObjectDescribe);
            describedCount++;
            spinner.text = `Describiendo SObjects... (${describedCount}/${sObjectsToDescribe.length}) ${sObjectName}`;
          }).catch(err => {
            logger.warn(`Error al describir SObject ${sObjectName}: ${err.message}. Se omitirá de la caché.`);
          })
        );
      }
      await Promise.all(describePromises);
      spinner.succeed(`${describedCount} SObjects descritos.`);
      
      const fetchedTimestamp = new Date();
      if (!params.noCache) {
        spinner.text = 'Guardando metadatos en caché...';
        await cacheManager.saveMetadata(sObjectDetailsToCache, fetchedTimestamp);
        spinner.succeed('Metadatos guardados en caché.');
        logger.info(`Caché de metadatos para Org ${salesforceOrg.getOrgId()} (re)generada.`);
      }
      // Construir 'metadata' para uso local si no se usó la caché
       metadata = {
            orgId: salesforceOrg.getOrgId(),
            userId: salesforceOrg.getUsername() || salesforceOrg.getOrgId(), // Provisional
            cacheSchemaVersion: '1.0', // Asignar la versión actual del esquema
            toolVersion: toolVersion,
            generatedTimestamp: new Date().toISOString(), // Timestamp de ahora
            metadataFetchedTimestamp: fetchedTimestamp.toISOString(),
            sObjects: sObjectDetailsToCache
        };
    }

    if (metadata && metadata.sObjects) {
        sObjectNames = Object.keys(metadata.sObjects).sort();
    }


    if (sObjectNames.length > 0) {
      console.log('\nSObjects disponibles en la organización:');
      sObjectNames.forEach(name => console.log(name));
    } else {
      console.log('No se encontraron SObjects consultables en la organización.');
    }

    logger.info('Listado de objetos completado exitosamente.');
    return sObjectNames;

  } catch (error: any) {
    spinner.fail('Error durante el listado de objetos.');
    logger.error('Error detallado:', error.message);
    if (error.stack) {
      logger.debug('Stack trace:', error.stack);
    }
    throw error; // Relanzar el error para que el modo interactivo lo capture
  }
}