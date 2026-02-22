# JsonApiDotNetCore Integration Test

This directory contains a self-contained ASP.NET Core application using JsonApiDotNetCore with SQLite and Entity Framework Core.

## Structure

- **Models/**: Entity models (Article, Comment, Person) with JsonApiDotNetCore attributes
- **Controllers/**: JsonApiDotNetCore controllers for each resource
- **Data/**: DbContext and seed data
- **Program.cs**: Application entry point with configuration

## How It Works

The C# server:
1. Uses SQLite for data storage
2. Implements JSON:API specification via JsonApiDotNetCore
3. Seeds sample data matching the README examples
4. Runs on http://localhost:5555

The integration test (`jsonapi-dotnetcore.spec.ts`):
1. Starts the C# server before tests run
2. Uses the TypeScript JSON:API client to test against the live server
3. Validates the client works with a real JSON:API implementation
4. Cleans up the server after tests complete

## Prerequisites

- .NET 10.0 SDK
- Node.js and pnpm

## Running the Tests

```bash
# From the project root
pnpm test tests/integration/jsonapi-dotnetcore.spec.ts
```

Or run the server manually:

```bash
cd tests/integration/jsonapi-server
dotnet run
```

Then test the API:

```bash
curl http://localhost:5555/api/articles?include=author,comments
```
