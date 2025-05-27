// src/core/auth.ts
import { Connection } from 'jsforce';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { logger } from './logger.js';
import { AppConfig, OrgConfig } from './typeDefs.js';

/**
 * Obtiene una conexión de Salesforce, priorizando los alias de VS Code/SFDX.
 * @param alias El alias de la organización.
 * @param config El objeto de configuración de la app.
 * @returns Una instancia de conexión de jsforce autenticada.
 */
export async function getSalesforceConnection(alias: string, config: AppConfig): Promise<Connection> {
  // Intento 1: Usar alias de SFDX (la forma más común y segura)
  try {
    const conn = await connectWithSfdxAlias(alias);
    logger.info(`Conexión establecida para el alias '${alias}' usando credenciales locales de SFDX.`);
    return conn;
  } catch (sfdxError) {
    logger.debug(`No se pudo conectar con el alias SFDX '${alias}': ${(sfdxError as Error).message}`);
    // Si falla, se pasa al siguiente método.
  }

  // Intento 2: Usar credenciales del archivo config.json
  const orgConfig = config.orgs[alias];
  if (orgConfig && orgConfig.username && orgConfig.password) {
    try {
      const conn = new Connection({ loginUrl: orgConfig.loginUrl || 'https://login.salesforce.com' });
      await conn.login(orgConfig.username, orgConfig.password);
      logger.info(`Conexión establecida para el alias '${alias}' usando credenciales del archivo de configuración.`);
      return conn;
    } catch (configError) {
      logger.error(`Fallo al iniciar sesión con las credenciales de config.json para el alias '${alias}': ${(configError as Error).message}`);
      throw configError;
    }
  }

  throw new Error(`No se encontraron credenciales válidas para el alias '${alias}'. Compruebe sus alias de SFDX o el archivo de configuración.`);
}

/**
 * Busca el archivo de estado de un alias de SFDX y crea una conexión.
 * @param alias El alias de la organización.
 */
async function connectWithSfdxAlias(alias: string): Promise<Connection> {
  const homeDir = os.homedir();
  const sfdxDir = path.join(homeDir, '.sfdx');
  const aliasStateFile = path.join(sfdxDir, `${alias}.json`);

  try {
    const stateData = await fs.readFile(aliasStateFile, 'utf-8');
    const authInfo = JSON.parse(stateData);

    if (!authInfo.accessToken || !authInfo.instanceUrl) {
      throw new Error('El archivo de estado del alias no contiene accessToken o instanceUrl.');
    }

    const conn = new Connection({
      instanceUrl: authInfo.instanceUrl,
      accessToken: authInfo.accessToken,
      // Se puede añadir refreshToken para sesiones más largas, pero requeriría manejar el evento 'refresh'
    });
    
    // Realizamos una pequeña consulta para verificar que la sesión está activa
    await conn.identity();

    return conn;
  } catch (error) {
    if ((error as any).code === 'ENOENT') {
      throw new Error(`El archivo de estado para el alias '${alias}' no se encontró en ${sfdxDir}.`);
    }
    throw error;
  }
}