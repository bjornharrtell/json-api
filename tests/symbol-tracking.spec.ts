import { describe, expect, test } from 'vitest'
import { type Article, articlesJsonApi } from '../src/stores/articles.ts'
import { JSON_API_TYPE } from '../src/json-api.ts'

describe('Symbol-based type tracking', () => {
  test('createRecord stores type as symbol', () => {
    const newArticle = articlesJsonApi.createRecord<Article>('articles', {
      title: 'New Article',
    })
    
    // The symbol should be present
    expect((newArticle as any)[JSON_API_TYPE]).toBe('articles')
    
    // The symbol shouldn't appear in normal object operations
    expect(Object.keys(newArticle)).not.toContain(JSON_API_TYPE.toString())
    expect(Object.getOwnPropertyNames(newArticle)).not.toContain(JSON_API_TYPE.toString())
    
    // But should be accessible via symbol
    expect(Object.getOwnPropertySymbols(newArticle)).toContain(JSON_API_TYPE)
  })

  test('findRelated works with symbol type tracking', async () => {
    const article = await articlesJsonApi.findRecord<Article>('articles', '1', {
      include: ['comments', 'author'],
    })
    
    // The article should have the type symbol
    expect((article as any)[JSON_API_TYPE]).toBe('articles')
    
    // findRelated should work without explicit type parameter
    const doc = await articlesJsonApi.findRelated(article, 'comments')
    expect(doc).toBeDefined()
    expect(doc.data).toBeDefined()
  })
})