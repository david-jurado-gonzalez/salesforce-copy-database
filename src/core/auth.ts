// src/core/auth.ts
import { Connection } from 'jsforce';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { exec } from 'child_process';
import { Logger } from './logger.js'; // Importar la clase Logger
import { AppConfig, OrgConfig } from './typeDefs.js';

const CACHE_DIR = path.join(os.homedir(), '.sfdc-data-copier');
const ALIAS_CACHE_FILE = path.join(CACHE_DIR, 'alias-cache.json');
const CACHE_EXPIRY_MS = 3600 * 1000; // 1 hora de caducidad para la caché

interface CachedAuthInfo {
  instanceUrl: string;
  accessToken: string;
  timestamp: number;
}

interface AliasCache {
  [alias: string]: CachedAuthInfo;
}

/**
 * Clase para gestionar la autenticación y las conexiones con Salesforce.
 */
export class Auth {
  private logger: Logger;

  constructor() {
    this.logger = new Logger('Auth');
  }

  /**
   * Obtiene una conexión de Salesforce, priorizando los alias de VS Code/SFDX.
   * @param alias El alias de la organización.
   * @param config El objeto de configuración de la app.
   * @returns Una instancia de conexión de jsforce autenticada.
   */
  public async getSalesforceConnection(alias: string, config: AppConfig): Promise<Connection> {
    // Intento 1: Usar alias de SFDX (la forma más común y segura)
    try {
      const conn = await this.connectWithSfdxAlias(alias);
      this.logger.info(`Conexión establecida para el alias '${alias}' usando credenciales locales de SFDX.`);
      return conn;
    } catch (sfdxError) {
      this.logger.debug(`No se pudo conectar con el alias SFDX '${alias}': ${(sfdxError as Error).message}`);
      // Si falla, se pasa al siguiente método.
    }

    // Intento 2: Usar credenciales del archivo config.json
    const orgConfig = config.orgs[alias];
    if (orgConfig && orgConfig.username && orgConfig.password) {
      try {
        const conn = new Connection({ loginUrl: orgConfig.loginUrl || 'https://login.salesforce.com' });
        await conn.login(orgConfig.username, orgConfig.password);
        this.logger.info(`Conexión establecida para el alias '${alias}' usando credenciales del archivo de configuración.`);
        return conn;
      } catch (configError) {
        this.logger.error(`Fallo al iniciar sesión con las credenciales de config.json para el alias '${alias}': ${(configError as Error).message}`);
        throw configError;
      }
    }

    throw new Error(`No se encontraron credenciales válidas para el alias '${alias}'. Compruebe sus alias de SFDX o el archivo de configuración.`);
  }

  /**
   * Obtiene una lista de todos los alias de organizaciones de Salesforce disponibles.
   * @returns Un array de strings con los alias de las organizaciones.
   */
  public async getOrgAliases(): Promise<string[]> {
    try {
      const command = `sf org list --json`;
      const stdout = await this.execCommand(command);
      const cliOutput = JSON.parse(stdout);

      if (!cliOutput.result || !Array.isArray(cliOutput.result.nonScratchOrgs)) {
        this.logger.warn('La salida de "sf org list" no contiene la estructura esperada para nonScratchOrgs.');
        return [];
      }

      const aliases = cliOutput.result.nonScratchOrgs
        .filter((org: any) => org.alias)
        .map((org: any) => org.alias);

      this.logger.debug(`Alias de organizaciones encontrados: ${aliases.join(', ')}`);
      return aliases;
    } catch (error: any) {
      this.logger.error(`Error al obtener los alias de las organizaciones: ${error.message}`);
      return [];
    }
  }

  /**
   * Ejecuta un comando de shell y devuelve su salida.
   * @param command El comando a ejecutar.
   * @returns La salida estándar del comando.
   */
  private async execCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Error al ejecutar el comando: ${command}\n${stderr}`));
        } else {
          resolve(stdout);
        }
      });
    });
  }

  /**
   * Lee el archivo de caché de alias.
   * @returns El objeto de caché de alias o un objeto vacío si no existe o es inválido.
   */
  private async readAliasCache(): Promise<AliasCache> {
    try {
      await fs.mkdir(CACHE_DIR, { recursive: true });
      const data = await fs.readFile(ALIAS_CACHE_FILE, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        this.logger.debug(`Archivo de caché de alias no encontrado en ${ALIAS_CACHE_FILE}. Creando uno nuevo.`);
      } else {
        this.logger.error(`Error al leer la caché de alias: ${(error as Error).message}`);
      }
      return {};
    }
  }

  /**
   * Escribe el objeto de caché de alias en el archivo.
   * @param cache El objeto de caché a escribir.
   */
  private async writeAliasCache(cache: AliasCache): Promise<void> {
    try {
      await fs.mkdir(CACHE_DIR, { recursive: true });
      await fs.writeFile(ALIAS_CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8');
      this.logger.debug(`Caché de alias guardada en ${ALIAS_CACHE_FILE}`);
    } catch (error) {
      this.logger.error(`Error al escribir la caché de alias: ${(error as Error).message}`);
    }
  }

  /**
   * Obtiene la información de autenticación de un alias de la caché, si es válida y no ha caducado.
   * @param alias El alias de la organización.
   * @returns La información de autenticación en caché o undefined si no se encuentra o ha caducado.
   */
  private async getAuthInfoFromCache(alias: string): Promise<CachedAuthInfo | undefined> {
    const cache = await this.readAliasCache();
    const cachedInfo = cache[alias];

    if (cachedInfo) {
      const now = Date.now();
      if (now - cachedInfo.timestamp < CACHE_EXPIRY_MS) {
        this.logger.debug(`Usando información de autenticación en caché para el alias '${alias}'.`);
        return cachedInfo;
      } else {
        this.logger.debug(`La información de autenticación en caché para el alias '${alias}' ha caducado.`);
      }
    }
    return undefined;
  }

  /**
   * Guarda la información de autenticación de un alias en la caché.
   * @param alias El alias de la organización.
   * @param authInfo La información de autenticación a guardar.
   */
  private async saveAuthInfoToCache(alias: string, authInfo: { instanceUrl: string; accessToken: string }): Promise<void> {
    const cache = await this.readAliasCache();
    cache[alias] = {
      instanceUrl: authInfo.instanceUrl,
      accessToken: authInfo.accessToken,
      timestamp: Date.now(),
    };
    await this.writeAliasCache(cache);
  }

  /**
   * Busca el archivo de estado de un alias de SFDX y crea una conexión.
   * @param alias El alias de la organización.
   */
  private async connectWithSfdxAlias(alias: string): Promise<Connection> {
    let authInfo: { instanceUrl: string; accessToken: string } | undefined;

    // Intento 1: Obtener de la caché
    authInfo = await this.getAuthInfoFromCache(alias);

    if (!authInfo) {
      this.logger.debug(`Información de autenticación para el alias '${alias}' no encontrada en caché o caducada. Consultando SF CLI.`);
      // Intento 2: Consultar Salesforce CLI
      try {
        const command = `sf org display --json -o ${alias}`;
        const stdout = await this.execCommand(command);
        const cliOutput = JSON.parse(stdout);

        if (!cliOutput.result || !cliOutput.result.instanceUrl || !cliOutput.result.accessToken) {
          throw new Error('La salida de la CLI no contiene instanceUrl o accessToken válidos.');
        }

        authInfo = {
          instanceUrl: cliOutput.result.instanceUrl,
          accessToken: cliOutput.result.accessToken,
        };

        await this.saveAuthInfoToCache(alias, authInfo);
        this.logger.debug(`Información de autenticación para el alias '${alias}' obtenida de SF CLI y guardada en caché.`);

      } catch (cliError) {
        this.logger.debug(`Fallo al obtener información del alias '${alias}' de SF CLI: ${(cliError as Error).message}`);
        throw new Error(`No se pudo resolver el alias '${alias}' con Salesforce CLI. Asegúrese de que el alias existe y está autenticado.`);
      }
    }

    if (!authInfo) {
      throw new Error(`No se pudo obtener la información de autenticación para el alias '${alias}'.`);
    }

    const conn = new Connection({
      instanceUrl: authInfo.instanceUrl,
      accessToken: authInfo.accessToken,
      // Se puede añadir refreshToken para sesiones más largas, pero requeriría manejar el evento 'refresh'
    });

    // Realizamos una pequeña consulta para verificar que la sesión está activa
    try {
      await conn.identity();
      this.logger.debug(`Conexión verificada para el alias '${alias}'.`);
    } catch (identityError) {
      this.logger.error(`Fallo al verificar la conexión para el alias '${alias}': ${(identityError as Error).message}`);
      // Si la verificación falla, invalidamos la caché y lanzamos un error
      const cache = await this.readAliasCache();
      delete cache[alias];
      await this.writeAliasCache(cache);
      throw new Error(`La conexión para el alias '${alias}' no es válida. La caché ha sido invalidada. Intente de nuevo.`);
    }

    return conn;
  }
}