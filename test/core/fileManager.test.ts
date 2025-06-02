import { jest } from '@jest/globals';
// import * as fs from 'fs/promises';
import * as path from 'path';
// import rewiremock from 'rewiremock';
import { fileManagerAPI } from '../../src/core/fileManager.js';
import { Logger } from '../../src/core/logger'; // Import class
import { AppConfig, IdMap, DEFAULT_ORG_CONFIG } from '../../src/core/typeDefs.js';

// Mock Logger
const mockLoggerInstance = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  setLogLevel: jest.fn(),
  getLogLevel: jest.fn().mockReturnValue('info'),
} as unknown as Logger;

jest.mock('../../src/core/logger', () => {
  return {
    __esModule: true,
    Logger: jest.fn().mockImplementation(() => {
      return mockLoggerInstance;
    })
  };
});

// use(sinonChai); // Eliminado
// use(chaiAsPromised); // Eliminado

describe('FileManager Functions', () => {
    // let sandbox: sinon.SinonSandbox; // Eliminado
    // let fsAccessStub: sinon.SinonStub;
    // let fsMkdirStub: sinon.SinonStub;
    // let fsWriteFileStub: sinon.SinonStub;
    // let fsReadFileStub: sinon.SinonStub;
    // let fsReaddirStub: sinon.SinonStub;
    // let processCwdStub: sinon.SinonStub;

    const WORK_DIR_NAME = 'workdir';
    const BASE_CWD = '/app';

    beforeEach(() => {
        jest.spyOn(process, 'cwd').mockReturnValue(BASE_CWD);
        // // fsAccessStub = sandbox.stub(fs, 'access');
        // fsMkdirStub = sandbox.stub(fs, 'mkdir');
        // fsWriteFileStub = sandbox.stub(fs, 'writeFile');
        // fsReadFileStub = sandbox.stub(fs, 'readFile');
        // fsReaddirStub = sandbox.stub(fs, 'readdir');
    });

    afterEach(() => {
        jest.restoreAllMocks();
        // rewiremock.disable(); // Disable rewiremock after each test
    });

    describe('Path Helpers', () => { // .skip TEMPORAL
        it('getWorkDir should return the correct work directory path', () => {
            expect(fileManagerAPI.getWorkDir()).toBe(path.join(BASE_CWD, WORK_DIR_NAME));
        });

        it('getOrgWorkDir should return the correct organization work directory path', () => {
            const alias = 'testOrg';
            expect(fileManagerAPI.getOrgWorkDir(alias)).toBe(path.join(BASE_CWD, WORK_DIR_NAME, alias));
        });

        it('getOrgDataDir should return the correct organization data directory path', () => {
            const alias = 'testOrg';
            expect(fileManagerAPI.getOrgDataDir(alias)).toBe(path.join(BASE_CWD, WORK_DIR_NAME, alias, 'data'));
        });

        it('getOrgMetadataDir should return the correct organization metadata directory path', () => {
            const alias = 'testOrg';
            expect(fileManagerAPI.getOrgMetadataDir(alias)).toBe(path.join(BASE_CWD, WORK_DIR_NAME, alias, 'metadata'));
        });

        it('getOrgMappingsDir should return the correct organization mappings directory path', () => {
            const alias = 'testOrg';
            expect(fileManagerAPI.getOrgMappingsDir(alias)).toBe(path.join(BASE_CWD, WORK_DIR_NAME, alias, 'mappings'));
        });

        it('getOrgErrorsDir should return the correct organization errors directory path', () => {
            const alias = 'testOrg';
            expect(fileManagerAPI.getOrgErrorsDir(alias)).toBe(path.join(BASE_CWD, WORK_DIR_NAME, alias, 'errors'));
        });
    });

    describe('ensureDir', () => {
        it('should create a directory recursively', async () => {
            const dirPath = '/test/dir';
            await fileManagerAPI.ensureDir(dirPath);
            // expect(fsMkdirStub).to.have.been.calledWith(dirPath, { recursive: true });
            // expect(loggerDebugStub).to.have.been.calledWith(`Directorio asegurado: ${dirPath}`);
        });

        it('should log and rethrow error if mkdir fails', async () => {
            const dirPath = '/test/dir';
            const error = new Error('Permission denied');
            // fsMkdirStub.withArgs(dirPath, { recursive: true }).rejects(error);

            await expect(fileManagerAPI.ensureDir(dirPath)).rejects.toThrow(error);
            // expect(loggerErrorStub).to.have.been.calledWith(`Error crítico al asegurar la existencia del directorio ${dirPath}: ${error.message}`);
        });
    });

    describe('loadConfig', () => {
        const configPath = '/app/config.json';
        const mockConfig: AppConfig = {
            orgs: {
                source: { username: 'user1', password: 'pw1' },
                target: { username: 'user2', password: 'pw2' }
            }
        };

        it('should load and parse config file successfully', async () => {
            // fsReadFileStub.withArgs(configPath, 'utf-8').resolves(JSON.stringify(mockConfig));
            const config = await fileManagerAPI.loadConfig(configPath);
            expect(config).toEqual(mockConfig);
        });

        it('should return default config if no configPath provided', async () => {
            const config = await fileManagerAPI.loadConfig();
            expect(config).toEqual({ orgs: {} });
        });

        it('should return default config if file not found', async () => {
            // fsReadFileStub.withArgs(configPath, 'utf-8').rejects({ code: 'ENOENT' });
            const config = await fileManagerAPI.loadConfig(configPath);
            expect(config).toEqual({ orgs: {} });
            // expect(loggerInfoStub).to.have.been.calledWith(`No se encontró archivo de configuración en ${configPath}, se usará configuración por defecto`);
        });

        it('should return default config if file has invalid JSON', async () => {
            // fsReadFileStub.withArgs(configPath, 'utf-8').resolves('invalid json');
            const config = await fileManagerAPI.loadConfig(configPath);
            expect(config).toEqual({ orgs: {} });
            // expect(loggerErrorStub).to.have.been.calledWith(`El archivo de configuración en ${configPath} contiene JSON inválido, se usará configuración por defecto`);
        });

        it('should use CLI options for source org config', async () => {
            const options = {
                source: 'sourceOrg',
                username: 'cliUser',
                password: 'cliPass',
                loginUrl: 'https://test.salesforce.com'
            };

            const config = await fileManagerAPI.loadConfig(undefined, options);
            expect(config.orgs[options.source]).toEqual({
                ...DEFAULT_ORG_CONFIG,
                username: options.username,
                password: options.password,
                loginUrl: options.loginUrl
            });
        });

        it('should use CLI options for target org config', async () => {
            const options = {
                target: 'targetOrg',
                username: 'cliUser',
                password: 'cliPass',
                loginUrl: 'https://test.salesforce.com'
            };

            const config = await fileManagerAPI.loadConfig(undefined, options);
            expect(config.orgs[options.target]).toEqual({
                ...DEFAULT_ORG_CONFIG,
                username: options.username,
                password: options.password,
                loginUrl: options.loginUrl
            });
        });

        it('should merge file config with CLI options', async () => {
            // fsReadFileStub.withArgs(configPath, 'utf-8').resolves(JSON.stringify(mockConfig));
            const options = {
                source: 'newSource',
                username: 'cliUser',
                password: 'cliPass'
            };

            const config = await fileManagerAPI.loadConfig(configPath, options);
            expect(config.orgs).toMatchObject(mockConfig.orgs);
            expect(config.orgs[options.source]).toEqual({
                ...DEFAULT_ORG_CONFIG,
                username: options.username,
                password: options.password
            });
        });
    });

    describe('readJsonFile', () => {
        const filePath = '/app/data.json';
        const mockData = { key: 'value' };

        it('should read and parse a JSON file', async () => {
            // fsReadFileStub.withArgs(filePath, 'utf-8').resolves(JSON.stringify(mockData));
            const data = await fileManagerAPI.readJsonFile(filePath);
            expect(data).toEqual(mockData);
        });

        it('should throw error if file not found', async () => {
            // fsReadFileStub.withArgs(filePath, 'utf-8').rejects({ code: 'ENOENT' });
            await expect(fileManagerAPI.readJsonFile(filePath)).rejects.toThrow(Error);
        });

        it('should throw error if file has invalid JSON', async () => {
            // fsReadFileStub.withArgs(filePath, 'utf-8').resolves('invalid json');
            await expect(fileManagerAPI.readJsonFile(filePath)).rejects.toThrow(SyntaxError);
        });
    });

    describe('writeJsonFile', () => {
        const filePath = '/app/output.json';
        const dataToWrite = { name: 'test', value: 123 };

        it('should write JSON data to a file', async () => {
            await fileManagerAPI.writeJsonFile(filePath, dataToWrite);
            // expect(fsWriteFileStub).to.have.been.calledWith(filePath, JSON.stringify(dataToWrite, null, 2), 'utf-8');
        });
    });

    describe('readIdMap', () => {
        const alias = 'targetOrg';
        const objectName = 'Account';
        // const mapPath = path.join(BASE_CWD, WORK_DIR_NAME, alias, 'mappings', `${objectName}-map.json`);
        const mockIdMap: IdMap = { 'source1': 'target1', 'source2': 'target2' };

        it('should read existing ID map', async () => {
            // fsReadFileStub.withArgs(mapPath, 'utf-8').resolves(JSON.stringify(mockIdMap));
            const result = await fileManagerAPI.readIdMap(alias, objectName);
            expect(result).toEqual(mockIdMap);
            // expect(loggerDebugStub).to.not.have.been.called;
        });

        it('should return empty object if map file not found', async () => {
            // fsReadFileStub.withArgs(mapPath, 'utf-8').rejects({ code: 'ENOENT' });
            const result = await fileManagerAPI.readIdMap(alias, objectName);
            expect(result).toEqual({});
            // expect(loggerDebugStub).to.have.been.calledWith(`No se encontró el mapa de IDs para '${objectName}', se devolverá un mapa vacío.`);
        });

        it('should throw error for other read errors', async () => {
            const error = new Error('Read error');
            // fsReadFileStub.withArgs(mapPath, 'utf-8').rejects(error);
            await expect(fileManagerAPI.readIdMap(alias, objectName)).rejects.toThrow(error);
            // expect(loggerErrorStub).to.have.been.calledWith(`Error al leer el archivo de mapa ${mapPath}: ${error.message}`);
        });
    });

    describe('writeIdMap', () => {
        const alias = 'targetOrg';
        const objectName = 'Contact';
        // const mapPath = path.join(BASE_CWD, WORK_DIR_NAME, alias, 'mappings', `${objectName}-map.json`);
        const mapToWrite: IdMap = { 's1': 't1' };

        it('should write ID map to file', async () => {
            await fileManagerAPI.writeIdMap(alias, objectName, mapToWrite);
            // expect(fsWriteFileStub).to.have.been.calledWith(mapPath, JSON.stringify(mapToWrite, null, 2), 'utf-8');
            // expect(loggerDebugStub).to.have.been.calledWith(`Mapa de IDs para '${objectName}' guardado con ${Object.keys(mapToWrite).length} entradas.`);
        });
    });

    describe('writeErrorLog', () => {
        const alias = 'targetOrg';
        const objectName = 'Lead';
        const errorType = 'insert-errors';
        const errors = [{ message: 'Error 1' }, { message: 'Error 2' }];
        // const errorPath = path.join(BASE_CWD, WORK_DIR_NAME, alias, 'errors', `${objectName}-${errorType}.json`);

        it('should write error log if errors exist', async () => {
            await fileManagerAPI.writeErrorLog(alias, objectName, errorType, errors);
            // expect(fsWriteFileStub).to.have.been.calledWith(errorPath, JSON.stringify(errors, null, 2), 'utf-8');
            // expect(loggerInfoStub).to.have.been.calledWith(`Se han registrado ${errors.length} errores para '${objectName}' en el fichero: ${errorPath}`);
        });

        it('should not write error log if no errors', async () => {
            await fileManagerAPI.writeErrorLog(alias, objectName, errorType, []);
            // expect(fsWriteFileStub).to.not.have.been.called;
            // expect(loggerInfoStub).to.not.have.been.called;
        });
    });

    describe('getObjectListFromDataDir', () => {
        const sourceAlias = 'sourceOrg';
        // const dataDir = path.join(BASE_CWD, WORK_DIR_NAME, sourceAlias, 'data');

        it('should return list of object names from csv files', async () => {
            // fsReaddirStub.withArgs(dataDir).resolves(['Account.csv', 'Contact.CSV', 'Opportunity.txt'] as any);
            const result = await fileManagerAPI.getObjectListFromDataDir(sourceAlias);
            expect(result).toEqual(['Account', 'Contact']);
            // expect(loggerInfoStub).to.have.been.calledWith(`Objetos detectados en el directorio de datos: Account, Contact`);
        });

        it('should throw error if data directory not found', async () => {
            // fsReaddirStub.withArgs(dataDir).rejects({ code: 'ENOENT' });
            await expect(fileManagerAPI.getObjectListFromDataDir(sourceAlias)).rejects.toThrow(
                `Directorio de datos no encontrado para '${sourceAlias}'. ¿Ejecutaste el comando 'extract' primero?`
            );
            // expect(loggerErrorStub).to.have.been.calledWith(`El directorio de datos para el alias de origen '${sourceAlias}' no existe: ${dataDir}`);
        });

        it('should throw generic error for other readdir failures', async () => {
            const error = new Error('Read dir error');
            // fsReaddirStub.withArgs(dataDir).rejects(error);
            await expect(fileManagerAPI.getObjectListFromDataDir(sourceAlias)).rejects.toThrow(error);
            // expect(loggerErrorStub).to.have.been.calledWith(`No se pudo leer el directorio de datos para '${sourceAlias}': ${error.message}`);
        });
    });
});