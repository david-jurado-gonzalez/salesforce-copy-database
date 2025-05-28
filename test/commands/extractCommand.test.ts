import { expect, use } from 'chai';
import * as sinon from 'sinon';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import { extractCommand } from '../../src/commands/extractCommand.js';
import { logger } from '../../src/core/logger.js';
import * as auth from '../../src/core/auth.js';
import * as fileManager from '../../src/core/fileManager.js';
import { Connection } from 'jsforce';
import * as ora from 'ora';
import * as fs from 'fs';
import * as path from 'path';
import * as csvStringify from 'csv-stringify';
import { CommandOptions, AppConfig } from '../../src/core/typeDefs.js';
import { EventEmitter } from 'events';

use(sinonChai);
use(chaiAsPromised);

describe('extractCommand', () => {
    let sandbox: sinon.SinonSandbox;
    let loggerInfoStub: sinon.SinonStub;
    let loggerErrorStub: sinon.SinonStub;
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
    const mockConn = sinon.createStubInstance(Connection);

    beforeEach(() => {
        sandbox = sinon.createSandbox();
        const mockSpinner = {
            start: sandbox.stub(),
            succeed: sandbox.stub(),
            fail: sandbox.stub(),
            text: '',
        };
        loggerInfoStub = sandbox.stub(logger, 'info');
        loggerErrorStub = sandbox.stub(logger, 'error');

        spinnerStartStub = sandbox.stub().returns(mockSpinner);
        spinnerSucceedStub = mockSpinner.succeed;
        spinnerFailStub = mockSpinner.fail;
        spinnerTextSetterStub = sandbox.stub(mockSpinner, 'text').set(() => {}); // Stub the setter for 'text'
        sandbox.stub(ora, 'default').returns(spinnerStartStub());

        getSalesforceConnectionStub = sandbox.stub(auth, 'getSalesforceConnection').resolves(mockConn);
        loadConfigStub = sandbox.stub(fileManager, 'loadConfig').resolves(mockConfig);
        getOrgDataDirStub = sandbox.stub(fileManager, 'getOrgDataDir').returns('/mock/data/dir');
        ensureDirStub = sandbox.stub(fileManager, 'ensureDir').resolves();

        connBulkQueryStub = sandbox.stub(mockConn.bulk, 'query');
        fsCreateWriteStreamStub = sandbox.stub(fs, 'createWriteStream').returns(new EventEmitter() as any); // Mock a writable stream
        csvStringifyStub = sandbox.stub(csvStringify, 'stringify').returns(new EventEmitter() as any); // Mock a transform stream
        processExitStub = sandbox.stub(process, 'exit');
    });

    afterEach(() => {
        sandbox.restore();
    });

    it('should throw error if source alias is not in config', async () => {
        const options: CommandOptions = { source: 'nonExistentOrg', query: 'SELECT Id FROM Account', config: 'config.json' };
        loadConfigStub.resolves({ orgs: {} }); // No orgs defined
        await expect(extractCommand(options)).to.be.rejectedWith(
            `El alias de origen 'nonExistentOrg' no está definido en el archivo de configuración.`
        );
        expect(loggerErrorStub).to.have.been.calledOnce;
        expect(spinnerFailStub).to.have.been.calledOnce;
        expect(processExitStub).to.have.been.calledWith(1);
    });

    it('should throw error if --query option is missing', async () => {
        const options: CommandOptions = { source: 'source', config: 'config.json' };
        await expect(extractCommand(options as any)).to.be.rejectedWith(
            "La opción '--query' es obligatoria para la extracción."
        );
        expect(loggerErrorStub).to.have.been.calledOnce;
        expect(spinnerFailStub).to.have.been.calledOnce;
        expect(processExitStub).to.have.been.calledWith(1);
    });

    it('should throw error if SOQL query does not contain FROM clause', async () => {
        const options: CommandOptions = { source: 'source', query: 'SELECT Id', config: 'config.json' };
        await expect(extractCommand(options)).to.be.rejectedWith(
            "No se pudo determinar el objeto principal de la consulta SOQL."
        );
        expect(loggerErrorStub).to.have.been.calledOnce;
        expect(spinnerFailStub).to.have.been.calledOnce;
        expect(processExitStub).to.have.been.calledWith(1);
    });

    it('should successfully extract data and save to CSV', async () => {
        const options: CommandOptions = { source: 'source', query: 'SELECT Id, Name FROM Account', config: 'config.json' };
        const mockRecords = [{ Id: '001', Name: 'Test1' }, { Id: '002', Name: 'Test2' }];
        
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

        const extractPromise = extractCommand(options);

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
        expect(fsCreateWriteStreamStub).to.have.been.calledOnceWith(path.join('/mock/data/dir', 'Account.csv'));
        
        expect(spinnerStartStub).to.have.been.calledWith('Cargando configuración...');
        expect(spinnerSucceedStub).to.have.been.calledWith(sinon.match(/Extracción completada\. 2 registros guardados/));
        expect(spinnerTextSetterStub.getCall(0).args[0]).to.include('Procesando registros de \'Account\'... (1 encontrados)');
        expect(spinnerTextSetterStub.getCall(1).args[0]).to.include('Procesando registros de \'Account\'... (2 encontrados)');
        expect(loggerErrorStub).to.not.have.been.called;
        expect(processExitStub).to.not.have.been.called;
    });

    it('should handle errors during bulk query stream', async () => {
        const options: CommandOptions = { source: 'source', query: 'SELECT Id FROM NonExistentObject', config: 'config.json' };
        const mockBulkQueryStream = new EventEmitter();
        (mockBulkQueryStream as any).pipe = sandbox.stub().returnsThis();
        connBulkQueryStub.resolves({ stream: () => mockBulkQueryStream });

        const extractPromise = extractCommand(options);

        const error = new Error('SOQL_QUERY_EXCEPTION: Invalid object');
        mockBulkQueryStream.emit('error', error);

        await extractPromise; // Wait for the promise to settle

        expect(spinnerFailStub).to.have.been.calledWith(`Error durante la extracción: ${error.message}`);
        expect(loggerErrorStub).to.have.been.calledWith(error.message);
        expect(processExitStub).to.have.been.calledWith(1);
    });
});