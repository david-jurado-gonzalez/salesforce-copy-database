import { jest } from '@jest/globals';
import { expect, use } from 'chai';
import * as sinon from 'sinon';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import { Connection } from 'jsforce';
import { sfdcApi } from '../../src/core/sfdc-api.js';
import { SObjectDescribe } from '../../src/core/typeDefs.js';
import { Logger } from '../../src/core/logger.js';

// Mock Logger
const mockLoggerInstance = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  setLogLevel: jest.fn(),
  getLogLevel: jest.fn().mockReturnValue('info'),
} as unknown as Logger;

jest.mock('../../src/core/logger.js', () => {
  return {
    __esModule: true,
    Logger: jest.fn().mockImplementation(() => {
      return mockLoggerInstance;
    })
  };
});

use(sinonChai);
use(chaiAsPromised);

describe('SFDC API Functions', () => {
    let sandbox: sinon.SinonSandbox;
    let connStub: sinon.SinonStubbedInstance<Connection>;

    beforeEach(() => {
        sandbox = sinon.createSandbox();
        connStub = sandbox.createStubInstance(Connection);
    });

    afterEach(() => {
        sandbox.restore();
    });

    describe('describeSObject', () => {
        it('should return the SObject description', async () => {
            const objectName = 'Account';
            const mockDescribe: SObjectDescribe = {
                name: 'Account',
                label: 'Account',
                labelPlural: 'Accounts', // Añadido
                keyPrefix: '001', // Añadido
                feedEnabled: false, // Añadido
                custom: false,
                queryable: true, // Añadido
                retrieveable: true,
                fields: [{
                    name: 'Name',
                    type: 'string',
                    label: 'Name',
                    custom: false,
                    updateable: true,
                    createable: true,
                    nillable: false,
                    queryable: true, // Añadido
                    relationshipName: null,
                    referenceTo: null
                }]
            };
            
            // Stub the sobject method to return an object with a describe method
            const sobjectStub = {
                describe: sandbox.stub().resolves(mockDescribe)
            };
            (connStub.sobject as sinon.SinonStub).withArgs(objectName).returns(sobjectStub);

            const result = await sfdcApi.describeSObject(connStub, objectName);
            expect(result).to.deep.equal(mockDescribe);
            expect(connStub.sobject).to.have.been.calledWith(objectName);
            expect(sobjectStub.describe).to.have.been.calledOnce;
        });

        it('should throw an error if describe fails', async () => {
            const objectName = 'NonExistentObject';
            const error = new Error('Object not found');
            
            const sobjectStub = {
                describe: sandbox.stub().rejects(error)
            };
            (connStub.sobject as sinon.SinonStub).withArgs(objectName).returns(sobjectStub);

            await expect(sfdcApi.describeSObject(connStub, objectName)).to.be.rejectedWith(error);
            expect(connStub.sobject).to.have.been.calledWith(objectName);
            expect(sobjectStub.describe).to.have.been.calledOnce;
        });
    });

    describe('listAllSObjects', () => {
        it('should return a list of queryable SObject names', async () => {
            const mockDescribeGlobalResult = {
                sobjects: [
                    { name: 'Account', queryable: true },
                    { name: 'Contact', queryable: true },
                    { name: 'Task', queryable: false },
                    { name: 'CustomObject__c', queryable: true }
                ]
            };
            (connStub.describeGlobal as sinon.SinonStub).resolves(mockDescribeGlobalResult);

            const result = await sfdcApi.listAllSObjects(connStub);
            expect(result).to.deep.equal(['Account', 'Contact', 'CustomObject__c']);
            expect(connStub.describeGlobal).to.have.been.calledOnce;
        });

        it('should return an empty array if no SObjects are queryable', async () => {
            const mockDescribeGlobalResult = {
                sobjects: [
                    { name: 'Task', queryable: false },
                    { name: 'Event', queryable: false }
                ]
            };
            (connStub.describeGlobal as sinon.SinonStub).resolves(mockDescribeGlobalResult);

            const result = await sfdcApi.listAllSObjects(connStub);
            expect(result).to.deep.equal([]);
            expect(connStub.describeGlobal).to.have.been.calledOnce;
        });

        it('should throw an error if describeGlobal fails', async () => {
            const error = new Error('API_ERROR');
            (connStub.describeGlobal as sinon.SinonStub).rejects(error);

            await expect(sfdcApi.listAllSObjects(connStub)).to.be.rejectedWith(error);
            expect(connStub.describeGlobal).to.have.been.calledOnce;
        });
    });
});
