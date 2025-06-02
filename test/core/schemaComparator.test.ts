import { expect } from 'chai';
import { SchemaComparator, SchemaComparisonResult, SchemaComparatorOptions } from '../../src/core/schemaComparator.js';
import { CachedOrgMetadata, CachedSObjectDetail, CachedField, CachedRecordTypeInfo, CachedChildRelationship } from '../../src/core/cacheManager.js';
import { Logger } from '../../src/core/logger.js';

// Un logger mock simple para las pruebas
class MockLogger extends Logger {
  constructor() {
    super('MockTestLogger'); // Solo el contexto es necesario para el constructor base
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public info(message: string, ...meta: any[]): void { /* no-op */ }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public warn(message: string, ...meta: any[]): void { /* no-op */ }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public error(message: string, ...meta: any[]): void { /* no-op */ }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public debug(message: string, ...meta: any[]): void { /* no-op */ }
}

const baseOrgId1 = '00Dxx000000123AAA';
const baseOrgId2 = '00Dxx000000123AAB';
const toolVersion = '1.0.0';
const now = new Date().toISOString();

const createMockMetadata = (orgId: string, sObjects: { [key: string]: CachedSObjectDetail } = {}): CachedOrgMetadata => ({
  orgId,
  userId: `testuser@${orgId}.com`,
  cacheSchemaVersion: '1.0',
  toolVersion,
  generatedTimestamp: now,
  metadataFetchedTimestamp: now,
  sObjects,
});

const createMockSObjectDetail = (
  name: string,
  label: string,
  custom: boolean,
  fields: CachedField[] = [],
  recordTypeInfos: CachedRecordTypeInfo[] = [],
  childRelationships: CachedChildRelationship[] = []
): CachedSObjectDetail => ({
  name,
  label,
  labelPlural: label + 's', // Default pluralization for mock
  custom,
  fields,
  childRelationships,
  recordTypeInfos,
});

const createMockField = (
  name: string,
  label: string,
  type: string,
  custom: boolean,
  picklistValues?: CachedField['picklistValues'],
  referenceTo?: string[],
  relationshipName?: string
): CachedField => ({
  name,
  label,
  type,
  custom,
  picklistValues: picklistValues || undefined,
  referenceTo: referenceTo || undefined,
  relationshipName: relationshipName || undefined,
  // Otros atributos pueden ser añadidos si son necesarios para las pruebas
});

const createMockRecordTypeInfo = (
  name: string, // DeveloperName
  recordTypeId: string,
  available: boolean,
  defaultMapping: boolean
): CachedRecordTypeInfo => ({
  name,
  recordTypeId,
  available,
  defaultRecordTypeMapping: defaultMapping,
});

const createMockChildRelationship = (
  childSObject: string,
  field: string,
  relationshipName?: string
): CachedChildRelationship => ({
  childSObject,
  field,
  relationshipName: relationshipName || undefined,
});

describe('SchemaComparator', () => {
  let comparator: SchemaComparator;
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = new MockLogger();
    const options: SchemaComparatorOptions = { logger: mockLogger };
    comparator = new SchemaComparator(options);
  });

  describe('SObject Comparison', () => {
    it('should find no differences if schemas are identical', () => {
      const sObject1: CachedSObjectDetail = createMockSObjectDetail('Account', 'Account', false);
      const metadata1: CachedOrgMetadata = createMockMetadata(baseOrgId1, { Account: sObject1 });
      const metadata2: CachedOrgMetadata = createMockMetadata(baseOrgId2, { Account: { ...sObject1 } }); // Clonar para asegurar independencia

      const result: SchemaComparisonResult = comparator.compare(metadata1, metadata2);

      expect(result.hasDifferences).to.be.false;
      expect(result.sObjects.added).to.be.empty;
      expect(result.sObjects.removed).to.be.empty;
      expect(result.sObjects.modified).to.be.empty;
      expect(result.summary).to.contain('No differences found');
    });

    it('should detect added SObjects', () => {
      const metadata1: CachedOrgMetadata = createMockMetadata(baseOrgId1, {});
      const sObjectNew: CachedSObjectDetail = createMockSObjectDetail('CustomObject__c', 'Custom Object', true);
      const metadata2: CachedOrgMetadata = createMockMetadata(baseOrgId2, { CustomObject__c: sObjectNew });

      const result: SchemaComparisonResult = comparator.compare(metadata1, metadata2);

      expect(result.hasDifferences).to.be.true;
      expect(result.sObjects.added).to.deep.equal(['CustomObject__c']);
      expect(result.sObjects.removed).to.be.empty;
      expect(result.sObjects.modified).to.be.empty;
    });

    it('should detect removed SObjects', () => {
      const sObjectOld: CachedSObjectDetail = createMockSObjectDetail('ObsoleteObject__c', 'Obsolete Object', true);
      const metadata1: CachedOrgMetadata = createMockMetadata(baseOrgId1, { ObsoleteObject__c: sObjectOld });
      const metadata2: CachedOrgMetadata = createMockMetadata(baseOrgId2, {});

      const result: SchemaComparisonResult = comparator.compare(metadata1, metadata2);

      expect(result.hasDifferences).to.be.true;
      expect(result.sObjects.added).to.be.empty;
      expect(result.sObjects.removed).to.deep.equal(['ObsoleteObject__c']);
      expect(result.sObjects.modified).to.be.empty;
    });

    it('should detect modified SObject attributes (label change)', () => {
      const sObject1: CachedSObjectDetail = createMockSObjectDetail('Account', 'Old Account Label', false);
      const sObject2: CachedSObjectDetail = createMockSObjectDetail('Account', 'New Account Label', false);
      const metadata1: CachedOrgMetadata = createMockMetadata(baseOrgId1, { Account: sObject1 });
      const metadata2: CachedOrgMetadata = createMockMetadata(baseOrgId2, { Account: sObject2 });

      const result: SchemaComparisonResult = comparator.compare(metadata1, metadata2);

      expect(result.hasDifferences).to.be.true;
      expect(result.sObjects.added).to.be.empty;
      expect(result.sObjects.removed).to.be.empty;
      expect(result.sObjects.modified).to.have.lengthOf(1);
      expect(result.sObjects.modified[0].name).to.equal('Account');
      expect(result.sObjects.modified[0].changes).to.deep.include({
        attribute: 'label',
        oldValue: 'Old Account Label',
        newValue: 'New Account Label',
      });
    });
  });

  describe('Field Comparison', () => {
    it('should detect added fields', () => {
      const fieldOld: CachedField = createMockField('ExistingField__c', 'Existing Field', 'Text', true);
      const sObject1: CachedSObjectDetail = createMockSObjectDetail('Account', 'Account', false, [fieldOld]);
      
      const fieldNew: CachedField = createMockField('NewField__c', 'New Field', 'Number', true);
      const sObject2: CachedSObjectDetail = createMockSObjectDetail('Account', 'Account', false, [fieldOld, fieldNew]);
      
      const metadata1: CachedOrgMetadata = createMockMetadata(baseOrgId1, { Account: sObject1 });
      const metadata2: CachedOrgMetadata = createMockMetadata(baseOrgId2, { Account: sObject2 });

      const result: SchemaComparisonResult = comparator.compare(metadata1, metadata2);

      expect(result.hasDifferences).to.be.true;
      expect(result.sObjects.modified).to.have.lengthOf(1);
      const modifiedAccount = result.sObjects.modified[0];
      expect(modifiedAccount.name).to.equal('Account');
      expect(modifiedAccount.fieldComparison).to.exist;
      expect(modifiedAccount.fieldComparison?.added).to.deep.equal(['NewField__c']);
      expect(modifiedAccount.fieldComparison?.removed).to.be.empty;
      expect(modifiedAccount.fieldComparison?.modified).to.be.empty;
    });

    it('should detect removed fields', () => {
      const fieldOld1: CachedField = createMockField('FieldToRemove__c', 'Field To Remove', 'Text', true);
      const fieldOld2: CachedField = createMockField('KeptField__c', 'Kept Field', 'Date', false);
      const sObject1: CachedSObjectDetail = createMockSObjectDetail('Account', 'Account', false, [fieldOld1, fieldOld2]);
      
      const sObject2: CachedSObjectDetail = createMockSObjectDetail('Account', 'Account', false, [fieldOld2]);
      
      const metadata1: CachedOrgMetadata = createMockMetadata(baseOrgId1, { Account: sObject1 });
      const metadata2: CachedOrgMetadata = createMockMetadata(baseOrgId2, { Account: sObject2 });

      const result: SchemaComparisonResult = comparator.compare(metadata1, metadata2);

      expect(result.hasDifferences).to.be.true;
      expect(result.sObjects.modified).to.have.lengthOf(1);
      const modifiedAccount = result.sObjects.modified[0];
      expect(modifiedAccount.fieldComparison?.removed).to.deep.equal(['FieldToRemove__c']);
      expect(modifiedAccount.fieldComparison?.added).to.be.empty;
      expect(modifiedAccount.fieldComparison?.modified).to.be.empty;
    });

    it('should detect modified field attributes (label and type change)', () => {
      const field1: CachedField = createMockField('FieldToModify__c', 'Old Label', 'Text', true);
      const sObject1: CachedSObjectDetail = createMockSObjectDetail('Account', 'Account', false, [field1]);
      
      const field2: CachedField = createMockField('FieldToModify__c', 'New Label', 'Number', true);
      const sObject2: CachedSObjectDetail = createMockSObjectDetail('Account', 'Account', false, [field2]);
      
      const metadata1: CachedOrgMetadata = createMockMetadata(baseOrgId1, { Account: sObject1 });
      const metadata2: CachedOrgMetadata = createMockMetadata(baseOrgId2, { Account: sObject2 });

      const result: SchemaComparisonResult = comparator.compare(metadata1, metadata2);

      expect(result.hasDifferences).to.be.true;
      expect(result.sObjects.modified).to.have.lengthOf(1);
      const modifiedAccount = result.sObjects.modified[0];
      expect(modifiedAccount.fieldComparison?.modified).to.have.lengthOf(1);
      const modifiedField = modifiedAccount.fieldComparison!.modified[0];
      expect(modifiedField.name).to.equal('FieldToModify__c');
      expect(modifiedField.changes).to.deep.include.members([
        { attribute: 'label', oldValue: 'Old Label', newValue: 'New Label' },
        { attribute: 'type', oldValue: 'Text', newValue: 'Number' },
      ]);
    });

    it('should detect modified field referenceTo', () => {
      const field1: CachedField = createMockField('Lookup__c', 'Lookup', 'Lookup', true, undefined, ['Contact']);
      const sObject1: CachedSObjectDetail = createMockSObjectDetail('Account', 'Account', false, [field1]);
      
      const field2: CachedField = createMockField('Lookup__c', 'Lookup', 'Lookup', true, undefined, ['User']);
      const sObject2: CachedSObjectDetail = createMockSObjectDetail('Account', 'Account', false, [field2]);
      
      const metadata1: CachedOrgMetadata = createMockMetadata(baseOrgId1, { Account: sObject1 });
      const metadata2: CachedOrgMetadata = createMockMetadata(baseOrgId2, { Account: sObject2 });

      const result: SchemaComparisonResult = comparator.compare(metadata1, metadata2);
      expect(result.hasDifferences).to.be.true;
      const modifiedField = result.sObjects.modified[0].fieldComparison!.modified[0];
      expect(modifiedField.changes).to.deep.include({
          attribute: 'referenceTo', oldValue: ['Contact'], newValue: ['User']
      });
    });
  });

  describe('Picklist Value Comparison', () => {
    it('should detect added picklist values', () => {
      const picklistValues1 = [{ value: 'Val1', label: 'Value 1', active: true }];
      const field1: CachedField = createMockField('PicklistField__c', 'Picklist', 'Picklist', true, picklistValues1);
      const sObject1: CachedSObjectDetail = createMockSObjectDetail('Opportunity', 'Opportunity', false, [field1]);
      
      const picklistValues2 = [
        { value: 'Val1', label: 'Value 1', active: true },
        { value: 'Val2', label: 'Value 2', active: true }
      ];
      const field2: CachedField = createMockField('PicklistField__c', 'Picklist', 'Picklist', true, picklistValues2);
      const sObject2: CachedSObjectDetail = createMockSObjectDetail('Opportunity', 'Opportunity', false, [field2]);

      const metadata1: CachedOrgMetadata = createMockMetadata(baseOrgId1, { Opportunity: sObject1 });
      const metadata2: CachedOrgMetadata = createMockMetadata(baseOrgId2, { Opportunity: sObject2 });
      const result: SchemaComparisonResult = comparator.compare(metadata1, metadata2);

      expect(result.hasDifferences).to.be.true;
      const modifiedField = result.sObjects.modified[0].fieldComparison!.modified[0];
      expect(modifiedField.picklistComparison).to.exist;
      expect(modifiedField.picklistComparison?.added).to.deep.equal([{ value: 'Val2', label: 'Value 2', active: true }]);
      expect(modifiedField.picklistComparison?.removed).to.be.empty;
      expect(modifiedField.picklistComparison?.modified).to.be.empty;
    });

    it('should detect removed picklist values', () => {
      const picklistValues1 = [
        { value: 'Val1', label: 'Value 1', active: true },
        { value: 'ValToRemove', label: 'To Remove', active: true }
      ];
      const field1: CachedField = createMockField('Status__c', 'Status', 'Picklist', false, picklistValues1);
      const sObject1: CachedSObjectDetail = createMockSObjectDetail('Case', 'Case', false, [field1]);

      const picklistValues2 = [{ value: 'Val1', label: 'Value 1', active: true }];
      const field2: CachedField = createMockField('Status__c', 'Status', 'Picklist', false, picklistValues2);
      const sObject2: CachedSObjectDetail = createMockSObjectDetail('Case', 'Case', false, [field2]);

      const metadata1: CachedOrgMetadata = createMockMetadata(baseOrgId1, { Case: sObject1 });
      const metadata2: CachedOrgMetadata = createMockMetadata(baseOrgId2, { Case: sObject2 });
      const result: SchemaComparisonResult = comparator.compare(metadata1, metadata2);

      expect(result.hasDifferences).to.be.true;
      const modifiedField = result.sObjects.modified[0].fieldComparison!.modified[0];
      expect(modifiedField.picklistComparison?.removed).to.deep.equal([{ value: 'ValToRemove', label: 'To Remove', active: true }]);
    });

    it('should detect modified picklist value (label and active status)', () => {
      const picklistValues1 = [{ value: 'Val1', label: 'Old Label', active: true }];
      const field1: CachedField = createMockField('Type__c', 'Type', 'Picklist', true, picklistValues1);
      const sObject1: CachedSObjectDetail = createMockSObjectDetail('Lead', 'Lead', false, [field1]);

      const picklistValues2 = [{ value: 'Val1', label: 'New Label', active: false }];
      const field2: CachedField = createMockField('Type__c', 'Type', 'Picklist', true, picklistValues2);
      const sObject2: CachedSObjectDetail = createMockSObjectDetail('Lead', 'Lead', false, [field2]);
      
      const metadata1: CachedOrgMetadata = createMockMetadata(baseOrgId1, { Lead: sObject1 });
      const metadata2: CachedOrgMetadata = createMockMetadata(baseOrgId2, { Lead: sObject2 });
      const result: SchemaComparisonResult = comparator.compare(metadata1, metadata2);

      expect(result.hasDifferences).to.be.true;
      const modifiedField = result.sObjects.modified[0].fieldComparison!.modified[0];
      expect(modifiedField.picklistComparison?.modified).to.have.lengthOf(1);
      expect(modifiedField.picklistComparison?.modified[0]).to.deep.equal({
        value: 'Val1',
        oldLabel: 'Old Label',
        newLabel: 'New Label',
        oldActive: true,
        newActive: false
      });
    });
  });

  describe('Record Type Comparison', () => {
    it('should detect added record types', () => {
      const recordTypeOld: CachedRecordTypeInfo = createMockRecordTypeInfo('RT_Old', 'Old RT', true, true);
      const sObject1: CachedSObjectDetail = createMockSObjectDetail('Account', 'Account', false, [], [recordTypeOld]);
      
      const recordTypeNew: CachedRecordTypeInfo = createMockRecordTypeInfo('RT_New', 'New RT', true, false);
      const sObject2: CachedSObjectDetail = createMockSObjectDetail('Account', 'Account', false, [], [recordTypeOld, recordTypeNew]);
      
      const metadata1: CachedOrgMetadata = createMockMetadata(baseOrgId1, { Account: sObject1 });
      const metadata2: CachedOrgMetadata = createMockMetadata(baseOrgId2, { Account: sObject2 });

      const result: SchemaComparisonResult = comparator.compare(metadata1, metadata2);

      expect(result.hasDifferences).to.be.true;
      expect(result.sObjects.modified).to.have.lengthOf(1);
      const modifiedAccount = result.sObjects.modified[0];
      expect(modifiedAccount.recordTypeComparison).to.exist;
      expect(modifiedAccount.recordTypeComparison?.added).to.deep.equal([recordTypeNew]);
      expect(modifiedAccount.recordTypeComparison?.removed).to.be.empty;
      expect(modifiedAccount.recordTypeComparison?.modified).to.be.empty;
    });

    it('should detect removed record types', () => {
      const recordTypeToRemove: CachedRecordTypeInfo = createMockRecordTypeInfo('RT_ToRemove', 'To Remove RT', false, false);
      const recordTypeKept: CachedRecordTypeInfo = createMockRecordTypeInfo('RT_Kept', 'Kept RT', true, true);
      const sObject1: CachedSObjectDetail = createMockSObjectDetail('Account', 'Account', false, [], [recordTypeToRemove, recordTypeKept]);
      
      const sObject2: CachedSObjectDetail = createMockSObjectDetail('Account', 'Account', false, [], [recordTypeKept]);
      
      const metadata1: CachedOrgMetadata = createMockMetadata(baseOrgId1, { Account: sObject1 });
      const metadata2: CachedOrgMetadata = createMockMetadata(baseOrgId2, { Account: sObject2 });

      const result: SchemaComparisonResult = comparator.compare(metadata1, metadata2);

      expect(result.hasDifferences).to.be.true;
      expect(result.sObjects.modified).to.have.lengthOf(1);
      const modifiedAccount = result.sObjects.modified[0];
      // Expect the full object, not just the name
      expect(modifiedAccount.recordTypeComparison?.removed).to.deep.equal([
        createMockRecordTypeInfo('RT_ToRemove', 'To Remove RT', false, false)
      ]);
      expect(modifiedAccount.recordTypeComparison?.added).to.be.empty;
      expect(modifiedAccount.recordTypeComparison?.modified).to.be.empty;
    });

    it('should detect modified record type attributes (available and default)', () => {
      const recordType1: CachedRecordTypeInfo = createMockRecordTypeInfo('RT_Mod', 'Mod RT', true, true);
      const sObject1: CachedSObjectDetail = createMockSObjectDetail('Account', 'Account', false, [], [recordType1]);
      
      const recordType2: CachedRecordTypeInfo = createMockRecordTypeInfo('RT_Mod', 'Mod RT', false, false); // Name is the same, attributes changed
      const sObject2: CachedSObjectDetail = createMockSObjectDetail('Account', 'Account', false, [], [recordType2]);
      
      const metadata1: CachedOrgMetadata = createMockMetadata(baseOrgId1, { Account: sObject1 });
      const metadata2: CachedOrgMetadata = createMockMetadata(baseOrgId2, { Account: sObject2 });

      const result: SchemaComparisonResult = comparator.compare(metadata1, metadata2);

      expect(result.hasDifferences).to.be.true;
      expect(result.sObjects.modified).to.have.lengthOf(1);
      const modifiedAccount = result.sObjects.modified[0];
      expect(modifiedAccount.recordTypeComparison?.modified).to.have.lengthOf(1);
      const modifiedRT = modifiedAccount.recordTypeComparison!.modified[0];
      expect(modifiedRT.name).to.equal('RT_Mod');
      expect(modifiedRT.changes).to.deep.include.members([
        { attribute: 'available', oldValue: true, newValue: false },
        { attribute: 'defaultRecordTypeMapping', oldValue: true, newValue: false },
      ]);
    });
  });

  describe('Child Relationship Comparison', () => {
    it('should find no differences if child relationships are identical', () => {
      const cr1: CachedChildRelationship = createMockChildRelationship('Contact', 'AccountId', 'Contacts');
      const sObject1: CachedSObjectDetail = createMockSObjectDetail('Account', 'Account', false, [], [], [cr1]);
      const sObject2: CachedSObjectDetail = createMockSObjectDetail('Account', 'Account', false, [], [], [{...cr1}]);
      
      const metadata1: CachedOrgMetadata = createMockMetadata(baseOrgId1, { Account: sObject1 });
      const metadata2: CachedOrgMetadata = createMockMetadata(baseOrgId2, { Account: sObject2 });
      const result: SchemaComparisonResult = comparator.compare(metadata1, metadata2);

      expect(result.hasDifferences).to.be.false;
      const modifiedAccount = result.sObjects.modified.find(s => s.name === 'Account');
      // Si no hay diferencias, modifiedAccount podría no existir o no tener childRelationshipComparison
      if (modifiedAccount) {
        expect(modifiedAccount.childRelationshipComparison).to.be.undefined;
      }
    });

    it('should detect added child relationships', () => {
      const sObject1: CachedSObjectDetail = createMockSObjectDetail('Account', 'Account', false, [], [], []);
      const crNew: CachedChildRelationship = createMockChildRelationship('Opportunity', 'AccountId', 'Opportunities');
      const sObject2: CachedSObjectDetail = createMockSObjectDetail('Account', 'Account', false, [], [], [crNew]);
      
      const metadata1: CachedOrgMetadata = createMockMetadata(baseOrgId1, { Account: sObject1 });
      const metadata2: CachedOrgMetadata = createMockMetadata(baseOrgId2, { Account: sObject2 });
      const result: SchemaComparisonResult = comparator.compare(metadata1, metadata2);

      expect(result.hasDifferences).to.be.true;
      const modifiedAccount = result.sObjects.modified[0];
      expect(modifiedAccount.name).to.equal('Account');
      expect(modifiedAccount.childRelationshipComparison).to.exist;
      expect(modifiedAccount.childRelationshipComparison?.added).to.deep.equal([crNew]);
      expect(modifiedAccount.childRelationshipComparison?.removed).to.be.empty;
      expect(modifiedAccount.childRelationshipComparison?.modified).to.be.empty;
    });

    it('should detect removed child relationships', () => {
      const crToRemove: CachedChildRelationship = createMockChildRelationship('Case', 'AccountId', 'Cases');
      const sObject1: CachedSObjectDetail = createMockSObjectDetail('Account', 'Account', false, [], [], [crToRemove]);
      const sObject2: CachedSObjectDetail = createMockSObjectDetail('Account', 'Account', false, [], [], []);
      
      const metadata1: CachedOrgMetadata = createMockMetadata(baseOrgId1, { Account: sObject1 });
      const metadata2: CachedOrgMetadata = createMockMetadata(baseOrgId2, { Account: sObject2 });
      const result: SchemaComparisonResult = comparator.compare(metadata1, metadata2);

      expect(result.hasDifferences).to.be.true;
      const modifiedAccount = result.sObjects.modified[0];
      expect(modifiedAccount.childRelationshipComparison?.removed).to.deep.equal([crToRemove]);
      expect(modifiedAccount.childRelationshipComparison?.added).to.be.empty;
      expect(modifiedAccount.childRelationshipComparison?.modified).to.be.empty;
    });

    it('should detect modified child relationship (relationshipName change)', () => {
      const cr1: CachedChildRelationship = createMockChildRelationship('Asset', 'AccountId', 'OldAssets');
      const sObject1: CachedSObjectDetail = createMockSObjectDetail('Account', 'Account', false, [], [], [cr1]);
      
      const cr2: CachedChildRelationship = createMockChildRelationship('Asset', 'AccountId', 'NewAssetsName'); // Same childSObject and field
      const sObject2: CachedSObjectDetail = createMockSObjectDetail('Account', 'Account', false, [], [], [cr2]);
      
      const metadata1: CachedOrgMetadata = createMockMetadata(baseOrgId1, { Account: sObject1 });
      const metadata2: CachedOrgMetadata = createMockMetadata(baseOrgId2, { Account: sObject2 });
      const result: SchemaComparisonResult = comparator.compare(metadata1, metadata2);

      expect(result.hasDifferences).to.be.true;
      const modifiedAccount = result.sObjects.modified[0];
      expect(modifiedAccount.childRelationshipComparison?.modified).to.have.lengthOf(1);
      const modifiedCR = modifiedAccount.childRelationshipComparison!.modified[0];
      expect(modifiedCR.childSObject).to.equal('Asset');
      expect(modifiedCR.field).to.equal('AccountId');
      expect(modifiedCR.changes).to.deep.include.members([
        { attribute: 'relationshipName', oldValue: 'OldAssets', newValue: 'NewAssetsName' },
      ]);
    });
  });
});