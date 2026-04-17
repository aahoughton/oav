# Autonomous Build: OpenAPI 3.1 Validator

You are building a production-quality OpenAPI 3.1 HTTP request/response validator from scratch. This is a greenfield TypeScript project. You have full autonomy and destructive permissions. Build it correctly the first time.

## Project name: `oav` (OpenAPI Validate)

## What this is

An HTTP validation engine for OpenAPI 3.1. Given an API spec (potentially split across multiple files with $ref), it resolves and stitches the spec together, then validates HTTP requests and responses against it, producing structured error trees of arbitrary depth that are both human-readable and machine-parseable.

This is NOT just a JSON Schema validator. It is an HTTP-aware validation toolkit with a JSON Schema 2020-12 compiler inside it.

## Non-negotiable architectural decisions

These are load-bearing. Do not deviate.

### 1. Error model is a tree, not a flat list

This is the single most important design decision. Every layer returns the same error type:

```typescript
interface ValidationError {
  code: string                         // "type", "required", "oneOf", "body", "query-param", etc.
  path: PathSegment[]                  // ["body", "users", 3, "email"] — segments, never a pre-joined string
  message: string                      // human-readable
  params: Record<string, unknown>      // machine-readable, keyword-specific
  children: ValidationError[]          // ALWAYS present, empty array for leaf errors. NOT optional.
}

type PathSegment = string | number
```

Applicator keywords (oneOf, allOf, anyOf, if/then/else) create branch nodes with children. `oneOf` failure has N children, one per branch. `allOf` failure has children for each failing conjunction. HTTP-level validation wraps schema errors: a request validation error has children for body errors, query param errors, header errors.

The `children` field is always `ValidationError[]`, never `undefined`. Leaf errors have `children: []`. This means every consumer can do `error.children.map(...)` without null checks.

### 2. Phased pipeline with inspectable intermediates

```
Schema JSON → Resolver → Resolved Graph → Analyzer → Annotated Graph → Compiler → Validation Function
```

Each phase is a pure function of its inputs. Each intermediate is a value you can assert on in tests. The compilation does NOT go directly from schema to eval'd function with no inspectable middle step.

### 3. Single dialect: JSON Schema 2020-12 + OpenAPI 3.1 extensions

No draft-7, no 2019-09, no JTD. One dialect. This eliminates enormous complexity.

### 4. Code generation for validation functions

Compile schemas to JavaScript functions via code generation (like Ajv does). Do NOT write an interpreter. The generated functions return `ValidationError | null`, not a boolean. The error tree is constructed during validation, not after.

The compiler always collects all errors (there is no `allErrors: false` fast-path). For HTTP validation, partial error reports are useless — the consumer needs the complete picture. This simplifies codegen significantly: every keyword always emits its error, no early-return branching based on error mode.

### 4a. Boolean schemas are first-class

JSON Schema 2020-12 allows `true` and `false` as schemas, not just objects. `true` validates everything. `false` rejects everything. Every part of the compiler that touches a schema value must handle `boolean | SchemaObject`. This is not an edge case — the official test suite exercises it heavily, and applicator keywords like `additionalProperties: false` depend on it. Handle this from day one.

### 5. Vocabularies and keywords are composable values, not class hierarchies

```typescript
interface KeywordDefinition {
  keyword: string
  vocabulary: string
  compile: (ctx: KeywordCompileContext) => CodeFragment
  inlineable?: boolean
  applicator?: boolean
  evaluates?: { ... }
  dependsOn?: string[]
  implements?: string[]    // "discriminator implements oneOf" — compiler knows to delegate
  before?: string
}

interface Vocabulary {
  uri: string
  keywords: KeywordDefinition[]
}
```

No subclasses. No virtual methods in constructors. Validator is constructed by a factory function that takes a vocabulary list.

### 6. Narrow, typed contexts — no god objects

Keyword authors receive ONLY what they need:

```typescript
interface KeywordCompileContext {
  readonly gen: CodeGen          // code generation handle
  readonly schema: unknown       // this keyword's schema value
  readonly parentSchema: SchemaObject
  readonly data: CodeExpression  // reference to the data variable
  readonly schemaPath: SchemaPath
  readonly dataPath: DataPath
  subschema(schema: SchemaObject): CodeFragment
  error(params: ErrorParams): void
}
```

They do NOT get access to the full validator instance, the registry, or unrelated configuration. There is no `this` threading of the validator instance through the compilation pipeline.

### 7. Spec overlay/extension system

Users can extend or override a base spec:

```typescript
interface SpecOverlay {
  addPaths?: Record<string, PathItem>
  overrides?: Record<string, PathOverride>    // path -> method -> operation overrides
  extendSchemas?: Record<string, SchemaObject>  // merged via allOf
  replaceSchemas?: Record<string, SchemaObject> // full swap
}
```

Overlays apply in order during the merge phase, between resolution and compilation.

## Development discipline

### Commits

Commit early and often. Every logical unit of work gets its own commit. Examples of commit boundaries:

- Monorepo scaffolding (workspace config, tsconfig, tooling) — commit before writing any source code
- Each package's initial types/interfaces — commit before implementing
- Each keyword implementation + its tests — commit
- Each phase completion — commit with a message noting the phase

Use conventional commit messages: `feat(core): add error tree formatters`, `test(schema): add oneOf branch structure assertions`, `feat(cli): add resolve subcommand`. Keep messages under 72 characters.

Do NOT batch large amounts of work into single commits. If you have been working for more than 15 minutes without committing, stop and commit what works.

### Testing philosophy

Test behavior, not implementation. Concretely:

- Assert on what a function returns or what effect it produces, never on internal state
- Do not assert on generated code strings — assert on the validation result of running the compiled function against input data
- Do not assert on the exact text of error `message` strings — assert on error `code`, `path`, `params`, and `children` structure
- Do not build test-only infrastructure like "recording code generators" or "mock compile contexts" — compile a real schema, validate real data, check the real error tree
- If a refactor of internals (without changing behavior) would break a test, that test is wrong
- Name tests as behaviors: `"rejects string when type is number"` not `"test type keyword"`

### Documentation

Every exported function, interface, and type alias must have TSDoc comments. This is a hard requirement — do not skip it and come back later. Write the TSDoc when you write the export.

TSDoc must include:
- A one-line summary
- `@param` for each parameter
- `@returns` description
- `@example` with a runnable code snippet

Do NOT add TSDoc to non-exported internals. Do NOT add inline comments unless the logic is genuinely non-obvious.

### Code quality

Linting and formatting are handled by oxlint and oxfmt. Both are pre-installed on this machine.

- Run `oxlint` to check for lint errors. Fix all warnings before committing.
- Run `oxfmt --write .` to format before committing.
- Configure these in the project root:
  - `oxlint`: create an `oxlintrc.json` (or use defaults if they're sane for TypeScript)
  - `oxfmt`: respects `.editorconfig` or its own config. Set printWidth to 100, use double quotes, trailing commas.
- Do NOT install eslint, prettier, or their plugins. oxlint and oxfmt replace them entirely.
- Add a `lint` script to the root package.json: `"lint": "oxlint && oxfmt --check ."`
- Add a `fmt` script: `"fmt": "oxfmt --write ."`

## Tech stack

- **Language**: TypeScript, strict mode, ES2022 target
- **Runtime**: Node.js >= 20
- **Package manager**: pnpm with workspaces
- **Test framework**: vitest
- **Build**: tsup for each package
- **YAML parsing**: yaml (npm package)
- **Linting**: oxlint (pre-installed, do NOT use eslint)
- **Formatting**: oxfmt (pre-installed, do NOT use prettier)

## Package structure (pnpm monorepo)

All packages are scoped under `@oav/`. Package names in package.json: `@oav/core`, `@oav/schema`, `@oav/spec`, `@oav/router`, `@oav/validator`, `@oav/cli`, `@oav/formats`.

```
packages/
  core/           — error model, shared types, error formatters       (@oav/core)
  schema/         — JSON Schema 2020-12 compiler (code generation)    (@oav/schema)
  spec/           — spec loader, multi-file resolver, overlay merger  (@oav/spec)
  router/         — OpenAPI path matching (trie-based)                (@oav/router)
  validator/      — HTTP request/response validation orchestrator     (@oav/validator)
  cli/            — command-line tool                                 (@oav/cli, bin: "oav")
  formats/        — string format validators (date-time, email, etc.) (@oav/formats)
```

Dependency graph (strictly enforced — no cycles):
```
cli → validator → router
               → spec → schema → core
               → formats → core
               → schema
               → core
     → spec
     → core
```

## Build order — follow this sequence

Build and fully test each phase before moving to the next. Run tests after each phase. Do not move on if tests fail.

### Phase 1: Core (error model + types)

Create the monorepo structure, then build `packages/core/`:

**Files to create:**
- `packages/core/src/errors.ts` — `ValidationError` interface, `createError()` helper, `createLeafError()`, `createBranchError()`
- `packages/core/src/types.ts` — shared types: `SchemaObject`, `OpenAPIDocument`, `PathItem`, `OperationObject`, `ParameterObject`, `RequestBodyObject`, `ResponseObject`, `MediaTypeObject`, `HeaderObject`, `ReferenceObject`, `PathSegment`, `HttpRequest`, `HttpResponse`
- `packages/core/src/format.ts` — error formatters: `formatText()` (indented human-readable), `formatJson()` (the raw tree), `formatFlat()` (one line per leaf for grep), `formatGithub()` (GitHub Actions annotation format)
- `packages/core/src/index.ts` — public exports

**Tests to write (these are critical — the error model is the foundation):**
- Error tree construction and traversal
- `formatText()` output for nested errors (oneOf with branches, allOf with failures, 3+ levels deep)
- `formatFlat()` correctly flattens a deep tree to leaf-per-line
- `formatJson()` round-trips through JSON.parse
- Edge cases: empty children array, single-child branch, very deep nesting (10+ levels)

**Definition of done:** All formatters produce correct output for a hand-constructed 4-level error tree representing a realistic oneOf validation failure.

### Phase 2: Schema compiler

Build `packages/schema/`. This is the largest and most complex package. It is broken into sub-phases to prevent getting stuck. Complete each sub-phase and commit before moving to the next.

#### Phase 2a: Code generation engine + compiler skeleton

Build the codegen foundation and the compiler loop that dispatches to keywords. No keywords yet — just the machinery.

**Code generation engine (`packages/schema/src/codegen/`):**
- `codegen.ts` — `CodeGen` class that builds JavaScript source strings. Supports: variable declaration, if/else, for/for-in loops, function calls, string concatenation for building code. The generated code constructs `ValidationError` trees (using `createError`/`createLeafError` from `@oav/core`), not flat arrays.
- `scope.ts` — variable scope management for generated code. Tracks variable names, prevents collisions, manages references to runtime values (schemas, formats, etc.) that the generated code needs to access via closure.
- `names.ts` — well-known variable names used in generated code (`data`, `errors`, `rootData`, `dataPath`, etc.)

**Schema resolution (`packages/schema/src/resolve/`):**
- `registry.ts` — `SchemaRegistry` class. One map, URI-keyed. `add(uri, schema)`, `get(uri)`, `remove(uri)`. No separate schemas/refs/cache triple.
- `resolver.ts` — resolves `$ref`, `$id`, `$anchor` within a schema or set of schemas. Output: a graph of resolved schema nodes. Handle `boolean` schemas (`true`/`false`) from the start — they are valid schemas in 2020-12.

**Compiler (`packages/schema/src/compiler/`):**
- `compiler.ts` — takes a schema + vocabulary list, walks the schema tree, dispatches to keyword `compile()` functions in vocabulary order, assembles generated code, evals into a validation function via `new Function()`.
- Must handle `boolean` schemas: `true` → always valid (no-op), `false` → always invalid (emit error).
- The compiled function signature: `(data: unknown) => ValidationResult`
- `ValidationResult`: `{ valid: boolean; error?: ValidationError }`

**Keyword system (`packages/schema/src/keywords/`):**
- `types.ts` — `KeywordDefinition`, `KeywordCompileContext`, `Vocabulary` interfaces
- `context.ts` — `KeywordCompileContext` implementation

**Tests for 2a:**
- CodeGen produces valid JavaScript (eval the output, it should not throw)
- Compile `true` schema → always returns `{ valid: true }`
- Compile `false` schema → always returns `{ valid: false, error: ... }`
- Compile `{}` (empty object schema) → always returns `{ valid: true }`
- SchemaRegistry add/get/remove

**Commit after 2a passes.**

#### Phase 2b: Validation keywords (the simple ones)

Implement these keywords — they are all leaf validators (no subschemas, no composition):

- `type` (handles all JSON types including integer; handles arrays of types)
- `enum`, `const`
- `multipleOf`, `maximum`, `exclusiveMaximum`, `minimum`, `exclusiveMinimum`
- `maxLength`, `minLength`, `pattern`
- `maxItems`, `minItems`, `uniqueItems`
- `maxProperties`, `minProperties`
- `required`

**Tests for 2b:** For each keyword, write behavioral tests: compile a schema, validate good data (expect null), validate bad data (expect an error with the correct `code`, `path`, and `params`). Test `type` with every JSON type. Test that `required` lists all missing properties.

**Commit after 2b passes.**

#### Phase 2c: Applicator keywords (composition)

These are the keywords that apply subschemas. This is where the error tree structure matters most.

- `properties`, `patternProperties`, `additionalProperties`
- `items`, `prefixItems`
- `contains` (with `maxContains`, `minContains`)
- `allOf`, `anyOf`, `oneOf`, `not`
- `if`/`then`/`else`
- `propertyNames`
- `dependentSchemas`, `dependentRequired`

**Critical: error tree structure for applicators.**

When `oneOf` compiles, the generated code must build a tree:
```javascript
// Generated code for oneOf (conceptual)
const oneOfChildren = [];
let matchCount = 0;
// branch 0
const branch0result = validateBranch0(data);
if (branch0result.valid) { matchCount++; }
else { oneOfChildren.push(createBranchError(0, "Cat", branch0result.error)); }
// ... branch N
if (matchCount !== 1) {
  errors.push(createError("oneOf", path, `must match exactly one of ${n} schemas`, { matchCount }, oneOfChildren));
}
```

Each applicator generates subschema validation calls (either inlined or as separate functions) and wraps their results into its own error node. `allOf` children are the failing conjuncts. `anyOf` children are all branches (when none match). `oneOf` children are all branches (when count != 1). `not` has no children — it's a leaf that says "must NOT match schema".

**Tests for 2c:** For each applicator:
- Valid data returns null
- Invalid data returns an error with correct `code`
- **Assert on tree structure**: `oneOf` error has N children (one per branch). `allOf` error has children only for failing branches. `properties` error has children for each failing property. Nested composition (`allOf` containing `oneOf`) produces a correctly nested tree.
- `additionalProperties: false` rejects extra properties (this exercises boolean schema handling)

**Commit after 2c passes.**

#### Phase 2d: $ref and $dynamicRef

- `$ref` — standard reference resolution. Compile the referenced schema and call it.
- `$dynamicRef` / `$dynamicAnchor` — dynamic scoping for recursive schemas.
- Circular `$ref` handling: detect cycles during compilation, use lazy stub + backpatch.

**Tests for 2d:**
- Simple `$ref` to a `$defs` entry
- `$ref` to a nested path within `$defs`
- Circular `$ref` (e.g., a tree node type that references itself)
- `$dynamicRef` with `$dynamicAnchor` (the recursive extension mechanism)

**Commit after 2d passes.**

#### Phase 2e: unevaluated keywords + discriminator

These are the hardest keywords. If you get stuck, skip with `// TODO` and a failing test.

- `unevaluatedProperties` — requires tracking which properties were "evaluated" by prior keywords (`properties`, `patternProperties`, `additionalProperties`, `allOf`/`anyOf`/`oneOf`/`if-then-else` applicators). This is the most complex keyword in the spec.
- `unevaluatedItems` — same concept for arrays.
- `discriminator` (OpenAPI extension) — when present alongside `oneOf`, check the discriminator property first, validate only the matching branch. Error shows only the relevant branch failure.

**Tests for 2e:**
- `unevaluatedProperties` with `properties` + `allOf` containing more `properties`
- `unevaluatedItems` with `prefixItems` + `items`
- `discriminator` validates only the matching branch
- `discriminator` error shows single-branch failure, not all branches

**Commit after 2e passes (or after marking TODOs and moving on).**

#### Phase 2f: JSON Schema Test Suite

Clone https://github.com/json-schema-org/JSON-Schema-Test-Suite into the repo (add to `.gitignore`, do not commit the suite itself — clone it in a test setup script or vitest globalSetup).

Write a test runner that reads `tests/draft2020-12/*.json` and generates vitest test cases from them. Each file contains an array of test groups, each group has a schema and an array of tests with `data`, `valid`, and `description`.

**Realistic expectations:** Aim for the required vocabulary tests to pass (`type`, `enum`, `const`, all validation keywords, all applicator keywords, `$ref`). The optional vocabulary tests (`format-assertion`, `unevaluated`, `$dynamicRef`) may have known failures — track them as skipped tests with `it.skip()` and a comment explaining what's missing.

Do NOT spend more than 30 minutes debugging test suite failures. If a specific test group is failing due to an edge case in a complex keyword, skip it and move on to Phase 3.

**Commit the test runner and results, including any skips.**

### Phase 3: Formats

Build `packages/formats/`:

Implement validators for these string formats:
- `date-time`, `date`, `time`, `duration` (RFC 3339)
- `email`, `idn-email` (RFC 5321/6531)
- `hostname`, `idn-hostname` (RFC 1123/5890)
- `ipv4`, `ipv6` (RFC 2673/4291)
- `uri`, `uri-reference`, `iri`, `iri-reference` (RFC 3986/3987)
- `uri-template` (RFC 6570)
- `json-pointer`, `relative-json-pointer` (RFC 6901)
- `regex` (ECMA 262)
- `uuid` (RFC 4122)

Each format is a pure function: `(value: string) => boolean`. Export them individually and as a collection.

**Tests:** Each format with valid and invalid examples. Use RFC-sourced examples where possible.

### Phase 4: Spec loader and resolver

Build `packages/spec/`:

**Document reader abstraction:**
```typescript
interface DocumentReader {
  read(uri: string): Promise<unknown>  // returns parsed JSON/YAML
}
```

Built-in implementations:
- `FileReader` — reads from filesystem, handles .json/.yaml/.yml
- `HttpReader` — fetches URLs (for remote $ref)
- `MemoryReader` — takes a `Map<string, unknown>`, for tests
- `CompositeReader` — tries readers in order based on URI scheme

**Spec resolver (`packages/spec/src/resolver.ts`):**
1. Read entry file
2. Walk document tree, collect all `$ref` values
3. For external refs (different file), read target, recursively resolve
4. Track resolution graph for cycle detection
5. Output: fully resolved OpenAPI document with all external $refs inlined, circular refs left as internal $refs

**Overlay merger (`packages/spec/src/overlay.ts`):**
- Implements the `SpecOverlay` merge semantics
- `addPaths`: added wholesale, error if path already exists in base
- `overrides`: operation-level merge. `addParameters` appends (replaces on name+in match). `requestBody`, `responses` replace the field.
- `extendSchemas`: wraps base schema + extension in `allOf`
- `replaceSchemas`: full swap
- Wildcard `"*"` in overrides applies to all paths/methods
- Overlays apply in order, later wins on conflicts
- Errors use the same `ValidationError` tree (overlay conflicts are spec-level errors, not runtime errors)

**Tests:**
- Single-file resolution (no external refs)
- Multi-file resolution with relative paths
- Circular $ref detection and handling
- YAML and JSON input
- Overlay: add paths, override parameters, extend schemas, replace schemas
- Overlay: wildcard overrides
- Overlay: conflict detection (two overlays modifying same field)
- Overlay: order matters (later overlay wins)

**Definition of done:** Can load a multi-file OpenAPI 3.1 spec split across 5+ files, apply 2 overlays, and produce a valid resolved document.

### Phase 5: Router

Build `packages/router/`:

- Trie-based path matching for OpenAPI path templates
- Handles `{paramName}` template segments
- Specificity: literal segments win over templates (`/pets/mine` beats `/pets/{petId}`)
- Extracts path parameters into `Record<string, string>`

```typescript
interface Router {
  match(method: string, path: string): RouteMatch | undefined
}

interface RouteMatch {
  operation: OperationObject
  pathParams: Record<string, string>
  pathItem: PathItem
  pathPattern: string              // the original template, e.g. "/pets/{petId}"
}
```

**Tests:**
- Exact path matching
- Template parameter extraction
- Specificity ordering
- Method matching (GET vs POST on same path)
- No match returns undefined
- Trailing slash handling
- Path with multiple template segments

### Phase 6: HTTP Validator

Build `packages/validator/`:

This is the orchestrator. Given a resolved spec, it:
1. Builds a router from the spec's paths
2. Pre-compiles all schemas referenced by operations
3. On `validateRequest()`: matches route, validates parameters (path, query, header, cookie), validates request body (content-type negotiation, schema validation)
4. On `validateResponse()`: matches route, validates status code, response headers, response body

```typescript
interface OavValidator {
  validateRequest(req: HttpRequest): ValidationError | null
  validateResponse(req: HttpRequest, res: HttpResponse): ValidationError | null
}

function createValidator(spec: ResolvedSpec, options?: ValidatorOptions): OavValidator
```

**Parameter deserialization:** OpenAPI's `style` + `explode` parameter serialization. Support at minimum:
- `simple` (path params default)
- `form` (query params default)
- `label` and `matrix` for path
- `deepObject` for query

Deserialize the raw string value into a typed value BEFORE schema validation.

**Content-type negotiation:** Match request's Content-Type against the operation's `requestBody.content` keys. Support wildcards (`application/*`, `*/*`).

**Tests:**
- Request body validation with correct error tree
- Missing required request body
- Wrong content type
- Path parameter validation
- Query parameter validation (including array params with style/explode)
- Header parameter validation
- Response body validation
- Response status code matching (exact, range like 2XX, default)
- Full request with multiple validation errors (body + query + header) — error tree has all three as children
- Valid request returns null

**Definition of done:** Can validate a realistic POST request with path params, query params, required headers, and a JSON body, returning a correctly structured error tree. Can validate the response too.

### Phase 7: CLI

Build `packages/cli/`:

Three subcommands:

```bash
oav resolve <spec>                                    # stitch and dump
oav resolve <spec> --overlay <file>...                # stitch with overrides
oav validate <spec> --path "POST /pets" --body <file> # validate request body
oav validate <spec> --schema Pet <file>               # validate against component schema
oav validate <spec> --request <file>                  # validate full HTTP request
oav validate <spec> --path "GET /pets" --response --status 200 --body <file>  # validate response
```

**Flags:**
- `--format text|json|flat|github` (default: text)
- `--overlay <file>` (repeatable)
- `--depth <n>` (truncate error tree depth, default: unlimited)
- `-o <file>` (output to file instead of stdout)
- `--quiet` (exit code only, no output)

**Exit codes:**
- 0: valid
- 1: validation errors
- 2: spec resolution error
- 3: input/usage error

**The CLI is a thin shell.** No business logic. Argument parsing, I/O, exit codes. Use `commander` or `yargs` for arg parsing.

**`.http` file parser:** Support the standard HTTP message format for `--request`:
```http
POST /pets?limit=10 HTTP/1.1
Content-Type: application/json
X-Tenant-Id: abc-123

{"name": "Fido", "species": "dog"}
```

Split on blank line, parse method/path/headers above, body below.

**Tests:**
- Each subcommand with valid input
- Each output format
- Error exit codes
- `--depth` truncation
- `.http` file parsing
- stdin input (`--body -`)

### Phase 8: Documentation and polish

**README.md at repo root:**
- What this is (one paragraph)
- Quick start (install, basic usage — 10 lines of code)
- CLI usage with examples
- Link to detailed docs

**Per-package README.md:**
- What the package does
- Installation
- API reference with examples
- For `core/`: error model documentation with tree examples
- For `schema/`: how to write custom keywords
- For `spec/`: overlay documentation with examples
- For `cli/`: full command reference

**CLAUDE.md at repo root:**
- Build commands (`pnpm install`, `pnpm build`, `pnpm test`, `pnpm test --filter=@oav/schema`)
- Architecture overview (one paragraph per package)
- Dependency graph
- How to add a new keyword
- How to add a new format
- How to add a new CLI output format

**package.json files:**
- Correct `exports` fields with `types`, `import`, `require` conditions
- `engines: { node: ">=20" }`
- `sideEffects: false`
- Proper `peerDependencies` where appropriate

**Final checks:**
- `pnpm build` succeeds with no errors
- `pnpm test` passes all tests
- `oxlint` passes with no warnings
- `oxfmt --check .` passes (all files formatted)
- TypeScript strict mode, no `any` except where interfacing with JSON values
- Every exported function, interface, and type has TSDoc with `@example`
- The CLI binary is properly configured in package.json (`bin` field) and works via `npx`
- Git log shows a clean history of incremental, well-described commits

## Constraints

- Do NOT use classes for the main API. Use factory functions that return interface implementations. Classes are fine internally (CodeGen, SchemaRegistry) but the public API is functions + interfaces.
- Do NOT add dependencies you don't need. The only npm dependencies should be: `yaml` (YAML parsing), `commander` or `yargs` (CLI arg parsing), and dev dependencies for vitest/tsup/typescript. No eslint, no prettier — oxlint and oxfmt handle that.
- Do NOT implement a JSON Schema interpreter. Compile to functions via code generation.
- Do NOT support drafts other than 2020-12. Do NOT build abstractions for hypothetical future drafts.
- Do NOT build an Express/Koa/Hono middleware package. That is out of scope for this build.
- Do NOT use `any` in public type signatures. Use `unknown` for JSON values.
- Do NOT install eslint, prettier, or any eslint/prettier plugins. Linting is oxlint. Formatting is oxfmt. They are already installed globally.
- Every test file should be focused — test one thing per file. Do not create 1000-line test files.
- Write tests as you go, not at the end. Each phase has a "definition of done" — meet it before moving on.
- If you get stuck on one keyword implementation for more than 10 minutes, skip it and move on. Mark it with a `// TODO: implement <keyword>` comment and a failing test. Come back to it after the rest of the system works.
- Prefer correctness over performance. This is a v1. Get it right first.
- Commit after every logical unit of work. Do not go more than 15 minutes without committing.

## Priority order if running long

If you find yourself deep into the build and realize you won't finish everything, prioritize in this order:

1. **Core + schema compiler through Phase 2c (applicators)** — this is the foundation. Without working schema validation with correct error trees, nothing else matters.
2. **Spec loader (Phase 4)** — multi-file resolution is a hard requirement.
3. **Router + HTTP validator (Phases 5-6)** — this is the user-facing product.
4. **CLI (Phase 7)** — high value, relatively quick to build on top of working packages.
5. **Formats (Phase 3)** — can be stubbed with TODO and basic implementations for common formats (date-time, email, uri, uuid).
6. **$dynamicRef, unevaluated keywords (Phase 2e)** — hardest keywords, lowest ROI for initial release.
7. **JSON Schema Test Suite integration (Phase 2f)** — important for correctness but not for initial functionality.
8. **Documentation (Phase 8)** — TSDoc should be written inline as you go, but README files are the lowest priority.

The goal is a working system that can validate HTTP requests against a multi-file OpenAPI spec and produce good error trees. A system that does this for 90% of real-world schemas is far more valuable than a system with 100% JSON Schema compliance but no HTTP validation layer.

## Pre-flight: what's already on this machine

The following are pre-installed and available globally. Do not install them as project dependencies:
- `pnpm` (package manager)
- `oxlint` (linter — replaces eslint)
- `oxfmt` (formatter — replaces prettier)
- `node` >= 20
- `git` (repo is initialized, no commits yet)

## How to start

The repo is already initialized with `git init` and `pnpm init`. Begin by:

1. Create `.gitignore`: `node_modules/`, `dist/`, `*.tsbuildinfo`, `.turbo/`, `coverage/`, `JSON-Schema-Test-Suite/`
2. Set up pnpm workspace config (`pnpm-workspace.yaml`)
3. Set up root `tsconfig.json` (strict, ES2022, composite project references)
4. Set up vitest config (root `vitest.config.ts` with workspace support, or per-package configs)
5. Set up oxlint and oxfmt config
6. Add root package.json scripts: `build`, `test`, `lint`, `fmt`
7. **Commit**: `chore: initialize monorepo scaffolding`
8. Then Phase 1: core package

Begin.
