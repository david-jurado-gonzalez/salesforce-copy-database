import { expect, use } from 'chai';
import * as sinon from 'sinon';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
// import rewiremock from 'rewiremock'; // Add this import

// Original imports - these will be handled by rewiremock or imported dynamically
// import { extractCommand } from '../../src/commands/extractCommand.js';
// import { logger } from '../../src/core/logger.js';
// import * as auth from '../../src/core/auth.js';
// import * as fileManager from '../../src/core/fileManager.js';
// import { Connection } from 'jsforce';
// import * as ora from 'ora';
// import * as fs from 'fs';
// import * as path from 'path';
// import * as csvStringify from 'csv-stringify';
import { /*CommandOptions,*/ AppConfig } from '../../src/core/typeDefs.js';
import { ExtractDataParams } from '../../src/commands/extractCommand.js'; // Import type from .ts, but use .js extension
import { EventEmitter } from 'events';

use(sinonChai);
use(chaiAsPromised);

describe('extractCommand', () => {
    let sandbox: sinon.SinonSandbox;
    // let loggerInfoStub: sinon.SinonStub;
    // let loggerErrorStub: sinon.SinonStub;
    let spinnerStartStub: sinon.SinonStub;
    let spinnerSucceedStub: sinon.SinonStub;
    let spinnerFailStub: sinon.SinonStub;
    let spinnerTextSetterStub: sinon.SinonStub;
    let getSalesforceConnectionStub: sinon.SinonStub;
    let loadConfigStub: sinon.SinonStub;
    let getOrgDataDirStub: sinon.SinonStub;
    let ensureDirStub: sinon.SinonStub;
    let connBulkQueryStub: sinon.SinonStub;
    let fsCreateWriteStreamStub: sinon.SinonStub;
    let csvStringifyStub: sinon.SinonStub;
    let processExitStub: sinon.SinonStub;

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
    // let csvStringifyModule: typeof import('csv-stringify');

    // Use a placeholder for Connection type until jsforceModule is loaded
    // let Connection: any;

    const mockConn: any = { bulk: { query: sinon.stub() }, query: sinon.stub(), describe: sinon.stub() }; // More specific mock

    beforeEach(async () => { // Make beforeEach async
        sandbox = sinon.createSandbox();
        
        // Enable rewiremock
        // rewiremock.enable();

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
        const mockSpinner = {
            start: sandbox.stub(),
            succeed: sandbox.stub(),
            fail: sandbox.stub(),
            text: '',
        };
        // rewiremock(() => import('ora')).with({
        //     default: sandbox.stub().returns(mockSpinner)
        // });
        spinnerStartStub = mockSpinner.start;
        spinnerSucceedStub = mockSpinner.succeed;
        spinnerFailStub = mockSpinner.fail;
        spinnerTextSetterStub = sandbox.stub(mockSpinner, 'text').set(() => {}); // Stub the setter for 'text'

        // Configure mocks for auth
        getSalesforceConnectionStub = sandbox.stub().resolves(mockConn);
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
        loadConfigStub = sandbox.stub().resolves(mockConfig);
        getOrgDataDirStub = sandbox.stub().returns('/mock/data/dir');
        ensureDirStub = sandbox.stub().resolves();
        // rewiremock(() => import('../../src/core/fileManager.js')).with({
        //     loadConfig: loadConfigStub,
        //     getOrgDataDir: getOrgDataDirStub,
        //     ensureDir: ensureDirStub
        // });

        // Configure mocks for fs
        fsCreateWriteStreamStub = sandbox.stub().returns(new EventEmitter() as any); // Mock a writable stream
        // rewiremock(() => import('fs')).with({
        //     createWriteStream: fsCreateWriteStreamStub
        // });

        // Configure mocks for csv-stringify
        csvStringifyStub = sandbox.stub().returns(new EventEmitter() as any); // Mock a transform stream
        // rewiremock(() => import('csv-stringify')).with({
        //     stringify: csvStringifyStub
        // });

        // Configure mocks for process.exit
        processExitStub = sandbox.stub(process, 'exit');

        // Dynamically import the module under test AFTER mocks are configured
        const tempExtractCommandModule = await import('../../src/commands/extractCommand.js');
        extractCommandModule = tempExtractCommandModule;
        // loggerModule = await rewiremock.module(() => import('../../src/core/logger.js'));
        // authModule = await rewiremock.module(() => import('../../src/core/auth.js'));
        // fileManagerModule = await rewiremock.module(() => import('../../src/core/fileManager.js'));
        // jsforceModule = await rewiremock.module(() => import('jsforce'));
        // oraModule = await rewiremock.module(() => import('ora'));
        // fsModule = await rewiremock.module(() => import('fs'));
        pathModule = await import('path');
        // csvStringifyModule = await rewiremock.module(() => import('csv-stringify'));

        // Now that jsforceModule is loaded, assign Connection
        // Connection = jsforceModule.default.Connection || jsforceModule.Connection;

        // Stub methods on the mock connections
        connBulkQueryStub = mockConn.bulk.query; // Assign the stub directly
    });

    afterEach(() => {
        sandbox.restore();
        // rewiremock.disable(); // Disable rewiremock
    });

    it('should attempt to use default org if source alias is not in config', async () => {
        const options: ExtractDataParams = { username: 'nonExistentOrg', query: 'SELECT Id FROM Account' };
        loadConfigStub.resolves({ orgs: {} }); // No orgs defined

        const mockBulkQueryStream = new EventEmitter();
        (mockBulkQueryStream as any).pipe = sandbox.stub().returnsThis();
        connBulkQueryStub.resolves({ stream: () => mockBulkQueryStream });

        const extractPromise = extractCommandModule.extractData(options);

        // Simulate successful extraction
        mockBulkQueryStream.emit('data', { Id: '001', Name: 'Test1' });
        mockBulkQueryStream.emit('end');

        await extractPromise;

        expect(getSalesforceConnectionStub).to.have.been.calledOnceWith('nonExistentOrg', { orgs: {} });
        expect(spinnerFailStub).to.not.have.been.called;
        expect(processExitStub).to.not.have.been.called;
    });

    it('should throw error if --query option is missing', async () => {
        const options: ExtractDataParams = { username: 'source', query: '' }; // Query is required, add empty for now, will be checked by test
        await expect(extractCommandModule.extractData(options as any)).to.be.rejectedWith(
            "La opción '--query' es obligatoria para la extracción."
        );
        // expect(loggerErrorStub).to.have.been.calledOnce;
        expect(spinnerFailStub).to.have.been.calledOnce;
        expect(processExitStub).to.have.been.calledWith(1);
    });

    it('should throw error if SOQL query does not contain FROM clause', async () => {
        const options: ExtractDataParams = { username: 'source', query: 'SELECT Id' };
        await expect(extractCommandModule.extractData(options)).to.be.rejectedWith(
            "No se pudo determinar el objeto principal de la consulta SOQL."
        );
        // expect(loggerErrorStub).to.have.been.calledOnce;
        expect(spinnerFailStub).to.have.been.calledOnce;
        expect(processExitStub).to.have.been.calledWith(1);
    });

    it('should successfully extract data and save to CSV', async () => {
        const options: ExtractDataParams = { username: 'source', query: 'SELECT Id, Name FROM Account' };
        // const mockRecords = [{ Id: '001', Name: 'Test1' }, { Id: '002', Name: 'Test2' }];
        
        const mockBulkQueryStream = new EventEmitter();
        (mockBulkQueryStream as any).pipe = sandbox.stub().returnsThis(); // Allow chaining .pipe()
        connBulkQueryStub.resolves({ stream: () => mockBulkQueryStream });

        // Simulate data flow
        const writeStream = new EventEmitter();
        (writeStream as any).write = sandbox.stub();
        (writeStream as any).end = sandbox.stub();
        fsCreateWriteStreamStub.returns(writeStream as any);

        const stringifyStream = new EventEmitter();
        (stringifyStream as any).pipe = sandbox.stub().returns(writeStream); // Pipe to writeStream
        csvStringifyStub.returns(stringifyStream as any);

        const extractPromise = extractCommandModule.extractData(options); // Changed

        // Simulate records coming through the stream
        mockBulkQueryStream.emit('data', { Id: '001', Name: 'Test1' });
        mockBulkQueryStream.emit('data', { Id: '002', Name: 'Test2' });
        mockBulkQueryStream.emit('end');

        await extractPromise;
        
        expect(loadConfigStub).to.have.been.calledOnceWith('config.json');
        expect(getSalesforceConnectionStub).to.have.been.calledOnceWith('source', mockConfig);
        expect(getOrgDataDirStub).to.have.been.calledOnceWith('source');
        expect(ensureDirStub).to.have.been.calledOnceWith('/mock/data/dir');
        expect(connBulkQueryStub).to.have.been.calledOnceWith(options.query);
        expect(csvStringifyStub).to.have.been.calledOnceWith({ header: true });
        expect(fsCreateWriteStreamStub).to.have.been.calledOnceWith(pathModule.join('/mock/data/dir', 'Account.csv')); // Corrected path.join usage
        
        expect(spinnerStartStub).to.have.been.calledWith('Cargando configuración...');
        expect(spinnerSucceedStub).to.have.been.calledWith(sinon.match(/Extracción completada\. 2 registros guardados/));
        expect(spinnerTextSetterStub.getCall(0).args[0]).to.include('Procesando registros de \'Account\'... (1 encontrados)');
        expect(spinnerTextSetterStub.getCall(1).args[0]).to.include('Procesando registros de \'Account\'... (2 encontrados)');
        // expect(loggerErrorStub).to.not.have.been.called;
        expect(processExitStub).to.not.have.been.called;
    });

    it('should handle errors during bulk query stream', async () => {
        const options: ExtractDataParams = { username: 'source', query: 'SELECT Id FROM NonExistentObject' };
        const mockBulkQueryStream = new EventEmitter();
        (mockBulkQueryStream as any).pipe = sandbox.stub().returnsThis();
        connBulkQueryStub.resolves({ stream: () => mockBulkQueryStream });

        const extractPromise = extractCommandModule.extractData(options); // Changed

        const error = new Error('SOQL_QUERY_EXCEPTION: Invalid object');
        mockBulkQueryStream.emit('error', error);

        await extractPromise; // Wait for the promise to settle

        expect(spinnerFailStub).to.have.been.calledWith(`Error durante la extracción: ${error.message}`);
        // expect(loggerErrorStub).to.have.been.calledWith(error.message);
        expect(processExitStub).to.have.been.calledWith(1);
    });
});