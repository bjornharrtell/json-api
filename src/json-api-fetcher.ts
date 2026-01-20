import type { JsonApiAtomicDocument, JsonApiDocument, JsonApiResource } from './json-api.ts'

function resolvePath(...segments: string[]): string {
  return new URL(segments.join('/')).href
}

export interface PageOption {
  size?: number
  number?: number
}

export interface FetchOptions {
  fields?: Record<string, string[]>
  page?: PageOption
  include?: string[]
  filter?: string
  headers?: HeadersInit
  body?: BodyInit
  signal?: AbortSignal
}

export interface FetchParams {
  [key: string]: string
}

export interface Options {
  searchParams?: URLSearchParams
  headers: Headers
  method?: string
  body?: BodyInit
  signal?: AbortSignal
}

class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
    public document?: JsonApiDocument,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

async function tryError(response: Response) {
  if (response.ok) return
  let errorMessage = `HTTP error! status: ${response.status} ${response.statusText}`
  let errorDocument: JsonApiDocument | undefined
  try {
    errorDocument = (await response.json()) as JsonApiDocument
    if (errorDocument.errors && errorDocument.errors.length > 0) {
      const firstError = errorDocument.errors[0]
      errorMessage += ` - ${firstError.title}: ${firstError.detail ?? ''}`
    }
  } catch {
    // Ignore JSON parsing errors
  }
  throw new HttpError(errorMessage, response.status, errorDocument)
}

async function req(url: string, options: Options) {
  const { headers, searchParams, method, signal, body } = options
  const textSearchParams = searchParams ? `?${searchParams}` : ''
  const finalUrl = url.replace(/(?:\?.*?)?(?=#|$)/, textSearchParams)
  const response = await fetch(finalUrl, {
    method,
    headers,
    signal,
    body,
  })
  tryError(response)
  const data = (await response.json()) as JsonApiDocument
  return data
}

async function postAtomic(url: string, options: FetchOptions) {
  const { signal, body } = options
  const method = 'POST'
  const headers = new Headers(options.headers ?? {})
  headers.append('Accept', 'application/vnd.api+json; ext="https://jsonapi.org/ext/atomic"')
  headers.append('Content-Type', 'application/vnd.api+json; ext="https://jsonapi.org/ext/atomic"')
  const response = await fetch(url, {
    method,
    headers,
    signal,
    body,
  })
  tryError(response)
  if (response.status === 204) return
  const data = (await response.json()) as JsonApiAtomicDocument
  return data
}

export type JsonApiFetcher = InstanceType<typeof JsonApiFetcherImpl>

export class JsonApiFetcherImpl implements JsonApiFetcher {
  constructor(public endpoint: string) {}
  createOptions(options: FetchOptions = {}, params: FetchParams = {}, body?: BodyInit): Options {
    const searchParams = new URLSearchParams()
    const headers = new Headers(options.headers ?? {})
    headers.append('Accept', 'application/vnd.api+json')
    const requestOptions = { searchParams, headers, body }
    if (options.fields)
      for (const [key, value] of Object.entries(options.fields)) searchParams.append(`fields[${key}]`, value.join(','))
    if (options.page?.size) searchParams.append('page[size]', options.page.size.toString())
    if (options.page?.number) searchParams.append('page[number]', options.page.number.toString())
    if (options.include) searchParams.append('include', options.include.join(','))
    if (options.filter) searchParams.append('filter', options.filter)
    for (const [key, value] of Object.entries(params)) searchParams.append(key, value)
    return requestOptions
  }
  async fetchDocument(type: string, id?: string, options?: FetchOptions, params?: FetchParams) {
    const segments = [this.endpoint, type]
    if (id) segments.push(id)
    const url = resolvePath(...segments)
    const doc = await req(url, this.createOptions(options, params))
    return doc
  }
  async fetchAll(type: string, options?: FetchOptions, params?: FetchParams) {
    const url = resolvePath(this.endpoint, type)
    const doc = await req(url, this.createOptions(options, params))
    const resources = doc.data as JsonApiResource[]
    return resources
  }
  async fetchOne(type: string, id: string, options?: FetchOptions, params?: FetchParams) {
    const url = resolvePath(this.endpoint, type, id)
    const doc = await req(url, this.createOptions(options, params))
    const resource = doc.data as JsonApiResource
    return resource
  }
  async fetchHasMany(type: string, id: string, name: string, options?: FetchOptions, params?: FetchParams) {
    const url = resolvePath(this.endpoint, type, id, name)
    const doc = await req(url, this.createOptions(options, params))
    return doc
  }
  async fetchBelongsTo(type: string, id: string, name: string, options?: FetchOptions, params?: FetchParams) {
    const url = resolvePath(this.endpoint, type, id, name)
    const doc = await req(url, this.createOptions(options, params))
    return doc
  }
  async post(resource: JsonApiResource, options?: FetchOptions) {
    const url = resolvePath(this.endpoint, resource.type)
    const postDoc: JsonApiDocument = {
      data: resource,
    }
    const body = JSON.stringify(postDoc)
    const newOptions = this.createOptions(options, {}, body)
    newOptions.method = 'POST'
    newOptions.headers.set('Content-Type', 'application/vnd.api+json')
    const doc = (await req(url, newOptions)) as JsonApiDocument
    return doc
  }
  async postAtomic(doc: JsonApiAtomicDocument, options: FetchOptions = {}) {
    const url = new URL([this.endpoint, 'operations'].join('/')).href
    options.body = JSON.stringify(doc)
    const results = await postAtomic(url, options)
    return results
  }
}
