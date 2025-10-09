import type { JsonApiDocument, JsonApiResource, JsonApiResourceIdentifier } from '../json-api.ts'
import { Model, type ModelDefinition, RelationshipType, useJsonApi } from '../json-api.ts'
import type { JsonApiFetcher } from '../json-api-fetcher.ts'
import doc from './articles.json'

export class JsonApiFetcherArticles implements JsonApiFetcher {
  doc: JsonApiDocument
  articles: JsonApiResource[]
  included: JsonApiResource[]
  constructor() {
    this.doc = doc as JsonApiDocument
    this.articles = this.doc.data as JsonApiResource[]
    this.included = this.doc.included as JsonApiResource[]
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
  async post(_data: JsonApiResource): Promise<JsonApiDocument> {
    throw new Error('Not implemented')
  }
}

export class Person extends Model {
  firstName?: string
  lastName?: string
  twitter?: string
}

export class Comment extends Model {
  body?: string
  author: Person | null = null
}

export class Article extends Model {
  title?: string
  author: Person | null = null
  comments: Comment[] = []
}

const modelDefinitions: ModelDefinition[] = [
  {
    type: 'people',
    ctor: Person,
  },
  {
    type: 'comments',
    ctor: Comment,
    rels: {
      author: { ctor: Person, type: RelationshipType.BelongsTo },
    },
  },
  {
    type: 'articles',
    ctor: Article,
    rels: {
      author: { ctor: Person, type: RelationshipType.BelongsTo },
      comments: { ctor: Comment, type: RelationshipType.HasMany },
    },
  },
]

export const articlesJsonApi = useJsonApi(
  { endpoint: 'http://localhost:3000', modelDefinitions },
  new JsonApiFetcherArticles(),
)
