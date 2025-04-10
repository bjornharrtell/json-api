export interface JsonApiResourceIdentifier {
  id: string
  type: string
}

export interface JsonApiRelationship {
  data: null | [] | JsonApiResourceIdentifier | JsonApiResourceIdentifier[]
}

export interface JsonApiResource {
  id: string
  type: string
  attributes: Record<string, unknown>
  relationships?: Record<string, JsonApiRelationship>
}

export interface JsonApiMeta {
  // Pagination
  totalPages?: number
  totalItems?: number
  currentPage?: number
  itemsPerPage?: number

  // Common metadata
  timestamp?: string | number
  version?: string
  copyright?: string

  // Allow additional custom properties
  [key: string]: unknown
}

export interface JsonApiLinkObject {
  href: string
  rel?: string
  describedby?: JsonApiLink
  title?: string
  type?: string
  hreflang?: string | string[]
  meta?: JsonApiMeta
}

export type JsonApiLink = null | string | JsonApiLinkObject

export interface JsonApiLinks {
  self?: JsonApiLink
  related?: JsonApiLink
  describedby?: JsonApiLink
  first?: JsonApiLink
  last?: JsonApiLink
  prev?: JsonApiLink
  next?: JsonApiLink
}

export interface JsonApiDocument {
  links?: JsonApiLinks
  data?: JsonApiResource | JsonApiResource[]
  errors?: JsonApiError[]
  included?: JsonApiResource[]
  meta?: JsonApiMeta
}

export interface JsonApiError {
  id: string
  status: string
  code?: string
  title: string
  detail?: string
  meta?: JsonApiMeta
}
