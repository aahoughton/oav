# Changelog

## [2.4.0](https://github.com/aahoughton/oav/compare/oav-core-v2.3.0...oav-core-v2.4.0) (2026-06-06)


### Features

* **schema:** add maxDepth to bound recursion through $ref cycles ([#333](https://github.com/aahoughton/oav/issues/333)) ([cd05fa1](https://github.com/aahoughton/oav/commit/cd05fa1938db3714d3c19026a90b3971a88aeb80))


### Bug Fixes

* **schema:** make deepEqual iterative to stop stack overflow on deep data ([#332](https://github.com/aahoughton/oav/issues/332)) ([5aaa4dd](https://github.com/aahoughton/oav/commit/5aaa4ddce3f8bfdde1e9e29e8f4d99b513539cbf))


### Documentation

* **adapters:** add Hardening section to adapter READMEs ([#334](https://github.com/aahoughton/oav/issues/334)) ([73bdcb2](https://github.com/aahoughton/oav/commit/73bdcb28180f9ae64ccd8e5ea9f44b2efa673497))

## [2.3.0](https://github.com/aahoughton/oav/compare/oav-core-v2.2.1...oav-core-v2.3.0) (2026-06-06)


### Features

* **oav:** make esbuild an optional peer dependency ([#313](https://github.com/aahoughton/oav/issues/313)) ([daad9dd](https://github.com/aahoughton/oav/commit/daad9dd8b5848f6df5e5f1917b613c78208527f0))


### Bug Fixes

* correctness fixes from review (path decode, spaceDelimited, emit dedup) ([#326](https://github.com/aahoughton/oav/issues/326)) ([47ec36b](https://github.com/aahoughton/oav/commit/47ec36b6e35c3cea807b86cb199f56b3c6c92017))
* **release:** prefix tarball path with ./ for npm publish ([#308](https://github.com/aahoughton/oav/issues/308)) ([ddd0524](https://github.com/aahoughton/oav/commit/ddd052479e6c0d2147abbda135d33285d9cb94ac))


### Performance

* **core:** share frozen empty params default across errors ([#317](https://github.com/aahoughton/oav/issues/317)) ([bad7cfb](https://github.com/aahoughton/oav/commit/bad7cfb3e866eef3f0da334e7100556000e4c9f0))
* large-response benchmarks (stress + error-tree anatomy) ([#318](https://github.com/aahoughton/oav/issues/318)) ([4bbc1e7](https://github.com/aahoughton/oav/commit/4bbc1e7666763c78cac04f85794c79ee41da5ad0))
* **schema:** bind property value to a local before validating it ([#324](https://github.com/aahoughton/oav/issues/324)) ([cb167f3](https://github.com/aahoughton/oav/commit/cb167f3753ed20706df6076cb56ec2be7b8849a1))
* **schema:** bound minLength/maxLength by string length before walking code points ([#322](https://github.com/aahoughton/oav/issues/322)) ([35a32f2](https://github.com/aahoughton/oav/commit/35a32f243318de3b32c20e7d634bb7cbd6728188))
* **schema:** low-risk codegen cleanups ([7a2863c](https://github.com/aahoughton/oav/commit/7a2863c35b225b903f45cdc2003c529c8a771fc9))
* **schema:** low-risk codegen cleanups (redundant isFinite, length hoist, unused eval params) ([#323](https://github.com/aahoughton/oav/issues/323)) ([7a2863c](https://github.com/aahoughton/oav/commit/7a2863c35b225b903f45cdc2003c529c8a771fc9))
* **schema:** object hot-path codegen (single-pass required + shared guard) ([#316](https://github.com/aahoughton/oav/issues/316)) ([6dc008f](https://github.com/aahoughton/oav/commit/6dc008f876bf9b6b39ad2a10edf2ac95da99c53e))


### Documentation

* harden recursion-depth guidance and slim CLAUDE.md ([#331](https://github.com/aahoughton/oav/issues/331)) ([8c91e50](https://github.com/aahoughton/oav/commit/8c91e5012c1e03726e6f0a161f33d4c3c008795e))
* refresh benchmark and comparison perf claims after perf work ([#325](https://github.com/aahoughton/oav/issues/325)) ([6e70129](https://github.com/aahoughton/oav/commit/6e7012952dc02336b2c928945b254945460ff96d))

## [2.2.1](https://github.com/aahoughton/oav/compare/oav-core-v2.2.0...oav-core-v2.2.1) (2026-06-05)


### Documentation

* **core:** toProblemDetails echoes request values + schema metadata ([#304](https://github.com/aahoughton/oav/issues/304)) ([1f566fc](https://github.com/aahoughton/oav/commit/1f566fc045823b1099722963bb7f8197bfabd63b))

## [2.2.0](https://github.com/aahoughton/oav/compare/oav-core-v2.1.0...oav-core-v2.2.0) (2026-05-19)


### Features

* **overlay-spec:** translator for OpenAPI Overlay 1.0 spec format ([#290](https://github.com/aahoughton/oav/issues/290)) ([e8ae711](https://github.com/aahoughton/oav/commit/e8ae71100586922f55040db59537866d3e2d8938))
* **schema:** regexCompiler option for pattern and format: regex ([#289](https://github.com/aahoughton/oav/issues/289)) ([a9418c2](https://github.com/aahoughton/oav/commit/a9418c28db2c508a39a88b33a406fd0c8091b685))
* **spec:** expand SpecOverlay typed verbs to cover OpenAPI Overlay axes ([#284](https://github.com/aahoughton/oav/issues/284)) ([2e0423b](https://github.com/aahoughton/oav/commit/2e0423b4868a5f02b29ccfd31cd4fb74d438c287))

## [2.1.0](https://github.com/aahoughton/oav/compare/oav-core-v2.0.0...oav-core-v2.1.0) (2026-05-04)


### Features

* **validator:** enum-valued validateSecurity with strict mode ([#262](https://github.com/aahoughton/oav/issues/262)) ([df1bb4d](https://github.com/aahoughton/oav/commit/df1bb4d20a2662d927a0758a772f1c546ebec6c8))


### Bug Fixes

* **schema:** close codegen-injection vectors in keyword compilation ([#253](https://github.com/aahoughton/oav/issues/253)) ([b456f08](https://github.com/aahoughton/oav/commit/b456f0834d0544d61248eab564e7a21189d2c39a))
* **validator:** check required response headers when res.headers is absent ([1561395](https://github.com/aahoughton/oav/commit/1561395bebd646528e683357f34c6ecd2830a782))
* **validator:** required response headers when res.headers is absent ([#261](https://github.com/aahoughton/oav/issues/261)) ([1561395](https://github.com/aahoughton/oav/commit/1561395bebd646528e683357f34c6ecd2830a782))


### Performance

* **schema:** low-risk codegen wins (regex hoist, primitive equality, oneOf cleanup, required predicate) ([#265](https://github.com/aahoughton/oav/issues/265)) ([a9bc49d](https://github.com/aahoughton/oav/commit/a9bc49d9298ef6609990f6f0fd4ade51eebfaadc))


### Documentation

* cleanup pass, spelling normalization, TSDoc tightening ([#260](https://github.com/aahoughton/oav/issues/260)) ([77fcf4d](https://github.com/aahoughton/oav/commit/77fcf4ddafe8e6a30b8108fc0dee78a31a8e1a6b))

## [2.0.0](https://github.com/aahoughton/oav/compare/oav-core-v1.1.2...oav-core-v2.0.0) (2026-05-02)


### ⚠ BREAKING CHANGES

* **core:** formatSummary separator + includeCode ([#241](https://github.com/aahoughton/oav/issues/241))

### Features

* **core:** formatSummary separator + includeCode ([#241](https://github.com/aahoughton/oav/issues/241)) ([4cf7148](https://github.com/aahoughton/oav/commit/4cf7148d84f0c42e37359335c3ea297a8e74a9f9))
* **schema:** silent-rewrite/* lint family with three checks ([#245](https://github.com/aahoughton/oav/issues/245)) ([1dda495](https://github.com/aahoughton/oav/commit/1dda495d998b8add5db57aadddbfa537ab95f3cd))
* **spec:** spec-hygiene lint (resolveSpec / createValidator / oav resolve --lint) ([#243](https://github.com/aahoughton/oav/issues/243)) ([af3b1da](https://github.com/aahoughton/oav/commit/af3b1da327197ea353aaa4ac9a39029cb890de37))
* **spec:** spec-hygiene lint with four checks; surfaces from resolveSpec, loadSpec, createValidator, oav resolve ([af3b1da](https://github.com/aahoughton/oav/commit/af3b1da327197ea353aaa4ac9a39029cb890de37))


### Documentation

* move root markdown into docs/ subdir ([#237](https://github.com/aahoughton/oav/issues/237)) ([365af48](https://github.com/aahoughton/oav/commit/365af48ab7394bf18ddc498419f15be67079ba3a))
* trim README; extract reference content into docs/ ([#239](https://github.com/aahoughton/oav/issues/239)) ([db25a46](https://github.com/aahoughton/oav/commit/db25a46c4c3e6ca04a5a531cd48396561022b0b5))

## [1.1.2](https://github.com/aahoughton/oav/compare/oav-core-v1.1.1...oav-core-v1.1.2) (2026-04-27)


### Bug Fixes

* **docs:** cross-link gaps, custom-envelope worked example, parseYamlString cast hint ([#230](https://github.com/aahoughton/oav/issues/230)) ([b65c75d](https://github.com/aahoughton/oav/commit/b65c75dc54ca2afc128858587d2ab7ffec0d3f57)), closes [#229](https://github.com/aahoughton/oav/issues/229)

## [1.1.1](https://github.com/aahoughton/oav/compare/oav-core-v1.1.0...oav-core-v1.1.1) (2026-04-27)


### Bug Fixes

* drop preinstall script; too belt+suspender-y ([#228](https://github.com/aahoughton/oav/issues/228)) ([2ca850d](https://github.com/aahoughton/oav/commit/2ca850d9ba77cd696423b407a80445c758adf379)), closes [#227](https://github.com/aahoughton/oav/issues/227)
* **release:** revert OIDC; pnpm publish doesn't do trusted-publisher exchange ([#223](https://github.com/aahoughton/oav/issues/223)) ([2fc681e](https://github.com/aahoughton/oav/commit/2fc681ed9d0dcc824bc11cf856bc0494532ff54c))
* **release:** revert to NPM_TOKEN auth; pnpm doesn't yet do OIDC exchange ([2fc681e](https://github.com/aahoughton/oav/commit/2fc681ed9d0dcc824bc11cf856bc0494532ff54c))
* **release:** unblock OIDC trusted publishing; add dispatch recovery handle ([#221](https://github.com/aahoughton/oav/issues/221)) ([a3ae3e5](https://github.com/aahoughton/oav/commit/a3ae3e57619ce77e915f5ff47a55d1c443920d5e))


### Documentation

* rework readme to surface goals ([#226](https://github.com/aahoughton/oav/issues/226)) ([babe3e5](https://github.com/aahoughton/oav/commit/babe3e5c199bda9ebc0b59af311b2cac93d2ae7e)), closes [#225](https://github.com/aahoughton/oav/issues/225)

## [1.1.0](https://github.com/aahoughton/oav/compare/oav-core-v1.0.0...oav-core-v1.1.0) (2026-04-26)


### Features

* **core:** add formatSummary + toJsonObject; deprecate three misnamed exports ([#218](https://github.com/aahoughton/oav/issues/218)) ([23ce743](https://github.com/aahoughton/oav/commit/23ce743e1241b58998a385ecfb4ccb56a34daa3c))

## 1.0.0 (2026-04-25)

Initial release. `@aahoughton/oav-core` is the lean, zero-runtime-dependency
core: an HTTP-aware OpenAPI 3.0 / 3.1 / 3.2 request and response validator
built on a JSON Schema 2020-12 codegen compiler. JSON specs only. For YAML
readers and the `oav` CLI, install [`@aahoughton/oav`](https://www.npmjs.com/package/@aahoughton/oav)
instead.
