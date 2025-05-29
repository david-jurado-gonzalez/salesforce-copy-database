#!/usr/bin/env node

// src/main.ts
import { Command, Option } from 'commander';
import fs from 'fs';
import path from 'path';
import { extractCommand } from './commands/extractCommand.js';
import { deployCommand } from './commands/deployCommand.js';
import { logger, setLogLevel } from './core/logger.js'; // Importar logger y setLogLevel
// import { listObjectsCommand } from './commands/listObjectsCommand';

// Función para determinar y establecer el nivel de log
const initializeLogLevel = () => {
  // Intentar obtener opciones globales antes de parsear comandos específicos
  // Commander no facilita esto directamente para opciones globales antes de .parse()
  // así que inspeccionamos process.argv manualmente para --loglevel y --config.
  // Esto es un workaround. Una mejor solución podría ser usar un pre-parser o una instancia separada de Command.

  let logLevelFromCli: string | undefined;
  let configPathFromCli: string = './config.json'; // Default config path

  const argv = process.argv;
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === '-l' || argv[i] === '--loglevel') && argv[i + 1]) {
      logLevelFromCli = argv[i + 1];
      // No romper, por si --config aparece después
    }
    if (argv[i] === '--config' && argv[i + 1]) {
      configPathFromCli = argv[i + 1];
      // No romper, por si --loglevel aparece después
    }
  }
  
  let finalLogLevel: string = 'WARN'; // Nivel por defecto

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
  
  setLogLevel(finalLogLevel);
};

// Inicializar el nivel de log ANTES de definir los comandos y parsear.
// Esto asegura que el logger ya está configurado cuando los comandos se ejecutan.
initializeLogLevel();

logger.debug('Iniciando sfdc-data-copier...'); // Este log ya usará el nivel configurado

const program = new Command();

program
  .name('sfdc-data-copier')
  .description('Una herramienta CLI para mover datos entre organizaciones de Salesforce.')
  .version('1.0.0')
  .addOption(new Option('-l, --loglevel <level>', 'Nivel de verbosidad del log (error, warn, info, http, verbose, debug, silly)').hideHelp()); // Ocultar de la ayuda general ya que se maneja globalmente

program
  .command('extract')
  .description('Extrae datos de una organización de origen usando una consulta SOQL.')
  .requiredOption('-s, --source <alias>', 'Alias de la organización de origen (de SFDX o config)')
  .requiredOption('-q, --query <soql>', 'La consulta SOQL para extraer los datos')
  .option('-c, --config <path>', 'Ruta al archivo de configuración', './config.json')
  .option('--apiType <type>', 'Tipo de API a usar (auto, bulk, rest)', 'auto')
  .action(extractCommand);

program
  .command('deploy')
  .description('Despliega datos en una organización de destino desde un directorio de trabajo local.')
  .requiredOption('-s, --source <alias>', 'Alias del directorio de origen de los datos')
  .requiredOption('-t, --target <alias>', 'Alias de la organización de destino')
  .option('-c, --config <path>', 'Ruta al archivo de configuración', './config.json')
  .option('-f, --force', 'Saltar la confirmación de seguridad antes de desplegar', false)
  .action(deployCommand);
  
// Aquí añadirías el comando 'list-objects'

// Parsear los argumentos de la línea de comandos
// Las opciones globales como --loglevel ya han sido consideradas por initializeLogLevel
program.parse(process.argv);