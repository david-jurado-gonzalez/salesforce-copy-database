import { jest, describe, beforeEach, it, expect } from '@jest/globals';
import { Org } from '@salesforce/core';
import * as fsOriginalTypes from 'fs-extra'; // Paso 1: Para tipos originales
import { PathLike } from 'fs'; // Tipos del módulo 'fs' nativo
import path from 'path';
import { CacheManager, CacheManagerOptions, CachedOrgMetadata, CachedSObjectDetail, METADATA_FILE_NAME, CACHE_BASE_DIR } from '../../src/core/cacheManager';
import { Logger } from '../../src/core/logger';

// Definición del tipo para la sobrecarga de readdir que devuelve Promise<string[]>
// Basado en la firma de Node.js fs.promises.readdir que devuelve string[]
type ReaddirStringArrayFn = (
  path: PathLike, // De 'import { PathLike } from 'fs';'
  options?: { encoding?: BufferEncoding | null; withFileTypes?: false; recursive?: boolean } | BufferEncoding | null
) => Promise<string[]>;

// Mockear las dependencias externas
jest.mock('@salesforce/core');
// Paso 2: Mockear fs-extra con un factory
jest.mock('fs-extra', () => ({
  __esModule: true,
  ensureDir: jest.fn(), // Genérico, el tipo se infiere o se castea en uso
  writeJson: jest.fn(), // Genérico
  readJson: jest.fn(), // Genérico
  pathExists: jest.fn(), // Genérico
  readdir: jest.fn(), // Genérico, se casteará a ReaddirStringArrayFn en uso
  remove: jest.fn(), // Genérico
}));

// Paso 3: Importar el módulo mockeado y castearlo
import fsImported from 'fs-extra';
const fs = fsImported as jest.Mocked<typeof fsOriginalTypes>;

// Definir la instancia mock ANTES de llamar a jest.mock para Logger
const mockLoggerInstance = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  setLogLevel: jest.fn(),
  getLogLevel: jest.fn(),
} as unknown as Logger; // Casteo para que coincida con el tipo Logger

// Mockear Logger para que 'new Logger()' devuelva nuestra mockLoggerInstance
jest.mock('../../src/core/logger', () => {
  return {
    Logger: jest.fn().mockImplementation(() => {
      return mockLoggerInstance;
    })
  };
});


describe('CacheManager', () => {
  let cacheManager: CacheManager;
  const mockOrgId = '00Dxx0000001234ORG';
  const mockUsername = 'test@example.com';
  const mockOrgAlias = 'myTestOrg';
  const mockToolVersion = '1.0.0';
  const mockCacheBasePath = path.join(CACHE_BASE_DIR, 'test-cache'); // Usar un subdirectorio para pruebas

  const mockOrgInstance = {
    getOrgId: jest.fn().mockReturnValue(mockOrgId),
    getUsername: jest.fn().mockReturnValue(mockUsername),
    getConnection: jest.fn().mockReturnValue({
      instanceUrl: 'https://example.salesforce.com',
      accessToken: 'fakeAccessToken',
    }),
  } as unknown as Org;

  const defaultOptions: CacheManagerOptions = {
    org: mockOrgInstance,
    // orgAlias: mockOrgAlias, // Removed as it's no longer part of CacheManagerOptions
    toolVersion: mockToolVersion,
    logger: mockLoggerInstance,
    cacheBasePath: mockCacheBasePath, // Sobrescribir para pruebas
  };

  const sampleSObjectDetails: { [sObjectApiName: string]: CachedSObjectDetail } = {
    Account: {
      name: 'Account', // Added SObject API name
      label: 'Account',
      labelPlural: 'Accounts',
      custom: false, // Added custom flag for SObject
      fields: [{ name: 'Id', type: 'id', label: 'Record ID', custom: false }],
      childRelationships: [],
      recordTypeInfos: [], // Corrected property name
    },
  };
  
  const sampleMetadata: CachedOrgMetadata = {
    orgId: mockOrgId,
    userId: mockUsername,
    cacheSchemaVersion: '1.0',
    toolVersion: mockToolVersion,
    generatedTimestamp: new Date().toISOString(),
    metadataFetchedTimestamp: new Date().toISOString(),
    sObjects: sampleSObjectDetails,
  };

  beforeEach(() => {
    // Limpiar mocks antes de cada prueba
    jest.clearAllMocks();
    // Ahora fs.ensureDir, etc., ya son jest.MockedFunction gracias al factory
    fs.ensureDir.mockImplementation((_path, _options) => Promise.resolve(undefined));
    fs.writeJson.mockImplementation((_file, _object, _options) => Promise.resolve(undefined));
    fs.readJson.mockImplementation((_file, _options) => Promise.resolve(sampleMetadata)); // Para la configuración general
    fs.pathExists.mockImplementation((_path) => Promise.resolve(true));
    
    (fs.readdir as unknown as jest.MockedFunction<ReaddirStringArrayFn>)
      .mockImplementation((_path, _options) => Promise.resolve([]));
    
    fs.remove.mockImplementation((_dir) => Promise.resolve(undefined));

    cacheManager = new CacheManager(defaultOptions);
  });

  describe('Constructor', () => {
    // Test for orgAlias initialization removed as orgAlias property is removed
    it('should set the correct cache base path for the org', () => {
      const expectedOrgCachePath = path.join(mockCacheBasePath, mockOrgId);
      expect(cacheManager.getOrgSpecificCachePath()).toBe(expectedOrgCachePath);
    });
  });

  describe('formatTimestamp', () => {
    it('should format date to YYYYMMDD_HHMMSS', () => {
      const date = new Date(2024, 0, 20, 10, 30, 15); // 20 Jan 2024, 10:30:15
      const formatted = cacheManager['formatTimestamp'](date);
      expect(formatted).toBe('20240120_103015');
    });
  });

  describe('getSnapshotDirectoryName', () => {
    it('should generate snapshot directory name correctly', () => {
      const date = new Date(2024, 0, 20, 10, 30, 15);
      // orgAlias is no longer part of getSnapshotDirectoryName method signature
      const snapshotName = cacheManager['getSnapshotDirectoryName'](date);
      expect(snapshotName).toBe('20240120_103015'); // Expect only timestamp
    });
  });

  describe('saveMetadata', () => {
    it('should create a new snapshot directory and save metadata.json', async () => {
      const fetchedTimestamp = new Date();
      await cacheManager.saveMetadata(sampleSObjectDetails, fetchedTimestamp);

      const expectedSnapshotDirNameRegex = /^\d{8}_\d{6}$/; // Regex for YYYYMMDD_HHMMSS
      const orgSpecificCachePath = path.join(mockCacheBasePath, mockOrgId);
      
      expect(fs.ensureDir).toHaveBeenCalledTimes(1);
      const ensureDirCall = (fs.ensureDir as jest.Mock).mock.calls[0][0];
      expect(ensureDirCall).toContain(orgSpecificCachePath);
      expect(ensureDirCall).toMatch(expectedSnapshotDirNameRegex);


      expect(fs.writeJson).toHaveBeenCalledTimes(1);
      const writeJsonCall = fs.writeJson.mock.calls[0];
      // Regex for YYYYMMDD_HHMMSS
      expect(writeJsonCall[0]).toMatch(new RegExp(path.join(orgSpecificCachePath, '\\d{8}_\\d{6}', METADATA_FILE_NAME).replace(/\\/g, '\\\\')));
      
      const dataWritten = writeJsonCall[1] as CachedOrgMetadata;
      expect(dataWritten.orgId).toBe(mockOrgId);
      expect(dataWritten.sObjects).toEqual(sampleSObjectDetails);
      expect(dataWritten.metadataFetchedTimestamp).toBe(fetchedTimestamp.toISOString());
    });
  });

  describe('getMetadata', () => {
    it('should load metadata from the latest snapshot if no specific snapshot is provided', async () => {
      const snapshot1 = '20240101_000000'; // No orgAlias
      const snapshot2 = '20240102_000000'; // Latest, no orgAlias
      (fs.readdir as unknown as jest.MockedFunction<ReaddirStringArrayFn>)
        .mockImplementationOnce((_path, _options) => Promise.resolve([snapshot1, snapshot2].sort((a,b) => b.localeCompare(a)))); // Ensure sorted desc
      
      fs.pathExists.mockImplementation(async (p: PathLike) => {
        const pathStr = p.toString();
        return pathStr.endsWith(METADATA_FILE_NAME);
      });
      
      const metadataForSnapshot2 = { ...sampleMetadata, snapshotName: snapshot2, orgId: mockOrgId };
      fs.readJson.mockResolvedValueOnce(metadataForSnapshot2);

      const metadata = await cacheManager.getMetadata();

      const expectedLatestSnapshotPath = path.join(mockCacheBasePath, mockOrgId, snapshot2, METADATA_FILE_NAME);
      expect(fs.readJson).toHaveBeenCalledWith(expectedLatestSnapshotPath);
      expect(metadata).toEqual(metadataForSnapshot2);
    });

    it('should load metadata from a specific snapshot if provided', async () => {
      const specificSnapshot = '20240101_100000'; // No orgAlias
      (fs.readdir as unknown as jest.MockedFunction<ReaddirStringArrayFn>)
        .mockImplementationOnce((_path, _options) => Promise.resolve([specificSnapshot, '20231231_000000'].sort((a,b) => b.localeCompare(a))));
      
      fs.pathExists.mockImplementation(async (p: PathLike) => {
        const pathStr = p.toString();
        return pathStr.endsWith(METADATA_FILE_NAME) && pathStr.includes(specificSnapshot);
      });
      
      const metadataForSpecificSnapshot = { ...sampleMetadata, snapshotName: specificSnapshot, orgId: mockOrgId };
      fs.readJson.mockResolvedValue(metadataForSpecificSnapshot);

      const metadata = await cacheManager.getMetadata(false, false, specificSnapshot);
      
      const expectedSpecificSnapshotPath = path.join(mockCacheBasePath, mockOrgId, specificSnapshot, METADATA_FILE_NAME);
      expect(fs.readJson).toHaveBeenCalledWith(expectedSpecificSnapshotPath);
      expect(metadata).toEqual(metadataForSpecificSnapshot);
    });

    it('should return null if no snapshots exist', async () => {
      (fs.readdir as unknown as jest.MockedFunction<ReaddirStringArrayFn>)
        .mockImplementationOnce((_path, _options) => Promise.resolve([]));
      const metadata = await cacheManager.getMetadata();
      expect(metadata).toBeNull();
      expect(fs.readJson).not.toHaveBeenCalled();
    });

    it('should return null if a specific snapshot does not exist', async () => {
      (fs.readdir as unknown as jest.MockedFunction<ReaddirStringArrayFn>)
        .mockImplementationOnce((_path, _options) => Promise.resolve(['20240101_000000'])); // No orgAlias
      
      fs.pathExists.mockImplementation(async (p: PathLike) => {
        const pathStr = p.toString();
        if (pathStr.includes('nonExistentSnapshot')) return false; // No orgAlias
        return pathStr.includes('20240101_000000') && pathStr.endsWith(METADATA_FILE_NAME);
      });

      const metadata = await cacheManager.getMetadata(false, false, 'nonExistentSnapshot'); // No orgAlias
      expect(metadata).toBeNull();
      expect(fs.readJson as jest.Mock).not.toHaveBeenCalled();
    });
  });

  describe('listSnapshots', () => {
    it('should return a list of valid snapshot directory names, sorted descending', async () => {
      const snapshotsFromFs = ['20240102_100000', 'invalidDir', '20240101_000000']; // No orgAlias
      (fs.readdir as unknown as jest.MockedFunction<ReaddirStringArrayFn>)
        .mockImplementationOnce((_path, _options) => Promise.resolve(snapshotsFromFs));
      
      const result = await cacheManager.listSnapshots();
      // CacheManager's listSnapshots filters by regex (^\d{8}_\d{6}$) and sorts descending
      expect(result).toEqual(['20240102_100000', '20240101_000000']); // Sorted and filtered
    });

    it('should return an empty array if no snapshots exist', async () => {
      (fs.readdir as unknown as jest.MockedFunction<ReaddirStringArrayFn>)
        .mockImplementationOnce((_path, _options) => Promise.resolve([]));
      const result = await cacheManager.listSnapshots();
      expect(result).toEqual([]);
    });
  });

  describe('clearCache', () => {
    it('should remove a specific snapshot directory', async () => {
      const snapshotToClear = '20240101_000000'; // No orgAlias
      await cacheManager.clearCache(snapshotToClear);
      const expectedPathToRemove = path.join(mockCacheBasePath, mockOrgId, snapshotToClear);
      expect(fs.remove as jest.Mock).toHaveBeenCalledWith(expectedPathToRemove);
    });

    it('should remove the entire org cache directory if no specific snapshot is provided', async () => {
      await cacheManager.clearCache(); // Clear all for the org
      const expectedPathToRemove = path.join(mockCacheBasePath, mockOrgId);
      expect(fs.remove).toHaveBeenCalledWith(expectedPathToRemove);
    });
  });
});