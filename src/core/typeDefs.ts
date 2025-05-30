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
  defaultSourceOrgAlias?: string; // Nuevo: Alias de la organización de origen por defecto
  jobConfig?: {
    deploymentOrder?: string[]; // Opcional, para forzar un orden
    twoPassObjects?: string[]; // Opcional, para forzar 2 fases
    personAccountsEnabled?: boolean;
  };
  logLevel?: string; // Añadido para permitir la configuración del nivel de log
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

export const DEFAULT_APP_CONFIG: AppConfig = {
  orgs: {},
  jobConfig: {
    personAccountsEnabled: false
  },
  logLevel: 'INFO'
};

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

export interface Field {
  name: string;
  label: string;
  type: string;
  custom: boolean;
  updateable: boolean;
  createable: boolean;
  nillable: boolean;
  unique?: boolean;
  relationshipName: string | null | undefined;
  referenceTo: string[] | null | undefined;
  length?: number; // Añadido por si es útil, común en describe
  precision?: number; // Añadido por si es útil
  scale?: number; // Añadido por si es útil
  picklistValues?: any[] | null; // Ajustado para ser compatible con jsforce
}

export interface SObjectDescribe {
  name: string;
  label: string;
  custom: boolean;
  queryable: boolean;
  retrieveable: boolean; // Añadido para soportar la detección de Tooling API
  url?: string; // Añadido para soportar la detección de Tooling API (describe.url)
  fields: Field[];
  childRelationships?: ChildRelationship[];
}

// Interfaz para la información de los alias de organización
export interface OrgAliasInfo {
  alias: string;
  username: string;
  orgId: string;
  instanceUrl: string;
  connectedStatus: 'Connected' | 'Not Connected' | 'Unknown';
  isDefaultUsername: boolean;
  isDefaultDevHubUsername: boolean;
  isProjectDefault?: boolean;
  // Otros campos relevantes de 'sf org list --all --json'
  // por ejemplo: lastUsedDate, sfdxAuthUrl, etc.
}

// Estructura del mapa de IDs
export type IdMap = { [sourceId: string]: string };