import { expect, use } from 'chai';
import * as sinon from 'sinon';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import { Connection } from 'jsforce';
import { describeSObject, listAllSObjects } from '../../src/core/sfdc-api.js';
import { SObjectDescribe } from '../../src/core/typeDefs.js';

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
                    relationshipName: null,
                    referenceTo: null
                }]
            };
            
            // Stub the sobject method to return an object with a describe method
            const sobjectStub = {
                describe: sandbox.stub().resolves(mockDescribe)
            };
            (connStub.sobject as sinon.SinonStub).withArgs(objectName).returns(sobjectStub);

            const result = await describeSObject(connStub, objectName);
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

            await expect(describeSObject(connStub, objectName)).to.be.rejectedWith(error);
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

            const result = await listAllSObjects(connStub);
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

            const result = await listAllSObjects(connStub);
            expect(result).to.deep.equal([]);
            expect(connStub.describeGlobal).to.have.been.calledOnce;
        });

        it('should throw an error if describeGlobal fails', async () => {
            const error = new Error('API_ERROR');
            (connStub.describeGlobal as sinon.SinonStub).rejects(error);

            await expect(listAllSObjects(connStub)).to.be.rejectedWith(error);
            expect(connStub.describeGlobal).to.have.been.calledOnce;
        });
    });
});
