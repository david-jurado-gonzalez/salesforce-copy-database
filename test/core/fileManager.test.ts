import { expect, use } from 'chai';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as sinon from 'sinon';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import rewiremock from 'rewiremock';
import {
    getWorkDir, getOrgWorkDir, getOrgDataDir, getOrgMetadataDir,
    getOrgMappingsDir, getOrgErrorsDir, ensureDir, loadConfig,
    readJsonFile, writeJsonFile, readIdMap, writeIdMap,
    writeErrorLog, getObjectListFromDataDir
} from '../../src/core/fileManager.js';
import { Logger } from '../../src/core/logger.js'; // Import class
import { AppConfig, IdMap, DEFAULT_ORG_CONFIG } from '../../src/core/typeDefs.js';

use(sinonChai);
use(chaiAsPromised);

describe('FileManager Functions', () => {
    let sandbox: sinon.SinonSandbox;
    let loggerInfoStub: sinon.SinonStub;
    let loggerErrorStub: sinon.SinonStub;
    let loggerDebugStub: sinon.SinonStub;
    let loggerWarnStub: sinon.SinonStub;
    let fsAccessStub: sinon.SinonStub;
    let fsMkdirStub: sinon.SinonStub;
    let fsWriteFileStub: sinon.SinonStub;
    let fsReadFileStub: sinon.SinonStub;
    let fsReaddirStub: sinon.SinonStub;
    let processCwdStub: sinon.SinonStub;

    const WORK_DIR_NAME = 'workdir';
    const BASE_CWD = '/app';

    beforeEach(() => {
        sandbox = sinon.createSandbox();

        // Stubs for logger methods
        loggerInfoStub = sandbox.stub();
        loggerErrorStub = sandbox.stub();
        loggerDebugStub = sandbox.stub();
        loggerWarnStub = sandbox.stub();

        // Enable rewiremock and mock Logger
        // Ensure rewiremock is imported if not already: import rewiremock from 'rewiremock';
        rewiremock.enable(); // Assuming rewiremock is imported at the top
        rewiremock(() => import('../../src/core/logger.js')).with({
            Logger: class {
                winstonLogger: any; // Propiedad añadida para compatibilidad
                consoleTransport: any; // Propiedad añadida para compatibilidad

                constructor(context?: string) {
                    // El constructor ahora acepta el parámetro opcional 'context'
                    // No es necesario hacer nada con él para este mock.
                }

                info = loggerInfoStub;
                error = loggerErrorStub;
                debug = loggerDebugStub;
                warn = loggerWarnStub;
                getLogLevel = sandbox.stub().returns('info');
                setLogLevel = sandbox.stub();
            } as any // Se añade 'as any' para simplificar el tipado del mock
        });

        fsAccessStub = sandbox.stub(fs, 'access');
        fsMkdirStub = sandbox.stub(fs, 'mkdir');
        fsWriteFileStub = sandbox.stub(fs, 'writeFile');
        fsReadFileStub = sandbox.stub(fs, 'readFile');
        fsReaddirStub = sandbox.stub(fs, 'readdir');
        processCwdStub = sandbox.stub(process, 'cwd').returns(BASE_CWD);
    });

    afterEach(() => {
        sandbox.restore();
        rewiremock.disable(); // Disable rewiremock after each test
    });

    describe('Path Helpers', () => {
        it('getWorkDir should return the correct work directory path', () => {
            expect(getWorkDir()).to.equal(path.join(BASE_CWD, WORK_DIR_NAME));
        });

        it('getOrgWorkDir should return the correct organization work directory path', () => {
            const alias = 'testOrg';
            expect(getOrgWorkDir(alias)).to.equal(path.join(BASE_CWD, WORK_DIR_NAME, alias));
        });

        it('getOrgDataDir should return the correct organization data directory path', () => {
            const alias = 'testOrg';
            expect(getOrgDataDir(alias)).to.equal(path.join(BASE_CWD, WORK_DIR_NAME, alias, 'data'));
        });

        it('getOrgMetadataDir should return the correct organization metadata directory path', () => {
            const alias = 'testOrg';
            expect(getOrgMetadataDir(alias)).to.equal(path.join(BASE_CWD, WORK_DIR_NAME, alias, 'metadata'));
        });

        it('getOrgMappingsDir should return the correct organization mappings directory path', () => {
            const alias = 'testOrg';
            expect(getOrgMappingsDir(alias)).to.equal(path.join(BASE_CWD, WORK_DIR_NAME, alias, 'mappings'));
        });

        it('getOrgErrorsDir should return the correct organization errors directory path', () => {
            const alias = 'testOrg';
            expect(getOrgErrorsDir(alias)).to.equal(path.join(BASE_CWD, WORK_DIR_NAME, alias, 'errors'));
        });
    });

    describe('ensureDir', () => {
        it('should create a directory recursively', async () => {
            const dirPath = '/test/dir';
            await ensureDir(dirPath);
            expect(fsMkdirStub).to.have.been.calledWith(dirPath, { recursive: true });
            expect(loggerDebugStub).to.have.been.calledWith(`Directorio asegurado: ${dirPath}`);
        });

        it('should log and rethrow error if mkdir fails', async () => {
            const dirPath = '/test/dir';
            const error = new Error('Permission denied');
            fsMkdirStub.withArgs(dirPath, { recursive: true }).rejects(error);

            await expect(ensureDir(dirPath)).to.be.rejectedWith(error);
            expect(loggerErrorStub).to.have.been.calledWith(`Error crítico al asegurar la existencia del directorio ${dirPath}: ${error.message}`);
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
            fsReadFileStub.withArgs(configPath, 'utf-8').resolves(JSON.stringify(mockConfig));
            const config = await loadConfig(configPath);
            expect(config).to.deep.equal(mockConfig);
        });

        it('should return default config if no configPath provided', async () => {
            const config = await loadConfig();
            expect(config).to.deep.equal({ orgs: {} });
        });

        it('should return default config if file not found', async () => {
            fsReadFileStub.withArgs(configPath, 'utf-8').rejects({ code: 'ENOENT' });
            const config = await loadConfig(configPath);
            expect(config).to.deep.equal({ orgs: {} });
            expect(loggerInfoStub).to.have.been.calledWith(`No se encontró archivo de configuración en ${configPath}, se usará configuración por defecto`);
        });

        it('should return default config if file has invalid JSON', async () => {
            fsReadFileStub.withArgs(configPath, 'utf-8').resolves('invalid json');
            const config = await loadConfig(configPath);
            expect(config).to.deep.equal({ orgs: {} });
            expect(loggerErrorStub).to.have.been.calledWith(`El archivo de configuración en ${configPath} contiene JSON inválido, se usará configuración por defecto`);
        });

        it('should use CLI options for source org config', async () => {
            const options = {
                source: 'sourceOrg',
                username: 'cliUser',
                password: 'cliPass',
                loginUrl: 'https://test.salesforce.com'
            };

            const config = await loadConfig(undefined, options);
            expect(config.orgs[options.source]).to.deep.equal({
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

            const config = await loadConfig(undefined, options);
            expect(config.orgs[options.target]).to.deep.equal({
                ...DEFAULT_ORG_CONFIG,
                username: options.username,
                password: options.password,
                loginUrl: options.loginUrl
            });
        });

        it('should merge file config with CLI options', async () => {
            fsReadFileStub.withArgs(configPath, 'utf-8').resolves(JSON.stringify(mockConfig));
            const options = {
                source: 'newSource',
                username: 'cliUser',
                password: 'cliPass'
            };

            const config = await loadConfig(configPath, options);
            expect(config.orgs).to.include(mockConfig.orgs);
            expect(config.orgs[options.source]).to.deep.equal({
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
            fsReadFileStub.withArgs(filePath, 'utf-8').resolves(JSON.stringify(mockData));
            const data = await readJsonFile(filePath);
            expect(data).to.deep.equal(mockData);
        });

        it('should throw error if file not found', async () => {
            fsReadFileStub.withArgs(filePath, 'utf-8').rejects({ code: 'ENOENT' });
            await expect(readJsonFile(filePath)).to.be.rejectedWith(Error);
        });

        it('should throw error if file has invalid JSON', async () => {
            fsReadFileStub.withArgs(filePath, 'utf-8').resolves('invalid json');
            await expect(readJsonFile(filePath)).to.be.rejectedWith(SyntaxError);
        });
    });

    describe('writeJsonFile', () => {
        const filePath = '/app/output.json';
        const dataToWrite = { name: 'test', value: 123 };

        it('should write JSON data to a file', async () => {
            await writeJsonFile(filePath, dataToWrite);
            expect(fsWriteFileStub).to.have.been.calledWith(filePath, JSON.stringify(dataToWrite, null, 2), 'utf-8');
        });
    });

    describe('readIdMap', () => {
        const alias = 'targetOrg';
        const objectName = 'Account';
        const mapPath = path.join(BASE_CWD, WORK_DIR_NAME, alias, 'mappings', `${objectName}-map.json`);
        const mockIdMap: IdMap = { 'source1': 'target1', 'source2': 'target2' };

        it('should read existing ID map', async () => {
            fsReadFileStub.withArgs(mapPath, 'utf-8').resolves(JSON.stringify(mockIdMap));
            const result = await readIdMap(alias, objectName);
            expect(result).to.deep.equal(mockIdMap);
            expect(loggerDebugStub).to.not.have.been.called;
        });

        it('should return empty object if map file not found', async () => {
            fsReadFileStub.withArgs(mapPath, 'utf-8').rejects({ code: 'ENOENT' });
            const result = await readIdMap(alias, objectName);
            expect(result).to.deep.equal({});
            expect(loggerDebugStub).to.have.been.calledWith(`No se encontró el mapa de IDs para '${objectName}', se devolverá un mapa vacío.`);
        });

        it('should throw error for other read errors', async () => {
            const error = new Error('Read error');
            fsReadFileStub.withArgs(mapPath, 'utf-8').rejects(error);
            await expect(readIdMap(alias, objectName)).to.be.rejectedWith(error);
            expect(loggerErrorStub).to.have.been.calledWith(`Error al leer el archivo de mapa ${mapPath}: ${error.message}`);
        });
    });

    describe('writeIdMap', () => {
        const alias = 'targetOrg';
        const objectName = 'Contact';
        const mapPath = path.join(BASE_CWD, WORK_DIR_NAME, alias, 'mappings', `${objectName}-map.json`);
        const mapToWrite: IdMap = { 's1': 't1' };

        it('should write ID map to file', async () => {
            await writeIdMap(alias, objectName, mapToWrite);
            expect(fsWriteFileStub).to.have.been.calledWith(mapPath, JSON.stringify(mapToWrite, null, 2), 'utf-8');
            expect(loggerDebugStub).to.have.been.calledWith(`Mapa de IDs para '${objectName}' guardado con ${Object.keys(mapToWrite).length} entradas.`);
        });
    });

    describe('writeErrorLog', () => {
        const alias = 'targetOrg';
        const objectName = 'Lead';
        const errorType = 'insert-errors';
        const errors = [{ message: 'Error 1' }, { message: 'Error 2' }];
        const errorPath = path.join(BASE_CWD, WORK_DIR_NAME, alias, 'errors', `${objectName}-${errorType}.json`);

        it('should write error log if errors exist', async () => {
            await writeErrorLog(alias, objectName, errorType, errors);
            expect(fsWriteFileStub).to.have.been.calledWith(errorPath, JSON.stringify(errors, null, 2), 'utf-8');
            expect(loggerInfoStub).to.have.been.calledWith(`Se han registrado ${errors.length} errores para '${objectName}' en el fichero: ${errorPath}`);
        });

        it('should not write error log if no errors', async () => {
            await writeErrorLog(alias, objectName, errorType, []);
            expect(fsWriteFileStub).to.not.have.been.called;
            expect(loggerInfoStub).to.not.have.been.called;
        });
    });

    describe('getObjectListFromDataDir', () => {
        const sourceAlias = 'sourceOrg';
        const dataDir = path.join(BASE_CWD, WORK_DIR_NAME, sourceAlias, 'data');

        it('should return list of object names from csv files', async () => {
            fsReaddirStub.withArgs(dataDir).resolves(['Account.csv', 'Contact.CSV', 'Opportunity.txt'] as any);
            const result = await getObjectListFromDataDir(sourceAlias);
            expect(result).to.deep.equal(['Account', 'Contact']);
            expect(loggerInfoStub).to.have.been.calledWith(`Objetos detectados en el directorio de datos: Account, Contact`);
        });

        it('should throw error if data directory not found', async () => {
            fsReaddirStub.withArgs(dataDir).rejects({ code: 'ENOENT' });
            await expect(getObjectListFromDataDir(sourceAlias)).to.be.rejectedWith(
                `Directorio de datos no encontrado para '${sourceAlias}'. ¿Ejecutaste el comando 'extract' primero?`
            );
            expect(loggerErrorStub).to.have.been.calledWith(`El directorio de datos para el alias de origen '${sourceAlias}' no existe: ${dataDir}`);
        });

        it('should throw generic error for other readdir failures', async () => {
            const error = new Error('Read dir error');
            fsReaddirStub.withArgs(dataDir).rejects(error);
            await expect(getObjectListFromDataDir(sourceAlias)).to.be.rejectedWith(error);
            expect(loggerErrorStub).to.have.been.calledWith(`No se pudo leer el directorio de datos para '${sourceAlias}': ${error.message}`);
        });
    });
});