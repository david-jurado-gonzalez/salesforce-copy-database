import { CachedOrgMetadata, CachedSObjectDetail, CachedField, CachedRecordTypeInfo, CachedChildRelationship } from './cacheManager.js';
import { Logger } from './logger.js';

export interface SObjectChangeDetail {
  attribute: string; // e.g., 'label', 'custom'
  oldValue: any;
  newValue: any;
}

export interface FieldChangeDetail {
  attribute: string; // e.g., 'label', 'type', 'length', 'custom', 'referenceTo', 'relationshipName'
  oldValue: any;
  newValue: any;
}

// Interfaces for Picklist Comparison
export interface PicklistValueItem {
  value: string;
  label: string;
  active: boolean;
}

export interface ModifiedPicklistValueInfo {
  value: string; // The value of the picklist item
  oldLabel?: string;
  newLabel?: string;
  oldActive?: boolean;
  newActive?: boolean;
}

export interface PicklistComparisonResult {
  added: PicklistValueItem[];
  removed: PicklistValueItem[];
  modified: ModifiedPicklistValueInfo[];
}

export interface ModifiedFieldInfo {
  name: string;
  changes: FieldChangeDetail[];
  picklistComparison?: PicklistComparisonResult; // For detailed picklist value changes
}

export interface FieldComparisonResult {
  added: string[]; // Field names
  removed: string[]; // Field names
  modified: ModifiedFieldInfo[];
}

export interface RecordTypeChangeDetail {
  attribute: string; // e.g., 'available', 'defaultRecordTypeMapping'
  oldValue: any;
  newValue: any;
}

export interface ModifiedRecordTypeInfo {
  name: string; // developerName of the Record Type
  changes: RecordTypeChangeDetail[];
}

// ... (otras interfaces) ...

export interface RecordTypeComparisonResult {
  added: CachedRecordTypeInfo[]; // Ahora objetos completos
  removed: CachedRecordTypeInfo[]; // Ahora objetos completos
  modified: ModifiedRecordTypeInfo[];
}

// Interfaces for ChildRelationship Comparison
export interface ChildRelationshipChangeDetail {
  attribute: string; // e.g., 'relationshipName'
  oldValue: any;
  newValue: any;
}

export interface ModifiedChildRelationshipInfo {
  childSObject: string; // API name of the child SObject
  field: string; // API name of the lookup/master-detail field on the child SObject
  changes: ChildRelationshipChangeDetail[];
}

export interface ChildRelationshipComparisonResult {
  added: CachedChildRelationship[];
  removed: CachedChildRelationship[];
  modified: ModifiedChildRelationshipInfo[];
}

export interface ModifiedSObjectInfo {
  name: string;
  changes: SObjectChangeDetail[];
  fieldComparison?: FieldComparisonResult;
  recordTypeComparison?: RecordTypeComparisonResult;
  childRelationshipComparison?: ChildRelationshipComparisonResult;
}

export interface SchemaComparisonResult {
  sObjects: {
    added: string[];
    removed: string[];
    modified: ModifiedSObjectInfo[];
  };
  hasDifferences: boolean;
  summary: string;
}

export interface SchemaComparatorOptions {
  logger: Logger;
}

export class SchemaComparator {
  private logger: Logger;

  constructor(options: SchemaComparatorOptions) {
    this.logger = options.logger;
  }

  private compareSObjectDetails(
    sObjectName: string,
    detail1: CachedSObjectDetail,
    detail2: CachedSObjectDetail
  ): SObjectChangeDetail[] {
    const changes: SObjectChangeDetail[] = [];

    if (detail1.label !== detail2.label) {
      changes.push({ attribute: 'label', oldValue: detail1.label, newValue: detail2.label });
      this.logger.debug(`SObject ${sObjectName}: Label changed from '${detail1.label}' to '${detail2.label}'`);
    }
    if (detail1.custom !== detail2.custom) {
      changes.push({ attribute: 'custom', oldValue: detail1.custom, newValue: detail2.custom });
      this.logger.debug(`SObject ${sObjectName}: Custom status changed from '${detail1.custom}' to '${detail2.custom}'`);
    }
    return changes;
  }

  private compareSObjectRecordTypes(
    sObjectName: string,
    sObjectDetail1: CachedSObjectDetail,
    sObjectDetail2: CachedSObjectDetail
  ): RecordTypeComparisonResult | undefined {
    const recordTypes1 = sObjectDetail1.recordTypeInfos || [];
    const recordTypes2 = sObjectDetail2.recordTypeInfos || [];
    
    const map1 = new Map(recordTypes1.map(rt => [rt.name, rt]));
    const map2 = new Map(recordTypes2.map(rt => [rt.name, rt]));

    const addedRTs: CachedRecordTypeInfo[] = [];
    for (const [name, rt] of map2) {
      if (!map1.has(name)) {
        addedRTs.push(rt);
      }
    }

    const removedRTs: CachedRecordTypeInfo[] = [];
    for (const [name, rt] of map1) {
      if (!map2.has(name)) {
        removedRTs.push(rt);
      }
    }
    
    const commonRTNames = recordTypes1.map(rt => rt.name).filter(rtName => map2.has(rtName));
    const modifiedRTs: ModifiedRecordTypeInfo[] = [];

    for (const rtName of commonRTNames) {
      const rt1 = recordTypes1.find(rt => rt.name === rtName)!;
      const rt2 = recordTypes2.find(rt => rt.name === rtName)!;
      const rtChanges: RecordTypeChangeDetail[] = [];

      if (rt1.available !== rt2.available) {
        rtChanges.push({ attribute: 'available', oldValue: rt1.available, newValue: rt2.available });
      }
      if (rt1.defaultRecordTypeMapping !== rt2.defaultRecordTypeMapping) {
        rtChanges.push({ attribute: 'defaultRecordTypeMapping', oldValue: rt1.defaultRecordTypeMapping, newValue: rt2.defaultRecordTypeMapping });
      }

      if (rtChanges.length > 0) {
        modifiedRTs.push({ name: rtName, changes: rtChanges });
        this.logger.debug(`SObject ${sObjectName}, RecordType ${rtName}: Has modifications.`);
      }
    }

    if (addedRTs.length === 0 && removedRTs.length === 0 && modifiedRTs.length === 0) {
      return undefined;
    }
    this.logger.info(`SObject ${sObjectName}: RecordTypes added: ${addedRTs.length}, removed: ${removedRTs.length}, modified: ${modifiedRTs.length}`);
    return { added: addedRTs, removed: removedRTs, modified: modifiedRTs };
  }

  private comparePicklistValues(
    sObjectName: string,
    fieldName: string,
    pv1: CachedField['picklistValues'],
    pv2: CachedField['picklistValues']
  ): PicklistComparisonResult | undefined {
    const values1 = pv1 || [];
    const values2 = pv2 || [];

    const map1 = new Map(values1.map(p => [p.value, p]));
    const map2 = new Map(values2.map(p => [p.value, p]));

    const added: PicklistValueItem[] = [];
    const removed: PicklistValueItem[] = [];
    const modified: ModifiedPicklistValueInfo[] = [];

    for (const [value, item2] of map2) {
      if (!map1.has(value)) {
        added.push({ value: item2.value, label: item2.label, active: item2.active });
      }
    }

    for (const [value, item1] of map1) {
      if (!map2.has(value)) {
        removed.push({ value: item1.value, label: item1.label, active: item1.active });
      } else {
        const item2 = map2.get(value)!;
        const mods: Partial<ModifiedPicklistValueInfo> = {};
        let changed = false;
        if (item1.label !== item2.label) {
          mods.oldLabel = item1.label;
          mods.newLabel = item2.label;
          changed = true;
        }
        if (item1.active !== item2.active) {
          mods.oldActive = item1.active;
          mods.newActive = item2.active;
          changed = true;
        }
        if (changed) {
          modified.push({ value, ...mods });
        }
      }
    }
    
    if (added.length === 0 && removed.length === 0 && modified.length === 0) {
      return undefined;
    }

    this.logger.debug(`SObject ${sObjectName}, Field ${fieldName}: Picklist changes - Added: ${added.length}, Removed: ${removed.length}, Modified: ${modified.length}`);
    return { added, removed, modified };
  }

  private compareSObjectFields(
    sObjectName: string,
    sObjectDetail1: CachedSObjectDetail,
    sObjectDetail2: CachedSObjectDetail
  ): FieldComparisonResult | undefined {
    const fields1 = sObjectDetail1.fields || [];
    const fields2 = sObjectDetail2.fields || [];
    const fieldNames1 = fields1.map(f => f.name);
    const fieldNames2 = fields2.map(f => f.name);

    const addedFields = fieldNames2.filter(fName => !fieldNames1.includes(fName));
    const removedFields = fieldNames1.filter(fName => !fieldNames2.includes(fName));
    const commonFieldNames = fieldNames1.filter(fName => fieldNames2.includes(fName));
    const modifiedFields: ModifiedFieldInfo[] = [];

    for (const fieldName of commonFieldNames) {
      const field1 = fields1.find(f => f.name === fieldName)!;
      const field2 = fields2.find(f => f.name === fieldName)!;
      const fieldChanges: FieldChangeDetail[] = [];

      if (field1.label !== field2.label) {
        fieldChanges.push({ attribute: 'label', oldValue: field1.label, newValue: field2.label });
      }
      if (field1.type !== field2.type) {
        fieldChanges.push({ attribute: 'type', oldValue: field1.type, newValue: field2.type });
      }
      if (field1.length !== field2.length) {
        fieldChanges.push({ attribute: 'length', oldValue: field1.length, newValue: field2.length });
      }
      if (field1.custom !== field2.custom) {
        fieldChanges.push({ attribute: 'custom', oldValue: field1.custom, newValue: field2.custom });
      }
      // Compare referenceTo (ensure arrays are stringified for simple comparison or compare element-wise)
      const refTo1 = field1.referenceTo || [];
      const refTo2 = field2.referenceTo || [];
      if (JSON.stringify(refTo1.sort()) !== JSON.stringify(refTo2.sort())) {
        fieldChanges.push({ attribute: 'referenceTo', oldValue: field1.referenceTo, newValue: field2.referenceTo });
      }
      if (field1.relationshipName !== field2.relationshipName) {
        fieldChanges.push({ attribute: 'relationshipName', oldValue: field1.relationshipName, newValue: field2.relationshipName });
      }
      // TODO: Add more attributes: precision, scale

      const picklistComparison = this.comparePicklistValues(sObjectName, fieldName, field1.picklistValues, field2.picklistValues);

      if (fieldChanges.length > 0 || picklistComparison) {
        const modifiedFieldInfo: ModifiedFieldInfo = { name: fieldName, changes: fieldChanges };
        if (picklistComparison) {
          modifiedFieldInfo.picklistComparison = picklistComparison;
        }
        modifiedFields.push(modifiedFieldInfo);
        this.logger.debug(`SObject ${sObjectName}, Field ${fieldName}: Has modifications.`);
      }
    }

    if (addedFields.length === 0 && removedFields.length === 0 && modifiedFields.length === 0) {
      return undefined;
    }
    this.logger.info(`SObject ${sObjectName}: Fields added: ${addedFields.length}, removed: ${removedFields.length}, modified: ${modifiedFields.length}`);
    return { added: addedFields, removed: removedFields, modified: modifiedFields };
  }

  private compareSObjectChildRelationships(
    sObjectName: string, // Nombre del SObject padre
    sObjectDetail1: CachedSObjectDetail,
    sObjectDetail2: CachedSObjectDetail
  ): ChildRelationshipComparisonResult | undefined {
    const relationships1 = sObjectDetail1.childRelationships || [];
    const relationships2 = sObjectDetail2.childRelationships || [];

    // Usar una clave compuesta de childSObject y field para identificar unívocamente una relación
    const map1 = new Map(relationships1.map(cr => [`${cr.childSObject}-${cr.field}`, cr]));
    const map2 = new Map(relationships2.map(cr => [`${cr.childSObject}-${cr.field}`, cr]));

    const addedCRs: CachedChildRelationship[] = [];
    for (const [key, cr] of map2) {
      if (!map1.has(key)) {
        addedCRs.push(cr);
      }
    }

    const removedCRs: CachedChildRelationship[] = [];
    for (const [key, cr] of map1) {
      if (!map2.has(key)) {
        removedCRs.push(cr);
      }
    }

    const modifiedCRs: ModifiedChildRelationshipInfo[] = [];
    for (const [key, cr1] of map1) {
      if (map2.has(key)) {
        const cr2 = map2.get(key)!;
        const crChanges: ChildRelationshipChangeDetail[] = [];

        if (cr1.relationshipName !== cr2.relationshipName) {
          crChanges.push({ attribute: 'relationshipName', oldValue: cr1.relationshipName, newValue: cr2.relationshipName });
        }
        // Se podrían añadir más atributos si CachedChildRelationship los tuviera (e.g., cascadeDelete)

        if (crChanges.length > 0) {
          modifiedCRs.push({ childSObject: cr1.childSObject, field: cr1.field, changes: crChanges });
          this.logger.debug(`SObject ${sObjectName}, ChildRelationship ${cr1.childSObject}.${cr1.field}: Has modifications.`);
        }
      }
    }

    if (addedCRs.length === 0 && removedCRs.length === 0 && modifiedCRs.length === 0) {
      return undefined;
    }

    this.logger.info(`SObject ${sObjectName}: ChildRelationships added: ${addedCRs.length}, removed: ${removedCRs.length}, modified: ${modifiedCRs.length}`);
    return { added: addedCRs, removed: removedCRs, modified: modifiedCRs };
  }

  public compare(metadata1: CachedOrgMetadata, metadata2: CachedOrgMetadata): SchemaComparisonResult {
    this.logger.info(`Starting schema comparison between org ${metadata1.orgId} (source1) and org ${metadata2.orgId} (source2)`);

    const sObjects1Names = Object.keys(metadata1.sObjects);
    const sObjects2Names = Object.keys(metadata2.sObjects);

    const addedSObjects = sObjects2Names.filter(sObj => !sObjects1Names.includes(sObj));
    if (addedSObjects.length > 0) {
      this.logger.info(`SObjects added (in source2, not in source1): ${addedSObjects.join(', ')}`);
    }

    const removedSObjects = sObjects1Names.filter(sObj => !sObjects2Names.includes(sObj));
    if (removedSObjects.length > 0) {
      this.logger.info(`SObjects removed (in source1, not in source2): ${removedSObjects.join(', ')}`);
    }
    
    const commonSObjectNames = sObjects1Names.filter(sObj => sObjects2Names.includes(sObj));
    const modifiedSObjects: ModifiedSObjectInfo[] = [];

    for (const sObjectName of commonSObjectNames) {
      const detail1 = metadata1.sObjects[sObjectName];
      const detail2 = metadata2.sObjects[sObjectName];
      const sObjectChanges = this.compareSObjectDetails(sObjectName, detail1, detail2);
      const fieldComparisonResult = this.compareSObjectFields(sObjectName, detail1, detail2);
      const recordTypeComparisonResult = this.compareSObjectRecordTypes(sObjectName, detail1, detail2);
      const childRelationshipComparisonResult = this.compareSObjectChildRelationships(sObjectName, detail1, detail2);

      if (sObjectChanges.length > 0 || fieldComparisonResult || recordTypeComparisonResult || childRelationshipComparisonResult) {
        const modifiedSObjectInfo: ModifiedSObjectInfo = { name: sObjectName, changes: sObjectChanges };
        if (fieldComparisonResult) {
          modifiedSObjectInfo.fieldComparison = fieldComparisonResult;
        }
        if (recordTypeComparisonResult) {
          modifiedSObjectInfo.recordTypeComparison = recordTypeComparisonResult;
        }
        if (childRelationshipComparisonResult) {
          modifiedSObjectInfo.childRelationshipComparison = childRelationshipComparisonResult;
        }
        modifiedSObjects.push(modifiedSObjectInfo);
        this.logger.info(`SObject ${sObjectName} has modifications (attributes, fields, record types, or child relationships).`);
      } else {
        this.logger.debug(`SObject ${sObjectName} has no direct attribute, field, record type, or child relationship modifications.`);
      }
    }
    
    let sObjectsWithFieldChangesCount = 0;
    let sObjectsWithRecordTypeChangesCount = 0;
    let sObjectsWithChildRelationshipChangesCount = 0;

    if (modifiedSObjects.length > 0) {
        sObjectsWithFieldChangesCount = modifiedSObjects.filter(m =>
            m.fieldComparison &&
            (m.fieldComparison.added.length > 0 || m.fieldComparison.removed.length > 0 || m.fieldComparison.modified.length > 0)
        ).length;
        sObjectsWithRecordTypeChangesCount = modifiedSObjects.filter(m =>
            m.recordTypeComparison &&
            (m.recordTypeComparison.added.length > 0 || m.recordTypeComparison.removed.length > 0 || m.recordTypeComparison.modified.length > 0)
        ).length;
        sObjectsWithChildRelationshipChangesCount = modifiedSObjects.filter(m =>
            m.childRelationshipComparison &&
            (m.childRelationshipComparison.added.length > 0 || m.childRelationshipComparison.removed.length > 0 || m.childRelationshipComparison.modified.length > 0)
        ).length;
    }

    const hasDifferences = addedSObjects.length > 0 || removedSObjects.length > 0 || modifiedSObjects.length > 0;
    let summary = `Comparison Summary:
    SObjects: ${addedSObjects.length} added, ${removedSObjects.length} removed, ${modifiedSObjects.length} with modifications.
    Fields: ${sObjectsWithFieldChangesCount} SObject(s) have field differences.
    Record Types: ${sObjectsWithRecordTypeChangesCount} SObject(s) have Record Type differences.
    Child Relationships: ${sObjectsWithChildRelationshipChangesCount} SObject(s) have Child Relationship differences.`;
        
    if (!hasDifferences) {
        summary = 'Comparison Summary: No differences found in SObject presence, direct attributes, fields, Record Types, or Child Relationships.';
    }
    
    this.logger.info(summary.replace(/\n\\s*/g, ' ')); // Log summary in a single line

    return {
      sObjects: {
        added: addedSObjects,
        removed: removedSObjects,
        modified: modifiedSObjects,
      },
      hasDifferences,
      summary,
    };
  }
}