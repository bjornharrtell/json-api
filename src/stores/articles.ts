import {
  type BaseEntity,
  type JsonApiAtomicDocument,
  type JsonApiDocument,
  type JsonApiResource,
  type JsonApiResourceIdentifier,
  type ModelDefinition,
  RelationshipType,
  useJsonApi,
} from '../json-api.ts'
import type { JsonApiFetcher, Options } from '../json-api-fetcher.ts'
import doc from './articles.json'

export class JsonApiFetcherArticles implements JsonApiFetcher {
  endpoint = 'http://localhost:3000'
  doc: JsonApiDocument
  articles: JsonApiResource[]
  included: JsonApiResource[]
  constructor() {
    this.doc = doc as unknown as JsonApiDocument
    this.articles = this.doc.data as JsonApiResource[]
    this.included = this.doc.included as JsonApiResource[]
  }
  createOptions(): Options {
    throw new Error('Method not implemented.')
  }
  async postAtomic(doc: JsonApiAtomicDocument): Promise<JsonApiAtomicDocument | undefined> {
    const results = doc['atomic:operations']?.map((op) => ({ data: op.data as JsonApiResource }))
    if (results && results.length > 0 && results[0].data === undefined) return undefined
    return { 'atomic:results': results }
  }
  async fetchDocument(_type: string, id?: string): Promise<JsonApiDocument> {
    if (id) {
      const data = this.articles.find((a) => a.id === id)
      if (!data) throw new Error(`Article ${id} not found`)
      return {
        data,
        included: this.included,
      }
    }
    return this.doc
  }
  async fetchAll(_type: string): Promise<JsonApiResource[]> {
    return this.articles
  }
  async fetchOne(_type: string, id: string): Promise<JsonApiResource> {
    const article = this.articles.find((a) => a.id === id)
    if (!article) throw new Error(`Article ${id} not found`)
    return article
  }
  async fetchHasMany(_type: string, id: string, name: string) {
    const article = this.articles.find((a) => a.id === id)
    if (!article) throw new Error(`Article ${id} not found`)
    if (!article.relationships) throw new Error(`Relationships for article ${id} not found`)
    const relationship = article.relationships[name]
    const findIncluded = (rid: JsonApiResourceIdentifier) => {
      const resource = this.included.find((i) => i.id === rid.id)
      if (!resource) throw new Error(`Resource ${id} not found`)
      return resource
    }
    const rids = relationship.data as JsonApiResourceIdentifier[]
    const related = rids.map(findIncluded)
    return { data: related } as JsonApiDocument
  }
  async fetchBelongsTo(type: string, id: string, name: string) {
    if (type !== 'article') throw new Error(`Type ${type} not supported`)
    const article = this.articles.find((a) => a.id === id)
    if (!article) throw new Error(`Article ${id} not found`)
    if (!article.relationships) throw new Error(`Relationships for article ${id} not found`)
    const relationship = article.relationships[name]
    const findIncluded = (rid: JsonApiResourceIdentifier) => {
      const resource = this.included.find((i) => i.id === rid.id)
      if (!resource) throw new Error(`Resource ${id} not found`)
      return resource
    }
    const rid = relationship.data as JsonApiResourceIdentifier
    const related = findIncluded(rid)
    return { data: related } as JsonApiDocument
  }
  async post(data: JsonApiResource): Promise<JsonApiDocument> {
    return {
      data,
    }
  }
}

export interface Person extends BaseEntity {
  firstName?: string
  lastName?: string
  twitter?: string
  comments?: Comment[]
}

export interface Comment extends BaseEntity {
  body?: string
  author?: Person | null
}

export interface Article extends BaseEntity {
  title?: string
  author?: Person | null
  comments?: Comment[]
}

const modelDefinitions: ModelDefinition[] = [
  {
    type: 'people',
    relationships: {
      comments: { type: 'comments', relationshipType: RelationshipType.HasMany },
    },
  },
  {
    type: 'comments',
    relationships: {
      author: { type: 'people', relationshipType: RelationshipType.BelongsTo },
    },
  },
  {
    type: 'articles',
    relationships: {
      author: { type: 'people', relationshipType: RelationshipType.BelongsTo },
      comments: { type: 'comments', relationshipType: RelationshipType.HasMany },
    },
  },
]

export const articlesJsonApi = useJsonApi(
  { endpoint: 'http://localhost:3000', modelDefinitions },
  new JsonApiFetcherArticles(),
)
