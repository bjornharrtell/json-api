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
  test('fetch single article', async () => {
    const { record: article } = await articlesApi.findRecord<Article>('articles', '1')

    expect(article.id).toBe('1')
    expect(article.title).toBe('JSON:API paints my bikeshed!')
  })

  test('fetch all articles', async () => {
    const { records: articles } = await articlesApi.findAll<Article>('articles')

    expect(articles.length).toBeGreaterThanOrEqual(1)
    const article = articles.find((item) => item.id === '1')
    expect(article).toBeDefined()
    expect(article?.title).toBe('JSON:API paints my bikeshed!')
  })

  test('fetch people resources', async () => {
    const { records: people } = await articlesApi.findAll<Person>('people')
    expect(people.length).toBeGreaterThan(0)

    const dan = people.find((person) => person.firstName === 'Dan')
    expect(dan).toBeDefined()
    expect(dan?.lastName).toBe('Gebhardt')
  })

  test('fetch comments resources', async () => {
    const { records: comments } = await articlesApi.findAll<Comment>('comments')
    expect(comments.length).toBeGreaterThan(0)

    const firstComment = comments.find((comment) => comment.body === 'First!')
    expect(firstComment).toBeDefined()
  })
})
