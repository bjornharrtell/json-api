import { describe, expect, test } from 'vitest'
import { type Article, articlesJsonApi, Person } from '../src/stores/articles.ts'
import { AtomicOperation, JsonApiResourceIdentifier } from '../src/json-api.ts'

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
    expect(articles.length).toBe(1)
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
      title: 'test222'
    } as Article
    const result = await articlesJsonApi.saveRecord(newArticle) as Article
    expect(result.title, newArticle.title)
  })

  test('save atomic', async () => {
    const newAuthor = {
      lid: 'local-1',
      type: 'people',
      firstName: 'John',
      lastName: 'Doe'
    } as Person
    const newArticle = {
      type: 'articles',
      title: 'test222',
      author: newAuthor
    } as Article
    const operations: AtomicOperation[] = [{
      op: 'add',
      data: newAuthor
    },{
      op: 'add',
      data: newArticle
    }]
    const result = await articlesJsonApi.saveAtomic(operations)
    expect(result.doc.data[0].attributes.title, newArticle.title)
    const rid = result.doc.data[1].relationships!['author'].data as JsonApiResourceIdentifier
    expect(rid.lid, 'local-1')
  })
})
