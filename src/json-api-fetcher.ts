import type { JsonApiAtomicDocument, JsonApiAtomicOperation, JsonApiAtomicResults, JsonApiDocument, JsonApiResource } from './json-api.ts'

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
  signal?: AbortSignal
}

export interface FetchParams {
  [key: string]: string
}

export interface Options {
  searchParams: URLSearchParams
  headers: Headers
  method?: string
  body?: BodyInit
  signal?: AbortSignal
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
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status} ${response.statusText}`)
  const data = (await response.json()) as JsonApiDocument
  return data
}

export type JsonApiFetcher = InstanceType<typeof JsonApiFetcherImpl>

export class JsonApiFetcherImpl implements JsonApiFetcher {
  constructor(public endpoint: string) {}
  createOptions(options: FetchOptions = {}, params: FetchParams = {}, body?: BodyInit): Options {
    const searchParams = new URLSearchParams()
    const headers = new Headers(options.headers)
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
    const doc = await req(url, newOptions) as JsonApiDocument
    return doc
  }
  async postAtomic(doc: JsonApiAtomicDocument, options?: FetchOptions) {
    const url = new URL([this.endpoint, 'operations'].join('/')).href
    const body = JSON.stringify(doc)
    const newOptions = this.createOptions(options, {}, body)
    newOptions.method = 'POST'
    newOptions.headers.set('Accept', 'application/vnd.api+json; ext="https://jsonapi.org/ext/atomic"')
    newOptions.headers.set('Content-Type', 'application/vnd.api+json; ext="https://jsonapi.org/ext/atomic"')
    const results = await req(url, newOptions) as JsonApiAtomicResults
    return results
  }
}
