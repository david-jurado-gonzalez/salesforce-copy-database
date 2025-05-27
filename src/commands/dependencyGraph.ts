import { SObjectDescribe } from './typeDefs';
import { logger } from './logger';

/**
 * Este módulo es una de las piezas más "inteligentes" de la herramienta. Su responsabilidad es 
 * analizar las relaciones entre los objetos y proporcionar un plan de ejecución lógico y seguro 
 * para el comando deploy. La implementación utiliza el algoritmo de Kahn para el ordenamiento 
 * topológico, que es eficiente y detecta ciclos de forma natural.
 */

/**
 * Representa un grafo de dependencias entre SObjects de Salesforce.
 * El grafo es dirigido, donde una arista A -> B significa que "A depende de B".
 * Por lo tanto, B debe ser procesado antes que A.
 */
export class DependencyGraph {
  /**
   * Almacena los metadatos de cada objeto (nodo) en el grafo.
   * Clave: Nombre del SObject (ej: 'Account').
   * Valor: El resultado de la llamada `describe` para ese objeto.
   */
  private readonly nodes: Map<string, SObjectDescribe> = new Map();

  /**
   * Lista de adyacencia que representa las dependencias.
   * Clave: Nombre del SObject que tiene la dependencia.
   * Valor: Un Set de los nombres de los SObjects de los que depende.
   * Ejemplo: `adj.get('Contact')` podría contener `{'Account', 'User'}`.
   */
  private readonly adj: Map<string, Set<string>> = new Map();

  /**
   * Añade un nuevo objeto (nodo) al grafo.
   * @param objectName El nombre de API del SObject.
   * @param describe El resultado de la llamada `describe` para ese objeto.
   */
  public addNode(objectName: string, describe: SObjectDescribe): void {
    if (!this.nodes.has(objectName)) {
      this.nodes.set(objectName, describe);
      this.adj.set(objectName, new Set());
      logger.debug(`[Graph] Nodo añadido: ${objectName}`);
    }
  }

  /**
   * Construye las aristas para un nodo dado, analizando sus campos de relación.
   * Una arista se crea si un campo es un Lookup o Master-Detail a otro objeto
   * que también está incluido en el ámbito del despliegue actual.
   * @param objectName El nombre del objeto para el que se construirán las aristas.
   * @param objectsInScope Un Set con todos los nombres de objetos que forman parte del despliegue.
   */
  public buildEdges(objectName: string, objectsInScope: Set<string>): void {
    const describe = this.nodes.get(objectName);
    if (!describe) return;

    for (const field of describe.fields) {
      // Nos interesan los campos de tipo 'reference' (Lookup/Master-Detail)
      if (field.type === 'reference' && field.referenceTo && field.referenceTo.length > 0) {
        // Un campo puede apuntar a varios tipos de objeto (polimórfico, ej: WhatId en Task)
        for (const relatedObjectName of field.referenceTo) {
          // Solo creamos la arista si el objeto relacionado está en nuestro lote de despliegue
          if (objectsInScope.has(relatedObjectName)) {
            this.adj.get(objectName)!.add(relatedObjectName);
            logger.debug(`[Graph] Arista creada: ${objectName} -> ${relatedObjectName}`);
          }
        }
      }
    }
  }

  /**
   * Realiza un ordenamiento topológico del grafo para determinar el orden de despliegue.
   * Utiliza el algoritmo de Kahn.
   * @returns Un objeto que contiene el orden de despliegue y los ciclos detectados.
   */
  public topologicalSort(): { order: string[]; cycles: Set<string> } {
    const inDegree: Map<string, number> = new Map();
    const queue: string[] = [];
    const order: string[] = [];
    const objectNames = Array.from(this.nodes.keys());

    // 1. Inicializar el grado de entrada (in-degree) de todos los nodos a 0.
    objectNames.forEach(name => inDegree.set(name, 0));

    // 2. Calcular el grado de entrada de cada nodo.
    // Por cada arista A -> B, incrementamos el grado de entrada de A.
    this.adj.forEach((dependencies, node) => {
      dependencies.forEach(dep => {
        // En nuestra convención A -> B, A depende de B.
        // El algoritmo de Kahn funciona sobre las aristas salientes, pero es conceptualmente
        // más fácil pensar en "grado de dependencia". Un nodo con in-degree 0 no depende de nadie.
        // Por tanto, la arista Contact -> Account significa que el in-degree de Contact aumenta.
        inDegree.set(node, inDegree.get(node)! + 1);
      });
    });

    // 3. Encolar todos los nodos con grado de entrada 0.
    // Estos son los objetos que no tienen dependencias, como User o RecordType.
    inDegree.forEach((degree, node) => {
      if (degree === 0) {
        queue.push(node);
      }
    });

    // 4. Procesar la cola.
    while (queue.length > 0) {
      const u = queue.shift()!;
      order.push(u);

      // Recorremos todos los nodos para ver cuáles dependen de 'u'.
      this.adj.forEach((dependencies, v) => {
        if (dependencies.has(u)) {
          // 'v' depende de 'u'. Como 'u' ya está procesado, reducimos el grado de dependencia de 'v'.
          const newDegree = inDegree.get(v)! - 1;
          inDegree.set(v, newDegree);
          if (newDegree === 0) {
            queue.push(v);
          }
        }
      });
    }

    // 5. Detectar ciclos.
    // Si el ordenamiento no incluye todos los nodos, es que hay un ciclo.
    if (order.length < objectNames.length) {
      const cycles = new Set(objectNames.filter(name => !order.includes(name)));
      logger.warn(`[Graph] ¡Ciclo de dependencias detectado! Objetos involucrados: ${Array.from(cycles).join(', ')}`);
      return { order, cycles };
    }
    
    // El orden resultante es [A, B, C] donde A no tiene dependencias.
    // Pero para el despliegue, necesitamos procesar las dependencias primero.
    // Ejemplo: Si el resultado es [User, Account, Contact], es correcto porque User y Account no dependen de nadie
    // y Contact depende de ellos. El despliegue debe seguir este orden.
    return { order, cycles: new Set() };
  }
  
  /**
   * Identifica los objetos que necesitan un despliegue en dos fases (un `UPDATE` posterior).
   * Un objeto necesita dos fases si:
   * 1. Forma parte de un ciclo de dependencias.
   * 2. Tiene un campo de lookup OPCIONAL (`nillable: true`) a un objeto que aparece MÁS TARDE en el orden de despliegue.
   * @param deploymentOrder El orden de despliegue calculado por `topologicalSort`.
   * @param cycles Un Set con los objetos que forman parte de un ciclo.
   * @returns Un Set con los nombres de los objetos que requieren dos fases.
   */
  public getTwoPassObjects(deploymentOrder: string[], cycles: Set<string>): Set<string> {
    const twoPassObjects = new Set<string>(cycles);
    const orderIndexMap = new Map(deploymentOrder.map((obj, i) => [obj, i]));

    for (const objectName of deploymentOrder) {
      const describe = this.nodes.get(objectName);
      if (!describe) continue;

      const currentIndex = orderIndexMap.get(objectName)!;

      for (const field of describe.fields) {
        // Buscamos lookups opcionales. Master-Detail (`nillable: false`) no puede esperar.
        if (field.type === 'reference' && field.nillable && field.referenceTo) {
          for (const relatedObjectName of field.referenceTo) {
            const relatedIndex = orderIndexMap.get(relatedObjectName);

            // Si el objeto relacionado existe y se procesará DESPUÉS del objeto actual...
            if (relatedIndex !== undefined && relatedIndex > currentIndex) {
              // ...entonces el objeto actual necesita una segunda fase para rellenar este campo.
              twoPassObjects.add(objectName);
              logger.debug(`[Graph] ${objectName} marcado para 2 fases debido a lookup opcional a ${relatedObjectName}.`);
              // Salimos del bucle de campos, ya que con una sola razón es suficiente.
              break; 
            }
          }
        }
        if (twoPassObjects.has(objectName)) break;
      }
    }

    return twoPassObjects;
  }
}