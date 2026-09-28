# Seamark Axum integration fixture

This fixture exercises the TypeScript JSON:API client against an Axum server
built with Seamark's public query, mutation, and Atomic Operations router APIs.
Its Seamark dependency uses the published crates.io release `0.1.0` for
reproducible builds.

Run it from the `json-api` repository root with:

```sh
pnpm test:integration:seamark
```

## Coverage and limitation

The Seamark client suite mirrors the JsonApiDotNetCore integration assertions
for article/people/comment reads and includes, resource creation, Atomic
Operations (including local IDs and relationship mutations), and PATCH. The
fixture keeps its resources in process memory; an in-memory SQLite connection
provides the transaction boundary required by Seamark's Atomic HTTP router.

The one omitted assertion is the article copyright resource-level `meta`.
Seamark's public `AdapterResource` has no resource-level metadata field, and
the HTTP router projects resource objects from the registered attributes and
relationships, so this fixture cannot produce that resource-level `meta`
without bypassing Seamark's public response path. The existing
JsonApiDotNetCore assertion remains unchanged.
