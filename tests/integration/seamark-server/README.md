# Seamark Axum integration fixture

This fixture exercises the TypeScript JSON:API client against an Axum server
built with the public `seamark::http::router` API. Its Seamark dependency is
pinned to Git revision
`ca658ddbb989266754c46b7c97a118cca21fd85b` for reproducible builds; Cargo
fetches that revision from the public Seamark repository.

Run it from the `json-api` repository root with:

```sh
pnpm test:integration:seamark
```

## Current Seamark scope

The fixture covers unqueried collection and single-resource reads for articles,
people, and comments. The other existing JsonApiDotNetCore assertions cannot be
mirrored yet because the current Seamark `router` only serves `GET` collection
and resource routes and rejects every non-empty query string:

- `include`-based assertions for populated article comments/authors and comment
  authors are unavailable; their resource-identifier relationship linkage can
  be returned, but compound `included` resources cannot be requested through
  this router.
- `POST`, `PATCH`, and the client operations that depend on them are not
  implemented by this read-only router. The standalone Atomic Operations
  router is not part of this fixture.
- The current `AdapterResource` has no resource-level metadata field, so the
  JsonApiDotNetCore copyright metadata assertion has no equivalent.

These omissions are limited to the Seamark fixture; the existing
JsonApiDotNetCore integration tests and their assertions remain unchanged.
