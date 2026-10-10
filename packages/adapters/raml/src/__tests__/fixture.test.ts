/**
 * RAML Adapter golden tests.
 *
 * Uses a minimal RAML 1.0 fixture to verify that the adapter
 * produces a valid CanonicalApiModel with correct endpoint counts,
 * schema references, and diagnostics.
 */
import { CanonicalApiModelSchema } from '@sketch-test/canonical-api-model';
import { describe, expect, test } from 'vitest';
import { type ImportResult, importRaml } from '../index';

// ─── RAML 1.0 Fixture ─────────────────────────────────────────────

const FIXTURE_RAML = `#%RAML 1.0
title: Test API
version: v1
baseUri: http://api.example.com/{version}
mediaType: application/json

types:
  User:
    type: object
    properties:
      id: integer
      name: string
      email: string
    example:
      id: 1
      name: Alice
      email: alice@test.com

/users:
  get:
    description: List all users
    queryParameters:
      limit:
        type: integer
        required: false
    responses:
      200:
        body:
          application/json:
            type: User[]
  post:
    description: Create a user
    body:
      application/json:
        type: User
    responses:
      201:
        body:
          application/json:
            type: User

/users/{userId}:
  get:
    description: Get user by ID
    responses:
      200:
        body:
          application/json:
            type: User

/auth/login:
  post:
    description: Login
    body:
      application/json:
        properties:
          email: string
          password: string
    responses:
      200:
        body:
          application/json:
            properties:
              accessToken: string
`;

const SOURCE_HASH = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2' as const;

// ─── Helper ──────────────────────────────────────────────────────

function runImport(yaml?: string): ImportResult {
  return importRaml(yaml ?? FIXTURE_RAML, {
    sourceLabel: 'fixture.raml',
    sourceHash: SOURCE_HASH,
  });
}

// ─── Tests ───────────────────────────────────────────────────────

describe('RAML Adapter', () => {
  const result = runImport();

  test('import succeeds with valid RAML', () => {
    expect(result.success).toBe(true);
    expect(result.model).not.toBeNull();
  });

  test('produces valid CanonicalApiModel', () => {
    const parsed = CanonicalApiModelSchema.safeParse(result.model);
    if (!parsed.success) {
      console.error(JSON.stringify(parsed.error.issues, null, 2));
    }
    expect(parsed.success).toBe(true);
  });

  test('correct endpoint count', () => {
    // 4 endpoints: GET /users, POST /users, GET /users/{userId}, POST /auth/login
    expect(result.model!.endpoints).toHaveLength(4);
  });

  test('correct schema count', () => {
    // 1 type: User
    const schemaIds = Object.keys(result.model!.schemas);
    expect(schemaIds).toContain('/schemas/User');
  });

  test('stable endpoint ids match OpenAPI adapter convention', () => {
    const ids = result.model!.endpoints.map((e) => e.id);
    expect(ids).toContain('GET-/users');
    expect(ids).toContain('POST-/users');
    expect(ids).toContain('GET-/users/:userId');
    expect(ids).toContain('POST-/auth/login');
  });

  test('resource path is correctly normalized', () => {
    const getUserEndpoint = result.model!.endpoints.find((e) => e.id === 'GET-/users/:userId');
    expect(getUserEndpoint).toBeDefined();
    expect(getUserEndpoint!.path).toBe('/users/:userId');
  });

  test('query parameters are extracted', () => {
    const listUsers = result.model!.endpoints.find((e) => e.id === 'GET-/users');
    expect(listUsers).toBeDefined();
    const queryParams = listUsers!.parameters.filter((p) => p.in === 'query');
    expect(queryParams.length).toBeGreaterThanOrEqual(1);
    expect(queryParams[0]!.name).toBe('limit');
  });

  test('URI parameters are extracted from path pattern', () => {
    const getUserEndpoint = result.model!.endpoints.find((e) => e.id === 'GET-/users/:userId');
    expect(getUserEndpoint).toBeDefined();
    const pathParams = getUserEndpoint!.parameters.filter((p) => p.in === 'path');
    expect(pathParams.length).toBe(1);
    expect(pathParams[0]!.name).toBe('userId');
  });

  test('request body is mapped for POST endpoints', () => {
    const createUser = result.model!.endpoints.find((e) => e.id === 'POST-/users');
    expect(createUser).toBeDefined();
    expect(createUser!.requestBodies.length).toBeGreaterThanOrEqual(1);
  });

  test('inline body properties create schema refs', () => {
    const login = result.model!.endpoints.find((e) => e.id === 'POST-/auth/login');
    expect(login).toBeDefined();
    expect(login!.requestBodies.length).toBeGreaterThanOrEqual(1);
  });

  test('responses are mapped with status codes', () => {
    const listUsers = result.model!.endpoints.find((e) => e.id === 'GET-/users');
    expect(listUsers).toBeDefined();
    expect(listUsers!.responses.length).toBeGreaterThanOrEqual(1);
    const okResponse = listUsers!.responses.find((r) => r.statusCode === 200);
    expect(okResponse).toBeDefined();
  });

  test('every endpoint has source locations', () => {
    for (const ep of result.model!.endpoints) {
      expect(ep.sourceLocations.length).toBeGreaterThanOrEqual(1);
      expect(ep.sourceLocations[0]!.sourceLabel).toBe('fixture.raml');
    }
  });

  test('metadata includes parser info', () => {
    expect(result.model!.metadata.sourceType).toBe('raml');
    expect(result.model!.metadata.parserName).toBe('@sketch-test/adapter-raml');
    expect(result.model!.metadata.sourceLabel).toBe('fixture.raml');
    expect(result.model!.metadata.sourceVersion).toBe('1.0.0');
  });

  test('baseUri is mapped as server', () => {
    expect(result.model!.servers.length).toBe(1);
    expect(result.model!.servers[0]!.url).toBe('http://api.example.com/{version}');
  });

  test('diagnostics include support for warnings', () => {
    // With the clean fixture, there should be no errors
    const errors = result.diagnostics.filter((d) => d.severity === 'error');
    expect(errors.length).toBe(0);
  });
});

describe('RAML Adapter — diagnostics for unsupported features', () => {
  test('warns on traits', () => {
    const ramlWithTraits = `#%RAML 1.0
title: Test With Traits
traits:
  paged:
    queryParameters:
      page: integer
/users:
  get:
    is: [paged]
    responses:
      200:
        body:
          application/json: {}
`;
    const res = runImport(ramlWithTraits);
    expect(res.success).toBe(true);
    const traitDiags = res.diagnostics.filter((d) => d.code === 'TRAITS_NOT_RESOLVED');
    expect(traitDiags.length).toBe(1);
  });

  test('warns on resourceTypes', () => {
    const ramlWithResourceTypes = `#%RAML 1.0
title: Test With Resource Types
resourceTypes:
  collection:
    get:
      responses:
        200:
          body:
            application/json: {}
/users:
  type: collection
`;
    const res = runImport(ramlWithResourceTypes);
    expect(res.success).toBe(true);
    const rtDiags = res.diagnostics.filter((d) => d.code === 'RESOURCE_TYPES_NOT_RESOLVED');
    expect(rtDiags.length).toBe(1);
  });

  test('warns on annotationTypes', () => {
    const ramlWithAnnotations = `#%RAML 1.0
title: Test With Annotations
annotationTypes:
  deprecated: string
/users:
  get:
    responses:
      200:
        body:
          application/json: {}
`;
    const res = runImport(ramlWithAnnotations);
    const annDiags = res.diagnostics.filter((d) => d.code === 'ANNOTATIONS_NOT_RESOLVED');
    expect(annDiags.length).toBe(1);
  });
});

describe('RAML Adapter — error cases', () => {
  test('fails on invalid YAML', () => {
    const res = runImport('not: valid: yaml: [');
    expect(res.success).toBe(false);
    expect(res.model).toBeNull();
    expect(res.diagnostics[0]!.code).toBe('INVALID_YAML');
  });

  test('fails on missing title', () => {
    const ramlNoTitle = `#%RAML 1.0
version: v1
/users:
  get:
    responses:
      200:
        body:
          application/json: {}
`;
    const res = runImport(ramlNoTitle);
    // Should have a MISSING_TITLE diagnostic
    const missingTitle = res.diagnostics.filter((d) => d.code === 'MISSING_TITLE');
    expect(missingTitle.length).toBe(1);
  });

  test('warns on libraries/uses', () => {
    const ramlWithUses = `#%RAML 1.0
title: Test With Libraries
uses:
  lib: ./library.raml
/users:
  get:
    responses:
      200:
        body:
          application/json: {}
`;
    const res = runImport(ramlWithUses);
    const libDiags = res.diagnostics.filter((d) => d.code === 'LIBRARIES_NOT_RESOLVED');
    expect(libDiags.length).toBe(1);
  });
});
