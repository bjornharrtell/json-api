import { type FetchOptions, type FetchParams, type JsonApiFetcher, JsonApiFetcherImpl } from './json-api-fetcher.ts'
import { camel } from './util.ts'

export interface JsonApiResourceIdentifier {
  id: string
  lid?: string
  type: string
}

export interface JsonApiRelationship {
  data: null | [] | JsonApiResourceIdentifier | JsonApiResourceIdentifier[]
}

export interface JsonApiResource {
  id: string
  lid?: string
  type: string
  attributes: Record<string, unknown>
  relationships?: Record<string, JsonApiRelationship>
}

export interface JsonApiMeta {
  // Pagination
  totalPages?: number
  totalItems?: number
  currentPage?: number
  itemsPerPage?: number

  // Common metadata
  timestamp?: string | number
  version?: string
  copyright?: string

  // Allow additional custom properties
  [key: string]: unknown
}

export interface JsonApiLinkObject {
  href: string
  rel?: string
  describedby?: JsonApiLink
  title?: string
  type?: string
  hreflang?: string | string[]
  meta?: JsonApiMeta
}

export type JsonApiLink = null | string | JsonApiLinkObject

export interface JsonApiLinks {
  self?: JsonApiLink
  related?: JsonApiLink
  describedby?: JsonApiLink
  first?: JsonApiLink
  last?: JsonApiLink
  prev?: JsonApiLink
  next?: JsonApiLink
}

export interface JsonApiDocument {
  links?: JsonApiLinks
  data?: JsonApiResource | JsonApiResource[]
  errors?: JsonApiError[]
  included?: JsonApiResource[]
  meta?: JsonApiMeta
}

export interface JsonApiError {
  id: string
  status: string
  code?: string
  title: string
  detail?: string
  meta?: JsonApiMeta
}

/**
 * Type-safe helper to set a relationship on a record
 */
function setRelationship(record: BaseRecord, name: string, value: unknown): void {
  (record as Record<string, unknown>)[name] = value
}

export interface BaseEntity {
  id: string
  lid?: string
  type: string
}

/**
 * Base interface for records
 */
export interface BaseRecord extends BaseEntity {
  [key: string]: unknown
}

/**
 * Model definition
 */
export interface ModelDefinition {
  /**
   * The JSON:API type for the model
   */
  type: string
  /**
   * Optional relationships for the model
   */
  relationships?: Record<string, Relationship>
}

export interface JsonApiConfig {
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
  /** The JSON:API type name of the related model */
  type: string
  /** The relationship type */
  relationshipType: RelationshipType
}

export interface JsonApi {
  /**
   * Find all records of a given type
   * @returns the JSON API document that was fetched and the records that were found
   */
  findAll<T extends BaseEntity>(
    type: string,
    options?: FetchOptions,
    params?: FetchParams,
  ): Promise<{ doc: JsonApiDocument; records: T[] }>

  /**
   * Find a single record by id
   * @returns the record that was found
   */
  findRecord<T extends BaseEntity>(
    type: string,
    id: string,
    options?: FetchOptions,
    params?: FetchParams,
  ): Promise<T>

  /**
   * Find related records for a given record and relationship name
   * @returns the JSON API document that was fetched
   */
  findRelated<T extends BaseEntity>(
    record: T, 
    relationshipName: string, 
    options?: FetchOptions, 
    params?: FetchParams
  ): Promise<JsonApiDocument>

  /**
   * Create a new record instance
   */
  createRecord<T extends BaseEntity>(type: string, properties: Partial<T> & { id?: string }): T

  /**
   * Save a record
   */
  saveRecord<T extends BaseEntity>(record: T): Promise<void>
}

export type JsonApiUseFunction = () => JsonApi

export function useJsonApi(config: JsonApiConfig, fetcher?: JsonApiFetcher): JsonApi {
  const _fetcher = fetcher ?? new JsonApiFetcherImpl(config.endpoint)

  // Map type names to their definitions
  const modelDefinitions = new Map<string, ModelDefinition>()
  const relationshipDefinitions = new Map<string, Record<string, Relationship>>()

  for (const modelDef of config.modelDefinitions) {
    modelDefinitions.set(modelDef.type, modelDef)
    if (modelDef.relationships) {
      relationshipDefinitions.set(modelDef.type, modelDef.relationships)
    }
  }

  function normalize(str: string) {
    return config.kebabCase ? camel(str) : str
  }

  function createRecord<T extends BaseEntity>(type: string, properties: Partial<T> & { id?: string }): T {
    const modelDef = modelDefinitions.get(type)
    if (!modelDef) throw new Error(`Model type ${type} not defined`)

    const id = properties.id ?? crypto.randomUUID()

    const record = { id, type, ...properties } as T
    
    // Normalize property keys if needed
    if (config.kebabCase) {
      const normalizedRecord = { id, type } as Record<string, unknown> & BaseRecord
      for (const [key, value] of Object.entries(properties)) {
        if (key !== 'id' && value !== undefined) {
          normalizedRecord[normalize(key)] = value
        }
      }
      return normalizedRecord as T
    }
    
    return record as T
  }

  function resourcesToRecords<T extends BaseEntity>(
    type: string,
    resources: JsonApiResource[],
    included?: JsonApiResource[],
  ): T[] {
    // Create records for included resources
    const includedMap = new Map<string, BaseRecord>()
    if (included) {
      for (const resource of included) {
        const record = createRecord<BaseEntity>(resource.type, {
          id: resource.id,
          ...(resource.attributes as Record<string, unknown>),
        }) as BaseRecord
        includedMap.set(resource.id, record)
      }
    }

    // Create records for main resources
    const records = resources.map(resource => 
      createRecord<T>(type, {
        id: resource.id,
        ...(resource.attributes as Partial<T>),
      })
    )

    const recordsMap = new Map<string, BaseRecord>()
    for (const record of records) {
      recordsMap.set(record.id, record as unknown as BaseRecord)
    }

    // Populate relationships
    function populateRelationships(resource: JsonApiResource) {
      const record = recordsMap.get(resource.id) ?? includedMap.get(resource.id)
      if (!record) throw new Error('Unexpected not found record')
      
      if (!resource.relationships) return

      const rels = relationshipDefinitions.get(resource.type)
      if (!rels) return

      for (const [name, reldoc] of Object.entries(resource.relationships)) {
        const normalizedName = normalize(name)
        const rel = rels[normalizedName]
        if (!rel) continue // Ignore undefined relationships

        const rids = rel.relationshipType === RelationshipType.HasMany
          ? (reldoc.data as JsonApiResourceIdentifier[])
          : [reldoc.data as JsonApiResourceIdentifier]

        const relatedRecords = rids
          .filter(d => d && d.type === rel.type)
          .map(d => includedMap.get(d.id) || recordsMap.get(d.id))
          .filter(Boolean)

        setRelationship(record, normalizedName, rel.relationshipType === RelationshipType.HasMany 
          ? relatedRecords 
          : relatedRecords[0])
      }
    }

    if (included) {
      resources.forEach(populateRelationships)
      included.forEach(populateRelationships)
    }

    return records
  }

  async function findAll<T extends BaseEntity>(
    type: string,
    options?: FetchOptions,
    params?: FetchParams,
  ): Promise<{ doc: JsonApiDocument; records: T[] }> {
    const doc = await _fetcher.fetchDocument(type, undefined, options, params)
    const resources = doc.data as JsonApiResource[]
    const records = resourcesToRecords<T>(type, resources, doc.included)
    return { doc, records }
  }

  async function findRecord<T extends BaseEntity>(
    type: string,
    id: string,
    options?: FetchOptions,
    params?: FetchParams,
  ): Promise<T> {
    const doc = await _fetcher.fetchDocument(type, id, options, params)
    const resource = doc.data as JsonApiResource
    const records = resourcesToRecords<T>(type, [resource], doc.included)
    const record = records[0]
    if (!record) throw new Error(`Record with id ${id} not found`)
    return record
  }

  async function findRelated<T extends BaseEntity>(
    record: T,
    relationshipName: string,
    options?: FetchOptions,
    params?: FetchParams,
  ): Promise<JsonApiDocument> {
    const type = record.type
    const rels = relationshipDefinitions.get(type)
    if (!rels) throw new Error(`Model ${type} has no relationships`)
    
    const rel = rels[relationshipName]
    if (!rel) throw new Error(`Relationship ${relationshipName} not defined`)

    if (rel.relationshipType === RelationshipType.BelongsTo) {
      const doc = await _fetcher.fetchBelongsTo(type, record.id, relationshipName, options, params)
      const related = doc.data as JsonApiResource
      const relatedRecord = createRecord(rel.type, {
        id: related.id,
        ...(related.attributes as Record<string, unknown>),
      })
      setRelationship(record as unknown as BaseRecord, relationshipName, relatedRecord)
      return doc
    }

    const doc = await _fetcher.fetchHasMany(type, record.id, relationshipName, options, params)
    const related = rel.relationshipType === RelationshipType.HasMany
      ? (doc.data as JsonApiResource[])
      : [doc.data as JsonApiResource]
    
    const relatedRecords = related.map(r => createRecord(rel.type, {
      id: r.id,
      ...(r.attributes as Record<string, unknown>),
    }))
    
    setRelationship(record as unknown as BaseRecord, relationshipName, rel.relationshipType === RelationshipType.HasMany 
      ? relatedRecords 
      : relatedRecords[0])
    
    return doc
  }

  async function saveRecord<T extends BaseEntity>(record: T, options?: FetchOptions): Promise<void> {
    const type = record.type    
    const resource: JsonApiResource = {
      id: record.id,
      type,
      attributes: record as Record<string, unknown>,
    }
    await _fetcher.post(resource, options)
  }

  return {
    findAll,
    findRecord,
    findRelated,
    createRecord,
    saveRecord,
  }
}
