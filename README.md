# json-api

json-api can fetch typed data models via a JSON:API endpoint into record instances.

An instance is created with an endpoint and model definitions and the instance API provides methods `findAll`, `findRecord` to fetch record(s). Included relationships will be automatically resolved. If relationships for a record are not included they can be fetched later using `findRelated`.

## Example usage

A service returning the canonical example JSON:API document at https://jsonapi.org/ can be consumed this way:

```ts
import { useJsonApi, type BaseRecord, type ModelDefinition, RelationshipType } from '@bjornharrtell/json-api'

export interface Person extends BaseRecord {
  firstName?: string
  lastName?: string
  twitter?: string
}

export interface Comment extends BaseRecord {
  body?: string
  author?: Person | null
}

export interface Article extends BaseRecord {
  title?: string
  author?: Person | null
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

## Key Features

- **Type-safe**: Full TypeScript support with interfaces instead of classes
- **Zero runtime overhead**: Types are compile-time only, no class constructors
- **Automatic relationships**: Included relationships are automatically resolved
- **Lazy loading**: Non-included relationships can be fetched later with `findRelated`
- **Symbol-based type tracking**: Clean record objects without type pollution
- **Flexible**: Optional factory functions for custom initialization

## API Reference

### `useJsonApi(config)`

Creates a JSON:API client instance.

**Parameters:**
- `config.endpoint` - The base URL for the JSON:API endpoint
- `config.modelDefinitions` - Array of model definitions
- `config.kebabCase` - Optional: Convert kebab-case to camelCase (default: false)

**Returns:** JsonApi instance with the following methods:

### `findAll<T>(type, options?, params?)`

Fetch all records of a given type.

```ts
const { doc, records } = await api.findAll<Article>('articles', {
  include: ['author', 'comments']
})
```

### `findRecord<T>(type, id, options?, params?)`

Fetch a single record by ID.

```ts
const article = await api.findRecord<Article>('articles', '1', {
  include: ['author']
})
```

### `findRelated<T>(record, relationshipName, options?, params?)`

Fetch related records for a given relationship.

```ts
const doc = await api.findRelated(article, 'comments')
// Comments are now loaded on article.comments
```

### `createRecord<T>(type, properties)`

Create a new record instance.

```ts
const newArticle = api.createRecord<Article>('articles', {
  title: 'New Article',
  author: null
})
```

### `saveRecord<T>(record)`

Save a record to the server.

```ts
await api.saveRecord(article)
```
