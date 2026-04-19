# Changelog

## [0.2.0](https://github.com/aahoughton/oav/compare/oav-v0.1.0...oav-v0.2.0) (2026-04-19)


### ⚠ BREAKING CHANGES

* **core:** drop unused VersionSupport type

### Features

* **cli:** oav binary with resolve / validate subcommands and .http parser ([a6afaab](https://github.com/aahoughton/oav/commit/a6afaabbd91f6c3802e35fe16937fb51124bf990))
* **conformance:** standalone package for upstream test-suite conformance ([d324bfa](https://github.com/aahoughton/oav/commit/d324bfaedfad93935b9a4053a70a560382e25d1b))
* **core,validator:** OpenAPI 3.2 support + dialect hook for future 3.0 ([166b811](https://github.com/aahoughton/oav/commit/166b8111abfcf54595ac7e642752db2118f07679))
* **core:** add toProblemDetails RFC 9457 helper and framework adapter docs ([52b27dd](https://github.com/aahoughton/oav/commit/52b27dd22a494e0ca697b7846003a05ef976961d))
* **core:** error tree model, shared types, and formatters ([4fdeb23](https://github.com/aahoughton/oav/commit/4fdeb23d3c0c4c4bfa5a69298dfe3bc9e71a38bb))
* **core:** publish BuiltInErrorParams as the per-code params contract ([de2e599](https://github.com/aahoughton/oav/commit/de2e599ef9e7c8ba6ce6a7738bb4361498a7c11e))
* **formats:** RFC 3339 / 5321 / 4291 / 3986 / 6570 / 6901 / 4122 string formats ([eb51635](https://github.com/aahoughton/oav/commit/eb5163531ed5787a0c2c9b67bb64cdb619ed6fa4))
* OpenAPI 3.0.x support via OAS 3.0 Schema Object dialect ([bdba1b6](https://github.com/aahoughton/oav/commit/bdba1b680b99548b4fa9af90a31ecd994490e0e6))
* **performance:** standalone benchmark package vs ajv + hyperjump ([9c221b9](https://github.com/aahoughton/oav/commit/9c221b900d8226d17577a5652853d0a059255156))
* **router:** trie-based OpenAPI path matching with specificity ordering ([355cf6b](https://github.com/aahoughton/oav/commit/355cf6bea6363f98696281e69a0d63f7eacea4a0))
* **schema,validator:** user-registered schema keywords ([20b742d](https://github.com/aahoughton/oav/commit/20b742d6355c03e6cd0d0ee377b5d51d6c9afe95))
* **schema:** $ref / $dynamicRef with JSON pointer + anchor resolution and cycle handling ([6ede8d7](https://github.com/aahoughton/oav/commit/6ede8d7ee807b1a7b4afda7f103834ebcb8cc59d))
* **schema:** add draft-07-compat dependencies keyword ([79af5a7](https://github.com/aahoughton/oav/commit/79af5a749f36d92f8c03d85c00d6dc83b7e1ca22))
* **schema:** applicator keywords (properties, items, allOf/anyOf/oneOf/not, if/then/else, contains, dependent*) ([c7100df](https://github.com/aahoughton/oav/commit/c7100dfadd3ce3c8e47c336b7ce7a24c186679d1))
* **schema:** codegen, registry, resolver, compiler skeleton ([f946490](https://github.com/aahoughton/oav/commit/f946490b74594aba9c3d740eacd023f37a613236))
* **schema:** maxErrors cap with loop short-circuit and truncated flag ([edaefb3](https://github.com/aahoughton/oav/commit/edaefb3e370bcc69abd2c485dd1dbe72f82009f8))
* **schema:** split format annotation vs assertion; decode JSON Pointer segments ([e182afb](https://github.com/aahoughton/oav/commit/e182afb3d4dce469a923e1365ff8b7df57bec9b2))
* **schema:** unevaluatedProperties/unevaluatedItems and discriminator ([cfb2ce0](https://github.com/aahoughton/oav/commit/cfb2ce0fc9d2e5bf765a301113501a42dfe18816))
* **schema:** validation keywords (type, enum, const, numeric/string/array/object bounds, required) ([ce4f043](https://github.com/aahoughton/oav/commit/ce4f043834149da8e97cfb58f397410c6940adfb))
* **spec:** add loadSpec pipeline entrypoint (resolve then overlay) ([6d73a8d](https://github.com/aahoughton/oav/commit/6d73a8dd28a8aa9cfd6ddb88bbb19638fc79dc42))
* **spec:** multi-file loader, resolver, overlay merger ([fb47758](https://github.com/aahoughton/oav/commit/fb477583682dbbf54c804951f29d42cc221c8fa4))
* **validator:** HTTP request/response validator with style-aware deserialization ([f61567d](https://github.com/aahoughton/oav/commit/f61567d845be78c052336ad98ced524226805f5f))
* **validator:** surface detected openapi version and onUnknownVersion option ([0df67a0](https://github.com/aahoughton/oav/commit/0df67a068acfd084c69df86918d4ee7b2a68757f))


### Bug Fixes

* **validator:** resolve operation-level $ref (requestBody, responses, parameters, headers) ([ecd647c](https://github.com/aahoughton/oav/commit/ecd647c0e09daccd626ac94af0d9ec6ee099afd4))


### Performance

* **performance:** measure validate hot-path cleanly; split valid/invalid ([b23d453](https://github.com/aahoughton/oav/commit/b23d453c997bc52e909c49d0e71d6f031e35785b))
* **schema:** inline multi-keyword leaf subschemas with tree-shape preservation ([35a9eaa](https://github.com/aahoughton/oav/commit/35a9eaaf9a66dc9f6b0e41d58e62e80f9644d36d))
* **schema:** inline single-keyword subschemas in applicator loops ([90d1534](https://github.com/aahoughton/oav/commit/90d1534534cfea73c9ddc17eb52f771c0bf37c29))
* **schema:** share the path array across sibling validations ([8e91974](https://github.com/aahoughton/oav/commit/8e9197494d3c444e316f9d7b8b5a619b72f3ecc6))


### Reverts

* **schema:** back out deferred-path fast path for single-keyword leaves ([f8cc336](https://github.com/aahoughton/oav/commit/f8cc3360700ace0530cf7d7195a8040e95912475))


### Documentation

* **conformance:** record 90.5% optional-suite pass rate and dependencies-compat fix ([cd0cd0a](https://github.com/aahoughton/oav/commit/cd0cd0aec57a2465d6abb4dea6e150291dcdf2eb))
* **performance:** reflect final numbers after the three-lever perf pass ([7be3221](https://github.com/aahoughton/oav/commit/7be3221b142d0f1285a3c257d9c2edad22ab497f))
* **performance:** update reading-the-results to reflect post-inlining + maxErrors reality ([9b2d08a](https://github.com/aahoughton/oav/commit/9b2d08a6d9bd30ad542a46ec7df1ec9d14a91d4c))
* refresh READMEs + add runnable examples directory ([7237038](https://github.com/aahoughton/oav/commit/72370389fe96c224d662f33639bd917ab87989d8))
* **repo:** root README, CLAUDE.md, per-package READMEs + build tsconfig ([31be668](https://github.com/aahoughton/oav/commit/31be668b28e737a0fe8ff79ef3511ecdda8d07b6))
* **repo:** surface conformance/ and performance/ in the root README and CLAUDE.md ([6d91819](https://github.com/aahoughton/oav/commit/6d91819c24889376a4a8d983de68771bb8e4a05e))
* rewrite READMEs for external consumers and fix tsdoc drift ([1d737cf](https://github.com/aahoughton/oav/commit/1d737cfa09d737afb3db12446470112c4583005e))
* **router:** document RouteMatch operation identity invariant ([842104a](https://github.com/aahoughton/oav/commit/842104ab864ebbdb3f638477b97eb2d08be0815c))


### Refactoring

* centralize @oav/* alias map in workspace-aliases.ts ([b1ddc42](https://github.com/aahoughton/oav/commit/b1ddc429af4e66389fbac9b0684f3031f1dd7f25))
* **cli:** accept injectable CommandIo and add commands tests ([d8323a0](https://github.com/aahoughton/oav/commit/d8323a03645fbe190c2075aedff0822f88f286b9))
* **cli:** derive output-format list from a single const tuple ([d140ef2](https://github.com/aahoughton/oav/commit/d140ef26518d6037ef18ff45531863b97ebc8e43))
* collapse oav root entrypoint to export * from core and validator ([88db4cb](https://github.com/aahoughton/oav/commit/88db4cb7bcb4336ab8906438b216c8354553da53))
* **core:** drop unused VersionSupport type ([6a150c2](https://github.com/aahoughton/oav/commit/6a150c21693a31cc8755ffaaa2d28e60f483d91c))
* **schema,validator:** accept startPath on CompiledSchema.validate, retire prefixPath ([0d9fc3b](https://github.com/aahoughton/oav/commit/0d9fc3ba320ddfc242af7efcabe7963c75436a50))
* **schema,validator:** make Dialect a first-class value ([412d235](https://github.com/aahoughton/oav/commit/412d235408a5f3777d7ad6691aa3548a7c98fcb8))
* **schema:** consolidate subschema API and prune dead ctx members ([193def0](https://github.com/aahoughton/oav/commit/193def05b46893463167972758c60d936d41159e))
* **schema:** expose CompileStats and rewrite inlining tests against them ([e61f8fc](https://github.com/aahoughton/oav/commit/e61f8fcb23bd870320325b2b85567875dfa55295))
* **schema:** narrow ctx.gen to a CodeEmitter interface ([8d1329a](https://github.com/aahoughton/oav/commit/8d1329a8871435207c57a34f5a3d5134dee350ba))
* **schema:** unify pushError/liftError into ctx.emitError({ kind }) ([4f8de30](https://github.com/aahoughton/oav/commit/4f8de30747d1b439baebb415b9b14c8ab0f595bd))

## Changelog

All notable changes to `@aahoughton/oav` will be documented in this
file. The format follows [Keep a Changelog](https://keepachangelog.com/)
and the project adheres to [Semantic Versioning](https://semver.org/).

Entries below this line are generated automatically by
[release-please](https://github.com/googleapis/release-please) from
[Conventional Commits](https://www.conventionalcommits.org/) on `main`.
