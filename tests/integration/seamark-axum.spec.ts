import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { type BaseEntity, type ModelDefinition, RelationshipType, useJsonApi } from '../../src/json-api.ts'

interface Person extends BaseEntity {
  firstName?: string
  lastName?: string
  twitter?: string
  comments?: Comment[]
}

interface Comment extends BaseEntity {
  body?: string
  author?: Person | null
}

interface Article extends BaseEntity {
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

const endpoint = 'http://127.0.0.1:5556/api'
const articlesApi = useJsonApi({ endpoint, modelDefinitions })
const serverDirectory = resolve(process.cwd(), 'tests/integration/seamark-server')
const serverManifest = resolve(serverDirectory, 'Cargo.toml')
const serverBinary = resolve(serverDirectory, 'target/debug/seamark-integration-server')
const serverUrl = `${endpoint}/articles`

let serverProcess: ChildProcess | null = null
let serverError: Error | null = null

async function waitForServer(maxAttempts = 120): Promise<boolean> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (serverError || (serverProcess && serverProcess.exitCode !== null)) {
      return false
    }
    try {
      const response = await fetch(serverUrl)
      if (response.ok) return true
    } catch {
      // The server has not bound its port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return false
}

beforeAll(async () => {
  execFileSync(
    'cargo',
    ['build', '--quiet', '--manifest-path', serverManifest, '--target-dir', resolve(serverDirectory, 'target')],
    { cwd: process.cwd(), stdio: 'inherit' },
  )

  serverProcess = spawn(serverBinary, [], {
    cwd: serverDirectory,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  serverProcess.once('error', (error) => {
    serverError = error
  })
  serverProcess.stdout?.on('data', (data) => {
    console.log(`Seamark server: ${data}`)
  })
  serverProcess.stderr?.on('data', (data) => {
    console.error(`Seamark server error: ${data}`)
  })

  if (!(await waitForServer())) {
    throw new Error(`Seamark server failed to start${serverError ? `: ${serverError.message}` : ' within 60 seconds'}`)
  }
}, 180_000)

afterAll(async () => {
  if (!serverProcess || serverProcess.exitCode !== null) return
  const process = serverProcess
  const exited = new Promise<void>((resolve) => process.once('exit', () => resolve()))
  if (process.kill()) await exited
})

describe('Seamark Axum integration tests', () => {
  test('fetch single article with includes', async () => {
    const { record: article } = await articlesApi.findRecord<Article>('articles', '1', {
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
    const article = articles.find((item) => item.id === '1')
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

    const article = articles.find((item) => item.id === '1')
    expect(article).toBeDefined()
    expect(article?.comments?.length).toBe(2)
    expect(article?.author?.firstName).toBe('Dan')
    expect(article?.comments?.[0]?.body).toBe('First!')
    expect(article?.comments?.[1]?.body).toBe('I like XML better')
  })

  test('create new article', async () => {
    const newArticle: Article = {
      id: '',
      type: 'articles',
      title: 'Integration Test Article',
    }

    const result = (await articlesApi.saveRecord(newArticle)) as Article
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

    const result = (await articlesApi.saveRecord(newArticle)) as Article
    expect(result.id).toBeDefined()
    expect(result.title).toBe('Article with Author')
  })

  test('fetch people resources', async () => {
    const { records: people } = await articlesApi.findAll<Person>('people')
    expect(people.length).toBeGreaterThan(0)

    const dan = people.find((person) => person.firstName === 'Dan')
    expect(dan).toBeDefined()
    expect(dan?.lastName).toBe('Gebhardt')
  })

  test('fetch comments with author included', async () => {
    const { records: comments } = await articlesApi.findAll<Comment>('comments', {
      include: ['author'],
    })

    expect(comments.length).toBeGreaterThan(0)
    const firstComment = comments.find((comment) => comment.body === 'First!')
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
    expect(createdPerson.id).toBeDefined()

    const createdArticle = result?.records[1] as Article
    expect(createdArticle.id).toBeDefined()

    const { record: persistedPerson } = await articlesApi.findRecord<Person>('people', createdPerson.id)
    expect(persistedPerson.firstName).toBe('Alice')
    expect(persistedPerson.lastName).toBe('Smith')

    const { record: persistedArticle } = await articlesApi.findRecord<Article>('articles', createdArticle.id, {
      include: ['author'],
    })
    expect(persistedArticle.title).toBe('Atomic Operations Test')
    expect(persistedArticle.author?.id).toBe(createdPerson.id)
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

    const result = await articlesApi.saveAtomic([{ op: 'add', data: newArticle }])

    expect(result).toBeDefined()
    expect(result?.records.length).toBe(1)

    const createdArticle = result?.records[0] as Article
    expect(createdArticle.id).toBeDefined()

    const { record: persistedArticle } = await articlesApi.findRecord<Article>('articles', createdArticle.id, {
      include: ['author'],
    })
    expect(persistedArticle.title).toBe('Another Atomic Article')
    expect(persistedArticle.author?.id).toBe('1')
  })

  test('atomic operations - update article', async () => {
    const newArticle: Article = {
      id: '',
      type: 'articles',
      title: 'Article to Update',
    }
    const createResult = (await articlesApi.saveRecord(newArticle)) as Article
    expect(createResult.id).toBeDefined()

    createResult.title = 'Updated via Atomic Operations'

    const result = await articlesApi.saveAtomic([{ op: 'update', data: createResult }])
    if (result) {
      expect(result.records.length).toBeGreaterThanOrEqual(0)
    }

    const { record: updatedArticle } = await articlesApi.findRecord<Article>('articles', createResult.id)
    expect(updatedArticle.title).toBe('Updated via Atomic Operations')
  })

  test('atomic operations - to-many relationship updates (add, replace, remove comments)', async () => {
    const newArticle: Article = {
      id: '',
      type: 'articles',
      title: 'Article for To-Many Relationship Test',
    }
    const article = await articlesApi.saveRecord<Article>(newArticle)
    expect(article.id).toBeDefined()

    const newComment1: Comment = {
      id: '',
      type: 'comments',
      body: 'To-many test comment 1',
    }
    const newComment2: Comment = {
      id: '',
      type: 'comments',
      body: 'To-many test comment 2',
    }
    const comment1 = await articlesApi.saveRecord<Comment>(newComment1)
    const comment2 = await articlesApi.saveRecord<Comment>(newComment2)
    expect(comment1.id).toBeDefined()
    expect(comment2.id).toBeDefined()

    await articlesApi.saveAtomic([
      {
        op: 'add',
        ref: { type: 'articles', id: article.id, relationship: 'comments' },
        data: [
          { type: 'comments', id: comment1.id },
          { type: 'comments', id: comment2.id },
        ],
      },
    ])

    const { record: articleWithComments } = await articlesApi.findRecord<Article>('articles', article.id, {
      include: ['comments'],
    })
    expect(articleWithComments.comments?.length).toBe(2)
    const commentIds = articleWithComments.comments?.map((comment) => comment.id)
    expect(commentIds).toContain(comment1.id)
    expect(commentIds).toContain(comment2.id)

    await articlesApi.saveAtomic([
      {
        op: 'update',
        ref: { type: 'articles', id: article.id, relationship: 'comments' },
        data: [{ type: 'comments', id: comment2.id }],
      },
    ])

    const { record: articleAfterReplace } = await articlesApi.findRecord<Article>('articles', article.id, {
      include: ['comments'],
    })
    expect(articleAfterReplace.comments?.length).toBe(1)
    expect(articleAfterReplace.comments?.[0]?.id).toBe(comment2.id)

    await articlesApi.saveAtomic([
      {
        op: 'remove',
        ref: { type: 'articles', id: article.id, relationship: 'comments' },
        data: [{ type: 'comments', id: comment2.id }],
      },
    ])

    const { record: articleAfterRemove } = await articlesApi.findRecord<Article>('articles', article.id, {
      include: ['comments'],
    })
    expect(articleAfterRemove.comments?.length ?? 0).toBe(0)
  })

  test('atomic operations - update to-one relationship via resource data member', async () => {
    const newArticle: Article = {
      id: '',
      type: 'articles',
      title: 'Article Without Author',
    }
    const article = await articlesApi.saveRecord<Article>(newArticle)
    expect(article.id).toBeDefined()

    const { record: articleBefore } = await articlesApi.findRecord<Article>('articles', article.id, {
      include: ['author'],
    })
    expect(articleBefore.author).toBeUndefined()

    const updatedArticle: Article = { ...article, author: { id: '1', type: 'people' } as Person }
    await articlesApi.saveAtomic([{ op: 'update', data: updatedArticle }])

    const { record: articleAfter } = await articlesApi.findRecord<Article>('articles', article.id, {
      include: ['author'],
    })
    expect(articleAfter.author?.id).toBe('1')
    expect(articleAfter.author?.firstName).toBe('Dan')
  })

  test('patch article', async () => {
    const newArticle: Article = {
      id: '',
      type: 'articles',
      title: 'Article to Patch',
    }

    const createResult = (await articlesApi.saveRecord(newArticle)) as Article
    expect(createResult.id).toBeDefined()

    createResult.title = 'Updated via PATCH'
    delete createResult.lid

    const patchResult = await articlesApi.saveRecord<Article>(createResult)
    expect(patchResult.id).toBe(createResult.id)
    expect(patchResult.title).toBe('Updated via PATCH')

    const { record: patchedArticle } = await articlesApi.findRecord<Article>('articles', createResult.id)
    expect(patchedArticle.title).toBe('Updated via PATCH')
  })
})
