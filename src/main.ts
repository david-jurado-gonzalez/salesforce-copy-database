#!/usr/bin/env node

// src/main.ts
import { Command, Option } from 'commander';
import fs from 'fs';
import path from 'path';
import { extractData } from './commands/extractCommand.js'; // Importar la función refactorizada
import { deployData } from './commands/deployCommand.js';   // Importar la función refactorizada
import { listObjects } from './commands/listObjectsCommand.js'; // Importar la función refactorizada
import { backupData } from './commands/backupCommand.js'; // Importar la función para el comando backup
import { restoreData } from './commands/restoreCommand.js'; // Importar la función para el comando restore
import { Logger } from './core/logger.js'; // Importar la clase Logger
import { InteractiveModeManager } from './interactive/InteractiveModeManager.js'; // Importar el gestor del modo interactivo
import { AppConfig, DEFAULT_APP_CONFIG } from './core/typeDefs.js'; // Importar AppConfig y DEFAULT_APP_CONFIG

const logger = new Logger('Main'); // Instanciar el logger

// Función para determinar y establecer el nivel de log
const initializeLogLevel = () => {
  let logLevelFromCli: string | undefined;
  let configPathFromCli: string = './config.json';

  const argv = process.argv;
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === '-l' || argv[i] === '--loglevel') && argv[i + 1]) {
      logLevelFromCli = argv[i + 1];
    }
    if (argv[i] === '--config' && argv[i + 1]) {
      configPathFromCli = argv[i + 1];
    }
  }
  
  let finalLogLevel: string = 'INFO'; // Nivel por defecto cambiado a INFO

  if (logLevelFromCli) {
    finalLogLevel = logLevelFromCli;
    logger.debug(`Nivel de log especificado por CLI: ${finalLogLevel}`);
  } else {
    logger.debug(`No se especificó --loglevel en CLI. Intentando leer desde archivo de configuración: ${configPathFromCli}`);
    try {
      const configFilePath = path.resolve(configPathFromCli);
      if (fs.existsSync(configFilePath)) {
        const configFileContent = fs.readFileSync(configFilePath, 'utf-8');
        const config = JSON.parse(configFileContent);
        if (config && typeof config.logLevel === 'string') {
          finalLogLevel = config.logLevel;
          logger.debug(`Nivel de log leído desde ${configPathFromCli}: ${finalLogLevel}`);
        } else {
          logger.debug(`Archivo de configuración ${configPathFromCli} no contiene "logLevel" o es inválido. Usando por defecto: ${finalLogLevel}`);
        }
      } else {
        logger.debug(`Archivo de configuración ${configPathFromCli} no encontrado. Usando por defecto: ${finalLogLevel}`);
      }
    } catch (error: any) {
      logger.warn(`Error al leer/parsear archivo de configuración ${configPathFromCli} para logLevel: ${error.message}. Usando por defecto: ${finalLogLevel}`);
    }
  }
  
  logger.setLogLevel(finalLogLevel); // Usar el método de la instancia de Logger
};

/**
 * Carga la configuración de la aplicación desde config.json o config.sample.json.
 * @returns La configuración de la aplicación.
 */
async function loadAppConfig(): Promise<AppConfig> {
  const configFilePath = path.resolve('./config.json');
  const sampleConfigFilePath = path.resolve('./config.sample.json');
  let config: AppConfig = DEFAULT_APP_CONFIG;

  try {
    if (fs.existsSync(configFilePath)) {
      const configFileContent = fs.readFileSync(configFilePath, 'utf-8');
      config = { ...config, ...JSON.parse(configFileContent) }; // Fusionar con valores por defecto
      logger.info(`Configuración cargada desde ${configFilePath}`);
    } else if (fs.existsSync(sampleConfigFilePath)) {
      const sampleFileContent = fs.readFileSync(sampleConfigFilePath, 'utf-8');
      config = { ...config, ...JSON.parse(sampleFileContent) }; // Fusionar con valores por defecto
      logger.warn(`Archivo de configuración ${configFilePath} no encontrado. Usando ${sampleConfigFilePath}.`);
    } else {
      logger.warn('No se encontró config.json ni config.sample.json. Usando configuración por defecto.');
    }
  } catch (error: any) {
    logger.error(`Error al cargar el archivo de configuración: ${error.message}. Usando configuración por defecto.`);
  }
  return config;
}

// Inicializar el nivel de log ANTES de definir los comandos y parsear.
initializeLogLevel();

logger.debug('Iniciando sfdc-data-copier...');

const program = new Command();

program
  .name('sfdc-data-copier')
  .description('Una herramienta CLI para mover datos entre organizaciones de Salesforce.')
  .version('1.0.0')
  .addOption(new Option('-l, --loglevel <level>', 'Nivel de verbosidad del log (error, warn, info, http, verbose, debug, silly)').hideHelp());

program
  .command('extract')
  .description('Extrae datos de una organización de origen usando una consulta SOQL o SOSL.')
  .option('-u, --username <username>', 'Nombre de usuario o alias de la organización de origen (reemplaza a -s)') // -s ahora es -u
  .option('-a, -T, --target-alias <alias>', 'Alias específico de la organización de origen (tiene precedencia sobre -u si ambos se proporcionan)')
  .option('-q, --query <soql>', 'La consulta SOQL para extraer los datos')
  .option('--sosl <soslQuery>', 'Permite especificar una consulta SOSL para la extracción de datos')
  .option('-o, --output <path>', 'Ruta del directorio de salida para los datos', './data')
  .option('--apiType <type>', 'Tipo de API a usar (auto, bulk, rest)', 'auto')
  .action(async (options) => {
    // Validar que al menos uno de username o targetAlias se proporcione
    if (!options.username && !options.targetAlias) {
      logger.error('Error: Debe proporcionar un alias de origen con -a (--target-alias) o un nombre de usuario/alias con -u (--username).');
      process.exit(1);
    }

    // Validar que se proporcione query o sosl, pero no ambos
    if (!options.query && !options.sosl) {
      logger.error('Error: Debe proporcionar una consulta SOQL con --query o una consulta SOSL con --sosl.');
      process.exit(1);
    }
    if (options.query && options.sosl) {
      logger.error('Error: No puede especificar --query y --sosl simultáneamente. Elija una opción.');
      process.exit(1);
    }

    try {
      await extractData({
        username: options.username, // options.source ahora es options.username
        targetAlias: options.targetAlias,
        query: options.query,
        soslQuery: options.sosl, // Corregido: usar soslQuery en lugar de sosl
        outputPath: options.output,
        apiType: options.apiType
      });
    } catch (error: any) {
      logger.error(`Error en el comando de extracción: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('deploy')
  .description('Despliega datos en una organización de destino desde un directorio de trabajo local.')
  .requiredOption('-t, --target <alias>', 'Alias de la organización de destino') // Cambiado a --target
  .option('-i, --input <path>', 'Ruta del directorio de entrada de los datos', './data') // Cambiado a --input
  .option('-f, --force', 'Saltar la confirmación de seguridad antes de desplegar', false)
  .action(async (options) => {
    try {
      await deployData({
        targetOrgAlias: options.target,
        inputPath: options.input, // Usar options.input
        force: options.force
      });
    } catch (error: any) {
      logger.error(`Error en el comando de despliegue: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('list-objects')
  .description('Lista todos los SObjects disponibles en la organización Salesforce de destino.')
  .requiredOption('-o, --org <alias>', 'Alias de la organización Salesforce') // Cambiado a --org
  .action(async (options) => {
    try {
      await listObjects({ orgAlias: options.org });
    } catch (error: any) {
      logger.error(`Error en el comando de listado de objetos: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('backup')
  .description('Crea un backup de datos y metadatos de una organización de Salesforce.')
  .option('-u, --username <username>', 'Nombre de usuario o alias de la organización de origen')
  .option('-a, --target-alias <alias>', 'Alias específico de la organización de origen (tiene precedencia sobre -u)')
  .requiredOption('-o, --output-dir <path>', 'Directorio de salida para el backup', './backup')
  .option('-m, --manifest <path>', 'Ruta al archivo backup-manifest.json (opcional, para especificar uno existente o ubicación no estándar)')
  .option('--include-metadata', 'Incluir metadatos (descripciones de SObject y grafo de dependencia)', false)
  .option('--data-only', 'Extraer solo datos (ignora --include-metadata y --metadata-only si se establece)', false)
  .option('--metadata-only', 'Extraer solo metadatos (ignora --data-only si se establece, implica --include-metadata)', false)
  .option('--api-version <version>', 'Versión de la API de Salesforce a utilizar')
  .option('--max-file-size <size>', 'Tamaño máximo de archivo para los CSV de datos (ej. 100MB, 1GB)', '250MB')
  .option('--exclude-fields <fields>', 'Lista de campos a excluir, separados por comas (ej. "CreatedDate,LastModifiedDate")')
  .option('--sobjects <objects>', 'Lista de SObjects a incluir, separados por comas (ej. "Account,Contact,MyCustomObject__c")')
  .option('--all-sobjects', 'Incluir todos los SObjects recuperables (puede tardar mucho)', false)
  .option('--name-fields-only', 'Incluir solo campos de nombre para registros relacionados en los CSV de datos', false)
  .action(async (options) => {
    if (!options.username && !options.targetAlias) {
      logger.error('Error: Debe proporcionar un alias de origen con -a (--target-alias) o un nombre de usuario/alias con -u (--username).');
      process.exit(1);
    }
    // Validar combinaciones de flags de datos/metadatos
    if (options.dataOnly && options.metadataOnly) {
        logger.error('Error: No puede especificar --data-only y --metadata-only simultáneamente.');
        process.exit(1);
    }
    if (options.dataOnly && options.includeMetadata) {
        logger.warn('Advertencia: --data-only está establecido, por lo que --include-metadata será ignorado.');
        options.includeMetadata = false; // Asegurar que no se procesen metadatos
    }
    if (options.metadataOnly) {
        options.includeMetadata = true; // --metadata-only implica --include-metadata
    }


    try {
      // Determinar el identificador de la organización de origen
      const sourceOrgIdentifier = options.targetAlias || options.username;
      if (!sourceOrgIdentifier) { // Doble verificación, aunque la CLI ya lo hace.
          logger.error('Error fatal: No se proporcionó identificador de organización de origen.');
          process.exit(1);
      }

      await backupData({
        sourceOrgIdentifier: sourceOrgIdentifier, // Usar el identificador combinado
        outputDir: options.outputDir,
        manifestPath: options.manifest,
        includeMetadata: options.includeMetadata,
        dataOnly: options.dataOnly,
        metadataOnly: options.metadataOnly,
        apiVersion: options.apiVersion,
        maxFileSize: options.maxFileSize,
        excludeFields: options.excludeFields ? options.excludeFields.split(',').map((f: string) => f.trim()) : undefined,
        sObjectList: options.sobjects ? options.sobjects.split(',').map((s: string) => s.trim()) : undefined,
        allSObjects: options.allSobjects, // El nombre de la opción en CLI es allSobjects
        nameFieldsOnly: options.nameFieldsOnly,
      });
    } catch (error: any) {
      logger.error(`Error en el comando de backup: ${error.message}`);
      process.exit(1);
    }
program
  .command('restore')
  .description('Restaura datos en una organización de Salesforce desde un directorio de backup.')
  .requiredOption('-t, --target-org <alias>', 'Alias de la organización Salesforce de destino')
  .requiredOption('-p, --backup-path <path>', 'Ruta al directorio del backup que contiene backup-manifest.json')
  .option('-s, --sobjects <list>', 'Lista de SObjects a restaurar, separados por comas (ej. "Account,Contact"). Por defecto, todos los del manifiesto.')
  .addOption(new Option('--resolve-conflicts <mode>', 'Estrategia para manejar conflictos de datos (SKIP o OVERWRITE)').choices(['SKIP', 'OVERWRITE']).default('SKIP'))
  .option('--max-api-usage <percentage>', 'Límite de uso de API de Salesforce (1-100), porcentaje del límite diario restante', '70')
  .option('--dry-run', 'Ejecuta una simulación sin realizar cambios en la organización de destino', false)
  .option('--no-dependency-check', 'Omite la comprobación de dependencias y restaura en el orden proporcionado o el del manifiesto', false)
  .option('--external-id-field <field>', 'Nombre del campo de ID Externo a usar para operaciones de upsert (ej. MyExternalId__c)')
  .action(async (options) => {
    // Validar que al menos targetOrg y backupPath se proporcionen (commander ya lo hace con requiredOption)
    // Validar maxApiUsage si se proporciona
    if (options.maxApiUsage) {
      const apiUsage = parseInt(options.maxApiUsage, 10);
      if (isNaN(apiUsage) || apiUsage < 1 || apiUsage > 100) {
        logger.error('Error: El valor de --max-api-usage debe ser un número entre 1 y 100.');
        process.exit(1);
      }
    }

    try {
      await restoreData({
        targetOrgAlias: options.targetOrg,
        backupPath: options.backupPath,
        sobjects: options.sobjects,
        resolveConflicts: options.resolveConflicts,
        maxApiUsage: options.maxApiUsage ? parseInt(options.maxApiUsage, 10) : undefined,
        dryRun: options.dryRun,
        noDependencyCheck: options.noDependencyCheck,
        externalIdField: options.externalIdField,
        interactive: false // El modo interactivo se maneja por separado
      });
    } catch (error: any) {
      logger.error(`Error en el comando de restauración: ${error.message}`);
      process.exit(1);
    }
  });
  });

// Comando para iniciar el modo interactivo explícitamente
program
  .command('interactive')
  .alias('i') // Añadir alias 'i'
  .description('Inicia la herramienta en modo interactivo.')
  .action(async () => { // Hacer la acción asíncrona
    const appConfig = await loadAppConfig(); // Cargar la configuración
    const interactiveMode = new InteractiveModeManager(appConfig); // Pasar la configuración
    interactiveMode.start().catch(error => {
      logger.error(`Error en el modo interactivo: ${error.message}`);
      process.exit(1);
    });
  });

// Lógica para iniciar el modo interactivo por defecto o parsear comandos
if (process.argv.length <= 2 || (process.argv.length === 3 && process.argv[2] === 'interactive')) {
  // Si no hay argumentos o el único argumento es 'interactive' (manejado por el comando de arriba)
  // o si se llama directamente sin 'interactive' pero queremos que sea el comportamiento por defecto.
  // Aquí, si es 'interactive', ya lo maneja el .command('interactive').
  // Si no hay argumentos, también queremos el modo interactivo.
  if (process.argv.length <= 2) {
    const appConfig = await loadAppConfig(); // Cargar la configuración
    const interactiveMode = new InteractiveModeManager(appConfig); // Pasar la configuración
    interactiveMode.start().catch(error => {
      logger.error(`Error iniciando modo interactivo por defecto: ${error.message}`);
      process.exit(1);
    });
  } else {
    // Parsear los argumentos de la línea de comandos si hay comandos explícitos
    // (esto incluye el caso 'interactive' que será capturado por su propio .action())
    program.parse(process.argv);
  }
} else {
  // Parsear los argumentos de la línea de comandos si hay comandos explícitos
  program.parse(process.argv);
}