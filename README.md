# json-api

![NPM Version](https://img.shields.io/npm/v/%40bjornharrtell%2Fjson-api)
[![Coverage Status](https://coveralls.io/repos/github/bjornharrtell/json-api/badge.svg?branch=main)](https://coveralls.io/github/bjornharrtell/json-api?branch=main)

json-api can fetch typed data models via a JSON:API endpoint into normalised records and/or post or update them.

An instance is created with an endpoint and model definitions and the instance API provides methods `findAll`, `findRecord` to fetch record(s). Included relationships will be automatically resolved. If relationships for a record are not included they can be fetched later using `findRelated`. A record can be created or updated `saveRecord`.

Additionally support for the [atomic operation extension](https://jsonapi.org/ext/atomic/) exists via types and `saveAtomic`.

When a record is serialized (by `saveRecord` or a resource operation in `saveAtomic`), a relationship property set to `null` clears the relationship (`data: null` for to-one, `data: []` for to-many), while an `undefined` or absent property is omitted and left unchanged on the server.

## Installation

```sh
npm install @bjornharrtell/json-api
```

The supported package entry point is `@bjornharrtell/json-api`.

## Example usage

A service returning the canonical example JSON:API document at https://jsonapi.org/ can be consumed this way:

```ts
import { useJsonApi, type BaseEntity, type ModelDefinition, RelationshipType } from '@bjornharrtell/json-api'

export interface Person extends BaseEntity {
  firstName?: string
  lastName?: string
  twitter?: string
}

export interface Comment extends BaseEntity {
  body?: string
  author?: Person
}

export interface Article extends BaseEntity {
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

## API reference

`useJsonApi({ endpoint, modelDefinitions, ...options }, fetcher?)` creates a client. Each model definition declares its JSON:API `type` and, optionally, named relationships with a related type and `RelationshipType.BelongsTo` or `RelationshipType.HasMany`.

- `createRecord<T>(type, properties)` creates a local record. If no `id` is given, one is generated.
- `findAll<T>(type, options?, params?)` returns `{ doc, records }` for the response page returned by that request. It does not automatically follow pagination links; use the returned `doc.links` to request subsequent pages. `options.page` sets `page[size]` and `page[number]`.
- `findRecord<T>(type, id, options?, params?)` returns `{ doc, record }`.
- `findRelated(record, relationshipName, options?, params?)` requests one declared relationship and assigns its normalized related record(s) to the supplied record.
- `saveRecord<T>(record, options?)` creates a resource with POST or updates it with PATCH. A `204 No Content` PATCH response is followed by a GET to return the updated record.
- `saveAtomic(operations, options?, serializeOptions?)` submits [JSON:API atomic operations](https://jsonapi.org/ext/atomic/). It returns `undefined` for a `204 No Content` response; otherwise it returns the response document and records for results that contain resource data.

`FetchOptions` supports sparse fieldsets (`fields`), pagination (`page`), included relationships (`include`), a `filter` string, request `headers`, and an `AbortSignal` (`signal`). Additional query parameters can be passed as the `params` argument to read methods. `kebabCase: true` converts kebab-case attribute and relationship names to camelCase on records and back to their JSON:API names when serializing.

## Response handling

Successful responses that require a JSON:API document must contain valid JSON. If the body is empty or malformed, the fetcher throws `JsonApiResponseError` with the response status and the parse error as its cause. This error reports invalid JSON syntax; it does not validate that successfully parsed JSON conforms to the JSON:API schema. For non-success HTTP responses, the fetcher throws an HTTP error and includes a parsed response body when available.

`204 No Content` is valid for PATCH and atomic-operation requests and returns `undefined`. A request that needs a document—such as a read or a POST that is expected to return a resource—throws `JsonApiResponseError` if it receives `204`.

`preserveNullRelationships: true` in `useJsonApi` assigns an explicit `data: null` to-one relationship as `null` on the normalized record. By default, null relationships remain unset. Links-only relationships (which omit `data`) remain unset.

`JsonApiWireDocument`, `JsonApiWireResource`, `JsonApiWireRelationship`, and related `JsonApiWire*` types describe incoming JSON:API payloads, including optional members, `data: null`, and links-only relationships. The existing `JsonApiDocument` and `JsonApiResource` types remain available unchanged for compatibility.

## Development

```sh
pnpm install --frozen-lockfile
pnpm type-check
pnpm test
pnpm test:integration
pnpm build
```

The integration test starts a local .NET 10 JSON:API server; see [`tests/integration/jsonapi-server/README.md`](tests/integration/jsonapi-server/README.md) for prerequisites. `pnpm build` also generates the API reference under `dist/docs`.