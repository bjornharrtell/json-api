import { describe, expect, test } from 'vitest'
import type { JsonApiAtomicDocument, JsonApiDocument, JsonApiResource } from '../src/json-api.ts'
import {
  type AtomicOperation,
  type BaseEntity,
  type JsonApiConfig,
  RelationshipType,
  useJsonApi,
} from '../src/json-api.ts'
import type { FetchOptions, FetchParams, JsonApiFetcher, Options } from '../src/json-api-fetcher.ts'

interface User extends BaseEntity {
  firstName: string
  lastName: string
  posts?: BaseEntity[]
}

// Mock fetcher for testing
class MockFetcher implements JsonApiFetcher {
  endpoint = 'https://api.example.com'

  createOptions(options: FetchOptions = {}, _params: FetchParams = {}, body?: BodyInit): Options {
    const searchParams = new URLSearchParams()
    const headers = new Headers(options.headers ?? {})
    return { searchParams, headers, body }
  }

  async fetchDocument(
    _type: string,
    id?: string,
    _options?: FetchOptions,
    _params?: FetchParams,
  ): Promise<JsonApiDocument> {
    if (id) {
      // Return single resource when id is provided
      return {
        data: {
          id: '1',
          type: 'users',
          attributes: {
            'first-name': 'John',
            'last-name': 'Doe',
          },
        },
      }
    }
    // Return array when no id (for findAll)
    return {
      data: [
        {
          id: '1',
          type: 'users',
          attributes: {
            'first-name': 'John',
            'last-name': 'Doe',
          },
        },
      ],
    }
  }

  async fetchAll(_type: string, _options?: FetchOptions, _params?: FetchParams): Promise<JsonApiResource[]> {
    return [
      {
        id: '1',
        type: 'users',
        attributes: {
          'first-name': 'John',
          'last-name': 'Doe',
        },
      },
    ]
  }

  async fetchOne(_type: string, _id: string, _options?: FetchOptions, _params?: FetchParams): Promise<JsonApiResource> {
    return {
      id: '1',
      type: 'users',
      attributes: {
        'first-name': 'John',
        'last-name': 'Doe',
      },
    }
  }

  async fetchHasMany(
    _type: string,
    _id: string,
    _name: string,
    _options?: FetchOptions,
    _params?: FetchParams,
  ): Promise<JsonApiDocument> {
    return {
      data: [
        {
          id: '1',
          type: 'posts',
          attributes: {
            title: 'Post 1',
          },
        },
        {
          id: '2',
          type: 'posts',
          attributes: {
            title: 'Post 2',
          },
        },
      ],
    }
  }

  async fetchBelongsTo(
    _type: string,
    _id: string,
    _name: string,
    _options?: FetchOptions,
    _params?: FetchParams,
  ): Promise<JsonApiDocument> {
    return {
      data: {
        id: '1',
        type: 'users',
        attributes: {
          'first-name': 'Jane',
          'last-name': 'Smith',
        },
      },
    }
  }

  async post(resource: JsonApiResource, _options?: FetchOptions): Promise<JsonApiDocument> {
    return {
      data: resource,
    }
  }

  async postAtomic(_doc: JsonApiAtomicDocument, _options?: FetchOptions): Promise<JsonApiAtomicDocument | undefined> {
    return {
      'atomic:results': [
        {
          data: {
            id: '1',
            type: 'users',
            attributes: { name: 'Test' },
          },
        },
      ],
    }
  }
}

describe('JsonApi with kebab-case', () => {
  const config: JsonApiConfig = {
    endpoint: 'https://api.example.com',
    modelDefinitions: [
      {
        type: 'users',
        relationships: {
          posts: {
            type: 'posts',
            relationshipType: RelationshipType.HasMany,
          },
        },
      },
      {
        type: 'posts',
        relationships: {
          author: {
            type: 'users',
            relationshipType: RelationshipType.BelongsTo,
          },
        },
      },
    ],
    kebabCase: true,
  }

  test('createRecord with kebab-case converts properties to camelCase', () => {
    const fetcher = new MockFetcher()
    const api = useJsonApi(config, fetcher)

    const user = api.createRecord('users', {
      'first-name': 'John',
      'last-name': 'Doe',
    } as Partial<User>)

    expect(user.firstName).toBe('John')
    expect(user.lastName).toBe('Doe')
  })

  test('findRecord with kebab-case converts attributes', async () => {
    const fetcher = new MockFetcher()
    const api = useJsonApi(config, fetcher)
    const user = await api.findRecord<User>('users', '1')
    expect(user.firstName).toBe('John')
    expect(user.lastName).toBe('Doe')
  })

  test('findAll with kebab-case converts attributes', async () => {
    const fetcher = new MockFetcher()
    const api = useJsonApi(config, fetcher)
    const { records: users } = await api.findAll<User>('users')
    expect(users[0].firstName).toBe('John')
    expect(users[0].lastName).toBe('Doe')
  })
})

describe('JsonApi findRelated', () => {
  const config: JsonApiConfig = {
    endpoint: 'https://api.example.com',
    modelDefinitions: [
      {
        type: 'users',
        relationships: {
          posts: {
            type: 'posts',
            relationshipType: RelationshipType.HasMany,
          },
        },
      },
      {
        type: 'posts',
        relationships: {
          author: {
            type: 'users',
            relationshipType: RelationshipType.BelongsTo,
          },
        },
      },
    ],
  }

  test('findRelated with HasMany relationship', async () => {
    const fetcher = new MockFetcher()
    const api = useJsonApi(config, fetcher)

    const user = api.createRecord<User>('users', { id: '1' })
    await api.findRelated(user, 'posts')

    expect(user.posts).toBeDefined()
    expect(user.posts?.length).toBe(2)
    expect(user.posts?.[0]?.id).toBe('1')
    expect(user.posts?.[1]?.id).toBe('2')
  })

  test('findRelated with BelongsTo relationship', async () => {
    const fetcher = new MockFetcher()
    const api = useJsonApi(config, fetcher)

    interface Post extends BaseEntity {
      author?: BaseEntity
    }

    const post = api.createRecord<Post>('posts', { id: '1' })
    await api.findRelated(post, 'author')

    expect(post.author).toBeDefined()
    expect(post.author?.id).toBe('1')
  })
})

describe('JsonApi error handling', () => {
  test('createRecord throws error for undefined model type', () => {
    const config: JsonApiConfig = {
      endpoint: 'https://api.example.com',
      modelDefinitions: [],
    }

    const api = useJsonApi(config)
    expect(() => api.createRecord('unknown-type', {})).toThrow('Model type unknown-type not defined')
  })

  test('findRelated throws error for model without relationships', async () => {
    const config: JsonApiConfig = {
      endpoint: 'https://api.example.com',
      modelDefinitions: [
        {
          type: 'users',
        },
      ],
    }

    const fetcher = new MockFetcher()
    const api = useJsonApi(config, fetcher)
    const user = api.createRecord('users', { id: '1' })

    await expect(api.findRelated(user, 'posts')).rejects.toThrow('Model users has no relationships')
  })

  test('findRelated throws error for undefined relationship', async () => {
    const config: JsonApiConfig = {
      endpoint: 'https://api.example.com',
      modelDefinitions: [
        {
          type: 'users',
          relationships: {
            posts: {
              type: 'posts',
              relationshipType: RelationshipType.HasMany,
            },
          },
        },
      ],
    }

    const fetcher = new MockFetcher()
    const api = useJsonApi(config, fetcher)
    const user = api.createRecord('users', { id: '1' })

    await expect(api.findRelated(user, 'comments')).rejects.toThrow('Relationship comments not defined')
  })
})

describe('JsonApi saveAtomic', () => {
  test('saveAtomic with empty results returns undefined', async () => {
    class EmptyResultFetcher extends MockFetcher {
      override async postAtomic(_doc: JsonApiAtomicDocument): Promise<JsonApiAtomicDocument | undefined> {
        return undefined
      }
    }

    const config: JsonApiConfig = {
      endpoint: 'https://api.example.com',
      modelDefinitions: [{ type: 'users' }],
    }

    const fetcher = new EmptyResultFetcher()
    const api = useJsonApi(config, fetcher)

    const operations: AtomicOperation[] = [
      {
        op: 'add',
        data: { id: '1', type: 'users' },
      },
    ]

    const result = await api.saveAtomic(operations)
    expect(result).toBeUndefined()
  })

  test('saveAtomic handles operations with ref only', async () => {
    class CustomFetcher extends MockFetcher {
      override async postAtomic(_doc: JsonApiAtomicDocument): Promise<JsonApiAtomicDocument | undefined> {
        return {
          'atomic:results': [
            {
              data: {
                id: '1',
                type: 'articles',
                attributes: { title: 'Test Article' },
              },
            },
          ],
        }
      }
    }

    const config: JsonApiConfig = {
      endpoint: 'https://api.example.com',
      modelDefinitions: [
        {
          type: 'articles',
          relationships: {
            author: {
              type: 'people',
              relationshipType: RelationshipType.BelongsTo,
            },
          },
        },
        {
          type: 'people',
        },
      ],
    }

    const fetcher = new CustomFetcher()
    const api = useJsonApi(config, fetcher)

    const operations: AtomicOperation[] = [
      {
        op: 'remove',
        ref: {
          type: 'articles',
          id: '1',
          relationship: 'author',
        },
      },
    ]

    const result = await api.saveAtomic(operations)
    expect(result?.records).toBeDefined()
  })
})
