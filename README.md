# json-api

json-api can fetch typed data models via a JSON:API endpoint into normalised records.

An instance is created with an endpoint and model definitions and the instance API provides methods `findAll`, `findRecord` to fetch record(s). Included relationships will be automatically resolved. If relationships for a record are not included they can be fetched later using `findRelated`.

## Example usage

A service returning the canonical example JSON:API document at https://jsonapi.org/ can be consumed this way:

```ts
import { useJsonApi, type ModelDefinition, RelationshipType } from '@bjornharrtell/json-api'

export interface Person {
  id: string
  lid?: string
  type: string
  firstName?: string
  lastName?: string
  twitter?: string
}

export interface Comment {
  id: string
  lid?: string
  type: string
  body?: string
  author?: Person
}

export interface Article {
  id: string
  lid?: string
  type: string
  title?: string
  author?: Person
  comments?: Comment[]
}

const modelDefinitions: ModelDefinition[] = [
  {
    type: 'people',
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

export const articlesApi = useJsonApi({
  endpoint: 'http://localhost/api',
  modelDefinitions,
})
```

The above can then be used as follows:

```ts
import { articlesApi, type Article } from './api/articles'

const { records: articles } = await articlesApi.findAll<Article>('articles', { 
  include: ['comments', 'author'] 
})
expect(articles.length).toBe(1)
const article = articles[0]
expect(article.id).toBe('1')
expect(article.title).toBe('JSON:API paints my bikeshed!')
expect(article.comments?.length).toBe(2)
expect(article.comments?.[0]?.body).toBe('First!')
expect(article.comments?.[1]?.body).toBe('I like XML better')
expect(article.author?.firstName).toBe('Dan')
```