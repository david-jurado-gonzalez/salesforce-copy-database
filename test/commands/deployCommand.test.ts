import { jest } from '@jest/globals'; // Añadido para globales de Jest
// import { expect, use } from 'chai'; // Eliminado
// import * as sinon from 'sinon'; // Eliminado
// import sinonChai from 'sinon-chai'; // Eliminado
// import chaiAsPromised from 'chai-as-promised'; // Eliminado
// import rewiremock from 'rewiremock';
import inquirer from 'inquirer'; // Este será el mock después de jest.mock
// Logger se importará estáticamente DESPUÉS de jest.mock
import type { Auth } from '../../src/core/auth.js'; // Reintroducida como type-only import

// import * as sfdcApi from '../../src/core/sfdc-api.js'; // Importar sfdcApi // Comentado temporalmente
// import * as oraModule from 'ora'; // Importar ora // Comentado temporalmente
// import * as fs from 'fs'; // Comentado temporalmente para evitar TS6133 // Importar fs
// import * as csvParse from 'csv-parse'; // No es necesario mockear directamente por ahora

// // Configuración personalizada para ESM
// const customPlugin = {
//     name: 'custom-esm-plugin',
//     onModule: (moduleName: string, parent: any) => {
//         console.log(`Cargando módulo: ${moduleName}`);
//         return moduleName;
//     }
// };
//
// rewiremock.addPlugin(customPlugin);

// Original imports - these will be handled by rewiremock or imported dynamically
// import { deployCommand } from '../../src/commands/deployCommand.js';
// import { logger } from '../../src/core/logger.js';
// import * as auth from '../../src/core/auth.js';
// import * as fileManager from '../../src/core/fileManager.js';
// import * as sfdcApi from '../../src/core/sfdc-api.js';
// import { DependencyGraph } from '../../src/commands/dependencyGraph.js';
// import { Connection } from 'jsforce';
// import * as ora from 'ora';
// import * as fs from 'fs';
// import * as csvParse from 'csv-parse';
import { AppConfig /*, SObjectDescribe*/ } from '../../src/core/typeDefs.js';
import type { fileManagerAPI } from '../../src/core/fileManager.js'; // Reintroducida como type-only import

// use(sinonChai); // Eliminado
// use(chaiAsPromised); // Eliminado

// --- Mock Implementations ---
// Funciones mock individuales para los métodos de Logger
const mockLoggerInfo = jest.fn();
const mockLoggerWarn = jest.fn();
const mockLoggerError = jest.fn();
const mockLoggerDebug = jest.fn();
const mockLoggerSetLogLevel = jest.fn();
const mockLoggerGetLogLevel = jest.fn().mockReturnValue('info');

// Definir un tipo para la instancia mock de Logger que devuelve el constructor mockeado
type MockLoggerInstance = {
    info: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
    debug: jest.Mock;
    setLogLevel: jest.Mock;
    getLogLevel: jest.Mock;
};

// Mockear el módulo Logger a nivel superior.
// Asegurarse de que la ruta coincide con la importación en el SUT, incluyendo .js
// jest.mock for logger.js moved to jest.doMock in beforeEach (lines 65-82 removed)

// Importar Logger DESPUÉS de jest.mock para asegurar que obtenemos la versión mockeada.
// La importación de tipo 'Logger' se puede mantener arriba si es solo para tipos.
// import { Logger as ActualLoggerMocked } from '../../src/core/logger.js'; // Removed (line 86), no longer needed as Logger is mocked via jest.doMock

const mockInquirerPromptActual = jest.fn< (questions: any) => Promise<{ confirm: boolean }> >();

// Provide explicit types for the mock functions
const mockLoadConfig = jest.fn<() => Promise<AppConfig>>();
const mockEnsureDir = jest.fn<() => Promise<void>>();
const mockGetObjectListFromDataDir = jest.fn<() => Promise<string[]>>();
const mockReadIdMap = jest.fn<() => Promise<Record<string, string>>>();
const mockWriteIdMap = jest.fn<() => Promise<void>>();
const mockWriteErrorLog = jest.fn<() => Promise<void>>();
const mockGetOrgDataDir = jest.fn<() => string>();
const mockGetOrgMappingsDir = jest.fn<() => string>();
const mockGetOrgErrorsDir = jest.fn<() => string>();

// Assuming Connection is 'any' for now as jsforce is not explicitly typed here for mocks
const mockGetSalesforceConnection = jest.fn<(alias: string, cfg: AppConfig) => Promise<any>>();

// mockLoggerConstructor is no longer needed for logger.js mock in this file.
// const mockLoggerConstructor = jest.fn().mockImplementation(() => mockLoggerInstance);
const mockAuthConstructor = jest.fn().mockImplementation(() => ({
  getSalesforceConnection: mockGetSalesforceConnection,
}));

// jest.mock() calls will be moved to beforeEach using jest.doMock()

describe('deployCommand', () => {
    // Stubs ahora referencian directamente las funciones mock
    let loggerErrorStub: jest.Mock; // o typeof mockLoggerError
    let loggerWarnStub: jest.Mock; // o typeof mockLoggerWarn
    let inquirerPromptStub: typeof mockInquirerPromptActual;
    let getSalesforceConnectionStub: typeof mockGetSalesforceConnection;
    let loadConfigStub: typeof mockLoadConfig;
    let ensureDirStub: typeof mockEnsureDir;
    let getObjectListFromDataDirStub: typeof mockGetObjectListFromDataDir;
    let readIdMapStub: typeof mockReadIdMap;
    let writeIdMapStub: typeof mockWriteIdMap;
    let writeErrorLogStub: typeof mockWriteErrorLog;
    let getOrgDataDirStub: typeof mockGetOrgDataDir;
    let getOrgMappingsDirStub: typeof mockGetOrgMappingsDir;
    let getOrgErrorsDirStub: typeof mockGetOrgErrorsDir;
 
    const mockConfig: AppConfig = {
        orgs: {
            source: { username: 'sourceUser', password: 'sourcePw' },
            target: { username: 'targetUser', password: 'targetPw' },
        },
        jobConfig: {}
    };

    // These will be imported dynamically or proxied
// let fileManagerModule: typeof import('../../src/core/fileManager.js');
    let deployCommandModule: typeof import('../../src/commands/deployCommand.js');
    // let DependencyGraphModule: typeof import('../../src/commands/dependencyGraph.js'); // Comentado temporalmente


    // Use a placeholder for Connection type until jsforceModule is loaded

    const mockSourceConn: any = { bulk: { load: jest.fn() }, query: jest.fn(), describe: jest.fn() };
    const mockTargetConn: any = { bulk: { load: jest.fn() }, query: jest.fn(), describe: jest.fn() };

    beforeAll(async () => { // Cambiado de before
        // sandbox = sinon.createSandbox(); // Eliminado

        // Los mocks de Logger se manejan con jest.mock() a nivel de módulo
        // Los stubs de inquirer, Auth, fileManagerAPI se crearán en beforeEach

        console.log('Iniciando importación de módulos en beforeAll()...');
        try {
            // deployCommandModule se importará en beforeEach después de jest.resetModules()
            console.log('Importando jsforce en beforeAll()...');
            await import('jsforce');
            console.log('jsforce importado exitosamente en beforeAll()');
        } catch (error) {
            console.error('Error durante la importación de módulos en beforeAll():', error);
            throw error;
        }
    });

    afterAll(() => { // Cambiado de after
        // sandbox.restore(); // Eliminado
    });

    beforeEach(async () => {
        // 1. Limpiar las funciones mock globales de Logger
        mockLoggerInfo.mockClear();
        mockLoggerWarn.mockClear();
        mockLoggerError.mockClear();
        mockLoggerDebug.mockClear();
        mockLoggerSetLogLevel.mockClear();
        mockLoggerGetLogLevel.mockClear();

        // 2. Limpiar otras funciones mock globales
        mockInquirerPromptActual.mockClear();
        mockGetSalesforceConnection.mockClear();
        mockLoadConfig.mockClear();
        mockEnsureDir.mockClear();
        mockGetObjectListFromDataDir.mockClear();
        mockReadIdMap.mockClear();
        mockWriteIdMap.mockClear();
        mockWriteErrorLog.mockClear();
        mockGetOrgDataDir.mockClear();
        mockGetOrgMappingsDir.mockClear();
        mockGetOrgErrorsDir.mockClear();
        
        mockAuthConstructor.mockClear(); // Limpiar el mock del constructor de Auth

        // 3. Logger mock is now handled by jest.doMock below. (lines 193-203 removed)

        // 4. Resetear módulos para asegurar un estado limpio para las importaciones
        console.log('*** In beforeEach: Calling jest.resetModules() ***');
        jest.resetModules();
        console.log('*** In beforeEach: jest.resetModules() COMPLETED ***');

        // 5. Re-aplicar mocks para dependencias ANTES de importar el SUT
        console.log('*** In beforeEach: Setting up jest.doMock for logger.js ***');
        jest.doMock('../../src/core/logger.js', () => {
            console.log('--- jest.doMock factory for logger.js EXECUTED ---');
            // MockLoggerInstance type is defined globally in this file (lines 54-61)
            // mockLoggerInfo, etc., are also global (lines 46-51)
            const MockedLoggerConstructor = jest.fn<(context?: string) => MockLoggerInstance>().mockImplementation((context?: string) => {
                console.log(`--- Mocked Logger CONSTRUCTOR (via doMock) CALLED with context: ${context} ---`);
                return {
                    info: mockLoggerInfo,
                    warn: mockLoggerWarn,
                    error: mockLoggerError,
                    debug: mockLoggerDebug,
                    setLogLevel: mockLoggerSetLogLevel,
                    getLogLevel: mockLoggerGetLogLevel,
                };
            });
            return {
                __esModule: true,
                Logger: MockedLoggerConstructor
            };
        });

        console.log('*** In beforeEach: Setting up jest.doMock for inquirer ***');
        jest.doMock('inquirer', () => {
            console.log('--- jest.doMock factory for inquirer EXECUTED ---');
            return {
                __esModule: true,
                prompt: mockInquirerPromptActual,
            };
        });

        console.log('*** In beforeEach: Setting up jest.doMock for fileManager.js ***');
        jest.doMock('../../src/core/fileManager.js', () => { // Asegurar extensión .js
            console.log('--- jest.doMock factory for fileManager.js EXECUTED ---');
            return {
                __esModule: true,
                fileManagerAPI: { // Suponiendo que el SUT usa fileManagerAPI directamente
                    loadConfig: mockLoadConfig,
                    ensureDir: mockEnsureDir,
                    getObjectListFromDataDir: mockGetObjectListFromDataDir,
                    readIdMap: mockReadIdMap,
                    writeIdMap: mockWriteIdMap,
                    writeErrorLog: mockWriteErrorLog,
                    getOrgDataDir: mockGetOrgDataDir,
                    getOrgMappingsDir: mockGetOrgMappingsDir,
                    getOrgErrorsDir: mockGetOrgErrorsDir,
                }
            };
        });

        console.log('*** In beforeEach: Setting up jest.doMock for auth.js ***');
        jest.doMock('../../src/core/auth.js', () => { // Asegurar extensión .js
            console.log('--- jest.doMock factory for auth.js EXECUTED ---');
            return {
                __esModule: true,
                Auth: mockAuthConstructor, // mockAuthConstructor es jest.fn() que devuelve la instancia mock
            };
        });
        
        // 6. Importar el SUT (deployCommand.js)
        try {
            console.log('*** In beforeEach: About to import SUT (deployCommand.js) and its Logger dependency ***');
            // Importar Logger aquí, DESPUÉS de resetModules y doMocks, para ver qué versión obtiene el SUT.
            // Esto es crucial. Si el jest.mock de logger.js a nivel superior es efectivo,
            // esta importación debería darnos el constructor mockeado.
            const { Logger: LoggerForSUT } = await import('../../src/core/logger.js');
            console.log('*** In beforeEach: Logger imported for SUT. Type:', typeof LoggerForSUT, 'Is it a mock constructor?', (LoggerForSUT as any)?.isMockFunction || (LoggerForSUT as any)?.prototype?.constructor?.isMockFunction ? 'YES' : 'NO');
            if (!((LoggerForSUT as any)?.isMockFunction || (LoggerForSUT as any)?.prototype?.constructor?.isMockFunction)) {
                 console.warn('*** In beforeEach: LoggerForSUT IS NOT the mock constructor. Value:', LoggerForSUT);
            }

            deployCommandModule = await import('../../src/commands/deployCommand.js');
            console.log('*** In beforeEach: Successfully imported deployCommand.js ***');
        } catch (e) {
            console.error('*** In beforeEach: FAILED to import deployCommand.js or its dependencies ***', e);
            throw e;
        }

        // 7. Asignar stubs (esto es más para la sintaxis de Chai/Sinon, pero puede ser útil para claridad)
        // Con Jest, puedes usar directamente mockLoggerError, mockInquirerPromptActual, etc.
        loggerErrorStub = mockLoggerError;
        loggerWarnStub = mockLoggerWarn;
        inquirerPromptStub = mockInquirerPromptActual;
        getSalesforceConnectionStub = mockGetSalesforceConnection;
        loadConfigStub = mockLoadConfig;
        ensureDirStub = mockEnsureDir;
        getObjectListFromDataDirStub = mockGetObjectListFromDataDir;
        readIdMapStub = mockReadIdMap;
        writeIdMapStub = mockWriteIdMap;
        writeErrorLogStub = mockWriteErrorLog;
        getOrgDataDirStub = mockGetOrgDataDir;
        getOrgMappingsDirStub = mockGetOrgMappingsDir;
        getOrgErrorsDirStub = mockGetOrgErrorsDir;

        // 8. Configurar comportamiento de los mocks (ya han sido limpiados)
        loadConfigStub.mockResolvedValue(mockConfig);
        ensureDirStub.mockResolvedValue(undefined);
        getObjectListFromDataDirStub.mockResolvedValue(['Account', 'Contact']);
        readIdMapStub.mockResolvedValue({});
        writeIdMapStub.mockResolvedValue(undefined);
        writeErrorLogStub.mockResolvedValue(undefined);
        getOrgDataDirStub.mockReturnValue('mock/data/dir/source');
        getOrgMappingsDirStub.mockReturnValue('mock/workdir/target/mappings');
        getOrgErrorsDirStub.mockReturnValue('mock/workdir/target/errors');
        
        getSalesforceConnectionStub.mockImplementation(async (alias: string, cfg: AppConfig) => {
            if (alias === 'source' && cfg === mockConfig) {
                return mockSourceConn;
            }
            if (alias === 'target' && cfg === mockConfig) {
                return mockTargetConn;
            }
            console.warn(`getSalesforceConnectionStub llamado con alias inesperado: ${alias}`);
            return undefined as any;
        });
        // Los mocks de CSV y describeSObject se configurarán en pruebas específicas si es necesario
    });

    afterEach(() => {
        jest.restoreAllMocks();
        // console.log('Limpiando configuración de rewiremock...'); // Eliminado
        // try { // Eliminado
            // rewiremock.disable(); // Eliminado
            // console.log('Rewiremock deshabilitado correctamente'); // Eliminado
        // } catch (error) { // Eliminado
            // console.error('Error al deshabilitar rewiremock:', error); // Eliminado
        // } // Eliminado
    });

    // it('should handle rewiremock module loading correctly', async () => { // Comentado
    //     console.log('Iniciando prueba de carga de módulos');
        
    //     // Configuración específica para esta prueba
    //     const testConfig = { sourceOrgAlias: 'source', targetOrgAlias: 'target', configPath: 'config.json' };
    //     inquirerPromptStub.mockResolvedValue({ confirm: true }); // Actualizado
        
    //     try {
    //         await deployCommandModule.deployData(testConfig);
    //         console.log('Prueba completada exitosamente');
    //     } catch (error: any) {
    //         if (error.message?.includes('there is no "parent module"')) {
    //             console.error('Error de parent module detectado:', {
    //                 message: error.message,
    //                 stack: error.stack
    //             });
    //             throw new Error('Error de configuración de módulos: ' + error.message);
    //         }
    //         throw error;
    //     }
    // });
 
    it('should throw error if --target option is missing', async () => {
        const options = { sourceOrgAlias: 'source', configPath: 'config.json' }; // targetOrgAlias is intentionally missing for this test
        const expectedErrorMessage = "El alias de la organización de destino es obligatorio para el despliegue.";
        await expect(deployCommandModule.deployData(options as any)).rejects.toThrow(expectedErrorMessage);
        expect(mockLoggerError).toHaveBeenCalledWith(expectedErrorMessage); // Usar mockLoggerError directamente
        // expect(processExitStub).to.have.been.calledWith(1); // El comando ya no llama a process.exit directamente, sino que lanza un error.
    });
 
    it('should cancel deployment if user does not confirm', async () => {
        inquirerPromptStub.mockResolvedValue({ confirm: false }); // Actualizado
        const options = { sourceOrgAlias: 'source', targetOrgAlias: 'target', configPath: 'config.json' };
        await expect(deployCommandModule.deployData(options)).rejects.toThrow('Despliegue cancelado por el usuario.');
        expect(mockLoggerWarn).toHaveBeenCalledWith('Despliegue cancelado por el usuario.'); // Usar mockLoggerWarn directamente
        // expect(processExitStub).to.have.been.calledWith(0); // El comando ya no llama a process.exit directamente
    });

    // it('should proceed without confirmation if --force flag is used', async () => {
    //     inquirerPromptStub.resolves({ confirm: false }); // This should be ignored
    //     const options = { sourceOrgAlias: 'source', targetOrgAlias: 'target', configPath: 'config.json', force: true };
    //     await deployCommandModule.deployData(options);
    //     expect(loggerWarnStub).to.have.been.calledWith(sinon.match(/Flag --force detectado/));
    //     expect(inquirerPromptStub).to.not.have.been.called;
    //     expect(processExitStub).to.not.have.been.called; // Should not exit
    // });

    // it('should successfully complete a basic deployment', async () => {
    //     inquirerPromptStub.resolves({ confirm: true });
    //     fsExistsSyncStub.returns(true); // Simulate CSV files exist

    //     // Mock CSV parsing for Account
    //     const accountRecords = [
    //         { Id: '001A000000AAAAA', Name: 'Test Account 1', OwnerId: '005A000000BBBBB' },
    //         { Id: '001A000000CCCCC', Name: 'Test Account 2', OwnerId: '005A000000DDDDD' },
    //     ];
    //     const accountParser = {
    //         [Symbol.asyncIterator]: async function* () {
    //             for (const record of accountRecords) {
    //                 yield record;
    //             }
    //         }
    //     };

    //     // Mock CSV parsing for Contact
    //     const contactRecords = [
    //         { Id: '003A000000EEEEE', Name: 'Test Contact 1', AccountId: '001A000000AAAAA' },
    //     ];
    //     const contactParser = {
    //         [Symbol.asyncIterator]: async function* () {
    //             for (const record of contactRecords) {
    //                 yield record;
    //             }
    //         }
    //     };

    //     fsCreateReadStreamStub.withArgs(sinon.match(/Account\.csv$/)).returns({
    //         pipe: sandbox.stub().returns(accountParser)
    //     });
    //     fsCreateReadStreamStub.withArgs(sinon.match(/Contact\.csv$/)).returns({
    //         pipe: sandbox.stub().returns(contactParser)
    //     });

    //     // Mock bulk load results
    //     targetConnBulkLoadStub.withArgs('Account', 'insert', sinon.match.any).resolves([
    //         { success: true, id: 'a00A000000AAAAA' },
    //         { success: true, id: 'a00A000000BBBBB' },
    //     ]);
    //     targetConnBulkLoadStub.withArgs('Contact', 'insert', sinon.match.any).resolves([
    //         { success: true, id: 'b00A000000CCCCC' },
    //     ]);

    //     // Mock readIdMap to return updated maps after inserts
    //     readIdMapStub.withArgs('target', 'Account').resolves({
    //         '001A000000AAAAA': 'a00A000000AAAAA',
    //         '001A000000CCCCC': 'a00A000000BBBBB',
    //     });
    //     readIdMapStub.withArgs('target', 'Contact').resolves({
    //         '003A000000EEEEE': 'b00A000000CCCCC',
    //     });

    //     const options = { sourceOrgAlias: 'source', targetOrgAlias: 'target', configPath: 'config.json' };
    //     await deployCommandModule.deployData(options);

    //     expect(loadConfigStub).to.have.been.calledOnceWith('config.json');
    //     expect(ensureDirStub).to.have.been.calledTwice; // For mappings and errors
    //     expect(getSalesforceConnectionStub).to.have.been.calledTwice;
    //     expect(getObjectListFromDataDirStub).to.have.been.calledOnceWith('source');
    //     expect(describeSObjectStub).to.have.been.calledTwice; // For Account and Contact
    //     expect(dependencyGraphTopologicalSortStub).to.have.been.calledOnce;
    //     expect(sinonDependencyGraphGetTwoPassObjectsStub).to.have.been.calledOnce; // Changed
    //     expect(fsExistsSyncStub).to.have.been.calledTwice; // For Account.csv and Contact.csv
    //     expect(fsCreateReadStreamStub).to.have.been.calledTwice;
    //     expect(targetConnBulkLoadStub).to.have.been.calledTwice; // Once for Account, once for Contact
    //     expect(writeIdMapStub).to.have.been.calledTwice;
    //     expect(writeErrorLogStub).to.not.have.been.called; // No errors in this scenario
    //     expect(loggerInfoStub).to.have.been.calledWith(sinon.match(/--- Resumen Final del Despliegue ---/));
    //     expect(processExitStub).to.not.have.been.called;
    // });

    // it('should handle objects requiring two-pass deployment', async () => {
    //     inquirerPromptStub.resolves({ confirm: true });
    //     fsExistsSyncStub.returns(true);

    //     // Simulate a scenario where Contact needs two-pass (e.g., due to a cycle or optional lookup)
    //     dependencyGraphTopologicalSortStub.returns({ order: ['Account', 'Contact'], cycles: new Set(['Contact']) });
    //     sinonDependencyGraphGetTwoPassObjectsStub.returns(new Set(['Contact'])); // Changed

    //     // Mock CSV parsing for Account
    //     const accountRecords = [{ Id: '001A000000AAAAA', Name: 'Test Account 1' }];
    //     const accountParser = {
    //         [Symbol.asyncIterator]: async function* () {
    //             for (const record of accountRecords) {
    //                 yield record;
    //             }
    //         }
    //     };

    //     // Mock CSV parsing for Contact (initial insert)
    //     const contactRecords = [
    //         { Id: '003A000000EEEEE', Name: 'Test Contact 1', AccountId: '001A000000AAAAA' },
    //     ];
    //     const contactParser = {
    //         [Symbol.asyncIterator]: async function* () {
    //             for (const record of contactRecords) {
    //                 yield record;
    //             }
    //         }
    //     };

    //     fsCreateReadStreamStub.withArgs(sinon.match(/Account\.csv$/)).returns({
    //         pipe: sandbox.stub().returns(accountParser)
    //     });
    //     fsCreateReadStreamStub.withArgs(sinon.match(/Contact\.csv$/)).returns({
    //         pipe: sandbox.stub().returns(contactParser)
    //     });

    //     targetConnBulkLoadStub.withArgs('Account', 'insert', sinon.match.any).resolves([
    //         { success: true, id: 'a00A000000AAAAA' },
    //     ]);
    //     // First pass for Contact: AccountId is null
    //     targetConnBulkLoadStub.withArgs('Contact', 'insert', sinon.match.any).resolves([
    //         { success: true, id: 'b00A000000CCCCC' },
    //     ]);
    //     // Second pass for Contact: AccountId is updated
    //     targetConnBulkLoadStub.withArgs('Contact', 'update', sinon.match.any).resolves([
    //         { success: true, id: 'b00A000000CCCCC' },
    //     ]);

    //     readIdMapStub.withArgs('target', 'Account').resolves({
    //         '001A000000AAAAA': 'a00A000000AAAAA',
    //     });
    //     readIdMapStub.withArgs('target', 'Contact').resolves({
    //         '003A000000EEEEE': 'b00A000000CCCCC',
    //     });

    //     const options = { sourceOrgAlias: 'source', targetOrgAlias: 'target', configPath: 'config.json' };
    //     await deployCommandModule.deployData(options);

    //     expect(targetConnBulkLoadStub).to.have.been.calledWith('Account', 'insert');
    //     expect(targetConnBulkLoadStub).to.have.been.calledWith('Contact', 'insert');
    //     // Expect the update pass for Contact
    //     expect(targetConnBulkLoadStub).to.have.been.calledWith('Contact', 'update');
    //     expect(loggerInfoStub).to.have.been.calledWith(sinon.match(/Objetos que requieren 2 fases/));
    //     expect(loggerInfoStub).to.have.been.calledWith(sinon.match(/FASE 2: Actualización de Relaciones/));
    // });

    // it('should handle errors during bulk load and log them', async () => {
    //     inquirerPromptStub.resolves({ confirm: true });
    //     fsExistsSyncStub.returns(true);

    //     const accountRecords = [{ Id: '001A000000AAAAA', Name: 'Test Account 1' }];
    //     const accountParser = {
    //         [Symbol.asyncIterator]: async function* () {
    //             for (const record of accountRecords) {
    //                 yield record;
    //             }
    //         }
    //     };
    //     fsCreateReadStreamStub.withArgs(sinon.match(/Account\.csv$/)).returns({
    //         pipe: sandbox.stub().returns(accountParser)
    //     });

    //     targetConnBulkLoadStub.withArgs('Account', 'insert', sinon.match.any).resolves([
    //         { success: false, errors: ['FIELD_CUSTOM_VALIDATION_EXCEPTION: Invalid Name'] },
    //     ]);

    //     const options = { sourceOrgAlias: 'source', targetOrgAlias: 'target', configPath: 'config.json' };
    //     await deployCommandModule.deployData(options);

    //     expect(targetConnBulkLoadStub).to.have.been.calledWith('Account', 'insert');
    //     expect(writeErrorLogStub).to.have.been.calledWith('target', 'Account', 'insert-errors', sinon.match.array);
    //     expect(writeErrorLogStub.getCall(0).args[3]).to.have.lengthOf(1);
    //     expect(loggerInfoStub).to.have.been.calledWith(sinon.match(/Account: 0 creados, 1 fallidos/));
    // });

    // it('should handle missing CSV files gracefully', async () => {
    //     inquirerPromptStub.resolves({ confirm: true });
    //     fsExistsSyncStub.withArgs(sinon.match(/Account\.csv$/)).returns(false); // Account.csv missing
    //     fsExistsSyncStub.withArgs(sinon.match(/Contact\.csv$/)).returns(true); // Contact.csv exists

    //     // Mock CSV parsing for Contact
    //     const contactRecords = [
    //         { Id: '003A000000EEEEE', Name: 'Test Contact 1' },
    //     ];
    //     const contactParser = {
    //         [Symbol.asyncIterator]: async function* () {
    //             for (const record of contactRecords) {
    //                 yield record;
    //             }
    //         }
    //     };
    //     fsCreateReadStreamStub.withArgs(sinon.match(/Contact\.csv$/)).returns({
    //         pipe: sandbox.stub().returns(contactParser)
    //     });

    //     targetConnBulkLoadStub.withArgs('Contact', 'insert', sinon.match.any).resolves([
    //         { success: true, id: 'b00A000000CCCCC' },
    //     ]);

    //     const options = { sourceOrgAlias: 'source', targetOrgAlias: 'target', configPath: 'config.json' };
    //     await deployCommandModule.deployData(options);

    //     expect(loggerWarnStub).to.have.been.calledWith(sinon.match(/No se encontró el archivo Account\.csv/));
    //     expect(targetConnBulkLoadStub).to.not.have.been.calledWith('Account', 'insert');
    //     expect(targetConnBulkLoadStub).to.have.been.calledWith('Contact', 'insert');
    //     expect(loggerInfoStub).to.have.been.calledWith(sinon.match(/Contact: 1 creados, 0 fallidos/));
    // });

    // it('should handle empty CSV files gracefully', async () => {
    //     inquirerPromptStub.resolves({ confirm: true });
    //     fsExistsSyncStub.returns(true);

    //     // Mock empty CSV parsing for Account
    //     const emptyParser = {
    //         [Symbol.asyncIterator]: async function* () { }
    //     };
    //     fsCreateReadStreamStub.withArgs(sinon.match(/Account\.csv$/)).returns({
    //         pipe: sandbox.stub().returns(emptyParser)
    //     });
    //     fsCreateReadStreamStub.withArgs(sinon.match(/Contact\.csv$/)).returns({
    //         pipe: sandbox.stub().returns(emptyParser)
    //     });

    //     const options = { sourceOrgAlias: 'source', targetOrgAlias: 'target', configPath: 'config.json' };
    //     await deployCommandModule.deployData(options);

    //     expect(spinnerSucceedStub).to.have.been.calledWith(sinon.match(/Account: No hay registros para procesar/));
    //     expect(spinnerSucceedStub).to.have.been.calledWith(sinon.match(/Contact: No hay registros para procesar/));
    //     expect(targetConnBulkLoadStub).to.not.have.been.called;
    // });
});