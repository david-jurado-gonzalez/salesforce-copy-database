#!/usr/bin/env node

// src/main.ts
import { Command } from 'commander';
import { extractCommand } from './commands/extractCommand.js';
import { deployCommand } from './commands/deployCommand.js';
import { logger } from './core/logger.js'; // Importar logger
// import { listObjectsCommand } from './commands/listObjectsCommand';

logger.debug('Iniciando sfdc-data-copier...'); // Añadir este log al inicio

const program = new Command();

program
  .name('sfdc-data-copier')
  .description('Una herramienta CLI para mover datos entre organizaciones de Salesforce.')
  .version('1.0.0');

program
  .command('extract')
  .description('Extrae datos de una organización de origen usando una consulta SOQL.')
  .requiredOption('-s, --source <alias>', 'Alias de la organización de origen (de SFDX o config)')
  .requiredOption('-q, --query <soql>', 'La consulta SOQL para extraer los datos')
  .option('-c, --config <path>', 'Ruta al archivo de configuración', './config.json')
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
program.parse(process.argv);