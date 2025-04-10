import { beforeEach, describe, expect, test } from 'vitest'
import { Article, Person, articlesStore } from '../src/stores/articles'

describe('JsonApiStore', () => {
  test('single record fetch', async () => {
    const article = await articlesStore.findRecord(Article, '1', {
      include: ['comments', 'author'],
    })
    expect(article.id).toBe('1')
    expect(article.title).toBe('JSON:API paints my bikeshed!')
    //await findRelated(article, 'comments')
    expect(article.comments.length).toBe(2)
    expect(article.comments[0].body).toBe('First!')
    expect(article.comments[1].body).toBe('I like XML better')
    expect(article.author?.firstName).toBe('Dan')
  })

  test('all records fetch', async () => {
    const { records: articles } = await articlesStore.findAll(Article, {
      include: ['comments', 'author'],
    })
    expect(articles.length).toBe(1)
    const article = articles[0]
    expect(article.id).toBe('1')
    expect(article.title).toBe('JSON:API paints my bikeshed!')
    //await findRelated(article, 'comments')
    expect(article.comments.length).toBe(2)
    expect(article.comments[0].body).toBe('First!')
    expect(article.comments[1].body).toBe('I like XML better')
    expect(article.comments[1].author?.firstName).toBe('Dan')
    //await findRelated(article, 'author')
    expect(article.author?.firstName).toBe('Dan')
  })
})
