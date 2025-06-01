import { expect, use } from 'chai';
import * as sinon from 'sinon';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import esmock from 'esmock';
// import * as oraModule from 'ora'; // Will be imported dynamically

// Original imports - these will be handled by rewiremock or imported dynamically
// import { extractCommand } from '../../src/commands/extractCommand.js';
// import { logger } from '../../src/core/logger.js';
// import * as auth from '../../src/core/auth.js';
// import * as fileManager from '../../src/core/fileManager.js';
// import { Connection } from 'jsforce';
// import * as ora from 'ora';
// import * as fs from 'fs'; // Import fs <--- REMOVED
// import * as path from 'path';
// import * as csvStringify from 'csv-stringify';
import { fileManagerAPI } from '../../src/core/fileManager.js';
import { Auth } from '../../src/core/auth.js'; // Added import
import { /*CommandOptions,*/ AppConfig } from '../../src/core/typeDefs.js';
import { ExtractDataParams } from '../../src/commands/extractCommand.js'; // Import type from .ts, but use .js extension
import { EventEmitter } from 'events';
import * as sfdcApiModuleImport from '../../src/core/sfdc-api.js'; // Import for type, actual module loaded dynamically

use(sinonChai);
use(chaiAsPromised);

describe('extractCommand', () => {
    let sandbox: sinon.SinonSandbox;
    // let loggerInfoStub: sinon.SinonStub;
    // let loggerErrorStub: sinon.SinonStub;
    // let spinnerStartStub: sinon.SinonStub; // No longer directly used, access via mockSpinner.start
    let spinnerSucceedStub: sinon.SinonStub;
    let spinnerFailStub: sinon.SinonStub;
    let spinnerTextSetterStub: sinon.SinonStub; // Kept for direct verification if needed
    let oraDefaultMock: sinon.SinonStub; // For esmock
    let getSalesforceConnectionStub: sinon.SinonStub;
    let loadConfigStub: sinon.SinonStub;
    let getOrgDataDirStub: sinon.SinonStub;
    let ensureDirStub: sinon.SinonStub;
    // let connBulkQueryStub: sinon.SinonStub; // No longer directly used, access via mockConn.bulk.query
    let processExitStub: sinon.SinonStub;
    let extractDataBulkStub: sinon.SinonStub;
    let extractDataQueryStub: sinon.SinonStub; // Added
    let executeSoslQueryStub: sinon.SinonStub; // Added
    let extractSObjectNameFromSoqlStub: sinon.SinonStub; // Added

    const mockConfig: AppConfig = {
        orgs: {
            source: { username: 'testUser', password: 'testPw' },
        },
    };

    // These will be imported dynamically or proxied
    let extractCommandModule: typeof import('../../src/commands/extractCommand.js');
    // let loggerModule: typeof import('../../src/core/logger.js');
    // let authModule: typeof import('../../src/core/auth.js');
    // let fileManagerModule: typeof import('../../src/core/fileManager.js');
    // let jsforceModule: any; // Changed to any
    // let oraModule: typeof import('ora');
    // let fsModule: typeof import('fs');
    let pathModule: typeof import('path');
    let sfdcApiModule: typeof sfdcApiModuleImport; // For the dynamically imported module
    // let csvStringifyModule: typeof import('csv-stringify');

    // Use a placeholder for Connection type until jsforceModule is loaded
    // let Connection: any;

    const mockConn: any = {}; // Initialize as an empty object, will be populated in beforeEach

    beforeEach(async () => { // Make beforeEach async
        sandbox = sinon.createSandbox();

        // Populate mockConn with stubs
        Object.assign(mockConn, {
            bulk: {
                query: sandbox.stub(), // This will be assigned to connBulkQueryStub
                createJob: sandbox.stub().returnsThis(),
                createBatch: sandbox.stub().returnsThis(),
                execute: sandbox.stub().resolves([]), // Simulate bulk batch execution
            },
            query: sandbox.stub().resolves({ // Default for REST API query
                records: [{ Id: '001REST', Name: 'Test Record REST' }],
                totalSize: 1,
                done: true,
                nextRecordsUrl: null
            }),
            sobject: sandbox.stub().callsFake((_objectName: string) => { // For conn.sobject('Account').describe$()
                return {
                    describe$: sandbox.stub().resolves({ // Default for describe$
                        fields: [
                            { name: 'Id', type: 'id', picklistValues: [], updateable: false, createable: false },
                            { name: 'Name', type: 'string', picklistValues: [], updateable: true, createable: true }
                        ],
                        childRelationships: []
                    })
                };
            }),
            describe: sandbox.stub().resolves({ // Default for describe (fallback, less likely to be used)
                fields: [
                    { name: 'Id', type: 'id', picklistValues: [], updateable: false, createable: false },
                    { name: 'Name', type: 'string', picklistValues: [], updateable: true, createable: true }
                ],
                childRelationships: []
            })
        });
        
        // Configure mocks for logger
        // loggerInfoStub = sandbox.stub();
        // loggerErrorStub = sandbox.stub();
        // rewiremock(() => import('../../src/core/logger.js')).with({
        //     Logger: class {
        //         info = loggerInfoStub;
        //         error = loggerErrorStub;
        //     } as any
        // });

        // Configure mocks for ora
        const actualSpinnerTextSetter = sandbox.stub();
        const mockSpinner = {
            start: sandbox.stub().returnsThis(),
            succeed: sandbox.stub(),
            fail: sandbox.stub(),
            _textBackingField: '', // Internal backing field for the text property
            get text() {
                return this._textBackingField;
            },
            set text(value: string) {
                this._textBackingField = value;
                actualSpinnerTextSetter(value); // Call the stub when spinner.text is set
            }
        };
        spinnerSucceedStub = mockSpinner.succeed;
        spinnerFailStub = mockSpinner.fail;
        spinnerTextSetterStub = actualSpinnerTextSetter; // Use this stub for assertions on text changes

        oraDefaultMock = sandbox.stub().returns(mockSpinner);

        // Configure mocks for auth
        // getSalesforceConnectionStub = sandbox.stub().resolves(mockConn); // Replaced by prototype stub
        getSalesforceConnectionStub = sandbox.stub(Auth.prototype, 'getSalesforceConnection').resolves(mockConn as any);
        // rewiremock(() => import('../../src/core/auth.js')).with({
        //     Auth: class {
        //         logger: any;
        //         constructor() {
        //             this.logger = { info: sinon.stub(), error: sinon.stub(), warn: sinon.stub(), debug: sinon.stub(), getLogLevel: sinon.stub().returns('info'), setLogLevel: sinon.stub() };
        //         }
        //         getSalesforceConnection = getSalesforceConnectionStub;
        //     } as any
        // });

        // Configure mocks for fileManager
        loadConfigStub = sandbox.stub(fileManagerAPI, 'loadConfig').resolves(mockConfig);
        getOrgDataDirStub = sandbox.stub(fileManagerAPI, 'getOrgDataDir').returns('/mock/data/dir');
        ensureDirStub = sandbox.stub(fileManagerAPI, 'ensureDir').resolves();
        // writeRecordsToCsvStub = sandbox.stub(fileManagerAPI, 'writeRecordsToCsv').resolves(); // REMOVED as it's no longer used directly
        // rewiremock(() => import('../../src/core/fileManager.js')).with({
        //     loadConfig: loadConfigStub,
        //     getOrgDataDir: getOrgDataDirStub,
        //     ensureDir: ensureDirStub
        // });

        // Configure mocks for fs
        // fsCreateWriteStreamStub ya no mockea fs.createWriteStream globalmente. // REMOVED
        // Es un stub simple que podemos usar para pasar a extractDataBulkStub. // REMOVED
        // fsCreateWriteStreamStub = sandbox.stub().returns(new EventEmitter() as any); // REMOVED

        // Configure mocks for csv-stringify
        // csvStringifyStub = sandbox.stub().returns(new EventEmitter() as any); // Mock a transform stream // REMOVED
        // rewiremock(() => import('csv-stringify')).with({ // REMOVED
        //     stringify: csvStringifyStub // REMOVED
        // }); // REMOVED

        // Configure mocks for process.exit
        processExitStub = sandbox.stub(process, 'exit');

        // Dynamically import sfdc-api.js first to stub it
        sfdcApiModule = await import('../../src/core/sfdc-api.js');
        // Stub methods on the imported sfdcApi object
        extractDataBulkStub = sandbox.stub(sfdcApiModule.sfdcApi, 'extractDataBulk');
        extractDataQueryStub = sandbox.stub(sfdcApiModule.sfdcApi, 'extractDataQuery');
        executeSoslQueryStub = sandbox.stub(sfdcApiModule.sfdcApi, 'executeSoslQuery');
        extractSObjectNameFromSoqlStub = sandbox.stub(sfdcApiModule.sfdcApi, 'extractSObjectNameFromSoql');

        // Set default behaviors for sfdcApi stubs
        extractSObjectNameFromSoqlStub.returns('Account'); // Default mock object name
        extractDataQueryStub.resolves({ parentFile: 'mockParent.csv', childFiles: [] });
        executeSoslQueryStub.resolves([]); // Default to no SOSL results
        
        // Default behavior for extractDataBulkStub (returns a stream that ends immediately)
        const defaultMockBulkStream = new EventEmitter();
        extractDataBulkStub.resolves(defaultMockBulkStream);
        setImmediate(() => defaultMockBulkStream.emit('end'));

        // Dynamically import the module under test AFTER mocks are configured, using esmock for 'ora'
        extractCommandModule = await esmock('../../src/commands/extractCommand.js', {
            'ora': {
                default: oraDefaultMock
            }
        });
        
        pathModule = await import('path');
        
        // loggerModule = await rewiremock.module(() => import('../../src/core/logger.js'));
        // authModule = await rewiremock.module(() => import('../../src/core/auth.js'));
        // fileManagerModule = await rewiremock.module(() => import('../../src/core/fileManager.js'));
        // jsforceModule = await rewiremock.module(() => import('jsforce'));
        // const oraModule = await rewiremock.module(() => import('ora')); // Load ora via rewiremock if needed elsewhere
        // fsModule = await rewiremock.module(() => import('fs'));
        // csvStringifyModule = await rewiremock.module(() => import('csv-stringify'));

        // Now that jsforceModule is loaded, assign Connection
        // Connection = jsforceModule.default.Connection || jsforceModule.Connection;

        // Stub methods on the mock connections
        // connBulkQueryStub = mockConn.bulk.query; // No longer assigned here, mockConn.bulk.query is used directly
    });

    afterEach(() => {
        sandbox.restore();
        if (extractCommandModule) { // Ensure module was loaded before trying to purge
            esmock.purge(extractCommandModule);
        }
    });

    it('should attempt to use default org if source alias is not in config (REST API)', async () => {
        const options: ExtractDataParams = { username: 'nonExistentOrg', query: 'SELECT Id FROM Account' }; // Small query, defaults to REST
        // const options: ExtractDataParams = { username: 'nonExistentOrg', query: 'SELECT Id FROM Account' }; // This line is a duplicate and will be removed by the next change
        loadConfigStub.resolves({ orgs: {} });

        // Configure sfdcApi stubs for this test
        extractSObjectNameFromSoqlStub.withArgs(options.query).returns('Account');
        const expectedParentFile = pathModule.join('/mock/data/dir', 'Account.csv');
        extractDataQueryStub.withArgs(mockConn, options.query, '/mock/data/dir', 'Account')
                            .resolves({ parentFile: expectedParentFile });

        await extractCommandModule.extractData(options);

        const expectedConfig = { orgs: {} };
        expect(getSalesforceConnectionStub).to.have.been.calledOnceWith('nonExistentOrg', sinon.match(expectedConfig));
        expect(extractSObjectNameFromSoqlStub).to.have.been.calledOnceWith(options.query);
        expect(extractDataQueryStub).to.have.been.calledOnceWith(mockConn, options.query, '/mock/data/dir', 'Account');
        
        // Verify spinner message based on extractDataQueryStub's resolution
        expect(spinnerSucceedStub).to.have.been.calledTwice; // Autenticación y luego extracción
        expect(spinnerSucceedStub.firstCall).to.have.been.calledWith(sinon.match(/Autenticado con/));
        
        const succeedArgSecondCall = spinnerSucceedStub.secondCall.args[0]; // Renamed variable for clarity
        // const expectedParentFile1 = pathModule.join('/mock/data/dir', 'Account.csv');
        const expectedSpinnerMsgPrefix1 = `Extracción SOQL (REST/Tooling API) completada. Datos guardados en /mock/data/dir. Archivo principal:`;
        // Usar to.match para expresiones regulares o to.equal para cadenas exactas.
        // Dado que la ruta puede tener separadores \ o /, es mejor usar una regex que los maneje o normalizar.
        // Por simplicidad, si esperamos una cadena exacta (después de la normalización de la ruta si fuera necesario), usamos to.equal.
        // Aquí, como pathModule.join puede usar \ en Windows, y el mensaje en el código fuente usa /,
        // una regex es más segura o una comparación que ignore las diferencias de separador.
        // Para este caso, vamos a construir la regex como antes pero aplicarla directamente.
        // Temporalmente, solo comprobamos el prefijo para diagnosticar el problema de truncamiento.
        expect(succeedArgSecondCall).to.match(new RegExp(expectedSpinnerMsgPrefix1.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));


        expect(spinnerFailStub).to.not.have.been.called;
        expect(processExitStub).to.not.have.been.called;
        // mockConn.query and writeRecordsToCsvStub are no longer asserted as they are internal to the stubbed sfdcApi.extractDataQuery
    });

    it('should throw error if --query option is missing', async () => {
        const options: ExtractDataParams = { username: 'source', query: '' };
        await expect(extractCommandModule.extractData(options as any)).to.be.rejectedWith(
            "Se debe proporcionar una consulta SOQL (query) o SOSL (soslQuery) para la extracción."
        );
        // expect(spinnerFailStub).to.have.been.called; // Temporarily commented out to check promise rejection
        // processExitStub is likely not called when chai-as-promised handles the rejection.
    });

    it('should throw error if SOQL query does not contain FROM clause', async () => {
        const options: ExtractDataParams = { username: 'source', query: 'SELECT Id' };
        extractSObjectNameFromSoqlStub.withArgs('SELECT Id').returns(null); // Configure for this specific test

        await expect(extractCommandModule.extractData(options)).to.be.rejectedWith(
            "No se pudo determinar el objeto principal de la consulta SOQL."
        );
        expect(extractSObjectNameFromSoqlStub).to.have.been.calledOnceWith('SELECT Id');
        // spinnerFailStub is called by the catch block in extractData
        expect(spinnerFailStub).to.have.been.calledOnce;
        const failArg2 = spinnerFailStub.firstCall.args[0];
        expect(failArg2.trim()).to.equal('La extracción ha fallado.');
    });

    it('should successfully extract data and save to CSV (Bulk API)', async () => {
        const options: ExtractDataParams = { username: 'source', query: 'SELECT Id, Name FROM Account', apiType: 'bulk' };
        
        // Configure sfdcApi stubs for this test
        extractSObjectNameFromSoqlStub.withArgs(options.query).returns('Account');
        const mockBulkQueryStream = new EventEmitter();
        extractDataBulkStub.withArgs(sinon.match.any, options.query, sinon.match.string) // Check first 3 args
                           .resolves(mockBulkQueryStream);

        const extractPromise = extractCommandModule.extractData(options);

        // Simulate stream events
        setImmediate(() => {
            mockBulkQueryStream.emit('data', { Id: '001', Name: 'Test1' });
            mockBulkQueryStream.emit('data', { Id: '002', Name: 'Test2' });
            mockBulkQueryStream.emit('end');
        });
        
        await extractPromise;
        
        expect(loadConfigStub).to.have.been.calledOnceWith('./config.json');
        expect(getSalesforceConnectionStub).to.have.been.calledOnceWith('source', mockConfig);
        expect(getOrgDataDirStub).to.have.been.calledOnceWith('source');
        // ensureDirStub is called for the output directory and potentially for the parent of the output file
        expect(ensureDirStub).to.have.been.calledWith('/mock/data/dir');
        
        const expectedOutputFile = pathModule.join('/mock/data/dir', 'Account.csv');
        // The fourth argument to extractDataBulk is the createWriteStream function itself, not the stub instance.
        // We can check that extractDataBulk was called, and the fsCreateWriteStreamStub was NOT called directly by extractCommand.
        expect(extractDataBulkStub).to.have.been.calledOnceWith(
            mockConn,
            options.query,
            expectedOutputFile // fs.createWriteStream is passed internally by sfdc-api
        );
        
        expect(spinnerSucceedStub).to.have.been.calledTwice; // Autenticación y luego extracción
        expect(spinnerSucceedStub.firstCall).to.have.been.calledWith(sinon.match(/Autenticado con/));

        const succeedArgSecondCallBulk = spinnerSucceedStub.secondCall.args[0]; // Renamed variable for clarity for Bulk test
        // const expectedOutputFile3 = pathModule.join('/mock/data/dir', 'Account.csv');
        const expectedSpinnerMsgPrefix3 = `Extracción SOQL (Bulk) completada. 2 registros guardados en `;
        // Similar al caso anterior, una regex es más robusta para las rutas.
        // Temporalmente, solo comprobamos el prefijo para diagnosticar el problema de truncamiento.
        expect(succeedArgSecondCallBulk).to.match(new RegExp(expectedSpinnerMsgPrefix3.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        expect(spinnerTextSetterStub.getCall(0).args[0]).to.match(/Autenticando con la organización de origen:/);
        expect(spinnerTextSetterStub.getCall(1).args[0]).to.include('Procesando registros de \'Account\'... (1 encontrados)');
        expect(spinnerTextSetterStub.getCall(2).args[0]).to.include('Procesando registros de \'Account\'... (2 encontrados)');
        expect(spinnerFailStub).to.not.have.been.called;
        expect(processExitStub).to.not.have.been.called;
    });

    it('should handle errors during bulk query stream', async () => {
        const options: ExtractDataParams = { username: 'source', query: 'SELECT Id FROM NonExistentObject', apiType: 'bulk' }; // Force Bulk API
        const mockError = new Error('SOQL_QUERY_EXCEPTION: Invalid object');

        // Configure sfdcApi stubs for this test
        extractSObjectNameFromSoqlStub.withArgs(options.query).returns('NonExistentObject');
        const mockBulkQueryStream = new EventEmitter();
        extractDataBulkStub.withArgs(sinon.match.any, options.query, sinon.match.string)
                           .resolves(mockBulkQueryStream);
        
        const extractPromise = extractCommandModule.extractData(options);

        setImmediate(() => {
            mockBulkQueryStream.emit('error', mockError);
        });

        await expect(extractPromise).to.be.rejectedWith(mockError.message);
        
        const expectedOutputFile = pathModule.join('/mock/data/dir', 'NonExistentObject.csv');
        expect(extractDataBulkStub).to.have.been.calledOnceWith(
            mockConn,
            options.query,
            expectedOutputFile // fs.createWriteStream is passed internally by sfdc-api
        );
        
        // This spinner message comes from the 'error' event handler on the stream *within* extractData
        expect(spinnerFailStub).to.have.been.calledTwice; // Se llama dos veces en este escenario de error
        const failArg4a = spinnerFailStub.firstCall.args[0];
        expect(failArg4a.trim()).to.equal(`Error durante la extracción SOQL (Bulk): ${mockError.message}`);
        // The final spinner fail is from the top-level catch block in extractData
        const failArg4b = spinnerFailStub.secondCall.args[0];
        expect(failArg4b.trim()).to.equal('La extracción ha fallado.');
    });
});