# Changelog

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
