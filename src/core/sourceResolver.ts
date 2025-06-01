import { Org, SfError } from '@salesforce/core';
import { Logger } from './logger.js'; // Importar el Logger local
import { CacheManager, CachedOrgMetadata } from './cacheManager.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

const METADATA_FILE_NAME = 'metadata.json';

export interface SourceResolverOptions {
  toolVersion: string;
  logger: Logger;
}
export interface SourceResolutionResult {
  metadata: CachedOrgMetadata;
  sourceId: string;
  isOrg: boolean;
}

/**
 * Resolves a source string (org alias, org alias with timestamp, or file path)
 * to its metadata content.
 */
export class SourceResolver {
  private toolVersion: string;
  private logger: Logger;

  constructor(options: SourceResolverOptions) {
    this.toolVersion = options.toolVersion;
    this.logger = options.logger;
  }

  /**
   * Resolves a source input string to metadata.
   * @param sourceInput - The source string (e.g., 'myOrg', 'myOrg@20230101_120000', './path/to/snapshot/metadata.json')
   * @param forceRefresh - Whether to force a refresh if the source is an org.
   * @param noCache - Whether to bypass the cache and fetch directly from the org (without saving to cache).
   * @returns Promise<SourceResolutionResult>
   */
  public async resolveSource(
    sourceInput: string,
    forceRefresh = false,
    noCache = false
  ): Promise<SourceResolutionResult> {
    this.logger.debug(`Attempting to resolve source: ${sourceInput}, forceRefresh: ${forceRefresh}, noCache: ${noCache}`);

    // Try to parse as orgAlias@timestamp
    const aliasTimeParts = sourceInput.match(/^([^@]+)@(\d{8}_\d{6})$/);
    if (aliasTimeParts) {
      const orgAlias = aliasTimeParts[1];
      const timestamp = aliasTimeParts[2];
      this.logger.info(`Resolving org alias '${orgAlias}' with specific snapshot timestamp '${timestamp}'.`);
      try {
        const org = await Org.create({ aliasOrUsername: orgAlias });
        const orgId = org.getOrgId();
        const snapshotFilePath = path.join(CacheManager.getCacheDirectoryPath(orgId), timestamp, METADATA_FILE_NAME);

        this.logger.debug(`Constructed snapshot file path: ${snapshotFilePath}`);
        if (fs.existsSync(snapshotFilePath) && fs.statSync(snapshotFilePath).isFile()) {
          const fileContent = fs.readFileSync(snapshotFilePath, 'utf-8');
          const metadata = JSON.parse(fileContent) as CachedOrgMetadata;
          // TODO: Add validation for the metadata structure if necessary
          this.logger.info(`Successfully loaded metadata from versioned snapshot: ${snapshotFilePath}`);
          return { metadata, sourceId: sourceInput, isOrg: true }; // isOrg is true as it originates from an org's cache
        } else {
          throw new SfError(`Snapshot file not found at '${snapshotFilePath}' for org alias '${orgAlias}' at timestamp '${timestamp}'.`);
        }
      } catch (error: any) {
        if (error instanceof SfError) throw error;
        throw new SfError(`Error resolving org alias with timestamp '${sourceInput}': ${error.message}`, 'AliasTimestampResolutionError', undefined, error);
      }
    }

    // Try to resolve as a direct file path
    if (sourceInput.includes(path.sep) || sourceInput.endsWith('.json') || sourceInput.startsWith('.')) {
      this.logger.info(`Attempting to resolve '${sourceInput}' as a direct file path.`);
      if (fs.existsSync(sourceInput) && fs.statSync(sourceInput).isFile()) {
        try {
          const fileContent = fs.readFileSync(sourceInput, 'utf-8');
          const metadata = JSON.parse(fileContent) as CachedOrgMetadata;
          // TODO: Add validation for the metadata structure if necessary
          this.logger.info(`Successfully loaded metadata from direct file path: ${sourceInput}`);
          return { metadata, sourceId: sourceInput, isOrg: false };
        } catch (error: any) {
          throw new SfError(`Failed to read or parse metadata file '${sourceInput}': ${error.message}`);
        }
      } else {
        // If it looked like a path but wasn't found, it's an error before trying as an alias
         this.logger.warn(`Input '${sourceInput}' looked like a path but was not found or is not a file.`);
      }
    }

    // Assume it's an org alias (to be fetched or retrieved from latest cache)
    this.logger.info(`Resolving '${sourceInput}' as an org alias.`);
    try {
      const org = await Org.create({ aliasOrUsername: sourceInput });
      const cacheManager = new CacheManager({ org, toolVersion: this.toolVersion, logger: this.logger });

      if (noCache) {
        this.logger.warn(`--no-cache specified for ${sourceInput}. Direct fetching from org is not yet implemented in SourceResolver.`);
        // For now, we can't fulfill this. In a future step, this would trigger direct API calls.
        throw new SfError(`Direct fetching from org with --no-cache for '${sourceInput}' is not yet implemented.`, 'NotImplementedError');
      }

      // forceRefresh is passed to cacheManager.getMetadata.
      // If it returns null, it means either cache was stale (and refresh was intended) or cache miss.
      const metadata = await cacheManager.getMetadata(forceRefresh);

      if (metadata) {
        this.logger.info(`Successfully retrieved metadata for org alias '${sourceInput}' from cache.`);
        return { metadata, sourceId: sourceInput, isOrg: true };
      } else {
        // CacheManager.getMetadata returned null.
        // This means:
        // 1. Cache miss and needs fetching.
        // 2. Cache was stale and forceRefresh=false (so it indicated staleness by returning null).
        // 3. forceRefresh=true was passed, and CacheManager expects caller to fetch and save.
        this.logger.warn(`Metadata for org alias '${sourceInput}' not found in cache or requires refresh. Automatic fetching/refreshing by SourceResolver is not yet implemented.`);
        throw new SfError(`Metadata for '${sourceInput}' not available via cache and automatic fetching is not yet implemented. Try refreshing cache explicitly if supported by the command, or ensure a valid cache exists.`, 'CacheMissOrNeedsRefreshError');
      }
    } catch (error: any) {
      if (error instanceof SfError) {
        throw error;
      }
      // Catch errors from Org.create (e.g., alias not found) or CacheManager instantiation
      this.logger.error(`Error resolving org alias '${sourceInput}': ${error.message}`);
      throw new SfError(`Error resolving source '${sourceInput}': ${error.message}`, 'SourceResolutionError', undefined, error);
    }
  }
}