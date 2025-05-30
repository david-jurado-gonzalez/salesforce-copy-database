import { expect, use } from 'chai';
import * as sinon from 'sinon';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import rewiremock from 'rewiremock';

// Configuración personalizada para ESM
const customPlugin = {
    name: 'custom-esm-plugin',
    onModule: (moduleName: string, parent: any) => {
        console.log(`Cargando módulo: ${moduleName}`);
        return moduleName;
    }
};

rewiremock.addPlugin(customPlugin);

// Original imports - these will be handled by rewiremock or imported dynamically
// import { deployCommand } from '../../src/commands/deployCommand.js';
// import { logger } from '../../src/core/logger.js';
// import * as auth from '../../src/core/auth.js';
// import * as fileManager from '../../src/core/fileManager.js';
// import * as sfdcApi from '../../src/core/sfdc-api.js';
// import { DependencyGraph } from '../../src/commands/dependencyGraph.js';
// import { Connection } from 'jsforce';
// import * as ora from 'ora';
// import * as inquirer from 'inquirer';
// import * as fs from 'fs';
// import * as csvParse from 'csv-parse';
import { AppConfig, SObjectDescribe } from '../../src/core/typeDefs.js';

use(sinonChai);
use(chaiAsPromised);

describe('deployCommand', () => {
    let sandbox: sinon.SinonSandbox;
    let loggerInfoStub: sinon.SinonStub;
    let loggerErrorStub: sinon.SinonStub;
    let loggerWarnStub: sinon.SinonStub;
    let spinnerStartStub: sinon.SinonStub;
    let spinnerStopStub: sinon.SinonStub;
    let spinnerSucceedStub: sinon.SinonStub;
    let spinnerFailStub: sinon.SinonStub;
    let spinnerInfoStub: sinon.SinonStub;
    let inquirerPromptStub: sinon.SinonStub;
    let getSalesforceConnectionStub: sinon.SinonStub;
    let loadConfigStub: sinon.SinonStub;
    let ensureDirStub: sinon.SinonStub;
    let getObjectListFromDataDirStub: sinon.SinonStub;
    let describeSObjectStub: sinon.SinonStub;
    let dependencyGraphAddNodeStub: sinon.SinonStub;
    let dependencyGraphBuildEdgesStub: sinon.SinonStub;
    let dependencyGraphTopologicalSortStub: sinon.SinonStub;
    let sinonDependencyGraphGetTwoPassObjectsStub: sinon.SinonStub; // Renamed to avoid conflict
    let fsExistsSyncStub: sinon.SinonStub;
    let fsCreateReadStreamStub: sinon.SinonStub;
    let csvParseStub: sinon.SinonStub;
    let readIdMapStub: sinon.SinonStub;
    let writeIdMapStub: sinon.SinonStub;
    let writeErrorLogStub: sinon.SinonStub;
    let targetConnBulkLoadStub: sinon.SinonStub;
    let processExitStub: sinon.SinonStub;

    const mockConfig: AppConfig = {
        orgs: {
            source: { username: 'sourceUser', password: 'sourcePw' },
            target: { username: 'targetUser', password: 'targetPw' },
        },
        jobConfig: {}
    };

    // These will be imported dynamically or proxied
    let deployCommandModule: typeof import('../../src/commands/deployCommand.js');
    let authModule: typeof import('../../src/core/auth.js');
    let fileManagerModule: typeof import('../../src/core/fileManager.js');
    let sfdcApiModule: typeof import('../../src/core/sfdc-api.js');
    let oraModule: typeof import('ora');
    let inquirerModule: typeof import('inquirer');
    let fsModule: typeof import('fs');
    let csvParseModule: typeof import('csv-parse');
    let loggerModule: typeof import('../../src/core/logger.js');
    let DependencyGraphModule: typeof import('../../src/commands/dependencyGraph.js');
    let jsforceModule: any; // Changed to any to handle complex ESM/CommonJS interop types


    // Use a placeholder for Connection type until jsforceModule is loaded
    let Connection: any;

    const mockSourceConn: any = { bulk: { load: sinon.stub() }, query: sinon.stub(), describe: sinon.stub() }; // More specific mock
    const mockTargetConn: any = { bulk: { load: sinon.stub() }, query: sinon.stub(), describe: sinon.stub() }; // More specific mock
beforeEach(async () => {
    sandbox = sinon.createSandbox();
    
    console.log('Iniciando configuración de rewiremock...');
    
    // Habilitar rewiremock con configuración personalizada
    rewiremock.enable();
    
    // Agregar logs para debugging
    console.log('Rewiremock habilitado, configurando mocks...');


        // Configure mocks for inquirer
        inquirerPromptStub = sandbox.stub(); // Create a stub for inquirer.prompt
        // Initialize stubs that were potentially removed or commented out
        getSalesforceConnectionStub = sandbox.stub(); // Ensure this is initialized

        rewiremock(() => import('inquirer')).with({
            prompt: inquirerPromptStub,
            // Add other properties of inquirer.PromptModule if needed, or cast to any
            // For now, we'll assume only 'prompt' is used directly.
            // If other methods are called, they will need to be mocked here.
        } as any); // Cast to any to suppress type errors for missing properties

        // Configure mocks for ora
        const mockSpinner = {
            start: sandbox.stub(),
            stop: sandbox.stub(),
            succeed: sandbox.stub(),
            fail: sandbox.stub(),
            info: sandbox.stub(),
            text: '' // Add text property for assignment
        };
        rewiremock(() => import('ora')).with({
            default: sandbox.stub().returns(mockSpinner)
        });
        spinnerStartStub = mockSpinner.start;
        spinnerStopStub = mockSpinner.stop;
        spinnerSucceedStub = mockSpinner.succeed;
        spinnerFailStub = mockSpinner.fail;
        spinnerInfoStub = mockSpinner.info;

        // Configure mocks for logger
        loggerInfoStub = sandbox.stub();
        loggerErrorStub = sandbox.stub();
        loggerWarnStub = sandbox.stub();
        rewiremock(() => import('../../src/core/logger.js')).with({
            Logger: class { // Mock the Logger class
                info = loggerInfoStub;
                error = loggerErrorStub;
                warn = loggerWarnStub;
                debug = sandbox.stub();
                setLogLevel = sandbox.stub();
                constructor(context: string = 'App') {
                    // Mock constructor
                }
            } as any // Use 'as any' to bypass strict class signature checking for the mock
        });

        // Configure mocks for auth
        // getSalesforceConnectionStub is initialized above
        rewiremock(() => import('../../src/core/auth.js')).with({
            Auth: class { // Mock the Auth class
                // Add 'logger' back as 'any' to satisfy TypeScript's structural check
                logger: any = {
                    info: sandbox.stub(),
                    warn: sandbox.stub(),
                    error: sandbox.stub(),
                    debug: sandbox.stub(),
                    setLogLevel: sandbox.stub()
                };
                getSalesforceConnection = getSalesforceConnectionStub;
                getOrgAliasList = sandbox.stub().resolves([]);
                getOrgAliases = sandbox.stub().resolves({});
                execCommand = sandbox.stub().resolves({ stdout: '', stderr: '' });
                readAliasCache = sandbox.stub().resolves({});
                writeAliasCache = sandbox.stub().resolves();
                getAliasDetails = sandbox.stub().resolves(undefined);
                removeAlias = sandbox.stub().resolves();
                clearAliases = sandbox.stub().resolves();
                // Add missing methods from the error message
                getAuthInfoFromCache = sandbox.stub().resolves(null); // Or mock a specific return
                saveAuthInfoToCache = sandbox.stub().resolves();
                connectWithSfdxAlias = sandbox.stub().resolves(mockTargetConn); // Or mock a specific connection
                constructor() { // Constructor should not take arguments
                     // Mock constructor
                }
            } as any // Use 'as any' to bypass strict class signature checking for the mock
        });

        // Configure mocks for fileManager
        loadConfigStub = sandbox.stub().resolves(mockConfig);
        ensureDirStub = sandbox.stub().resolves();
        getObjectListFromDataDirStub = sandbox.stub().resolves(['Account', 'Contact']);
        readIdMapStub = sandbox.stub().resolves({});
        writeIdMapStub = sandbox.stub().resolves();
        writeErrorLogStub = sandbox.stub().resolves();
        rewiremock(() => import('../../src/core/fileManager.js')).with({
            loadConfig: loadConfigStub,
            ensureDir: ensureDirStub,
            getObjectListFromDataDir: getObjectListFromDataDirStub,
            readIdMap: readIdMapStub,
            writeIdMap: writeIdMapStub,
            writeErrorLog: writeErrorLogStub
        });

        // Configure mocks for sfdcApi
        describeSObjectStub = sandbox.stub();
        rewiremock(() => import('../../src/core/sfdc-api.js')).with({
            describeSObject: describeSObjectStub
        });

        // Configure mocks for fs
        fsExistsSyncStub = sandbox.stub();
        fsCreateReadStreamStub = sandbox.stub();
        rewiremock(() => import('fs')).with({
            existsSync: fsExistsSyncStub,
            createReadStream: fsCreateReadStreamStub
        });

        // Configure mocks for csv-parse
        csvParseStub = sandbox.stub().returns({
            [Symbol.asyncIterator]: async function* () { } // Default empty async iterator
        } as any);
        rewiremock(() => import('csv-parse')).with({
            parse: csvParseStub
        });

        // Configure mocks for process.exit
        processExitStub = sandbox.stub(process, 'exit');

        console.log('Iniciando importación de módulos...');

        try {
            // Dynamically import the module under test AFTER mocks are configured
            console.log('Importando deployCommand...');
            deployCommandModule = await rewiremock.module(() => {
                console.log('Dentro del callback de importación de deployCommand');
                return import('../../src/commands/deployCommand.js');
            });
            console.log('deployCommand importado exitosamente');

            console.log('Importando módulos restantes...');
            authModule = await rewiremock.module(() => import('../../src/core/auth.js'));
            fileManagerModule = await rewiremock.module(() => import('../../src/core/fileManager.js'));
            sfdcApiModule = await rewiremock.module(() => import('../../src/core/sfdc-api.js'));
            oraModule = await rewiremock.module(() => import('ora'));
            inquirerModule = await rewiremock.module(() => import('inquirer'));
            fsModule = await rewiremock.module(() => import('fs'));
            csvParseModule = await rewiremock.module(() => import('csv-parse'));
            loggerModule = await rewiremock.module(() => import('../../src/core/logger.js'));
            DependencyGraphModule = await rewiremock.module(() => import('../../src/commands/dependencyGraph.js'));
            jsforceModule = await rewiremock.module(() => import('jsforce'));
            console.log('Todos los módulos importados exitosamente');
        } catch (error) {
            console.error('Error durante la importación de módulos:', error);
            throw error;
        }

        // Now that jsforceModule is loaded, assign Connection
        Connection = jsforceModule.default.Connection || jsforceModule.Connection; // Try default first, then direct

        // Stub methods on the mock connections
        targetConnBulkLoadStub = mockTargetConn.bulk.load; // Assign the stub directly


        getSalesforceConnectionStub.withArgs('source', mockConfig).resolves(mockSourceConn);
        getSalesforceConnectionStub.withArgs('target', mockConfig).resolves(mockTargetConn);

        // Default mock for describeSObject
        describeSObjectStub.callsFake((conn: any, objectName: string) => { // Use any for conn type
            const mockDescribe: SObjectDescribe = {
                name: objectName,
                label: objectName,
                labelPlural: `${objectName}s`, // Default plural
                keyPrefix: '000', // Default keyPrefix
                feedEnabled: false, // Default feedEnabled
                custom: false,
                queryable: true, // Añadido
                retrieveable: true,
                fields: [
                    { name: 'Id', label: 'Id', type: 'id', custom: false, updateable: false, createable: false, nillable: false, queryable: true, relationshipName: null, referenceTo: null },
                    { name: 'Name', label: 'Name', type: 'string', custom: false, updateable: true, createable: true, nillable: true, queryable: true, relationshipName: null, referenceTo: null },
                ]
            };
            if (objectName === 'Account') {
                mockDescribe.fields.push({ name: 'OwnerId', label: 'Owner ID', type: 'reference', custom: false, updateable: true, createable: true, nillable: true, queryable: true, relationshipName: 'Owner', referenceTo: ['User'] });
            } else if (objectName === 'Contact') {
                mockDescribe.fields.push({ name: 'AccountId', label: 'Account ID', type: 'reference', custom: false, updateable: true, createable: true, nillable: true, queryable: true, relationshipName: 'Account', referenceTo: ['Account'] });
            }
            return Promise.resolve(mockDescribe);
        });

        // DependencyGraph prototype stubbing should still work with sinon
        dependencyGraphAddNodeStub = sandbox.stub(DependencyGraphModule.DependencyGraph.prototype, 'addNode');
        dependencyGraphBuildEdgesStub = sandbox.stub(DependencyGraphModule.DependencyGraph.prototype, 'buildEdges');
        dependencyGraphTopologicalSortStub = sandbox.stub(DependencyGraphModule.DependencyGraph.prototype, 'topologicalSort');
        sinonDependencyGraphGetTwoPassObjectsStub = sandbox.stub(DependencyGraphModule.DependencyGraph.prototype, 'getTwoPassObjects'); // Renamed
    });

    afterEach(() => {
        console.log('Limpiando configuración de rewiremock...');
        sandbox.restore();
        try {
            rewiremock.disable();
            console.log('Rewiremock deshabilitado correctamente');
        } catch (error) {
            console.error('Error al deshabilitar rewiremock:', error);
        }
    });

    it('should handle rewiremock module loading correctly', async () => {
        console.log('Iniciando prueba de carga de módulos');
        
        // Configuración específica para esta prueba
        const testConfig = { sourceOrgAlias: 'source', targetOrgAlias: 'target', configPath: 'config.json' };
        inquirerPromptStub.resolves({ confirm: true });
        
        try {
            await deployCommandModule.deployData(testConfig);
            console.log('Prueba completada exitosamente');
        } catch (error: any) {
            if (error.message?.includes('there is no "parent module"')) {
                console.error('Error de parent module detectado:', {
                    message: error.message,
                    stack: error.stack
                });
                throw new Error('Error de configuración de módulos: ' + error.message);
            }
            throw error;
        }
    });

    it('should throw error if --target option is missing', async () => {
        const options = { sourceOrgAlias: 'source', configPath: 'config.json' }; // targetOrgAlias is intentionally missing for this test
        await expect(deployCommandModule.deployData(options as any)).to.be.rejectedWith("La opción '--targetOrgAlias' es obligatoria para el despliegue.");
        expect(loggerErrorStub).to.have.been.calledOnce;
        expect(processExitStub).to.have.been.calledWith(1);
    });

    it('should cancel deployment if user does not confirm', async () => {
        inquirerPromptStub.resolves({ confirm: false });
        const options = { sourceOrgAlias: 'source', targetOrgAlias: 'target', configPath: 'config.json' };
        await deployCommandModule.deployData(options);
        expect(loggerWarnStub).to.have.been.calledWith('Despliegue cancelado por el usuario.');
        expect(processExitStub).to.have.been.calledWith(0);
    });

    it('should proceed without confirmation if --force flag is used', async () => {
        inquirerPromptStub.resolves({ confirm: false }); // This should be ignored
        const options = { sourceOrgAlias: 'source', targetOrgAlias: 'target', configPath: 'config.json', force: true };
        await deployCommandModule.deployData(options);
        expect(loggerWarnStub).to.have.been.calledWith(sinon.match(/Flag --force detectado/));
        expect(inquirerPromptStub).to.not.have.been.called;
        expect(processExitStub).to.not.have.been.called; // Should not exit
    });

    it('should successfully complete a basic deployment', async () => {
        inquirerPromptStub.resolves({ confirm: true });
        fsExistsSyncStub.returns(true); // Simulate CSV files exist

        // Mock CSV parsing for Account
        const accountCsvData = `Id,Name,OwnerId
        001A000000AAAAA,Test Account 1,005A000000BBBBB
        001A000000CCCCC,Test Account 2,005A000000DDDDD`;
        const accountRecords = [
            { Id: '001A000000AAAAA', Name: 'Test Account 1', OwnerId: '005A000000BBBBB' },
            { Id: '001A000000CCCCC', Name: 'Test Account 2', OwnerId: '005A000000DDDDD' },
        ];
        const accountParser = {
            [Symbol.asyncIterator]: async function* () {
                for (const record of accountRecords) {
                    yield record;
                }
            }
        };

        // Mock CSV parsing for Contact
        const contactCsvData = `Id,Name,AccountId
        003A000000EEEEE,Test Contact 1,001A000000AAAAA`; // AccountId will be null in first pass
        const contactRecords = [
            { Id: '003A000000EEEEE', Name: 'Test Contact 1', AccountId: '001A000000AAAAA' },
        ];
        const contactParser = {
            [Symbol.asyncIterator]: async function* () {
                for (const record of contactRecords) {
                    yield record;
                }
            }
        };

        fsCreateReadStreamStub.withArgs(sinon.match(/Account\.csv$/)).returns({
            pipe: sandbox.stub().returns(accountParser)
        });
        fsCreateReadStreamStub.withArgs(sinon.match(/Contact\.csv$/)).returns({
            pipe: sandbox.stub().returns(contactParser)
        });

        // Mock bulk load results
        targetConnBulkLoadStub.withArgs('Account', 'insert', sinon.match.any).resolves([
            { success: true, id: 'a00A000000AAAAA' },
            { success: true, id: 'a00A000000BBBBB' },
        ]);
        targetConnBulkLoadStub.withArgs('Contact', 'insert', sinon.match.any).resolves([
            { success: true, id: 'b00A000000CCCCC' },
        ]);

        // Mock readIdMap to return updated maps after inserts
        readIdMapStub.withArgs('target', 'Account').resolves({
            '001A000000AAAAA': 'a00A000000AAAAA',
            '001A000000CCCCC': 'a00A000000BBBBB',
        });
        readIdMapStub.withArgs('target', 'Contact').resolves({
            '003A000000EEEEE': 'b00A000000CCCCC',
        });

        const options = { sourceOrgAlias: 'source', targetOrgAlias: 'target', configPath: 'config.json' };
        await deployCommandModule.deployData(options);

        expect(loadConfigStub).to.have.been.calledOnceWith('config.json');
        expect(ensureDirStub).to.have.been.calledTwice; // For mappings and errors
        expect(getSalesforceConnectionStub).to.have.been.calledTwice;
        expect(getObjectListFromDataDirStub).to.have.been.calledOnceWith('source');
        expect(describeSObjectStub).to.have.been.calledTwice; // For Account and Contact
        expect(dependencyGraphTopologicalSortStub).to.have.been.calledOnce;
        expect(sinonDependencyGraphGetTwoPassObjectsStub).to.have.been.calledOnce; // Changed
        expect(fsExistsSyncStub).to.have.been.calledTwice; // For Account.csv and Contact.csv
        expect(fsCreateReadStreamStub).to.have.been.calledTwice;
        expect(targetConnBulkLoadStub).to.have.been.calledTwice; // Once for Account, once for Contact
        expect(writeIdMapStub).to.have.been.calledTwice;
        expect(writeErrorLogStub).to.not.have.been.called; // No errors in this scenario
        expect(loggerInfoStub).to.have.been.calledWith(sinon.match(/--- Resumen Final del Despliegue ---/));
        expect(processExitStub).to.not.have.been.called;
    });

    it('should handle objects requiring two-pass deployment', async () => {
        inquirerPromptStub.resolves({ confirm: true });
        fsExistsSyncStub.returns(true);

        // Simulate a scenario where Contact needs two-pass (e.g., due to a cycle or optional lookup)
        dependencyGraphTopologicalSortStub.returns({ order: ['Account', 'Contact'], cycles: new Set(['Contact']) });
        sinonDependencyGraphGetTwoPassObjectsStub.returns(new Set(['Contact'])); // Changed

        // Mock CSV parsing for Account
        const accountCsvData = `Id,Name
        001A000000AAAAA,Test Account 1`;
        const accountRecords = [{ Id: '001A000000AAAAA', Name: 'Test Account 1' }];
        const accountParser = {
            [Symbol.asyncIterator]: async function* () {
                for (const record of accountRecords) {
                    yield record;
                }
            }
        };

        // Mock CSV parsing for Contact (initial insert)
        const contactCsvData = `Id,Name,AccountId
        003A000000EEEEE,Test Contact 1,001A000000AAAAA`; // AccountId will be null in first pass
        const contactRecords = [
            { Id: '003A000000EEEEE', Name: 'Test Contact 1', AccountId: '001A000000AAAAA' },
        ];
        const contactParser = {
            [Symbol.asyncIterator]: async function* () {
                for (const record of contactRecords) {
                    yield record;
                }
            }
        };

        fsCreateReadStreamStub.withArgs(sinon.match(/Account\.csv$/)).returns({
            pipe: sandbox.stub().returns(accountParser)
        });
        fsCreateReadStreamStub.withArgs(sinon.match(/Contact\.csv$/)).returns({
            pipe: sandbox.stub().returns(contactParser)
        });

        targetConnBulkLoadStub.withArgs('Account', 'insert', sinon.match.any).resolves([
            { success: true, id: 'a00A000000AAAAA' },
        ]);
        // First pass for Contact: AccountId is null
        targetConnBulkLoadStub.withArgs('Contact', 'insert', sinon.match.any).resolves([
            { success: true, id: 'b00A000000CCCCC' },
        ]);
        // Second pass for Contact: AccountId is updated
        targetConnBulkLoadStub.withArgs('Contact', 'update', sinon.match.any).resolves([
            { success: true, id: 'b00A000000CCCCC' },
        ]);

        readIdMapStub.withArgs('target', 'Account').resolves({
            '001A000000AAAAA': 'a00A000000AAAAA',
        });
        readIdMapStub.withArgs('target', 'Contact').resolves({
            '003A000000EEEEE': 'b00A000000CCCCC',
        });

        const options = { sourceOrgAlias: 'source', targetOrgAlias: 'target', configPath: 'config.json' };
        await deployCommandModule.deployData(options);

        expect(targetConnBulkLoadStub).to.have.been.calledWith('Account', 'insert');
        expect(targetConnBulkLoadStub).to.have.been.calledWith('Contact', 'insert');
        // Expect the update pass for Contact
        expect(targetConnBulkLoadStub).to.have.been.calledWith('Contact', 'update');
        expect(loggerInfoStub).to.have.been.calledWith(sinon.match(/Objetos que requieren 2 fases/));
        expect(loggerInfoStub).to.have.been.calledWith(sinon.match(/FASE 2: Actualización de Relaciones/));
    });

    it('should handle errors during bulk load and log them', async () => {
        inquirerPromptStub.resolves({ confirm: true });
        fsExistsSyncStub.returns(true);

        const accountCsvData = `Id,Name
        001A000000AAAAA,Test Account 1`;
        const accountRecords = [{ Id: '001A000000AAAAA', Name: 'Test Account 1' }];
        const accountParser = {
            [Symbol.asyncIterator]: async function* () {
                for (const record of accountRecords) {
                    yield record;
                }
            }
        };
        fsCreateReadStreamStub.withArgs(sinon.match(/Account\.csv$/)).returns({
            pipe: sandbox.stub().returns(accountParser)
        });

        targetConnBulkLoadStub.withArgs('Account', 'insert', sinon.match.any).resolves([
            { success: false, errors: ['FIELD_CUSTOM_VALIDATION_EXCEPTION: Invalid Name'] },
        ]);

        const options = { sourceOrgAlias: 'source', targetOrgAlias: 'target', configPath: 'config.json' };
        await deployCommandModule.deployData(options);

        expect(targetConnBulkLoadStub).to.have.been.calledWith('Account', 'insert');
        expect(writeErrorLogStub).to.have.been.calledWith('target', 'Account', 'insert-errors', sinon.match.array);
        expect(writeErrorLogStub.getCall(0).args[3]).to.have.lengthOf(1);
        expect(loggerInfoStub).to.have.been.calledWith(sinon.match(/Account: 0 creados, 1 fallidos/));
    });

    it('should handle missing CSV files gracefully', async () => {
        inquirerPromptStub.resolves({ confirm: true });
        fsExistsSyncStub.withArgs(sinon.match(/Account\.csv$/)).returns(false); // Account.csv missing
        fsExistsSyncStub.withArgs(sinon.match(/Contact\.csv$/)).returns(true); // Contact.csv exists

        // Mock CSV parsing for Contact
        const contactCsvData = `Id,Name
        003A000000EEEEE,Test Contact 1`;
        const contactRecords = [
            { Id: '003A000000EEEEE', Name: 'Test Contact 1' },
        ];
        const contactParser = {
            [Symbol.asyncIterator]: async function* () {
                for (const record of contactRecords) {
                    yield record;
                }
            }
        };
        fsCreateReadStreamStub.withArgs(sinon.match(/Contact\.csv$/)).returns({
            pipe: sandbox.stub().returns(contactParser)
        });

        targetConnBulkLoadStub.withArgs('Contact', 'insert', sinon.match.any).resolves([
            { success: true, id: 'b00A000000CCCCC' },
        ]);

        const options = { sourceOrgAlias: 'source', targetOrgAlias: 'target', configPath: 'config.json' };
        await deployCommandModule.deployData(options);

        expect(loggerWarnStub).to.have.been.calledWith(sinon.match(/No se encontró el archivo Account\.csv/));
        expect(targetConnBulkLoadStub).to.not.have.been.calledWith('Account', 'insert');
        expect(targetConnBulkLoadStub).to.have.been.calledWith('Contact', 'insert');
        expect(loggerInfoStub).to.have.been.calledWith(sinon.match(/Contact: 1 creados, 0 fallidos/));
    });

    it('should handle empty CSV files gracefully', async () => {
        inquirerPromptStub.resolves({ confirm: true });
        fsExistsSyncStub.returns(true);

        // Mock empty CSV parsing for Account
        const emptyParser = {
            [Symbol.asyncIterator]: async function* () { }
        };
        fsCreateReadStreamStub.withArgs(sinon.match(/Account\.csv$/)).returns({
            pipe: sandbox.stub().returns(emptyParser)
        });
        fsCreateReadStreamStub.withArgs(sinon.match(/Contact\.csv$/)).returns({
            pipe: sandbox.stub().returns(emptyParser)
        });

        const options = { sourceOrgAlias: 'source', targetOrgAlias: 'target', configPath: 'config.json' };
        await deployCommandModule.deployData(options);

        expect(spinnerSucceedStub).to.have.been.calledWith(sinon.match(/Account: No hay registros para procesar/));
        expect(spinnerSucceedStub).to.have.been.calledWith(sinon.match(/Contact: No hay registros para procesar/));
        expect(targetConnBulkLoadStub).to.not.have.been.called;
    });
});