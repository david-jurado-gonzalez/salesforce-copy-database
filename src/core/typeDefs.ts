// src/core/typeDefs.ts
import { Connection } from 'jsforce';

export interface OrgConfig {
  loginUrl?: string;
  username?: string;
  password?: string;
  instanceUrl?: string; // Para conexión directa
}

// Valores por defecto para la configuración
export const DEFAULT_ORG_CONFIG: OrgConfig = {
  loginUrl: 'https://test.salesforce.com', // Por defecto apunta a sandbox
  instanceUrl: undefined, // Undefined por defecto, se configura tras el login
  username: undefined, // Se debe proporcionar vía config o CLI
  password: undefined  // Se debe proporcionar vía config o CLI
};

export interface AppConfig {
  orgs: { [alias: string]: OrgConfig };
  jobConfig?: {
    deploymentOrder?: string[]; // Opcional, para forzar un orden
    twoPassObjects?: string[]; // Opcional, para forzar 2 fases
    personAccountsEnabled?: boolean;
  };
}

export interface CommandOptions {
  source: string;
  target?: string;
  query?: string;
  config?: string; // Ahora es opcional
  force?: boolean;
  username?: string; // Para CLI
  password?: string; // Para CLI
  loginUrl?: string; // Para CLI
  instanceUrl?: string; // Para CLI
  apiType?: 'auto' | 'bulk' | 'rest'; // Nuevo parámetro para el tipo de API de extracción
}

// Interfaz para la descripción de un SObject de Salesforce

export interface ChildRelationship {
  childSObject: string;
  deprecatedAndHidden: boolean;
  field: string;
  junctionIdListNames: string[];
  junctionReferenceTo: string[];
  relationshipName: string | null | undefined;
  cascadeDelete: boolean;
  restrictedDelete: boolean;
}

export interface SObjectDescribe {
  name: string;
  label: string;
  custom: boolean;
  fields: {
    name: string;
    label: string;
    type: string;
    custom: boolean;
    updateable: boolean;
    createable: boolean;
    nillable: boolean;
    unique?: boolean; // Añadido para campos únicos
    relationshipName: string | null | undefined;
    referenceTo: string[] | null | undefined;
  }[];
  childRelationships?: ChildRelationship[]; // Usamos el tipo ChildRelationship
}

// Estructura del mapa de IDs
export type IdMap = { [sourceId: string]: string };