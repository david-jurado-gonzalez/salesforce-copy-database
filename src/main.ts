#!/usr/bin/env node

// src/main.ts
import { Command, Option } from 'commander';
import fs from 'fs';
import path from 'path';
import { extractData } from './commands/extractCommand.js'; // Importar la función refactorizada
import { deployData } from './commands/deployCommand.js';   // Importar la función refactorizada
import { listObjects } from './commands/listObjectsCommand.js'; // Importar la función refactorizada
import { Logger } from './core/logger.js'; // Importar la clase Logger
import { InteractiveModeManager } from './interactive/InteractiveModeManager.js'; // Importar el gestor del modo interactivo

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
  .description('Extrae datos de una organización de origen usando una consulta SOQL.')
  .requiredOption('-s, --source <alias>', 'Alias de la organización de origen (de SFDX o config)')
  .requiredOption('-q, --query <soql>', 'La consulta SOQL para extraer los datos')
  .option('-o, --output <path>', 'Ruta del directorio de salida para los datos', './data') // Cambiado a --output
  .option('--apiType <type>', 'Tipo de API a usar (auto, bulk, rest)', 'auto')
  .action(async (options) => {
    try {
      await extractData({
        sourceOrgAlias: options.source,
        query: options.query,
        outputPath: options.output, // Usar options.output
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

// Comando para iniciar el modo interactivo explícitamente
program
  .command('interactive')
  .description('Inicia la herramienta en modo interactivo.')
  .action(() => {
    const interactiveMode = new InteractiveModeManager();
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
    const interactiveMode = new InteractiveModeManager();
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