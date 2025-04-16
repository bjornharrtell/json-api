import type { JsonApiDocument, JsonApiResource, JsonApiResourceIdentifier } from './json-api.js'
import { type FetchOptions, type FetchParams, type JsonApiFetcher, JsonApiFetcherImpl } from './json-api-fetcher.js'
import { camel } from './util.js'

/**
 * Base class for models
 */
export class Model {
  constructor(public id: string) {
    this.id = id
  }
  [key: string]: unknown
}

export interface ModelDefinition {
  /**
   * The JSON:API type for the model
   */
  type: string
  /**
   * The model constructor
   */
  ctor: typeof Model
  /**
   * Relationships for the model
   */
  rels?: Record<string, Relationship>
}

export interface JsonApiStoreConfig {
  /**
   * The URL for the JSON:API endpoint
   */
  endpoint: string
  /**
   * Model definitions for the store
   */
  modelDefinitions: ModelDefinition[]
  /**
   * Whether to convert kebab-case names from JSON:API (older convention) to camelCase
   */
  kebabCase?: boolean
}

export enum RelationshipType {
  HasMany = 0,
  BelongsTo = 1,
}

/**
 * Relationship definition
 */
export interface Relationship {
  ctor: typeof Model
  type: RelationshipType
}

export interface JsonApiStore {
  /**
   * Models registered with this store
   */
  modelRegistry: Map<typeof Model, string>
  /**
   * Relationships registered with this store
   */
  relRegistry: Map<typeof Model, Record<string, Relationship>>
  /**
   * @internal
   */
  createRecord<T extends typeof Model>(ctor: T, properties: Partial<InstanceType<T>> & { id?: string }): InstanceType<T>
  /**
   * Find all records of a given type
   * @returns the JSON API document that was fetched and the records that were found
   */
  findAll<T extends typeof Model>(
    ctor: T,
    options?: FetchOptions,
    params?: FetchParams
  ): Promise<{ doc: JsonApiDocument; records: InstanceType<T>[] }>
  /**
   * Find a single record by id
   * @returns the record that was found
   */
  findRecord<T extends typeof Model>(
    ctor: T,
    id: string,
    options?: FetchOptions,
    params?: FetchParams
  ): Promise<InstanceType<T>>
  /**
   * Find related records for a given record and relationship name
   * @returns the JSON API document that was fetched
   */
  findRelated(record: Model, name: string, options?: FetchOptions, params?: FetchParams): Promise<JsonApiDocument>
}

export type JsonApiStoreUseFunction = () => JsonApiStore

export function createJsonApiStore(name: string, config: JsonApiStoreConfig, fetcher?: JsonApiFetcher) {
  const _fetcher = fetcher ?? new JsonApiFetcherImpl(config.endpoint)

  const modelRegistry = new Map<typeof Model, string>()
  const modelsByType = new Map<string, typeof Model>()
  const relsRegistry = new Map<typeof Model, Record<string, Relationship>>()

  for (const modelDef of config.modelDefinitions) {
    const ctor = modelDef.ctor
    modelRegistry.set(ctor, modelDef.type)
    modelsByType.set(modelDef.type, ctor)
    if (modelDef.rels) relsRegistry.set(ctor, modelDef.rels)
  }

  function normalize(str: string) {
    return config.kebabCase ? camel(str) : str
  }

  function internalCreateRecord<T extends typeof Model>(ctor: T, id: string, properties?: Partial<InstanceType<T>>) {
    const type = getModelType(ctor)
    const record = new ctor(id)
    if (properties)
      for (const [key, value] of Object.entries(properties)) if (value !== undefined) record[normalize(key)] = value
    return record as InstanceType<T>
  }

  function getModelType(ctor: typeof Model) {
    const type = modelRegistry.get(ctor)
    if (!type) throw new Error(`Model ${ctor.name} not defined`)
    return type
  }

  function getModel(type: string) {
    const ctor = modelsByType.get(type)
    if (!ctor) throw new Error(`Model with name ${type} not defined`)
    return ctor
  }

  function resourcesToRecords<T extends typeof Model>(
    ctor: T,
    resources: JsonApiResource[],
    included?: JsonApiResource[]
  ) {
    function createRecord<T extends typeof Model>(resource: JsonApiResource) {
      return internalCreateRecord<T>(
        getModel(resource.type) as T,
        resource.id,
        resource.attributes as Partial<InstanceType<T>>
      )
    }
    // create records for included resources
    const includedMap = new Map<string, InstanceType<typeof Model>>()
    if (included) for (const resource of included) includedMap.set(resource.id, createRecord(resource))
    // create records for main resources
    const records = resources.map((r) => internalCreateRecord<T>(ctor, r.id, r.attributes as Partial<InstanceType<T>>))
    const recordsMap = new Map<string, InstanceType<typeof Model>>()
    for (const r of records) recordsMap.set(r.id, r)
    // populate relationships
    function populateRelationships(resource: JsonApiResource) {
      const record = recordsMap.get(resource.id) ?? includedMap.get(resource.id)
      if (!record) throw new Error('Unexpected not found record')
      const recordCtor = getModel(resource.type)
      if (!resource.relationships) return
      for (const [name, reldoc] of Object.entries(resource.relationships)) {
        const rels = relsRegistry.get(recordCtor)
        // NOTE: if relationship is not defined but exists in data, it is ignored
        if (!rels) continue
        const normalizedName = normalize(name)
        const rel = rels[normalizedName]
        if (!rel) throw new Error(`Relationship ${normalizedName} not defined`)
        const relType = getModelType(rel.ctor)
        const rids =
          rel.type === RelationshipType.HasMany
            ? (reldoc.data as JsonApiResourceIdentifier[])
            : [reldoc.data as JsonApiResourceIdentifier]
        const relIncludedRecords = rids
          .filter((d) => d && includedMap.has(d.id) && d.type === relType)
          .map((d) => includedMap.get(d.id))
        const relRecords = rids
          .filter((d) => d && recordsMap.has(d.id) && d.type === relType)
          .map((d) => recordsMap.get(d.id))
        relRecords.push(...relIncludedRecords)
        record[normalizedName] = rel.type === RelationshipType.HasMany ? relRecords : relRecords[0]
      }
    }
    if (included) {
      resources.map(populateRelationships)
      included.map(populateRelationships)
    }
    return records as InstanceType<T>[]
  }

  async function findAll<T extends typeof Model>(ctor: T, options?: FetchOptions, params?: FetchParams) {
    const type = getModelType(ctor)
    const doc = await _fetcher.fetchDocument(type, undefined, options, params)
    const resources = doc.data as JsonApiResource[]
    const records = resourcesToRecords(ctor, resources, doc.included)
    return { doc, records }
  }

  async function findRecord<T extends typeof Model>(ctor: T, id: string, options?: FetchOptions, params?: FetchParams) {
    const type = getModelType(ctor)
    const doc = await _fetcher.fetchDocument(type, id, options, params)
    const resource = doc.data as JsonApiResource
    const records = resourcesToRecords(ctor, [resource], doc.included)
    const record = records[0]
    if (!record) throw new Error(`Record with id ${id} not found`)
    return record as InstanceType<T>
  }

  async function findRelated(record: Model, name: string, options?: FetchOptions, params?: FetchParams) {
    const ctor = record.constructor as typeof Model
    const type = getModelType(ctor)
    const rels = relsRegistry.get(ctor)
    if (!rels) throw new Error(`Model ${ctor.name} has no relationships`)
    const rel = rels[name]
    if (!rel) throw new Error(`Has many relationship ${name} not defined`)
    if (rel.type === RelationshipType.BelongsTo) {
      const doc = await _fetcher.fetchBelongsTo(type, record.id, name, options, params)
      const related = doc.data as JsonApiResource
      const relatedRecord = internalCreateRecord(rel.ctor, related.id, related.attributes)
      record[name] = relatedRecord
      return doc
    }
    const doc = await _fetcher.fetchHasMany(type, record.id, name, options, params)
    const related =
      rel.type === RelationshipType.HasMany ? (doc.data as JsonApiResource[]) : [doc.data as JsonApiResource]
    const relatedRecords = related.map((r) => internalCreateRecord(rel.ctor, r.id, r.attributes))
    record[name] = rel.type === RelationshipType.HasMany ? relatedRecords : relatedRecords[0]
    return doc
  }

  async function saveRecord(record: Model) {
    const type = getModelType(record.constructor as typeof Model)
    const resource: JsonApiResource = {
      id: record.id,
      type,
      attributes: record,
    }
    await _fetcher.post(resource)
  }

  return {
    modelRegistry,
    relsRegistry,
    findAll,
    findRecord,
    findRelated,
    saveRecord,
  }
}
