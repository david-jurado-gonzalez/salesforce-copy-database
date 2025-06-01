import { expect, use } from 'chai';
import * as sinon from 'sinon';
import sinonChai from 'sinon-chai';
import { DependencyGraph } from '../../src/commands/dependencyGraph.js';
import { Logger } from '../../src/core/logger.js';
import { SObjectDescribe } from '../../src/core/typeDefs.js';

use(sinonChai);

describe('DependencyGraph', () => {
    let sandbox: sinon.SinonSandbox;
    let loggerDebugStub: sinon.SinonStub;
    let loggerWarnStub: sinon.SinonStub;
    let graph: DependencyGraph;
    let testLoggerInstance: Logger; // Renamed for clarity

    beforeEach(() => {
        sandbox = sinon.createSandbox();
        // Instantiate a logger for test purposes. DependencyGraph creates its own internal logger.
        testLoggerInstance = new Logger('TestDependencyGraph');
        // These stubs are on testLoggerInstance. They will NOT capture logs from DependencyGraph's internal logger.
        loggerDebugStub = sandbox.stub(testLoggerInstance, 'debug');
        loggerWarnStub = sandbox.stub(testLoggerInstance, 'warn');
        graph = new DependencyGraph(testLoggerInstance); // Pass the stubbed logger instance
    });

    afterEach(() => {
        sandbox.restore();
    });

    describe('addNode', () => {
        it('should add a new node to the graph', () => {
            const describe: SObjectDescribe = {
                name: 'Account',
                label: 'Account',
                labelPlural: 'Accounts',
                keyPrefix: '001',
                feedEnabled: false,
                custom: false,
                queryable: true,
                retrieveable: true,
                fields: []
            };
            graph.addNode('Account', describe);
            // @ts-ignore - Accessing private property for testing
            expect(graph.nodes.has('Account')).to.be.true;
            // @ts-ignore
            expect(graph.adj.has('Account')).to.be.true;
            expect(loggerDebugStub).to.have.been.calledWith('[Graph] Nodo añadido: Account');
        });

        it('should not add a node if it already exists', () => {
            const describe: SObjectDescribe = {
                name: 'Account',
                label: 'Account',
                labelPlural: 'Accounts',
                keyPrefix: '001',
                feedEnabled: false,
                custom: false,
                retrieveable: true,
                queryable: true,
                fields: []
            };
            graph.addNode('Account', describe);
            // loggerDebugStub should have been called once with "Nodo añadido"
            expect(loggerDebugStub).to.have.been.calledWith('[Graph] Nodo añadido: Account');
            
            graph.addNode('Account', describe); // Add again
            
            // Now loggerDebugStub should have been called a second time with "Nodo actualizado"
            expect(loggerDebugStub).to.have.been.calledWith('[Graph] Nodo actualizado: Account');
            expect(loggerDebugStub).to.have.been.calledTwice; // Total calls
        });
    });

    describe('buildEdges', () => {
        const accountDescribe: SObjectDescribe = {
            name: 'Account',
            label: 'Account',
            labelPlural: 'Accounts',
            keyPrefix: '001',
            feedEnabled: false,
            retrieveable: true,
            custom: false,
            queryable: true,
            fields: [
                {
                    name: 'OwnerId',
                    label: 'Owner ID',
                    type: 'reference',
                    updateable: true,
                    createable: true,
                    nillable: true,
                    queryable: true,
                    relationshipName: 'Owner',
                    referenceTo: ['User'],
                    custom: false
                },
            ]
        };
        const contactDescribe: SObjectDescribe = {
            name: 'Contact',
            label: 'Contact',
            labelPlural: 'Contacts',
            keyPrefix: '003',
            feedEnabled: false,
            retrieveable: true,
            custom: false,
            queryable: true,
            fields: [
                {
                    name: 'AccountId',
                    label: 'Account ID',
                    type: 'reference',
                    updateable: true,
                    createable: true,
                    nillable: true,
                    queryable: true,
                    relationshipName: 'Account',
                    referenceTo: ['Account'],
                    custom: false
                },
                {
                    name: 'OwnerId',
                    label: 'Owner ID',
                    type: 'reference',
                    updateable: true,
                    createable: true,
                    nillable: true,
                    queryable: true,
                    relationshipName: 'Owner',
                    referenceTo: ['User'],
                    custom: false
                },
            ]
        };
        const userDescribe: SObjectDescribe = {
            name: 'User',
            label: 'User',
            labelPlural: 'Users',
            keyPrefix: '005',
            feedEnabled: false,
            retrieveable: true,
            custom: false,
            queryable: true,
            fields: []
        };

        beforeEach(() => {
            graph.addNode('Account', accountDescribe);
            graph.addNode('Contact', contactDescribe);
            graph.addNode('User', userDescribe);
        });

        it('should build edges for dependencies within scope', () => {
            const objectsInScope = new Set(['Account', 'Contact', 'User']);
            graph.buildEdges('Contact', objectsInScope);
            // @ts-ignore
            expect(graph.adj.get('Contact')).to.include('Account');
            // @ts-ignore
            expect(graph.adj.get('Contact')).to.include('User');
            expect(loggerDebugStub).to.have.been.calledWith('[Graph] Arista creada: Contact -> Account');
            expect(loggerDebugStub).to.have.been.calledWith('[Graph] Arista creada: Contact -> User');
        });

        it('should not build edges for dependencies outside scope', () => {
            const objectsInScope = new Set(['Account', 'User']); // Contact is not in scope
            graph.buildEdges('Contact', objectsInScope);
            // @ts-ignore
            expect(graph.adj.get('Contact')).to.not.include('Account'); // Should not be called if Contact is not in scope
        });

        it('should handle polymorphic lookups correctly', () => {
            const taskDescribe: SObjectDescribe = {
                name: 'Task',
                label: 'Task',
                labelPlural: 'Tasks',
                keyPrefix: '00T',
                feedEnabled: false,
                retrieveable: true,
                custom: false,
                queryable: true,
                fields: [
                    {
                        name: 'WhatId',
                        label: 'What ID',
                        type: 'reference',
                        updateable: true,
                        createable: true,
                        nillable: true,
                        queryable: true,
                        relationshipName: 'What',
                        referenceTo: ['Account', 'Opportunity'],
                        custom: false
                    },
                ]
            };
            const opportunityDescribe: SObjectDescribe = {
                name: 'Opportunity',
                label: 'Opportunity',
                labelPlural: 'Opportunities',
                keyPrefix: '006',
                feedEnabled: false,
                retrieveable: true,
                custom: false,
                queryable: true,
                fields: []
            };
            graph.addNode('Task', taskDescribe);
            graph.addNode('Opportunity', opportunityDescribe);

            const objectsInScope = new Set(['Account', 'Opportunity', 'Task']);
            graph.buildEdges('Task', objectsInScope);
            // @ts-ignore
            expect(graph.adj.get('Task')).to.include('Account');
            // @ts-ignore
            expect(graph.adj.get('Task')).to.include('Opportunity');
        });
    });

    describe('topologicalSort', () => {
        const userDescribe: SObjectDescribe = {
            name: 'User',
            label: 'User',
            labelPlural: 'Users',
            keyPrefix: '005',
            feedEnabled: false,
            retrieveable: true,
            custom: false,
            queryable: true,
            fields: []
        };
        const accountDescribe: SObjectDescribe = {
            name: 'Account',
            label: 'Account',
            labelPlural: 'Accounts',
            keyPrefix: '001',
            feedEnabled: false,
            custom: false,
            retrieveable: true,
            queryable: true,
            fields: [
                {
                    name: 'OwnerId',
                    label: 'Owner ID',
                    type: 'reference',
                    updateable: true,
                    createable: true,
                    nillable: true,
                    queryable: true,
                    relationshipName: 'Owner',
                    referenceTo: ['User'],
                    custom: false
                },
            ]
        };
        const contactDescribe: SObjectDescribe = {
            name: 'Contact',
            label: 'Contact',
            labelPlural: 'Contacts',
            keyPrefix: '003',
            feedEnabled: false,
            custom: false,
            retrieveable: true,
            queryable: true,
            fields: [
                {
                    name: 'AccountId',
                    label: 'Account ID',
                    type: 'reference',
                    updateable: true,
                    createable: true,
                    nillable: true,
                    queryable: true,
                    relationshipName: 'Account',
                    referenceTo: ['Account'],
                    custom: false
                },
                {
                    name: 'OwnerId',
                    label: 'Owner ID',
                    type: 'reference',
                    updateable: true,
                    createable: true,
                    nillable: true,
                    queryable: true,
                    relationshipName: 'Owner',
                    referenceTo: ['User'],
                    custom: false
                },
            ]
        };
        const opportunityDescribe: SObjectDescribe = {
            name: 'Opportunity',
            label: 'Opportunity',
            labelPlural: 'Opportunities',
            keyPrefix: '006',
            feedEnabled: false,
            custom: false,
            retrieveable: true,
            queryable: true,
            fields: [
                {
                    name: 'AccountId',
                    label: 'Account ID',
                    type: 'reference',
                    updateable: true,
                    createable: true,
                    nillable: true,
                    queryable: true,
                    relationshipName: 'Account',
                    referenceTo: ['Account'],
                    custom: false
                },
            ]
        };

        beforeEach(() => {
            graph.addNode('User', userDescribe);
            graph.addNode('Account', accountDescribe);
            graph.addNode('Contact', contactDescribe);
            graph.addNode('Opportunity', opportunityDescribe);

            const allObjects = new Set(['User', 'Account', 'Contact', 'Opportunity']);
            graph.buildEdges('Account', allObjects);
            graph.buildEdges('Contact', allObjects);
            graph.buildEdges('Opportunity', allObjects);
        });

        it('should return a valid topological order for a DAG', () => {
            const { order, cycles } = graph.topologicalSort();
            expect(cycles).to.be.empty;
            expect(order).to.have.lengthOf(4);
            // User should come before Account and Contact
            expect(order.indexOf('User')).to.be.lessThan(order.indexOf('Account'));
            expect(order.indexOf('User')).to.be.lessThan(order.indexOf('Contact'));
            // Account should come before Contact and Opportunity
            expect(order.indexOf('Account')).to.be.lessThan(order.indexOf('Contact'));
            expect(order.indexOf('Account')).to.be.lessThan(order.indexOf('Opportunity'));
        });

        it('should detect and report cycles', () => {
            // Introduce a cycle: Account -> Contact -> Account
            const accountCycleDescribe: SObjectDescribe = {
                name: 'Account',
                label: 'Account',
                labelPlural: 'Accounts',
                keyPrefix: '001',
                feedEnabled: false,
                custom: false,
                retrieveable: true,
                queryable: true,
                fields: [
                    {
                        name: 'ContactId__c',
                        label: 'Contact',
                        type: 'reference',
                        updateable: true,
                        createable: true,
                        nillable: true,
                        queryable: true,
                        relationshipName: 'Contact',
                        referenceTo: ['Contact'],
                        custom: true
                    },
                ]
            };
            graph.addNode('Account', accountCycleDescribe); // Overwrite existing Account node
            // @ts-ignore
            graph.adj.get('Account').add('Contact'); // Manually add edge for cycle

            const { order: _order, cycles } = graph.topologicalSort();
            expect(cycles).to.not.be.empty;
            expect(cycles).to.include('Account');
            expect(cycles).to.include('Contact');
            expect(loggerWarnStub).to.have.been.calledWith(sinon.match(/\[Graph\] ¡Ciclo de dependencias detectado! Objetos involucrados: Account, Contact|\[Graph\] ¡Ciclo de dependencias detectado! Objetos involucrados: Contact, Account/)); // Order in set can vary
        });
    });

    describe('getTwoPassObjects', () => {
        const userDescribe: SObjectDescribe = {
            name: 'User',
            label: 'User',
            labelPlural: 'Users',
            keyPrefix: '005',
            feedEnabled: false,
            custom: false,
            queryable: true,
            retrieveable: true, // Añadido para corregir el error de compilación
            fields: []
        };
        const accountDescribe: SObjectDescribe = {
            name: 'Account',
            label: 'Account',
            labelPlural: 'Accounts',
            keyPrefix: '001',
            feedEnabled: false,
            custom: false,
            retrieveable: true,
            queryable: true,
            fields: [
                {
                    name: 'OwnerId',
                    label: 'Owner ID',
                    type: 'reference',
                    updateable: true,
                    createable: true,
                    nillable: false,
                    queryable: true,
                    relationshipName: 'Owner',
                    referenceTo: ['User'],
                    custom: false
                },
            ]
        };
        const contactDescribe: SObjectDescribe = {
            name: 'Contact',
            label: 'Contact',
            labelPlural: 'Contacts',
            keyPrefix: '003',
            feedEnabled: false,
            custom: false,
            retrieveable: true,
            queryable: true,
            fields: [
                {
                    name: 'AccountId',
                    label: 'Account ID',
                    type: 'reference',
                    updateable: true,
                    createable: true,
                    nillable: true,
                    queryable: true,
                    relationshipName: 'Account',
                    referenceTo: ['Account'],
                    custom: false
                },
                {
                    name: 'OwnerId',
                    label: 'Owner ID',
                    type: 'reference',
                    updateable: true,
                    createable: true,
                    nillable: false,
                    queryable: true,
                    relationshipName: 'Owner',
                    referenceTo: ['User'],
                    custom: false
                },
            ]
        };
        const opportunityDescribe: SObjectDescribe = {
            name: 'Opportunity',
            label: 'Opportunity',
            labelPlural: 'Opportunities',
            keyPrefix: '006',
            feedEnabled: false,
            custom: false,
            retrieveable: true,
            queryable: true,
            fields: [
                {
                    name: 'AccountId',
                    label: 'Account ID',
                    type: 'reference',
                    updateable: true,
                    createable: true,
                    nillable: false,
                    queryable: true,
                    relationshipName: 'Account',
                    referenceTo: ['Account'],
                    custom: false
                },
                {
                    name: 'PrimaryContactId__c',
                    label: 'Primary Contact',
                    type: 'reference',
                    updateable: true,
                    createable: true,
                    nillable: true,
                    queryable: true,
                    relationshipName: 'PrimaryContact',
                    referenceTo: ['Contact'],
                    custom: true
                },
            ]
        };

        beforeEach(() => {
            graph.addNode('User', userDescribe);
            graph.addNode('Account', accountDescribe);
            graph.addNode('Contact', contactDescribe);
            graph.addNode('Opportunity', opportunityDescribe);

            const allObjects = new Set(['User', 'Account', 'Contact', 'Opportunity']);
            graph.buildEdges('Account', allObjects);
            graph.buildEdges('Contact', allObjects);
            graph.buildEdges('Opportunity', allObjects);
        });

        it('should identify objects in cycles for two-pass', () => {
            // Simulate a cycle: Account -> Contact -> Account
            const accountCycleDescribe: SObjectDescribe = {
                name: 'Account',
                label: 'Account',
                labelPlural: 'Accounts',
                keyPrefix: '001',
                feedEnabled: false,
                custom: false,
                retrieveable: true,
                queryable: true,
                fields: [
                    {
                        name: 'ContactId__c',
                        label: 'Contact',
                        type: 'reference',
                        updateable: true,
                        createable: true,
                        nillable: true,
                        queryable: true,
                        relationshipName: 'Contact',
                        referenceTo: ['Contact'],
                        custom: true
                    },
                ]
            };
            graph.addNode('Account', accountCycleDescribe);
            // @ts-ignore
            graph.adj.get('Account').add('Contact');

            const deploymentOrder = ['User', 'Account', 'Contact', 'Opportunity']; // Example order
            const cycles = new Set(['Account', 'Contact']);
            const twoPass = graph.getTwoPassObjects(deploymentOrder, cycles);
            expect(twoPass).to.include('Account');
            expect(twoPass).to.include('Contact');
        });

        it('should identify objects with optional lookups to later objects for two-pass', () => {
            const campaignDescribe: SObjectDescribe = {
                name: 'Campaign', label: 'Campaign', labelPlural: 'Campaigns', keyPrefix: '701',
                feedEnabled: false, custom: false, queryable: true, retrieveable: true, fields: []
            };
            graph.addNode('Campaign', campaignDescribe);

            const modifiedOpportunityDescribe: SObjectDescribe = {
                ...opportunityDescribe, // Uses opportunityDescribe from the describe block's scope
                fields: [
                    ...opportunityDescribe.fields,
                    {
                        name: 'CampaignId__c', label: 'Campaign', type: 'reference',
                        updateable: true, createable: true, nillable: true, queryable: true,
                        relationshipName: 'Campaign', referenceTo: ['Campaign'], custom: true
                    }
                ]
            };
            graph.addNode('Opportunity', modifiedOpportunityDescribe); // Overwrite Opportunity node

            // Rebuild edges for Opportunity to include the new Campaign dependency
            const currentScope = new Set(graph.getNodeNames());
            graph.buildEdges('Opportunity', currentScope);
            
            // Order: User, Account, Contact, Opportunity, Campaign
            // Opportunity has optional lookup to Campaign (Campaign comes AFTER Opportunity) - YES TWO-PASS
            const deploymentOrder = ['User', 'Account', 'Contact', 'Opportunity', 'Campaign'];
            const cycles = new Set<string>();
            const twoPass = graph.getTwoPassObjects(deploymentOrder, cycles);
            
            expect(twoPass).to.not.include('Contact');
            expect(twoPass).to.include('Opportunity'); // Opportunity needs 2-pass due to Campaign
            expect(loggerDebugStub).to.have.been.calledWith(sinon.match(/\[Graph\] Opportunity marcado para 2 fases debido a lookup opcional a Campaign\./));
        });

        it('should not mark objects for two-pass if lookup is not nillable', () => {
            // Account has non-nillable lookup to User (User comes before Account) - NO TWO-PASS
            const deploymentOrder = ['User', 'Account', 'Contact', 'Opportunity'];
            const cycles = new Set<string>();
            const twoPass = graph.getTwoPassObjects(deploymentOrder, cycles);
            expect(twoPass).to.not.include('Account');
        });

        it('should return empty set if no two-pass objects are found', () => {
            const deploymentOrder = ['User', 'Account', 'Contact', 'Opportunity'];
            const cycles = new Set<string>();
            // Remove optional lookups that would cause two-pass
            const contactNoOptionalDescribe: SObjectDescribe = {
                name: 'Contact',
                label: 'Contact',
                labelPlural: 'Contacts',
                keyPrefix: '003',
                feedEnabled: false,
                custom: false,
                retrieveable: true,
                queryable: true,
                fields: [
                    {
                        name: 'AccountId',
                        label: 'Account ID',
                        type: 'reference',
                        updateable: true,
                        createable: true,
                        nillable: false,
                        queryable: true,
                        relationshipName: 'Account',
                        referenceTo: ['Account'],
                        custom: false
                    },
                    {
                        name: 'OwnerId',
                        label: 'Owner ID',
                        type: 'reference',
                        updateable: true,
                        createable: true,
                        nillable: false,
                        queryable: true,
                        relationshipName: 'Owner',
                        referenceTo: ['User'],
                        custom: false
                    },
                ]
            };
            const opportunityNoOptionalDescribe: SObjectDescribe = {
                name: 'Opportunity',
                label: 'Opportunity',
                labelPlural: 'Opportunities',
                keyPrefix: '006',
                feedEnabled: false,
                custom: false,
                retrieveable: true,
                queryable: true,
                fields: [
                    {
                        name: 'AccountId',
                        label: 'Account ID',
                        type: 'reference',
                        updateable: true,
                        createable: true,
                        nillable: false,
                        queryable: true,
                        relationshipName: 'Account',
                        referenceTo: ['Account'],
                        custom: false
                    },
                    {
                        name: 'PrimaryContactId__c',
                        label: 'Primary Contact',
                        type: 'reference',
                        updateable: true,
                        createable: true,
                        nillable: false,
                        queryable: true,
                        relationshipName: 'PrimaryContact',
                        referenceTo: ['Contact'],
                        custom: true
                    },
                ]
            };
            graph = new DependencyGraph(); // Reset graph
            graph.addNode('User', userDescribe);
            graph.addNode('Account', accountDescribe);
            graph.addNode('Contact', contactNoOptionalDescribe);
            graph.addNode('Opportunity', opportunityNoOptionalDescribe);
            const allObjects = new Set(['User', 'Account', 'Contact', 'Opportunity']);
            graph.buildEdges('Account', allObjects);
            graph.buildEdges('Contact', allObjects);
            graph.buildEdges('Opportunity', allObjects);

            const twoPass = graph.getTwoPassObjects(deploymentOrder, cycles);
            expect(twoPass).to.be.empty;
        });
    });
});