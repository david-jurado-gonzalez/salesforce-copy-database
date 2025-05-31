import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, Connection, Logger } from '@salesforce/core';
import { DescribeSObjectResult, Field, DescribeGlobalResult } from 'jsforce';
import * as inquirer from 'inquirer';
import { writeFileSync } from 'node:fs';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('salesforce-copy-database', 'visualize');

interface SObjectNode {
  name: string;
  fields: Field[];
}

interface SObjectRelationship {
  sourceObject: string;
  targetObject: string;
  relationshipType: 'Lookup' | 'Master-Detail';
  fieldName: string;
}

export type VisualizeResult = {
  path: string;
};

export default class Visualize extends SfCommand<VisualizeResult> {
  private logger: Logger; // Declare logger instance

  public constructor(argv: string[], config: any) {
    super(argv, config);
    this.logger = Logger.childFromRoot('VisualizeCommand'); // Initialize logger
  }

  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessage('examples').split(messages.getMessage('newline'));

  public static readonly flags = {
    'target-org': Flags.requiredOrg({
      char: 'o',
      summary: messages.getMessage('flags.target-org.summary'),
      required: true,
    }),
    objects: Flags.string({
      char: 's',
      summary: messages.getMessage('flags.objects.summary'),
      required: false, // Made optional for interactive mode
    }),
    format: Flags.string({
      char: 'f',
      summary: messages.getMessage('flags.format.summary'),
      options: ['mermaid', 'utf8'],
      default: 'mermaid',
    }),
    'include-fields': Flags.boolean({
      char: 'i',
      summary: messages.getMessage('flags.include-fields.summary'),
      default: false,
    }),
    'output-file': Flags.string({
      char: 'r',
      summary: messages.getMessage('flags.output-file.summary'),
    }),
    interactive: Flags.boolean({
      summary: messages.getMessage('flags.interactive.summary'),
      default: false,
    }),
  };

  public async run(): Promise<VisualizeResult> {
    const { flags } = await this.parse(Visualize);
    let conn: Connection;
    let selectedObjects: string[] = [];
    // Explicitly cast flags.format and flags['output-file'] to their expected types
    let outputFormat: 'mermaid' | 'utf8' = flags.format as 'mermaid' | 'utf8';
    let includeFields: boolean = flags['include-fields'];
    let outputFile: string | undefined = flags['output-file'] as string | undefined;

    try {
      conn = flags['target-org'].getConnection();
      this.logger.info(`Conectado a la organización: ${flags['target-org'].getUsername()}`);
    } catch (error: unknown) { // Catch error as unknown
      if (error instanceof Error) {
        throw new Error(messages.getMessage('error.orgNotAccessible', [flags['target-org'].getUsername(), error.message]));
      } else {
        throw new Error(messages.getMessage('error.orgNotAccessible', [flags['target-org'].getUsername(), String(error)]));
      }
    }

    if (flags.interactive) {
      const allSObjects = await this.getAllSObjects(conn);
      const interactiveAnswers = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'objects',
          message: messages.getMessage('interactive.selectObjects'),
          choices: allSObjects.map(obj => ({ name: obj.name, value: obj.name })),
          validate: (input: string[]) => (input.length > 0 ? true : messages.getMessage('interactive.selectObjectsValidation')),
        },
        {
          type: 'list',
          name: 'format',
          message: messages.getMessage('interactive.selectFormat'),
          choices: ['mermaid', 'utf8'],
          default: 'mermaid',
        },
        {
          type: 'confirm',
          name: 'includeFields',
          message: messages.getMessage('interactive.includeFields'),
          default: false,
        },
        {
          type: 'confirm',
          name: 'saveToFile',
          message: messages.getMessage('interactive.saveToFile'),
          default: false,
        },
        {
          type: 'input',
          name: 'outputFile',
          message: messages.getMessage('interactive.outputFilePath'),
          when: (answers) => answers.saveToFile,
          validate: (input) => (input ? true : messages.getMessage('interactive.outputFilePathValidation')),
        },
      ]);
      selectedObjects = interactiveAnswers.objects;
      outputFormat = interactiveAnswers.format;
      includeFields = interactiveAnswers.includeFields;
      outputFile = interactiveAnswers.outputFile;
    } else {
      // Ensure flags.objects is treated as string | undefined
      if (!flags.objects) {
        throw new Error(messages.getMessage('error.objectsRequired'));
      }
      selectedObjects = (flags.objects as string).split(',');
    }

    this.logger.info(`SObjects seleccionados: ${selectedObjects.join(', ')}`);
    this.logger.info(`Formato de salida: ${outputFormat}`);
    this.logger.info(`Incluir campos: ${includeFields}`);
    this.logger.info(`Archivo de salida: ${outputFile || 'Consola'}`);

    const sObjectNodes: SObjectNode[] = [];
    const sObjectRelationships: SObjectRelationship[] = [];

    for (const objName of selectedObjects) {
      try {
        const describeResult: DescribeSObjectResult = await conn.sobject(objName).describe();
        sObjectNodes.push({ name: objName, fields: describeResult.fields });

        for (const field of describeResult.fields) {
          if (field.referenceTo && field.referenceTo.length > 0 && field.type === 'reference') {
            for (const refTo of field.referenceTo) {
              if (selectedObjects.includes(refTo)) {
                // Check for Master-Detail based on relationshipOrder and type
                const relationshipType = field.relationshipOrder !== undefined && field.type === 'reference' ? 'Master-Detail' : 'Lookup';
                sObjectRelationships.push({
                  sourceObject: objName,
                  targetObject: refTo,
                  relationshipType: relationshipType,
                  fieldName: field.name,
                });
              }
            }
          }
        }
      } catch (error: unknown) { // Catch error as unknown
        if (error instanceof Error) {
          this.logger.warn(messages.getMessage('error.sObjectNotFound', [objName, error.message]));
        } else {
          this.logger.warn(messages.getMessage('error.sObjectNotFound', [objName, String(error)]));
        }
      }
    }

    let outputContent: string;
    if (outputFormat === 'mermaid') {
      outputContent = this.generateMermaidDiagram(sObjectNodes, sObjectRelationships, includeFields);
    } else {
      outputContent = this.generateUtf8Diagram(sObjectNodes, sObjectRelationships, includeFields);
    }

    if (outputFile) {
      try {
        writeFileSync(outputFile, outputContent);
        this.logger.info(messages.getMessage('outputFileSaved', [outputFile]));
      } catch (error: unknown) { // Catch error as unknown
        if (error instanceof Error) {
          throw new Error(messages.getMessage('error.fileWrite', [outputFile, error.message]));
        } else {
          throw new Error(messages.getMessage('error.fileWrite', [outputFile, String(error)]));
        }
      }
    } else {
      this.logger.info('\n' + outputContent);
    }

    return {
      path: outputFile || 'console',
    };
  }

  private async getAllSObjects(conn: Connection): Promise<DescribeGlobalResult['sobjects']> {
    try {
      const globalDescribe: DescribeGlobalResult = await conn.describeGlobal();
      // Correctly type obj using indexed access type
      return globalDescribe.sobjects.filter((obj: DescribeGlobalResult['sobjects'][number]) => obj.queryable);
    } catch (error: unknown) { // Catch error as unknown
      if (error instanceof Error) {
        throw new Error(messages.getMessage('error.globalDescribe', [error.message]));
      } else {
        throw new Error(messages.getMessage('error.globalDescribe', [String(error)]));
      }
    }
  }

  private generateMermaidDiagram(nodes: SObjectNode[], relationships: SObjectRelationship[], includeFields: boolean): string {
    let mermaid = 'classDiagram\n';
    mermaid += '  direction LR\n';

    for (const node of nodes) {
      mermaid += `  class ${node.name} {\n`;
      if (includeFields) {
        for (const field of node.fields) {
          // Only include non-relationship fields or specific relationship fields if desired
          if (!field.referenceTo || field.referenceTo.length === 0) {
            mermaid += `    +${field.type} ${field.name}\n`;
          }
        }
      }
      mermaid += `  }\n`;
    }

    for (const rel of relationships) {
      const relationshipSymbol = rel.relationshipType === 'Master-Detail' ? '*--' : '--';
      mermaid += `  ${rel.sourceObject} ${relationshipSymbol} ${rel.targetObject} : ${rel.fieldName} (${rel.relationshipType})\n`;
    }

    return mermaid;
  }

  private generateUtf8Diagram(nodes: SObjectNode[], relationships: SObjectRelationship[], includeFields: boolean): string {
    // This is a simplified implementation for UTF-8. A full layout engine is complex.
    // For now, it will just list objects and relationships in a basic text format.
    let utf8Diagram = 'Diagrama de Esquema (UTF-8)\n\n';

    utf8Diagram += 'Objetos:\n';
    for (const node of nodes) {
      utf8Diagram += `  +----------------------------------+\n`;
      utf8Diagram += `  | ${node.name.padEnd(30, ' ')} |\n`;
      if (includeFields) {
        utf8Diagram += `  |----------------------------------|\n`;
        for (const field of node.fields) {
          if (!field.referenceTo || field.referenceTo.length === 0) {
            utf8Diagram += `  | - ${field.name} (${field.type})`.padEnd(35, ' ') + ' |\n';
          }
        }
      }
      utf8Diagram += `  +----------------------------------+\n\n`;
    }

    utf8Diagram += 'Relaciones:\n';
    for (const rel of relationships) {
      utf8Diagram += `  ${rel.sourceObject} --(${rel.fieldName} [${rel.relationshipType}])--> ${rel.targetObject}\n`;
    }

    utf8Diagram += '\nNota: La visualización UTF-8 es básica y no incluye un motor de layout complejo.';
    return utf8Diagram;
  }
}
