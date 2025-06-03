import inquirer from 'inquirer';
import { Connection } from 'jsforce';
import { sfdcApi } from '../core/sfdc-api.js';
import { Logger } from '../core/logger.js';
import { saveQueryHistory, loadQueryHistory } from '../core/queryFileManager.js'; // Importar funciones de queryFileManager
import { AliasManagerService } from '../core/aliasManagerService.js'; // Importar la clase AliasManagerService
import { generateSuggestedQueries } from './backupQuerySuggester.js'; // Importar la función de sugerencias

const logger = new Logger('QueryAssistant');
const aliasManagerService = new AliasManagerService(); // Instanciar AliasManagerService

// Tipos básicos para la construcción de la consulta
interface SoqlQueryParts {
  selectFields: string[];
  fromObject: string;
  whereClause?: string;
  orderBy?: string;
  limit?: number;
}

/**
 * Guía al usuario a través de la construcción de una consulta SOQL.
 * @param connection Instancia de conexión de jsforce.
 * @returns Una promesa que se resuelve con la cadena de consulta SOQL construida.
 */
export async function buildSoqlQueryInteractive(connection: Connection): Promise<string> {
  const queryParts: SoqlQueryParts = {
    selectFields: [],
    fromObject: '',
  };

  // Cargar y sugerir desde el historial y las consultas de respaldo
  // Asegurar que la información del usuario esté disponible en la conexión
  if (!connection.userInfo) {
    await connection.identity();
  }

  const username = (connection.userInfo as any)?.username;
  let orgAlias: string | undefined;

  // Helper function to get alias from username
  const getAliasFromUsername = async (uname: string): Promise<string | undefined> => {
    try {
      const aliases = await aliasManagerService.listOrgAliases();
      const foundOrg = aliases.find(org => org.username === uname);
      return foundOrg?.alias;
    } catch (error) {
      logger.error(`Error al obtener alias para el nombre de usuario ${uname}: ${(error as Error).message}`);
      return undefined;
    }
  };

  if (username) {
    orgAlias = await getAliasFromUsername(username);
  } else {
    logger.warn('No se pudo obtener el nombre de usuario de la conexión.');
  }

  let historyQueries: string[] = [];
  let backupQueries: string[] = [];

  if (orgAlias) {
    try {
      historyQueries = await loadQueryHistory(orgAlias); // Usar loadQueryHistory directamente
      logger.info(`Se cargaron ${historyQueries.length} consultas del historial para ${orgAlias}.`);
    } catch (error) {
      logger.warn(`Error al cargar el historial de consultas para ${orgAlias}: ${(error as Error).message}`);
    }
  }

  try {
    const suggestedBackupQueries = await generateSuggestedQueries(connection);
    backupQueries = suggestedBackupQueries.map(q => q.query);
    logger.info(`Se generaron ${backupQueries.length} consultas de respaldo sugeridas.`);
  } catch (error) {
    logger.warn(`Error al generar consultas de respaldo sugeridas: ${(error as Error).message}`);
  }

  const allSuggestions = [...new Set([...historyQueries, ...backupQueries])]; // Eliminar duplicados
  if (allSuggestions.length > 0) {
    const { useSuggestion } = await inquirer.prompt([
      {
        type: 'list',
        name: 'useSuggestion',
        message: '¿Desea usar una consulta existente o construir una nueva?',
        choices: [
          { name: 'Construir nueva consulta', value: 'new' },
          ...allSuggestions.map(q => ({ name: `Historial/Sugerencia: ${q}`, value: q }))
        ],
      },
    ]);

    if (useSuggestion !== 'new') {
      logger.info(`Usando consulta sugerida: ${useSuggestion}`);
      return useSuggestion;
    }
  }

  try {
    // 1. Seleccionar SObject
    const sObjectNames = await sfdcApi.listAllSObjects(connection); // Asumiendo que listAllSObjects devuelve Promise<string[]>
    // No es necesario mapear si sObjectNames ya es un string[]
    const { selectedSObject } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selectedSObject',
        message: 'Seleccione el SObject principal para su consulta:',
        choices: sObjectNames, // sObjectNames es directamente string[]
        pageSize: 15,
      },
    ]);
    queryParts.fromObject = selectedSObject;
    logger.info(`SObject seleccionado: ${queryParts.fromObject}`);

    // 2. Seleccionar Campos
    const sObjectDescribe = await sfdcApi.describeSObject(connection, queryParts.fromObject);
    // Aseguramos que 'field' tenga un tipo, asumiendo que sObjectDescribe.fields es { name: string }[] u compatible
    const fieldNames = sObjectDescribe.fields.map((field: { name: string }) => field.name);
    const { selectedFields } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'selectedFields',
        message: `Seleccione los campos para ${queryParts.fromObject}:`,
        choices: fieldNames,
        pageSize: 20,
        validate: (input) => input.length > 0 ? true : 'Debe seleccionar al menos un campo.',
      },
    ]);
    queryParts.selectFields = selectedFields;
    logger.info(`Campos seleccionados: ${queryParts.selectFields.join(', ')}`);

    // 3. (Opcional) Cláusula WHERE simple
    const { addWhere } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'addWhere',
        message: '¿Desea agregar una cláusula WHERE simple (ej: Campo = Valor)?',
        default: false,
      },
    ]);

    if (addWhere) {
      const { whereField } = await inquirer.prompt([
        {
          type: 'list',
          name: 'whereField',
          message: 'Seleccione el campo para la condición WHERE:',
          choices: fieldNames, // Podríamos filtrar por campos consultables/filtrables
        },
      ]);
      const { whereOperator } = await inquirer.prompt([
        {
          type: 'list',
          name: 'whereOperator',
          message: `Seleccione el operador para ${whereField}:`,
          choices: ['=', '!=', '<', '<=', '>', '>=', 'LIKE', 'IN', 'NOT IN'], // Simplificado
        },
      ]);
      const { whereValue } = await inquirer.prompt([
        {
          type: 'input',
          name: 'whereValue',
          message: `Ingrese el valor para ${whereField} ${whereOperator}:`,
          // Podríamos agregar validación o formateo aquí basado en el tipo de campo
        },
      ]);
      // Asegurarse de que los valores de cadena estén entre comillas simples para SOQL
      const formattedValue = typeof whereValue === 'string' && !whereValue.startsWith('(') // No entrecomillar para listas IN (val1, val2)
                           ? `'${whereValue.replace(/'/g, "\\'")}'`
                           : whereValue;
      queryParts.whereClause = `${whereField} ${whereOperator} ${formattedValue}`;
      logger.info(`Cláusula WHERE agregada: ${queryParts.whereClause}`);
    }

    // 4. (Opcional) ORDER BY
    const { addOrderBy } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'addOrderBy',
        message: '¿Desea agregar una cláusula ORDER BY?',
        default: false,
      },
    ]);

    if (addOrderBy) {
      const { orderByField } = await inquirer.prompt([
        {
          type: 'list',
          name: 'orderByField',
          message: 'Seleccione el campo para ORDER BY:',
          choices: queryParts.selectFields, // Solo campos seleccionados o todos los campos del objeto
        },
      ]);
      const { orderByDirection } = await inquirer.prompt([
        {
          type: 'list',
          name: 'orderByDirection',
          message: 'Seleccione la dirección de ordenamiento:',
          choices: ['ASC', 'DESC'],
          default: 'ASC',
        },
      ]);
      queryParts.orderBy = `${orderByField} ${orderByDirection}`;
      logger.info(`Cláusula ORDER BY agregada: ${queryParts.orderBy}`);
    }

    // 5. (Opcional) LIMIT
    const { addLimit } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'addLimit',
        message: '¿Desea agregar una cláusula LIMIT?',
        default: false,
      },
    ]);

    if (addLimit) {
      const { limitValue } = await inquirer.prompt([
        {
          type: 'number',
          name: 'limitValue',
          message: 'Ingrese el valor para LIMIT:',
          validate: (input) => Number.isInteger(input) && input > 0 ? true : 'Por favor ingrese un entero positivo.',
        },
      ]);
      queryParts.limit = limitValue;
      logger.info(`Cláusula LIMIT agregada: ${queryParts.limit}`);
    }

    // Construir la consulta SOQL
    let soql = `SELECT ${queryParts.selectFields.join(', ')} FROM ${queryParts.fromObject}`;
    if (queryParts.whereClause) {
      soql += ` WHERE ${queryParts.whereClause}`;
    }
    if (queryParts.orderBy) {
      soql += ` ORDER BY ${queryParts.orderBy}`;
    }
    if (queryParts.limit !== undefined) {
      soql += ` LIMIT ${queryParts.limit}`;
    }

    logger.info(`Consulta SOQL construida: ${soql}`);

    // Guardar la consulta en el historial
    // Guardar la consulta en el historial
    try {
      // Asegurar que la información del usuario esté disponible en la conexión antes de guardar
      if (!connection.userInfo) {
        await connection.identity();
      }
      const currentUsername = (connection.userInfo as any)?.username;
      if (currentUsername) {
        const currentOrgAlias = await getAliasFromUsername(currentUsername); // Usar la función auxiliar
        if (currentOrgAlias) {
          // Cargar el historial existente, añadir la nueva consulta y guardar
          const existingHistory = await loadQueryHistory(currentOrgAlias);
          // Asegurarse de que la consulta no sea un duplicado reciente
          if (existingHistory.length === 0 || existingHistory[0] !== soql) {
            const updatedHistory = [soql, ...existingHistory].slice(0, 10); // Mantener las últimas 10 consultas
            await saveQueryHistory(currentOrgAlias, updatedHistory);
            logger.info(`Consulta guardada en el historial para el alias: ${currentOrgAlias}`);
          } else {
            logger.info('La consulta es un duplicado reciente, no se guardará en el historial.');
          }
        } else {
          logger.warn('No se pudo obtener el alias de la organización actual para guardar el historial de consultas.');
        }
      } else {
        logger.warn('No se pudo obtener el nombre de usuario de la conexión para guardar el historial de consultas.');
      }
    } catch (historyError) {
      logger.error('Error al guardar la consulta en el historial:', historyError);
    }

    return soql;

  } catch (error) {
    logger.error('Error durante la construcción interactiva de la consulta SOQL:', error);
    throw new Error('No se pudo construir la consulta SOQL interactivamente.');
  }
}

// Ejemplo de cómo se podría llamar (requiere una conexión activa)
// async function testAssistant() {
//   // Simular una conexión - Reemplazar con una conexión real para pruebas
//   const mockConnection = {
//     describe: async (sobjectName: string) => {
//       logger.info(`Mock describe para: ${sobjectName}`);
//       if (sobjectName === 'Account') {
//         return { fields: [{name: 'Id'}, {name: 'Name'}, {name: 'Industry'}, {name: 'AnnualRevenue'}] };
//       }
//       return { fields: [] };
//     },
//     query: async (soql: string) => {
//       logger.info(`Mock query: ${soql}`);
//       return { records: [], totalSize: 0, done: true };
//     },
//     describeGlobal: async () => {
//        logger.info('Mock describeGlobal');
//        return { sobjects: [{name: 'Account', label: 'Account', queryable: true}, {name: 'Contact', label: 'Contact', queryable: true}] };
//     }
//   } as unknown as Connection;

//   try {
//     // Asumiendo que listAllSObjects y describeSObject están adaptados para usar la conexión
//     // y que las funciones de sfdc-api.ts están disponibles y correctamente implementadas.
//     // Para una prueba real, necesitarías inicializar una conexión Salesforce válida.
//     // const soqlQuery = await buildSoqlQueryInteractive(mockConnection);
//     // logger.info(`Consulta final: ${soqlQuery}`);
//   } catch (e) {
//     logger.error('Error en la prueba del asistente:', e);
//   }
// }

// testAssistant();