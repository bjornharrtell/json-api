import { type FetchOptions, type FetchParams, type JsonApiFetcher, JsonApiFetcherImpl } from './json-api-fetcher.ts'
import { camel } from './util.ts'

export interface JsonApiResourceIdentifier {
  id?: string
  lid?: string
  type: string
}

export interface JsonApiRelationship {
  data: null | [] | JsonApiResourceIdentifier | JsonApiResourceIdentifier[]
}

export interface JsonApiResource {
  id?: string
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

export interface JsonApiAtomicOperation {
  op: 'add' | 'update' | 'remove'
  data: JsonApiResource
}

export interface JsonApiAtomicResults {
  data: JsonApiResource[]
  meta?: JsonApiMeta
}

export interface JsonApiAtomicDocument {
  ['atomic:operations']?: JsonApiAtomicOperation[]
  ['atomic:results']?: JsonApiAtomicResults
  errors?: JsonApiError[]
}

export interface AtomicOperation {
  op: 'add' | 'update' | 'remove'
  data: BaseEntity
}

export interface BaseEntity {
  id: string
  lid?: string
  type: string
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

function setRelationship(record: BaseEntity, name: string, value: unknown): void {
  (record as unknown as Record<string, unknown>)[name] = value
}

export type JsonApi = ReturnType<typeof useJsonApi>

export function useJsonApi(config: JsonApiConfig, fetcher?: JsonApiFetcher) {
  const _fetcher = fetcher ?? new JsonApiFetcherImpl(config.endpoint)

  // Map type names to their definitions
  const modelDefinitions = new Map<string, ModelDefinition>()
  const relationshipDefinitions = new Map<string, Record<string, Relationship>>()

  for (const modelDef of config.modelDefinitions) {
    modelDefinitions.set(modelDef.type, modelDef)
    if (modelDef.relationships)
      relationshipDefinitions.set(modelDef.type, modelDef.relationships)
  }

  function normalize(str: string) {
    return config.kebabCase ? camel(str) : str
  }

  function serializeRid(entity: BaseEntity): JsonApiResourceIdentifier {
    const rid: JsonApiResourceIdentifier = { type: entity.type }
    if (entity.lid) rid.lid = entity.lid
    else if (entity.id) rid.id = entity.id
    return rid
  }

  function serialize(record: BaseEntity): JsonApiResource {
    const relationships = relationshipDefinitions.get(record.type) 
    const resource: JsonApiResource = serializeRid(record) as JsonApiResource
    resource.attributes = {}
    if (relationships)
      resource.relationships = {}
    for (const [key, value] of Object.entries(record)) {
      if (key === 'id' || key === 'lid' || key === 'type' || value === undefined)
        continue
      if (relationships && key in relationships) {
        const rel = relationships[key]
        if (rel.relationshipType === RelationshipType.HasMany) {
          const entities = value as unknown as BaseEntity[]
          resource.relationships![key] = {
            data: entities.map(serializeRid),
          }
        } else if (rel.relationshipType === RelationshipType.BelongsTo) {
          const entity = value as unknown as BaseEntity
          resource.relationships![key] = {
            data: serializeRid(entity),
          }
        } else {
          throw new Error(`Unknown relationship type for ${key}`)
        }
      } else {
        resource.attributes[key] = value
      }
    }
    return resource
  }

  function createRecord<T extends BaseEntity>(type: string, properties: Partial<T> & { id?: string }): T {
    const modelDef = modelDefinitions.get(type)
    if (!modelDef) throw new Error(`Model type ${type} not defined`)

    const id = properties.id ?? crypto.randomUUID()

    const record = { id, type, ...properties } as T
    
    // Normalize property keys if needed
    if (config.kebabCase) {
      const normalizedRecord = { id, type } as BaseEntity & Record<string, unknown>
      for (const [key, value] of Object.entries(properties))
        if (key !== 'id' && value !== undefined)
          normalizedRecord[normalize(key)] = value
      return normalizedRecord as T
    }
    
    return record as T
  }

  function resourcesToRecords<T extends BaseEntity>(
    resources: JsonApiResource[],
    included?: JsonApiResource[],
  ): T[] {
    // Create records for included resources
    const includedMap = new Map<string, BaseEntity>()
    if (included) {
      for (const resource of included) {
        const record = createRecord<BaseEntity>(resource.type, {
          id: resource.id,
          ...resource.attributes,
        })
        includedMap.set(resource.id!, record)
      }
    }

    // Create records for main resources
    const records = resources.map(resource => 
      createRecord<T>(resource.type, {
        id: resource.id,
        ...(resource.attributes as Partial<T>),
      })
    )

    const recordsMap = new Map<string, BaseEntity>()
    for (const record of records)
      recordsMap.set(record.id!, record)

    // Populate relationships
    function populateRelationships(resource: JsonApiResource) {
      const record = recordsMap.get(resource.id!) ?? includedMap.get(resource.id!)
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
          .map(d => includedMap.get(d.id!) || recordsMap.get(d.id!))
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
    const records = resourcesToRecords<T>(resources, doc.included)
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
    const records = resourcesToRecords<T>([resource], doc.included)
    const record = records[0]
    if (!record) throw new Error(`Record with id ${id} not found`)
    return record
  }

  async function findRelated(
    record: BaseEntity,
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
      const doc = await _fetcher.fetchBelongsTo(type, record.id!, relationshipName, options, params)
      const related = doc.data as JsonApiResource
      const relatedRecord = createRecord(rel.type, {
        id: related.id,
        ...related.attributes,
      })
      setRelationship(record, relationshipName, relatedRecord)
      return doc
    }

    const doc = await _fetcher.fetchHasMany(type, record.id!, relationshipName, options, params)
    const related = rel.relationshipType === RelationshipType.HasMany
      ? (doc.data as JsonApiResource[])
      : [doc.data as JsonApiResource]
    
    const relatedRecords = related.map(r => createRecord(rel.type, {
      id: r.id,
      ...r.attributes,
    }))
    
    setRelationship(record, relationshipName, rel.relationshipType === RelationshipType.HasMany 
      ? relatedRecords 
      : relatedRecords[0])
    
    return doc
  }

  async function saveRecord<T extends BaseEntity>(record: BaseEntity, options?: FetchOptions): Promise<T> {
    const resource = serialize(record)
    const doc = await _fetcher.post(resource, options)
    const records = resourcesToRecords<T>([doc.data] as JsonApiResource[])
    return records[0] as T
  }

  async function saveAtomic(operations: AtomicOperation[], options?: FetchOptions): Promise<{ doc: JsonApiAtomicResults; records: BaseEntity[] }> {
    const atomicOperations = operations.map(op => ({ op: op.op, data: serialize(op.data) } as JsonApiAtomicOperation))
    const atomicDoc: JsonApiAtomicDocument = {
      ['atomic:operations']: atomicOperations,
    }
    const doc = await _fetcher.postAtomic(atomicDoc, options)
    const records = resourcesToRecords(doc.data)
    return { doc, records }
  }

  return {
    findAll,
    findRecord,
    findRelated,
    createRecord,
    saveRecord,
    saveAtomic,
  }
}
