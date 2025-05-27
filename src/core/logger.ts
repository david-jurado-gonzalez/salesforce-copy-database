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
  level: 'debug', // Captura todos los niveles
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    printf(({ level, message, timestamp }) => `${timestamp} ${level.toUpperCase()}: ${message}`)
  ),
  transports: [
    // Escribe todos los logs de nivel 'debug' y superior en `debug.log`
    new winston.transports.File({ filename: 'debug.log', level: 'debug' }),
  ],
});

// Añade un transporte de consola que solo muestra 'info' o superior por defecto
// y que usa un formato más amigable y con colores.
logger.add(
  new winston.transports.Console({
    level: 'info',
    format: combine(colorize(), timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), consoleFormat),
  })
);