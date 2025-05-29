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

/**
 * Clase Logger que encapsula la funcionalidad de Winston.
 */
export class Logger {
  private winstonLogger: winston.Logger;
  private consoleTransport: winston.transports.ConsoleTransportInstance;

  constructor(context: string = 'App') {
    this.winstonLogger = winston.createLogger({
      level: 'info', // Nivel por defecto, se sobrescribirá
      format: combine(
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        printf(({ level, message, timestamp }) => `${timestamp} [${context}] ${level.toUpperCase()}: ${message}`)
      ),
      transports: [
        new winston.transports.File({ filename: 'debug.log', level: 'info' }), // Nivel por defecto para archivo
      ],
    });

    // Transporte de consola
    this.consoleTransport = new winston.transports.Console({
      level: 'info', // Nivel por defecto para consola
      format: combine(colorize(), timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), consoleFormat),
    });
    this.winstonLogger.add(this.consoleTransport);
  }

  public info(message: string, ...args: any[]): void {
    this.winstonLogger.info(message, ...args);
  }

  public warn(message: string, ...args: any[]): void {
    this.winstonLogger.warn(message, ...args);
  }

  public error(message: string, ...args: any[]): void {
    this.winstonLogger.error(message, ...args);
  }

  public debug(message: string, ...args: any[]): void {
    this.winstonLogger.debug(message, ...args);
  }

  /**
   * Establece el nivel de log para todos los transportes.
   * @param newLevel El nuevo nivel de log (ej. 'debug', 'info', 'warn', 'error')
   */
  public setLogLevel(newLevel: string): void {
    const validLevels = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'];
    if (!validLevels.includes(newLevel.toLowerCase())) {
      console.warn(`Nivel de log inválido: "${newLevel}". Usando "info" por defecto.`);
      newLevel = 'info';
    }

    this.winstonLogger.level = newLevel.toLowerCase();
    this.winstonLogger.transports.forEach((transport) => {
      transport.level = newLevel.toLowerCase();
    });
    if (this.consoleTransport) {
      this.consoleTransport.level = newLevel.toLowerCase();
    }
    this.winstonLogger.info(`Nivel de log establecido a: ${newLevel.toUpperCase()}`);
  }
}