# Seamark Axum integration fixture

This fixture exercises the TypeScript JSON:API client against an Axum server
built with Seamark's standard SeaORM query and mutation adapters and API
builder. Its Seamark dependency uses the published crates.io release `0.3.0`
for reproducible builds.

Run it from the `json-api` repository root with:

```sh
pnpm test:integration:seamark
```

## Coverage and limitation

The Seamark client suite mirrors the JsonApiDotNetCore integration assertions
for article/people/comment reads and includes, resource creation, Atomic
Operations (including local IDs and relationship mutations), and PATCH.
Articles, people, and comments use SeaORM entities stored in an in-memory
SQLite database; Seamark's standard adapters handle query execution,
projection, base mutations, and Atomic Operations.
Atomic create results contain resource identifiers, so the client tests fetch
the created resources to verify their persisted attributes and relationships.

The one omitted assertion is the article copyright resource-level `meta`.
Seamark's public `AdapterResource` has no resource-level metadata field, and
registry-based projection produces resource objects from registered
attributes and relationships, so this fixture cannot produce that
resource-level `meta` without bypassing Seamark's public response path. The
existing JsonApiDotNetCore assertion remains unchanged.
