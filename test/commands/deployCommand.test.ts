import { expect, use } from 'chai';
import * as sinon from 'sinon';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import { deployCommand } from '../../src/commands/deployCommand.js';
import { logger } from '../../src/core/logger.js';
import * as auth from '../../src/core/auth.js';
import * as fileManager from '../../src/core/fileManager.js';
import * as sfdcApi from '../../src/core/sfdc-api.js';
import { DependencyGraph } from '../../src/commands/dependencyGraph.js';
import { Connection } from 'jsforce';
import * as ora from 'ora';
import * as inquirer from 'inquirer';
import * as fs from 'fs';
import * as csvParse from 'csv-parse';
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
    let dependencyGraphGetTwoPassObjectsStub: sinon.SinonStub;
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

    const mockSourceConn = sinon.createStubInstance(Connection);
    const mockTargetConn = sinon.createStubInstance(Connection);

    beforeEach(() => {
        sandbox = sinon.createSandbox();
        loggerInfoStub = sandbox.stub(logger, 'info');
        loggerErrorStub = sandbox.stub(logger, 'error');
        loggerWarnStub = sandbox.stub(logger, 'warn');

        const mockSpinner = {
            start: sandbox.stub(),
            stop: sandbox.stub(),
            succeed: sandbox.stub(),
            fail: sandbox.stub(),
            info: sandbox.stub(),
            text: '' // Add text property for assignment
        };
        sandbox.stub(ora, 'default').returns(mockSpinner as any);
        spinnerStartStub = mockSpinner.start;
        spinnerStopStub = mockSpinner.stop;
        spinnerSucceedStub = mockSpinner.succeed;
        spinnerFailStub = mockSpinner.fail;
        spinnerInfoStub = mockSpinner.info;

        inquirerPromptStub = sandbox.stub(inquirer, 'prompt');
        getSalesforceConnectionStub = sandbox.stub(auth, 'getSalesforceConnection');
        loadConfigStub = sandbox.stub(fileManager, 'loadConfig').resolves(mockConfig);
        ensureDirStub = sandbox.stub(fileManager, 'ensureDir').resolves();
        getObjectListFromDataDirStub = sandbox.stub(fileManager, 'getObjectListFromDataDir').resolves(['Account', 'Contact']);
        describeSObjectStub = sandbox.stub(sfdcApi, 'describeSObject');

        dependencyGraphAddNodeStub = sandbox.stub(DependencyGraph.prototype, 'addNode');
        dependencyGraphBuildEdgesStub = sandbox.stub(DependencyGraph.prototype, 'buildEdges');
        dependencyGraphTopologicalSortStub = sandbox.stub(DependencyGraph.prototype, 'topologicalSort');
        dependencyGraphGetTwoPassObjectsStub = sandbox.stub(DependencyGraph.prototype, 'getTwoPassObjects');

        fsExistsSyncStub = sandbox.stub(fs, 'existsSync');
        fsCreateReadStreamStub = sandbox.stub(fs, 'createReadStream');
        csvParseStub = sandbox.stub(csvParse, 'parse').returns({
            [Symbol.asyncIterator]: async function* () { } // Default empty async iterator
        } as any);
        readIdMapStub = sandbox.stub(fileManager, 'readIdMap').resolves({});
        writeIdMapStub = sandbox.stub(fileManager, 'writeIdMap').resolves();
        writeErrorLogStub = sandbox.stub(fileManager, 'writeErrorLog').resolves();
        targetConnBulkLoadStub = sandbox.stub(mockTargetConn.bulk, 'load');
        processExitStub = sandbox.stub(process, 'exit');

        getSalesforceConnectionStub.withArgs('source', mockConfig).resolves(mockSourceConn);
        getSalesforceConnectionStub.withArgs('target', mockConfig).resolves(mockTargetConn);

        // Default mock for describeSObject
        describeSObjectStub.callsFake((conn: Connection, objectName: string) => {
            const mockDescribe: SObjectDescribe = {
                name: objectName,
                label: objectName,
                custom: false,
                fields: [
                    { name: 'Id', label: 'Id', type: 'id', custom: false, updateable: false, createable: false, nillable: false, relationshipName: null, referenceTo: null },
                    { name: 'Name', label: 'Name', type: 'string', custom: false, updateable: true, createable: true, nillable: true, relationshipName: null, referenceTo: null },
                ]
            };
            if (objectName === 'Account') {
                mockDescribe.fields.push({ name: 'OwnerId', label: 'Owner ID', type: 'reference', custom: false, updateable: true, createable: true, nillable: true, relationshipName: 'Owner', referenceTo: ['User'] });
            } else if (objectName === 'Contact') {
                mockDescribe.fields.push({ name: 'AccountId', label: 'Account ID', type: 'reference', custom: false, updateable: true, createable: true, nillable: true, relationshipName: 'Account', referenceTo: ['Account'] });
            }
            return Promise.resolve(mockDescribe);
        });

        dependencyGraphTopologicalSortStub.returns({ order: ['Account', 'Contact'], cycles: new Set() });
        dependencyGraphGetTwoPassObjectsStub.returns(new Set());
    });

    afterEach(() => {
        sandbox.restore();
    });

    it('should throw error if --target option is missing', async () => {
        const options = { source: 'source', config: 'config.json' };
        await expect(deployCommand(options as any)).to.be.rejectedWith("La opción '--target' es obligatoria para el despliegue.");
        expect(loggerErrorStub).to.have.been.calledOnce;
        expect(processExitStub).to.have.been.calledWith(1);
    });

    it('should cancel deployment if user does not confirm', async () => {
        inquirerPromptStub.resolves({ confirm: false });
        const options = { source: 'source', target: 'target', config: 'config.json' };
        await deployCommand(options);
        expect(loggerWarnStub).to.have.been.calledWith('Despliegue cancelado por el usuario.');
        expect(processExitStub).to.have.been.calledWith(0);
    });

    it('should proceed without confirmation if --force flag is used', async () => {
        inquirerPromptStub.resolves({ confirm: false }); // This should be ignored
        const options = { source: 'source', target: 'target', config: 'config.json', force: true };
        await deployCommand(options);
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
        003A000000EEEEE,Test Contact 1,001A000000AAAAA`;
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

        const options = { source: 'source', target: 'target', config: 'config.json' };
        await deployCommand(options);

        expect(loadConfigStub).to.have.been.calledOnceWith('config.json');
        expect(ensureDirStub).to.have.been.calledTwice; // For mappings and errors
        expect(getSalesforceConnectionStub).to.have.been.calledTwice;
        expect(getObjectListFromDataDirStub).to.have.been.calledOnceWith('source');
        expect(describeSObjectStub).to.have.been.calledTwice; // For Account and Contact
        expect(dependencyGraphTopologicalSortStub).to.have.been.calledOnce;
        expect(dependencyGraphGetTwoPassObjectsStub).to.have.been.calledOnce;
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
        dependencyGraphGetTwoPassObjectsStub.returns(new Set(['Contact']));

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

        const options = { source: 'source', target: 'target', config: 'config.json' };
        await deployCommand(options);

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

        const options = { source: 'source', target: 'target', config: 'config.json' };
        await deployCommand(options);

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

        const options = { source: 'source', target: 'target', config: 'config.json' };
        await deployCommand(options);

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

        const options = { source: 'source', target: 'target', config: 'config.json' };
        await deployCommand(options);

        expect(spinnerSucceedStub).to.have.been.calledWith(sinon.match(/Account: No hay registros para procesar/));
        expect(spinnerSucceedStub).to.have.been.calledWith(sinon.match(/Contact: No hay registros para procesar/));
        expect(targetConnBulkLoadStub).to.not.have.been.called;
    });
});