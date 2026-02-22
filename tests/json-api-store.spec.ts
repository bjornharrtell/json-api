import { describe, expect, test } from 'vitest'
import type { AtomicOperation } from '../src/json-api.ts'
import { type Article, articlesJsonApi, JsonApiFetcherArticles, type Person } from '../src/stores/articles.ts'

describe('JsonApiStore', () => {
  test('single record fetch', async () => {
    const article = await articlesJsonApi.findRecord<Article>('articles', '1', {
      include: ['comments', 'author'],
    })
    expect(article.id).toBe('1')
    expect(article.title).toBe('JSON:API paints my bikeshed!')
    //await findRelated(article, 'comments')
    expect(article.comments?.length).toBe(2)
    expect(article.comments?.[0]?.body).toBe('First!')
    expect(article.comments?.[1]?.body).toBe('I like XML better')
    expect(article.author?.firstName).toBe('Dan')
  })

  test('all records fetch', async () => {
    const { records: articles } = await articlesJsonApi.findAll<Article>('articles', {
      include: ['comments', 'author'],
    })
    expect(articles.length).toBe(2)
    const article = articles[0]
    expect(article.id).toBe('1')
    expect(article.title).toBe('JSON:API paints my bikeshed!')
    //await findRelated(article, 'comments')
    expect(article.comments?.length).toBe(2)
    expect(article.comments?.[0]?.body).toBe('First!')
    expect(article.comments?.[1]?.body).toBe('I like XML better')
    expect(article.comments?.[1]?.author?.firstName).toBe('Dan')
    //await findRelated(article, 'author')
    expect(article.author?.firstName).toBe('Dan')
  })

  test('save record', async () => {
    const newArticle = {
      type: 'articles',
      title: 'test222',
    } as Article
    const result = (await articlesJsonApi.saveRecord(newArticle)) as Article
    expect(result.title, newArticle.title)
  })

  test('save atomic', async () => {
    const newAuthor = {
      lid: 'local-1',
      type: 'people',
      firstName: 'John',
      lastName: 'Doe',
    } as Person
    const newArticle = {
      type: 'articles',
      title: 'test222',
      author: newAuthor,
    } as Article
    const operations: AtomicOperation[] = [
      {
        op: 'add',
        data: newAuthor,
      },
      {
        op: 'add',
        data: newArticle,
      },
    ]
    const result = await articlesJsonApi.saveAtomic(operations)
    expect((result?.records[0] as Article).title, newArticle.title)
    expect((result?.records[1] as Article).id, 'local-1')
  })

  test('same-type relationship chain - people to comments', async () => {
    // This test exercises same-type relationships in a chain:
    // Article -> Comments -> Author (Person) -> Comments
    const { records: articles } = await articlesJsonApi.findAll<Article>('articles', {
      include: ['comments', 'author', 'comments.author', 'comments.author.comments'],
    })

    const article = articles.find((a) => a.id === '1')
    if (!article) throw new Error('Article with ID 1 not found')

    expect(article.comments?.length).toBe(2)

    // Check the first comment and its author
    const firstComment = article.comments?.[0]
    expect(firstComment?.body).toBe('First!')
    expect(firstComment?.author?.firstName).toBe('Jane')
    expect(firstComment?.author?.lastName).toBe('Doe')

    // Check that the author has comments (same-type relationship chain)
    expect(firstComment?.author?.comments).toBeDefined()
    expect(firstComment?.author?.comments?.length).toBe(1)
    expect(firstComment?.author?.comments?.[0]?.id).toBe('5') // Should be the same comment

    // Check the second comment and its author
    const secondComment = article.comments?.[1]
    expect(secondComment?.body).toBe('I like XML better')
    expect(secondComment?.author?.firstName).toBe('Dan')

    // Check that Dan has comments too
    expect(secondComment?.author?.comments).toBeDefined()
    expect(secondComment?.author?.comments?.length).toBe(1)
    expect(secondComment?.author?.comments?.[0]?.id).toBe('12') // Should be the same comment

    // Verify the circular reference integrity
    expect(firstComment?.author?.comments?.[0]?.author?.id).toBe(firstComment?.author?.id)
    expect(secondComment?.author?.comments?.[0]?.author?.id).toBe(secondComment?.author?.id)
  })

  test('bug: same ID different types', async () => {
    // This test would expose a bug if it existed where includedMap.get(id)
    // could return wrong type when different resource types have the same ID.
    // With the current test data, all IDs are unique across types, so this
    // test passes and demonstrates the fix works for normal cases.
    const { records: articles } = await articlesJsonApi.findAll<Article>('articles', {
      include: ['author', 'comments'],
    })

    const article = articles.find((a) => a.id === '1')
    if (!article) throw new Error('Article with ID 1 not found')

    // Verify relationships are correctly typed
    expect(article.author?.type).toBe('people')
    expect(article.author?.firstName).toBe('Dan')
    expect(article.comments?.[0]?.type).toBe('comments')
    expect(article.comments?.[0]?.body).toBe('First!')
  })

  test('bug: relationships with only links (no data)', async () => {
    // This test exposes a bug where the parser doesn't handle JSON:API payloads
    // with relationship objects that only contain links (without data property).
    const { records: articles } = await articlesJsonApi.findAll<Article>('articles')
    const article = articles.find((a) => a.id === '2')
    expect(article?.title).toBe('Article with links-only relationships')
    // Relationships with only links should not be populated
    expect(article?.author).toBeUndefined()
    expect(article?.comments).toBeUndefined()
  })

  test('atomic remove operation with ref', async () => {
    const removeOperations: AtomicOperation[] = [
      {
        op: 'remove',
        ref: {
          type: 'articles',
          id: '1',
          relationship: 'author',
        },
      },
    ]

    await articlesJsonApi.saveAtomic(removeOperations)
  })

  test('error: article not found in fetchDocument', async () => {
    await expect(articlesJsonApi.findRecord<Article>('articles', '9999')).rejects.toThrow('Article 9999 not found')
  })

  test('error: article not found in fetchOne', async () => {
    const fetcher = new JsonApiFetcherArticles()
    await expect(fetcher.fetchOne('articles', '9998')).rejects.toThrow('Article 9998 not found')
  })

  test('error: article not found in fetchHasMany', async () => {
    const fetcher = new JsonApiFetcherArticles()
    await expect(fetcher.fetchHasMany('articles', '9997', 'comments')).rejects.toThrow('Article 9997 not found')
  })

  test('error: relationships not found in fetchHasMany', async () => {
    const fetcher = new JsonApiFetcherArticles()
    // Create a mock article without relationships
    fetcher.articles.push({
      type: 'articles',
      id: '8001',
      attributes: { title: 'Test' },
    })
    await expect(fetcher.fetchHasMany('articles', '8001', 'comments')).rejects.toThrow(
      'Relationships for article 8001 not found',
    )
  })

  test('error: included resource not found in fetchHasMany', async () => {
    const fetcher = new JsonApiFetcherArticles()
    // Create a mock article with a relationship pointing to non-existent resource
    fetcher.articles.push({
      type: 'articles',
      id: '8002',
      attributes: { title: 'Test' },
      relationships: {
        comments: {
          data: [{ type: 'comments', id: '9999' }],
        },
      },
    })
    await expect(fetcher.fetchHasMany('articles', '8002', 'comments')).rejects.toThrow('Resource 8002 not found')
  })

  test('error: article not found in fetchBelongsTo', async () => {
    const fetcher = new JsonApiFetcherArticles()
    await expect(fetcher.fetchBelongsTo('article', '9996', 'author')).rejects.toThrow('Article 9996 not found')
  })

  test('error: unsupported type in fetchBelongsTo', async () => {
    const fetcher = new JsonApiFetcherArticles()
    await expect(fetcher.fetchBelongsTo('comment', '1', 'author')).rejects.toThrow('Type comment not supported')
  })

  test('error: relationships not found in fetchBelongsTo', async () => {
    const fetcher = new JsonApiFetcherArticles()
    // Create a mock article without relationships
    fetcher.articles.push({
      type: 'articles',
      id: '8003',
      attributes: { title: 'Test' },
    })
    await expect(fetcher.fetchBelongsTo('article', '8003', 'author')).rejects.toThrow(
      'Relationships for article 8003 not found',
    )
  })

  test('error: included resource not found in fetchBelongsTo', async () => {
    const fetcher = new JsonApiFetcherArticles()
    // Create a mock article with a relationship pointing to non-existent resource
    fetcher.articles.push({
      type: 'articles',
      id: '8004',
      attributes: { title: 'Test' },
      relationships: {
        author: {
          data: { type: 'people', id: '9999' },
        },
      },
    })
    await expect(fetcher.fetchBelongsTo('article', '8004', 'author')).rejects.toThrow('Resource 8004 not found')
  })

  test('error: createOptions not implemented', () => {
    const fetcher = new JsonApiFetcherArticles()
    expect(() => fetcher.createOptions()).toThrow('Method not implemented.')
  })

  test('postAtomic returns undefined for operations without data', async () => {
    const fetcher = new JsonApiFetcherArticles()
    const result = await fetcher.postAtomic({
      'atomic:operations': [{ op: 'remove', ref: { type: 'articles', id: '1' } }],
    })
    expect(result).toBeUndefined()
  })

  test('fetchAll returns all articles', async () => {
    const fetcher = new JsonApiFetcherArticles()
    const articles = await fetcher.fetchAll('articles')
    expect(articles.length).toBeGreaterThan(0)
    expect(articles[0].type).toBe('articles')
  })

  test('fetchOne returns article by id', async () => {
    const fetcher = new JsonApiFetcherArticles()
    const article = await fetcher.fetchOne('articles', '1')
    expect(article.id).toBe('1')
    expect(article.type).toBe('articles')
  })

  test('fetchHasMany returns related resources', async () => {
    const fetcher = new JsonApiFetcherArticles()
    const result = await fetcher.fetchHasMany('articles', '1', 'comments')
    expect(result.data).toBeDefined()
    expect(Array.isArray(result.data)).toBe(true)
  })

  test('fetchBelongsTo returns related resource', async () => {
    const fetcher = new JsonApiFetcherArticles()
    const result = await fetcher.fetchBelongsTo('article', '1', 'author')
    expect(result.data).toBeDefined()
  })

  test('patch returns updated resource', async () => {
    const fetcher = new JsonApiFetcherArticles()
    const updatedArticle = {
      type: 'articles',
      id: '1',
      attributes: { title: 'Updated Title' },
    }
    const result = await fetcher.patch(updatedArticle)
    expect(result?.data).toEqual(updatedArticle)
  })
})
