// src/core/typeDefs.ts
import { Connection } from 'jsforce';

export interface OrgConfig {
  loginUrl?: string;
  username?: string;
  password?: string;
}

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
  config: string;
  force?: boolean;
}

// Interfaz para la descripción de un SObject de Salesforce
export interface SObjectDescribe {
  name: string;
  fields: {
    name: string;
    type: string;
    updateable: boolean;
    createable: boolean;
    nillable: boolean;
    relationshipName: string | null | undefined;
    referenceTo: string[] | null | undefined;
  }[];
}

// Estructura del mapa de IDs
export type IdMap = { [sourceId: string]: string };