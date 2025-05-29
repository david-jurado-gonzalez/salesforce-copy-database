import inquirer from 'inquirer';
import { Connection } from 'jsforce';
import { describeSObject, listAllSObjects } from '../core/sfdc-api.js'; // Asumiendo que estas funciones existen y están correctamente exportadas
import { Logger } from '../core/logger.js';

const logger = new Logger('QueryAssistant');

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

  try {
    // 1. Seleccionar SObject
    const sObjectNames = await listAllSObjects(connection); // Asumiendo que listAllSObjects devuelve Promise<string[]>
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
    const sObjectDescribe = await describeSObject(connection, queryParts.fromObject);
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
    return soql;

  } catch (error) {
    logger.error('Error durante la construcción interactiva de la consulta SOQL:', error);
    // Podríamos querer lanzar un error más específico o devolver un valor indicativo de fallo
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