import { beforeAll, describe, expect, test, vi } from 'vitest'
import type { JsonApiResource } from '../src/json-api.ts'
import { JsonApiFetcherImpl, JsonApiResponseError } from '../src/json-api-fetcher.ts'

// Setup fetch mock
beforeAll(() => {
  if (!globalThis.fetch) {
    globalThis.fetch = vi.fn()
  }
})

describe('JsonApiFetcher HTTP methods', () => {
  test('fetchAll returns array of resources', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          {
            id: '1',
            type: 'articles',
            attributes: { title: 'Test' },
          },
        ],
      }),
    })
    globalThis.fetch = mockFetch

    const fetcher = new JsonApiFetcherImpl('https://api.example.com')
    const result = await fetcher.fetchAll('articles')

    expect(result.length).toBe(1)
    expect(result[0].id).toBe('1')
  })

  test('fetchOne returns single resource', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          id: '1',
          type: 'articles',
          attributes: { title: 'Test' },
        },
      }),
    })
    globalThis.fetch = mockFetch

    const fetcher = new JsonApiFetcherImpl('https://api.example.com')
    const result = await fetcher.fetchOne('articles', '1')

    expect(result.id).toBe('1')
    expect(result.type).toBe('articles')
  })

  test('post creates new resource', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        data: {
          id: '1',
          type: 'articles',
          attributes: { title: 'New Article' },
        },
      }),
    })
    globalThis.fetch = mockFetch

    const fetcher = new JsonApiFetcherImpl('https://api.example.com')
    const resource = {
      type: 'articles',
      attributes: { title: 'New Article' },
    }
    const result = await fetcher.post(resource)

    expect(result.data).toBeDefined()
    expect((result.data as JsonApiResource).id).toBe('1')
  })

  test('postAtomic handles 204 No Content response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => {
        throw new Error('No content')
      },
      text: async () => '',
    })
    globalThis.fetch = mockFetch

    const fetcher = new JsonApiFetcherImpl('https://api.example.com')
    const result = await fetcher.postAtomic({
      'atomic:operations': [
        {
          op: 'add',
          data: {
            type: 'articles',
            attributes: { title: 'Test' },
          },
        },
      ],
    })

    expect(result).toBeUndefined()
  })

  test('postAtomic rejects a malformed successful response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token')
      },
    })

    const fetcher = new JsonApiFetcherImpl('https://api.example.com')
    await expect(fetcher.postAtomic({ 'atomic:operations': [] })).rejects.toBeInstanceOf(JsonApiResponseError)
  })

  test('fetchDocument throws HttpError on error response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({
        errors: [{ status: '404', title: 'Not Found' }],
      }),
    })
    globalThis.fetch = mockFetch

    const fetcher = new JsonApiFetcherImpl('https://api.example.com')

    await expect(fetcher.fetchDocument('articles', '999')).rejects.toThrow('HTTP error! status: 404 Not Found')
  })

  test('fetchDocument rejects invalid JSON responses by default', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token')
      },
    })
    globalThis.fetch = mockFetch

    const fetcher = new JsonApiFetcherImpl('https://api.example.com')
    await expect(fetcher.fetchDocument('articles')).rejects.toBeInstanceOf(JsonApiResponseError)
  })

  test('fetchDocument rejects successful 204 responses that require a document', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      statusText: 'No Content',
      json: async () => {
        throw new SyntaxError('Unexpected end of JSON input')
      },
    })
    globalThis.fetch = mockFetch

    const fetcher = new JsonApiFetcherImpl('https://api.example.com')
    await expect(fetcher.fetchDocument('articles')).rejects.toThrow(
      'Expected a JSON:API document but received HTTP 204 No Content',
    )
  })

  test('patch accepts 204 No Content', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      statusText: 'No Content',
      json: async () => {
        throw new Error('No content')
      },
    })
    globalThis.fetch = mockFetch

    const fetcher = new JsonApiFetcherImpl('https://api.example.com')
    await expect(
      fetcher.patch({ id: '1', type: 'articles', attributes: { title: 'Updated' } }),
    ).resolves.toBeUndefined()
  })

  test('createOptions builds query parameters correctly', () => {
    const fetcher = new JsonApiFetcherImpl('https://api.example.com')

    const options = fetcher.createOptions(
      {
        include: ['author', 'comments'],
        fields: {
          articles: ['title', 'body'],
          people: ['name'],
        },
        page: {
          size: 10,
          number: 2,
        },
        filter: 'title eq "Test"',
        headers: {
          'X-Custom': 'value',
        },
      },
      {
        sort: 'created',
      },
    )

    expect(options.searchParams).toBeDefined()
    const searchParams = options.searchParams as URLSearchParams
    expect(searchParams.get('include')).toBe('author,comments')
    expect(searchParams.get('fields[articles]')).toBe('title,body')
    expect(searchParams.get('fields[people]')).toBe('name')
    expect(searchParams.get('page[size]')).toBe('10')
    expect(searchParams.get('page[number]')).toBe('2')
    expect(searchParams.get('filter')).toBe('title eq "Test"')
    expect(searchParams.get('sort')).toBe('created')
    expect(options.headers.get('X-Custom')).toBe('value')
  })

  test('fetchHasMany returns related resources', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          {
            id: '1',
            type: 'comments',
            attributes: { body: 'Comment 1' },
          },
        ],
      }),
    })
    globalThis.fetch = mockFetch

    const fetcher = new JsonApiFetcherImpl('https://api.example.com')
    const result = await fetcher.fetchHasMany('articles', '1', 'comments')

    expect(result.data).toBeDefined()
    expect(Array.isArray(result.data)).toBe(true)
  })

  test('fetchBelongsTo returns related resource', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          id: '1',
          type: 'people',
          attributes: { name: 'John' },
        },
      }),
    })
    globalThis.fetch = mockFetch

    const fetcher = new JsonApiFetcherImpl('https://api.example.com')
    const result = await fetcher.fetchBelongsTo('articles', '1', 'author')

    expect(result.data).toBeDefined()
    expect((result.data as JsonApiResource).type).toBe('people')
  })
})
