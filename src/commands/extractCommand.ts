// src/commands/extractCommand.ts
import { getSalesforceConnection } from '../core/auth.js';
import { loadConfig, getOrgDataDir, ensureDir } from '../core/fileManager.js';
import { logger } from '../core/logger.js';
import { CommandOptions, DEFAULT_ORG_CONFIG } from '../core/typeDefs.js';
import ora from 'ora';
import path from 'path';
import { createWriteStream } from 'fs';

export async function extractCommand(options: CommandOptions) {
  logger.info(`--- Iniciando Extracción de Datos ---`);
  const spinner = ora('Cargando configuración...').start();

  try {
    let config = await loadConfig(options.config === '' ? undefined : options.config ? options.config : './config.json', {
      username: options.username,
      password: options.password,
      loginUrl: options.loginUrl,
      source: options.source,
      target: options.target
    });
    const sourceAlias = options.source;

    
    // Permitimos que no exista la org en config - se usará la org por defecto de SFDX
    if (!config || !config.orgs || !config.orgs[options.source]) {
      logger.warn('No se encontró configuración de organización. Se utilizará la configuración por defecto o SFDX.');
      config = config || { orgs: {} };
      config.orgs[options.source] = { ...DEFAULT_ORG_CONFIG };
    }
    if (!options.query) {
      throw new Error("La opción '--query' es obligatoria para la extracción.");
    }

    spinner.text = `Autenticando con la organización de origen: ${sourceAlias}...`;
    const conn = await getSalesforceConnection(sourceAlias, config);
    spinner.succeed(`Autenticado con ${conn.instanceUrl}`);

    const dataDir = getOrgDataDir(sourceAlias);
    await ensureDir(dataDir);
    
    // Extraemos el nombre del objeto principal de la query (simplificación)
    const objectNameMatch = options.query.match(/FROM\s+(\w+)/i);
    if (!objectNameMatch) {
      throw new Error("No se pudo determinar el objeto principal de la consulta SOQL.");
    }
    const mainObjectName = objectNameMatch[1];
    const outputFile = path.join(dataDir, `${mainObjectName}.csv`);

    spinner.start(`Ejecutando consulta y extrayendo datos para '${mainObjectName}'...`);

    const recordStream = (await conn.bulk.query(options.query)).stream();
    const fileWriteStream = createWriteStream(outputFile);
    
    let recordCount = 0;
    recordStream.on('data', (data) => {
        recordCount++;
        spinner.text = `Procesando registros de '${mainObjectName}'... (${recordCount} encontrados)`;
    });
    recordStream.on('end', () => {
        spinner.succeed(`Extracción completada. ${recordCount} registros guardados en ${outputFile}`);
    });
    recordStream.on('error', (err: Error) => {
        spinner.fail(`Error durante la extracción: ${err.message}`);
    });

    // Pipe para dirigir los datos de la query al archivo CSV
    recordStream.pipe(fileWriteStream);

  } catch (error) {
    spinner.fail('La extracción ha fallado.');
    logger.error((error as Error).message);
    process.exit(1);
  }
}