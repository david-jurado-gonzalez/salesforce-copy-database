import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { Interfaces as OclifInterfaces } from '@oclif/core';
import { SourceResolver, SourceResolutionResult } from '../../core/sourceResolver.js';
import { Logger } from '../../core/logger.js';
import { SchemaComparator, SchemaComparisonResult } from '../../core/schemaComparator.js';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('sfdc-cdb', 'schema.compare');

export type SchemaCompareResult = {
  success: boolean;
  message: string;
  source1Result?: SourceResolutionResult;
  source2Result?: SourceResolutionResult;
  comparisonResult?: SchemaComparisonResult;
  error?: string;
};

type ParsedFlags = {
  source1: string;
  source2: string;
  'output-format': string;
  'output-file': string | undefined;
  detailed: boolean | undefined;
  'refresh-cache1': boolean | undefined;
  'refresh-cache2': boolean | undefined;
  'no-cache1': boolean | undefined;
  'no-cache2': boolean | undefined;
};


export default class SchemaCompareCommand extends SfCommand<SchemaCompareResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly flags: OclifInterfaces.FlagInput<ParsedFlags> = {
    source1: Flags.string({
      summary: messages.getMessage('flags.source1.summary'),
      required: true,
    }),
    source2: Flags.string({
      summary: messages.getMessage('flags.source2.summary'),
      required: true,
    }),
    'output-format': Flags.string({
      summary: messages.getMessage('flags.output-format.summary'),
      char: 'f',
      options: ['console', 'md', 'json', 'html'],
      default: 'console',
    }),
    'output-file': Flags.string({
      summary: messages.getMessage('flags.output-file.summary'),
      char: 'o',
    }),
    detailed: Flags.boolean({
      summary: messages.getMessage('flags.detailed.summary'),
      default: false,
    }),
    'refresh-cache1': Flags.boolean({
      summary: messages.getMessage('flags.refresh-cache1.summary'),
      default: false,
    }),
    'refresh-cache2': Flags.boolean({
      summary: messages.getMessage('flags.refresh-cache2.summary'),
      default: false,
    }),
    'no-cache1': Flags.boolean({
      summary: messages.getMessage('flags.no-cache1.summary'),
      default: false,
    }),
    'no-cache2': Flags.boolean({
      summary: messages.getMessage('flags.no-cache2.summary'),
      default: false,
    }),
    // TODO: Consider adding loglevel flag if not inherited
  };

  public async run(): Promise<SchemaCompareResult> {
    const { flags } = await this.parse(SchemaCompareCommand);
    const commandLogger = new Logger('schema:compare');

    commandLogger.info(`Starting schema comparison...`);
    commandLogger.info(`Source 1: ${flags.source1}, Refresh: ${flags['refresh-cache1'] ?? false}, NoCache: ${flags['no-cache1'] ?? false}`);
    commandLogger.info(`Source 2: ${flags.source2}, Refresh: ${flags['refresh-cache2'] ?? false}, NoCache: ${flags['no-cache2'] ?? false}`);
    commandLogger.info(`Output Format: ${flags['output-format']}`);
    if (flags['output-file']) {
      commandLogger.info(`Output File: ${flags['output-file']}`);
    }
    commandLogger.info(`Detailed: ${flags.detailed ?? false}`);

    const sourceResolver = new SourceResolver({
      toolVersion: this.config.version,
      logger: commandLogger,
    });

    let source1Result: SourceResolutionResult | undefined;
    let source2Result: SourceResolutionResult | undefined;

    try {
      commandLogger.info(`Resolving source 1: ${flags.source1}`);
      source1Result = await sourceResolver.resolveSource(
        flags.source1,
        flags['refresh-cache1'] ?? false,
        flags['no-cache1'] ?? false
      );
      commandLogger.info(`Source 1 resolved: ${source1Result.sourceId}, isOrg: ${source1Result.isOrg}`);
      commandLogger.debug('Source 1 metadata (first 300 chars): ' + JSON.stringify(source1Result.metadata).substring(0,300));


      commandLogger.info(`Resolving source 2: ${flags.source2}`);
      source2Result = await sourceResolver.resolveSource(
        flags.source2,
        flags['refresh-cache2'] ?? false,
        flags['no-cache2'] ?? false
      );
      commandLogger.info(`Source 2 resolved: ${source2Result.sourceId}, isOrg: ${source2Result.isOrg}`);
      commandLogger.debug('Source 2 metadata (first 300 chars): ' + JSON.stringify(source2Result.metadata).substring(0,300));

      // Perform comparison
      const comparator = new SchemaComparator({ logger: commandLogger });
      // Ensure metadata is not undefined before passing to compare
      if (!source1Result?.metadata || !source2Result?.metadata) {
        // This case should ideally be covered by resolveSource throwing if metadata is truly unobtainable.
        // SourceResolutionResult defines metadata as non-optional.
        throw new SfError('Failed to retrieve metadata for one or both sources after resolution.', 'MetadataMissingAfterResolutionError');
      }
      const comparisonResult = comparator.compare(source1Result.metadata, source2Result.metadata);
      commandLogger.info(`Comparison completed. Differences found: ${comparisonResult.hasDifferences}`);
      commandLogger.info(`Summary: ${comparisonResult.summary}`);

      const message = comparisonResult.hasDifferences ?
        `Schema comparison complete. Differences found. ${comparisonResult.summary}` :
        `Schema comparison complete. No differences found.`;

      return {
        success: true,
        message,
        source1Result,
        source2Result,
        comparisonResult,
      };
    } catch (error: any) {
      const errorMessage = error instanceof SfError ? error.message : String(error);
      commandLogger.error(`Schema comparison failed: ${errorMessage}`);
      if (error.stack) {
        commandLogger.debug(String(error.stack));
      }
      return {
        success: false,
        message: `Schema comparison failed: ${errorMessage}`,
        error: errorMessage,
        source1Result, // Include partially resolved source if available
        source2Result, // Include partially resolved source if available
      };
    }
  }
}