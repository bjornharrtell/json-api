import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { type ModelDefinition, RelationshipType, useJsonApi } from '../../src/json-api.ts'

interface Person {
  id: string
  lid?: string
  type: string
  firstName?: string
  lastName?: string
  twitter?: string
  comments?: Comment[]
}

interface Comment {
  id: string
  lid?: string
  type: string
  body?: string
  author?: Person | null
}

interface Article {
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
    relationships: {
      comments: { type: 'comments', relationshipType: RelationshipType.HasMany },
    },
  },
  {
    type: 'comments',
    relationships: {
      author: { type: 'people', relationshipType: RelationshipType.BelongsTo },
      article: { type: 'articles', relationshipType: RelationshipType.BelongsTo },
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

const articlesApi = useJsonApi({
  endpoint: 'http://localhost:5555/api',
  modelDefinitions,
})

let serverProcess: ChildProcess | null = null

// Helper to wait for server to be ready
async function waitForServer(url: string, maxAttempts = 30): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(url)
      if (response.ok || response.status === 404) {
        return true
      }
    } catch (error) {
      // Server not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  return false
}

beforeAll(async () => {
  // Start the C# server
  console.log('Starting JsonApiDotNetCore server...')
  
  serverProcess = spawn('dotnet', ['run', '--project', 'tests/integration/jsonapi-server'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: process.cwd(),
  })

  serverProcess.stdout?.on('data', (data) => {
    console.log(`Server: ${data}`)
  })

  serverProcess.stderr?.on('data', (data) => {
    console.error(`Server Error: ${data}`)
  })

  // Wait for server to be ready
  const serverReady = await waitForServer('http://localhost:5555/api/articles')
  if (!serverReady) {
    throw new Error('Server failed to start within timeout period')
  }
  console.log('Server is ready!')
}, 60000) // 60 second timeout for starting server

afterAll(() => {
  if (serverProcess) {
    console.log('Stopping server...')
    serverProcess.kill()
  }
})

describe('JsonApiDotNetCore Integration Tests', () => {
  test('fetch single article with includes', async () => {
    const article = await articlesApi.findRecord<Article>('articles', '1', {
      include: ['comments', 'author'],
    })
    
    expect(article.id).toBe('1')
    expect(article.title).toBe('JSON:API paints my bikeshed!')
    expect(article.comments?.length).toBe(2)
    expect(article.comments?.[0]?.body).toBe('First!')
    expect(article.comments?.[1]?.body).toBe('I like XML better')
    expect(article.author?.firstName).toBe('Dan')
  })

  test('fetch all articles with includes', async () => {
    const { records: articles } = await articlesApi.findAll<Article>('articles', {
      include: ['comments', 'author'],
    })
    
    expect(articles.length).toBeGreaterThanOrEqual(1)
    const article = articles.find(a => a.id === '1')
    expect(article).toBeDefined()
    expect(article?.title).toBe('JSON:API paints my bikeshed!')
    expect(article?.comments?.length).toBe(2)
    expect(article?.comments?.[0]?.body).toBe('First!')
    expect(article?.comments?.[1]?.body).toBe('I like XML better')
    expect(article?.author?.firstName).toBe('Dan')
  })

  test('fetch article with includes', async () => {
    const { records: articles } = await articlesApi.findAll<Article>('articles', {
      include: ['comments', 'author'],
    })
    
    const article = articles.find(a => a.id === '1')
    expect(article).toBeDefined()
    expect(article?.comments?.length).toBe(2)
    expect(article?.author?.firstName).toBe('Dan')
    
    const firstComment = article?.comments?.[0]
    expect(firstComment?.body).toBe('First!')
    
    const secondComment = article?.comments?.[1]
    expect(secondComment?.body).toBe('I like XML better')
  })

  test('create new article', async () => {
    const newArticle: Article = {
      id: '',
      type: 'articles',
      title: 'Integration Test Article',
    }
    
    const result = await articlesApi.saveRecord(newArticle) as Article
    expect(result.id).toBeDefined()
    expect(result.title).toBe('Integration Test Article')
  })

  test('create article with author relationship', async () => {
    const newArticle: Article = {
      id: '',
      type: 'articles',
      title: 'Article with Author',
      author: {
        id: '1',
        type: 'people',
      } as Person,
    }
    
    const result = await articlesApi.saveRecord(newArticle) as Article
    expect(result.id).toBeDefined()
    expect(result.title).toBe('Article with Author')
  })

  test('fetch people resources', async () => {
    const { records: people } = await articlesApi.findAll<Person>('people')
    expect(people.length).toBeGreaterThan(0)
    
    const dan = people.find(p => p.firstName === 'Dan')
    expect(dan).toBeDefined()
    expect(dan?.lastName).toBe('Gebhardt')
  })

  test('fetch comments with author included', async () => {
    const { records: comments } = await articlesApi.findAll<Comment>('comments', {
      include: ['author'],
    })
    
    expect(comments.length).toBeGreaterThan(0)
    const firstComment = comments.find(c => c.body === 'First!')
    expect(firstComment).toBeDefined()
    expect(firstComment?.author?.firstName).toBeDefined()
  })

  test('atomic operations - create person and article', async () => {
    const newPerson: Person = {
      id: '',
      lid: 'temp-person-1',
      type: 'people',
      firstName: 'Alice',
      lastName: 'Smith',
      twitter: 'asmith',
    }

    const newArticle: Article = {
      id: '',
      lid: 'temp-article-1',
      type: 'articles',
      title: 'Atomic Operations Test',
      author: newPerson,
    }

    const result = await articlesApi.saveAtomic([
      { op: 'add', data: newPerson },
      { op: 'add', data: newArticle },
    ])

    expect(result).toBeDefined()
    expect(result?.records.length).toBe(2)
    
    const createdPerson = result?.records[0] as Person
    expect(createdPerson.firstName).toBe('Alice')
    expect(createdPerson.lastName).toBe('Smith')
    expect(createdPerson.id).toBeDefined()
    
    const createdArticle = result?.records[1] as Article
    expect(createdArticle.title).toBe('Atomic Operations Test')
    expect(createdArticle.id).toBeDefined()
  })

  test('atomic operations - create article with existing author', async () => {
    const newArticle: Article = {
      id: '',
      type: 'articles',
      title: 'Another Atomic Article',
      author: {
        id: '1',
        type: 'people',
      } as Person,
    }

    const result = await articlesApi.saveAtomic([
      { op: 'add', data: newArticle },
    ])

    expect(result).toBeDefined()
    expect(result?.records.length).toBe(1)
    
    const createdArticle = result?.records[0] as Article
    expect(createdArticle.title).toBe('Another Atomic Article')
    expect(createdArticle.id).toBeDefined()
  })

  test('atomic operations - update article', async () => {
    // First create an article to update
    const newArticle: Article = {
      id: '',
      type: 'articles',
      title: 'Article to Update',
    }
    
    const createResult = await articlesApi.saveRecord(newArticle) as Article
    expect(createResult.id).toBeDefined()
    
    // Now update it via atomic operations
    createResult.title = 'Updated via Atomic Operations'
    
    const result = await articlesApi.saveAtomic([
      { op: 'update', data: createResult },
    ])

    // Note: JsonApiDotNetCore may return 204 No Content for updates,
    // in which case result will be undefined. This is spec-compliant behavior.
    if (result) {
      expect(result.records.length).toBeGreaterThanOrEqual(0)
    }
    
    // Verify the update by fetching the article
    const updatedArticle = await articlesApi.findRecord<Article>('articles', createResult.id)
    expect(updatedArticle.title).toBe('Updated via Atomic Operations')
  })
})
