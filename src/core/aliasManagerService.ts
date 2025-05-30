// src/core/aliasManagerService.ts
import { exec } from 'child_process';
import { promisify } from 'util';
import { OrgAliasInfo } from './typeDefs.js';
import { Logger } from './logger.js'; // Asumiendo que el logger está en src/core/logger.ts

const execAsync = promisify(exec);
const logger = new Logger('AliasManagerService');

/**
 * Servicio para gestionar los alias de las organizaciones Salesforce.
 * Encapsula la lógica de interacción con Salesforce CLI (sf) para listar,
 * mostrar y gestionar alias de organización.
 */
export class AliasManagerService {
  /**
   * Lista todos los alias de organización Salesforce disponibles.
   * Ejecuta 'sf org list --all --json', parsea y devuelve la lista.
   * También intenta identificar el 'target-org' del proyecto.
   * @returns Una promesa que se resuelve con un array de OrgAliasInfo.
   */
  public async listOrgAliases(): Promise<OrgAliasInfo[]> {
    logger.debug('AliasManagerService.listOrgAliases: Obteniendo lista de alias...');
    try {
      // Primero, obtener el target-org del proyecto si existe
      let projectDefaultAlias: string | null = null;
      try {
        const { stdout: projectDefaultStdout } = await execAsync('sf config get target-org --json');
        const projectDefaultResult = JSON.parse(projectDefaultStdout);
        if (projectDefaultResult.status === 0 && projectDefaultResult.result && projectDefaultResult.result.length > 0) {
          const targetOrgConfig = projectDefaultResult.result.find((r: any) => r.name === 'target-org');
          if (targetOrgConfig && targetOrgConfig.value) {
            projectDefaultAlias = targetOrgConfig.value;
            logger.debug(`AliasManagerService.listOrgAliases: target-org del proyecto es '${projectDefaultAlias}'`);
          }
        }
      } catch (configError: any) {
        // No es un error fatal si no se puede obtener el target-org, puede que no esté configurado.
        logger.warn(`AliasManagerService.listOrgAliases: No se pudo obtener el target-org del proyecto. Error: ${configError.message}`);
      }

      const { stdout, stderr } = await execAsync('sf org list --all --json');
      if (stderr) {
        logger.error(`AliasManagerService.listOrgAliases: Error al ejecutar 'sf org list --all --json': ${stderr}`);
        throw new Error(`Error al listar alias: ${stderr}`);
      }
      const result = JSON.parse(stdout);
      if (result.status !== 0 || !result.result) {
        logger.error(`AliasManagerService.listOrgAliases: La ejecución de 'sf org list --all --json' no fue exitosa o no devolvió resultados. Status: ${result.status}, Mensaje: ${result.message}`);
        throw new Error(`Error al listar alias: ${result.message || 'Resultado inesperado de sf org list'}`);
      }

      const orgs = result.result.nonScratchOrgs || [];
      const scratchOrgs = result.result.scratchOrgs || [];
      const allOrgs = [...orgs, ...scratchOrgs];
      
      logger.debug(`AliasManagerService.listOrgAliases: Total de orgs encontradas (no-scratch + scratch): ${allOrgs.length}`);

      return allOrgs.map((org: any): OrgAliasInfo => ({
        alias: org.alias || org.username, // Usar username si el alias no está definido
        username: org.username,
        orgId: org.orgId,
        instanceUrl: org.instanceUrl,
        connectedStatus: org.connectedStatus === 'Connected' ? 'Connected' : 'Not Connected',
        isDefaultUsername: org.isDefaultUsername || false,
        isDefaultDevHubUsername: org.isDefaultDevHubUsername || false,
        isProjectDefault: projectDefaultAlias ? (org.alias === projectDefaultAlias || org.username === projectDefaultAlias) : false,
        // Aquí se podrían añadir más campos si son necesarios y están disponibles en la salida de 'sf org list --all'
        // por ejemplo: org.sfdxAuthUrl, org.lastUsedDate
      }));
    } catch (error: any) {
      logger.error(`AliasManagerService.listOrgAliases: Excepción al listar alias: ${error.message}`);
      throw error;
    }
  }

  /**
   * Obtiene detalles para un alias o nombre de usuario específico.
   * Ejecuta 'sf org display -o <aliasOrUsername> --json'.
   * @param aliasOrUsername El alias o nombre de usuario de la organización.
   * @returns Una promesa que se resuelve con OrgAliasInfo o null si no se encuentra.
   */
  public async getOrgDetails(aliasOrUsername: string): Promise<OrgAliasInfo | null> {
    logger.debug(`AliasManagerService.getOrgDetails: Obteniendo detalles para '${aliasOrUsername}'...`);
    try {
      const { stdout, stderr } = await execAsync(`sf org display -o ${aliasOrUsername} --json`);
      if (stderr) {
        // sf org display puede devolver un status 1 y un mensaje en stderr si el alias no existe.
        logger.warn(`AliasManagerService.getOrgDetails: stderr al ejecutar 'sf org display' para '${aliasOrUsername}': ${stderr}`);
        // No lanzar error aquí necesariamente, el parseo de stdout lo determinará.
      }
      const result = JSON.parse(stdout);
      if (result.status !== 0 || !result.result) {
        logger.warn(`AliasManagerService.getOrgDetails: 'sf org display' para '${aliasOrUsername}' no fue exitoso o no devolvió resultado. Status: ${result.status}, Mensaje: ${result.message}`);
        return null;
      }
      const orgData = result.result;
      
      // Comprobar si es el default del proyecto
      let projectDefaultAlias: string | null = null;
      try {
        const { stdout: projectDefaultStdout } = await execAsync('sf config get target-org --json');
        const projectDefaultResult = JSON.parse(projectDefaultStdout);
        if (projectDefaultResult.status === 0 && projectDefaultResult.result && projectDefaultResult.result.length > 0) {
           const targetOrgConfig = projectDefaultResult.result.find((r: any) => r.name === 'target-org');
          if (targetOrgConfig && targetOrgConfig.value) {
            projectDefaultAlias = targetOrgConfig.value;
          }
        }
      } catch (configError: any) {
         logger.warn(`AliasManagerService.getOrgDetails: No se pudo obtener el target-org del proyecto. Error: ${configError.message}`);
      }

      return {
        alias: orgData.alias || orgData.username,
        username: orgData.username,
        orgId: orgData.id, // 'sf org display' devuelve 'id' en lugar de 'orgId'
        instanceUrl: orgData.instanceUrl,
        connectedStatus: orgData.connectedStatus === 'Connected' ? 'Connected' : 'Not Connected', // 'sf org display' puede no tener 'connectedStatus' directamente, inferir si es posible o marcar como Unknown
        isDefaultUsername: orgData.isDefaultUsername || false,
        isDefaultDevHubUsername: orgData.isDefaultDevHubUsername || false,
        isProjectDefault: projectDefaultAlias ? (orgData.alias === projectDefaultAlias || orgData.username === projectDefaultAlias) : false,
      };
    } catch (error: any) {
      logger.error(`AliasManagerService.getOrgDetails: Excepción al obtener detalles para '${aliasOrUsername}': ${error.message}`);
      // Si el error es porque el alias no existe, sf org display devuelve status 1 y un mensaje.
      // Devolver null en ese caso es apropiado.
      if (error.message && (error.message.includes('No org found') || error.message.includes('No se encontró ninguna organización'))) {
        logger.warn(`AliasManagerService.getOrgDetails: Alias '${aliasOrUsername}' no encontrado.`);
        return null;
      }
      throw error;
    }
  }

  /**
   * Inicia sesión en una organización y le asigna un alias.
   * Ejecuta 'sf org login web -a <alias> [-r <instanceUrl>]'.
   * @param alias El alias a asignar a la organización.
   * @param instanceUrl La URL de la instancia de Salesforce (ej. https://login.salesforce.com). Opcional.
   * @returns Una promesa que se resuelve con un objeto indicando éxito y un mensaje opcional.
   */
  public async loginOrg(alias: string, instanceUrl?: string): Promise<{ success: boolean; message?: string }> {
    logger.debug(`AliasManagerService.loginOrg: Iniciando login web para el alias '${alias}'${instanceUrl ? ` en instancia '${instanceUrl}'` : ''}...`);
    try {
      let command = `sf org login web -a ${alias}`;
      if (instanceUrl) {
        command += ` -r ${instanceUrl}`;
      }
      logger.debug(`AliasManagerService.loginOrg: Ejecutando comando: ${command}`);
      // El comando 'sf org login web' es interactivo y abrirá un navegador.
      // La promesa de execAsync se resolverá cuando el proceso del CLI termine.
      // Se necesita verificar el resultado.
      const { stdout, stderr } = await execAsync(command);
      
      // stdout suele contener "Successfully authorized xxx@xxx.com and assigned alias xxx"
      // stderr puede contener warnings o información adicional, no necesariamente errores.
      logger.info(`AliasManagerService.loginOrg: stdout para '${alias}': ${stdout}`);
      if (stderr) {
        logger.warn(`AliasManagerService.loginOrg: stderr para '${alias}': ${stderr}`);
      }

      // Una forma simple de verificar el éxito es buscar "Successfully authorized" en stdout.
      // 'sf org login web' devuelve status 0 incluso si el usuario cierra el navegador sin autenticar.
      // Por lo tanto, necesitamos una comprobación más robusta o confiar en que el usuario completó el flujo.
      // Para una mejor verificación, podríamos llamar a getOrgDetails(alias) después.
      if (stdout.toLowerCase().includes('successfully authorized') || stdout.toLowerCase().includes('autorizado correctamente')) {
        logger.info(`AliasManagerService.loginOrg: Login web para '${alias}' parece exitoso.`);
        return { success: true, message: stdout };
      } else {
        // Si no encontramos el mensaje de éxito, asumimos que algo no fue como se esperaba.
        logger.warn(`AliasManagerService.loginOrg: Login web para '${alias}' no confirmó autorización explícita en stdout. stdout: ${stdout}`);
        // Podría ser un falso negativo si el mensaje de sf cli cambia.
        // Considerar el stderr también. Si hay un error claro en stderr, usarlo.
        const errorMessage = stderr && stderr.toLowerCase().includes("error:") ? stderr : `El proceso de login para '${alias}' finalizó, pero la autorización no se confirmó explícitamente. Revise la salida del CLI.`;
        return { success: false, message: errorMessage };
      }
    } catch (error: any) {
      logger.error(`AliasManagerService.loginOrg: Excepción durante el login web para '${alias}': ${error.message}`);
      return { success: false, message: error.message };
    }
  }

  /**
   * Cierra la sesión de una organización (elimina la autenticación de un alias).
   * Ejecuta 'sf org logout -o <alias> [--no-prompt] [-g]'.
   * @param alias El alias de la organización de la que se cerrará sesión.
   * @param global Si es true, desautoriza la organización de todas las Dev Hubs (usa la bandera -g).
   * @returns Una promesa que se resuelve con un objeto indicando éxito y un mensaje opcional.
   */
  public async logoutOrg(alias: string, global?: boolean): Promise<{ success: boolean; message?: string }> {
    logger.debug(`AliasManagerService.logoutOrg: Cerrando sesión para el alias '${alias}'${global ? ' globalmente' : ''}...`);
    try {
      let command = `sf org logout -o ${alias} --no-prompt`;
      if (global) {
        command += ' -g';
      }
      logger.debug(`AliasManagerService.logoutOrg: Ejecutando comando: ${command}`);
      const { stdout, stderr } = await execAsync(command);
      if (stderr) {
        // 'sf org logout' puede poner mensajes en stderr incluso si tiene éxito (ej. "You are now logged out...").
        // Considerar esto como informativo a menos que indique un error real.
        logger.warn(`AliasManagerService.logoutOrg: stderr para '${alias}': ${stderr}`);
        if (stderr.toLowerCase().includes('error:')) {
           logger.error(`AliasManagerService.logoutOrg: Error explícito en stderr para '${alias}': ${stderr}`);
           return { success: false, message: stderr };
        }
      }
      // 'sf org logout' devuelve status 0 si el alias existía y se deslogueó, o si el alias no existía.
      // El stdout suele ser "You are now logged out from org ... with username ..." o "No authorization information found for ..."
      logger.info(`AliasManagerService.logoutOrg: stdout para '${alias}': ${stdout}`);
      if (stdout.toLowerCase().includes('logged out') || stdout.toLowerCase().includes('sesión cerrada') || stdout.toLowerCase().includes('no authorization information found')) {
        return { success: true, message: stdout };
      } else {
        // Caso inesperado
        logger.warn(`AliasManagerService.logoutOrg: Respuesta inesperada de logout para '${alias}'. stdout: ${stdout}, stderr: ${stderr}`);
        return { success: false, message: `Respuesta inesperada de logout: ${stdout} ${stderr}`.trim() };
      }
    } catch (error: any) {
      logger.error(`AliasManagerService.logoutOrg: Excepción durante el logout para '${alias}': ${error.message}`);
      // Un error común es si el alias no existe, el comando puede fallar con status 1.
      // La salida de stdout/stderr ya debería haber sido capturada si el comando ejecutó.
      // Si es una excepción de 'execAsync' (ej. comando no encontrado), este catch lo maneja.
      return { success: false, message: error.message };
    }
  }

  /**
   * Establece una organización predeterminada para el proyecto actual.
   * Ejecuta 'sf config set target-org=<alias>'.
   * @param alias El alias a establecer como predeterminado para el proyecto.
   * @returns Una promesa que se resuelve con un objeto indicando éxito y un mensaje opcional.
   */
  public async setProjectDefaultOrg(alias: string): Promise<{ success: boolean; message?: string }> {
    logger.debug(`AliasManagerService.setProjectDefaultOrg: Estableciendo '${alias}' como target-org del proyecto...`);
    try {
      // El comando es 'sf config set target-org=<alias>' o 'sf config set target-org <alias>'
      // Usaremos la sintaxis con '=' para ser más explícitos, aunque ambas suelen funcionar.
      // Sin embargo, la documentación oficial y ejemplos suelen usar 'sf config set target-org <alias>'
      // Vamos a probar con 'sf config set "target-org=${alias}"' para asegurar que funciona con alias con caracteres especiales
      // O más simple: 'sf config set target-org <alias>'
      const command = `sf config set target-org=${alias}`; // Corrección: sf espera target-org=<value> o target-org <value>
      const { stdout, stderr } = await execAsync(command);

      if (stderr) {
        logger.error(`AliasManagerService.setProjectDefaultOrg: Error al ejecutar '${command}': ${stderr}`);
        return { success: false, message: stderr };
      }
      
      // Parsear stdout para verificar el éxito
      // {
      //   "status": 0,
      //   "result": [
      //     {
      //       "name": "target-org",
      //       "value": "myalias",
      //       "success": true
      //     }
      //   ],
      //   "warnings": []
      // }
      const result = JSON.parse(stdout);
      if (result.status === 0 && result.result && result.result.some((r: any) => r.name === 'target-org' && r.value === alias && r.success === true)) {
        logger.info(`AliasManagerService.setProjectDefaultOrg: '${alias}' establecido como target-org. stdout: ${stdout}`);
        return { success: true, message: `Alias '${alias}' establecido como predeterminado para el proyecto.` };
      } else {
        logger.warn(`AliasManagerService.setProjectDefaultOrg: No se pudo confirmar el establecimiento de target-org para '${alias}'. stdout: ${stdout}`);
        return { success: false, message: `No se pudo confirmar el establecimiento de '${alias}' como predeterminado. Respuesta: ${stdout}` };
      }
    } catch (error: any) {
      logger.error(`AliasManagerService.setProjectDefaultOrg: Excepción al establecer target-org para '${alias}': ${error.message}`);
      return { success: false, message: error.message };
    }
  }

  /**
   * Quita la organización predeterminada del proyecto actual.
   * Ejecuta 'sf config unset target-org'.
   * @returns Una promesa que se resuelve con un objeto indicando éxito y un mensaje opcional.
   */
  public async unsetProjectDefaultOrg(): Promise<{ success: boolean; message?: string }> {
    logger.debug(`AliasManagerService.unsetProjectDefaultOrg: Quitando target-org del proyecto...`);
    try {
      const { stdout, stderr } = await execAsync('sf config unset target-org --json'); // Añadido --json para parsear la respuesta
      if (stderr) {
        // No necesariamente un error, sf puede usar stderr para mensajes informativos.
        logger.warn(`AliasManagerService.unsetProjectDefaultOrg: stderr al ejecutar 'sf config unset target-org': ${stderr}`);
         if (stderr.toLowerCase().includes('error:')) {
           logger.error(`AliasManagerService.unsetProjectDefaultOrg: Error explícito en stderr: ${stderr}`);
           return { success: false, message: stderr };
        }
      }
      // Ejemplo de salida exitosa de 'sf config unset target-org --json':
      // {
      //   "status": 0,
      //   "result": [
      //     {
      //       "name": "target-org",
      //       "success": true,
      //       "message": "Successfully unset config var target-org." (o similar)
      //     }
      //   ],
      //   "warnings": []
      // }
      // O si no estaba seteado:
      // {
      //   "status": 0,
      //   "result": [
      //     {
      //       "name": "target-org",
      //       "success": true, (o false si no estaba seteado y se considera "no acción" como no exitoso para unset)
      //       "message": "target-org was not previously set." (o similar)
      //     }
      //   ],
      //   "warnings": ["target-org was not previously set."]
      // }
      const result = JSON.parse(stdout);
      if (result.status === 0 && result.result && result.result.some((r: any) => r.name === 'target-org' && r.success === true)) {
        logger.info(`AliasManagerService.unsetProjectDefaultOrg: target-org quitado. stdout: ${stdout}`);
        const unsetMessage = result.result.find((r:any) => r.name === 'target-org').message || 'target-org quitado exitosamente.';
        return { success: true, message: unsetMessage };
      } else if (result.warnings && result.warnings.some((w: string) => w.includes('was not previously set'))) {
        logger.info(`AliasManagerService.unsetProjectDefaultOrg: target-org no estaba configurado. stdout: ${stdout}`);
        return { success: true, message: 'El alias predeterminado del proyecto no estaba configurado.' };
      }
      else {
        logger.warn(`AliasManagerService.unsetProjectDefaultOrg: No se pudo confirmar la eliminación de target-org. stdout: ${stdout}`);
        return { success: false, message: `No se pudo confirmar la eliminación del alias predeterminado. Respuesta: ${stdout}` };
      }
    } catch (error: any) {
      logger.error(`AliasManagerService.unsetProjectDefaultOrg: Excepción al quitar target-org: ${error.message}`);
      return { success: false, message: error.message };
    }
  }

  /**
   * Obtiene la organización predeterminada para el proyecto actual.
   * Ejecuta 'sf config get target-org --json' y luego 'sf org display' para obtener todos los detalles.
   * @returns Una promesa que se resuelve con OrgAliasInfo o null si no hay predeterminada o no se encuentra.
   */
  public async getProjectDefaultOrg(): Promise<OrgAliasInfo | null> {
    logger.debug('AliasManagerService.getProjectDefaultOrg: Obteniendo target-org del proyecto...');
    try {
      const { stdout, stderr } = await execAsync('sf config get target-org --json');
      if (stderr) {
        logger.warn(`AliasManagerService.getProjectDefaultOrg: stderr al obtener target-org: ${stderr}`);
        // No es necesariamente un error fatal aquí, podría no estar configurado.
      }
      const result = JSON.parse(stdout);
      if (result.status === 0 && result.result && result.result.length > 0) {
        const targetOrgConfig = result.result.find((r: any) => r.name === 'target-org' && r.value);
        if (targetOrgConfig && targetOrgConfig.value) {
          const alias = targetOrgConfig.value;
          logger.info(`AliasManagerService.getProjectDefaultOrg: target-org es '${alias}'. Obteniendo detalles...`);
          // Ahora obtener los detalles completos de este alias
          const orgDetails = await this.getOrgDetails(alias);
          if (orgDetails) {
            return { ...orgDetails, isProjectDefault: true };
          } else {
            logger.warn(`AliasManagerService.getProjectDefaultOrg: Se encontró target-org='${alias}', pero no se pudieron obtener sus detalles.`);
            return null;
          }
        }
      }
      logger.info('AliasManagerService.getProjectDefaultOrg: No hay target-org configurado para el proyecto.');
      return null;
    } catch (error: any) {
      // Esto puede suceder si 'sf config get target-org' falla porque no está seteado (status 1)
      logger.info(`AliasManagerService.getProjectDefaultOrg: No se pudo obtener target-org (puede que no esté configurado): ${error.message}`);
      return null;
    }
  }

  /**
   * Resuelve un alias al nombre de usuario correspondiente.
   * Utiliza listOrgAliases para encontrar el nombre de usuario.
   * @param alias El alias a resolver.
   * @returns Una promesa que se resuelve con el nombre de usuario o null si no se encuentra.
   */
  public async resolveAliasToUsername(alias: string): Promise<string | null> {
    logger.debug(`AliasManagerService.resolveAliasToUsername: Resolviendo alias '${alias}' a username...`);
    try {
      const aliases = await this.listOrgAliases();
      const foundOrg = aliases.find(org => org.alias === alias);
      if (foundOrg) {
        logger.info(`AliasManagerService.resolveAliasToUsername: Alias '${alias}' resuelto a username '${foundOrg.username}'.`);
        return foundOrg.username;
      }
      logger.warn(`AliasManagerService.resolveAliasToUsername: No se encontró el alias '${alias}' en la lista de organizaciones.`);
      return null;
    } catch (error: any) {
      logger.error(`AliasManagerService.resolveAliasToUsername: Excepción al resolver alias '${alias}': ${error.message}`);
      throw error; // Re-lanzar el error ya que esto indica un problema más profundo
    }
  }
}