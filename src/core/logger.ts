console.log('--- DEBUG: src/core/logger.ts se está cargando ---'); // Añadir este log

// src/core/logger.ts
import winston from 'winston';
import chalk from 'chalk';

const { combine, timestamp, printf, colorize } = winston.format;

// Formato personalizado para la consola con colores
const consoleFormat = printf(({ level, message, timestamp }) => {
  let coloredMessage = message;
  if (level.includes('error')) coloredMessage = chalk.red(message);
  if (level.includes('warn')) coloredMessage = chalk.yellow(message);
  if (level.includes('info')) coloredMessage = chalk.green(message);
  if (level.includes('debug')) coloredMessage = chalk.blue(message);
  return `${chalk.gray(timestamp)} ${level}: ${coloredMessage}`;
});

export const logger = winston.createLogger({
  level: 'info', // Nivel por defecto, se sobrescribirá
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    printf(({ level, message, timestamp }) => `${timestamp} ${level.toUpperCase()}: ${message}`)
  ),
  transports: [
    new winston.transports.File({ filename: 'debug.log', level: 'info' }), // Nivel por defecto para archivo
  ],
});

// Transporte de consola
const consoleTransport = new winston.transports.Console({
  level: 'info', // Nivel por defecto para consola
  format: combine(colorize(), timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), consoleFormat),
});
logger.add(consoleTransport);

/**
 * Establece el nivel de log para todos los transportes.
 * @param newLevel El nuevo nivel de log (ej. 'debug', 'info', 'warn', 'error')
 */
export function setLogLevel(newLevel: string): void {
  const validLevels = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'];
  if (!validLevels.includes(newLevel.toLowerCase())) {
    console.warn(`Nivel de log inválido: "${newLevel}". Usando "info" por defecto.`);
    newLevel = 'info';
  }

  logger.level = newLevel.toLowerCase();
  logger.transports.forEach((transport) => {
    transport.level = newLevel.toLowerCase();
  });
  // Caso especial para el transporte de archivo si se quiere mantener un nivel diferente o específico
  // Por ahora, lo alineamos con el nivel global.
  const fileTransport = logger.transports.find(t => t instanceof winston.transports.File);
  if (fileTransport) {
    fileTransport.level = newLevel.toLowerCase();
  }
  if (consoleTransport) {
    consoleTransport.level = newLevel.toLowerCase();
  }
  logger.info(`Nivel de log establecido a: ${newLevel.toUpperCase()}`);
}