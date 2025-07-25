# json-api

json-api can fetch typed data models via an JSON:API endpoint into record instances.

An instance is created with an endpoint and model definitions and the instance API provides methods `findAll`, `findRecord` to fetch record(s). Included relationships will be automatically resolved. If relationships for a record are not included they can be fetched later using `findRelated`.

## Example usage

A service returning the canonical example JSON:API document at https://jsonapi.org/ can be consumed this way:

```ts
import { useJsonApi, Model, type ModelDefinition, RelationshipType } from '@bjornharrtell/json-api'

export class Person extends Model {
  firstName?: string
  lastName?: string
  twitter?: string
}

export class Comment extends Model {
  body?: string
}

export class Article extends Model {
  title?: string
  author: Person | null = null
  comments: Comment[] = []
}

const modelDefinitions: ModelDefinition[] = [
  {
    type: 'person',
    ctor: Person,
  },
  {
    type: 'comment',
    ctor: Comment,
  },
  {
    type: 'article',
    ctor: Article,
    rels: {
      author: { ctor: Person, type: RelationshipType.BelongsTo },
      comments: { ctor: Comment, type: RelationshipType.HasMany },
    },
  },
]

export const aticlesApi = useJsonApi({
  endpoint: 'http://localhost/api',
  modelDefinitions,
})
```

The above can then be used as follows:

```ts
import aticlesApi from './api/articles'
const { records: articles } = await aticlesApi.findAll(Article, { include: ['comments', 'author'] })
expect(articles.length).toBe(1)
const article = articles[0]
expect(article.id).toBe('1')
expect(article.title).toBe('JSON:API paints my bikeshed!')
expect(article.comments.length).toBe(2)
expect(article.comments[0].body).toBe('First!')
expect(article.comments[1].body).toBe('I like XML better')
expect(article.author?.firstName).toBe('Dan')
```
