# Changelog

## [4.0.0](https://github.com/aahoughton/oav/compare/oav-v3.1.0...oav-v4.0.0) (2026-06-09)


### ⚠ BREAKING CHANGES

* split into @aahoughton/oav-core + @aahoughton/oav ([#98](https://github.com/aahoughton/oav/issues/98))

### Features

* **cli:** accept http:// and https:// URLs for spec / overlay args ([#103](https://github.com/aahoughton/oav/issues/103)) ([f159479](https://github.com/aahoughton/oav/commit/f159479a4448ffa07d988cda0ca9eaab11d4c8e7))
* **cli:** compile-spec — AOT-compile OpenAPI to a standalone HTTP validator ([#126](https://github.com/aahoughton/oav/issues/126)) ([967e0ff](https://github.com/aahoughton/oav/commit/967e0fff45bc400db4a3cda00c5fadea8693c811))
* **cli:** oav compile --standalone — bundle runtime helpers via esbuild ([#119](https://github.com/aahoughton/oav/issues/119)) ([b2cf36e](https://github.com/aahoughton/oav/commit/b2cf36eff6c3821d2db9c20ff2ff4ddc2d2b8dbf))
* **core:** add formatSummary + toJsonObject; deprecate three misnamed exports ([#218](https://github.com/aahoughton/oav/issues/218)) ([23ce743](https://github.com/aahoughton/oav/commit/23ce743e1241b58998a385ecfb4ccb56a34daa3c))
* **oav:** make esbuild an optional peer dependency ([#313](https://github.com/aahoughton/oav/issues/313)) ([daad9dd](https://github.com/aahoughton/oav/commit/daad9dd8b5848f6df5e5f1917b613c78208527f0))
* **overlay-spec:** translator for OpenAPI Overlay 1.0 spec format ([#290](https://github.com/aahoughton/oav/issues/290)) ([e8ae711](https://github.com/aahoughton/oav/commit/e8ae71100586922f55040db59537866d3e2d8938))
* split into @aahoughton/oav-core + @aahoughton/oav ([#98](https://github.com/aahoughton/oav/issues/98)) ([c46bb9e](https://github.com/aahoughton/oav/commit/c46bb9e88114763b1cedb7e00a8d338567691156))
* synchronous spec loader (loadSpecSync) ([#362](https://github.com/aahoughton/oav/issues/362)) ([efbf842](https://github.com/aahoughton/oav/commit/efbf842a99d9405066ed4f3fc451ec3b9eb6ea9c))


### Bug Fixes

* **build:** conditional exports so CJS TypeScript consumers can resolve types ([#115](https://github.com/aahoughton/oav/issues/115)) ([6fa3006](https://github.com/aahoughton/oav/commit/6fa30063ebd04935083e2d0028078bf09e00a7c0))
* **docs:** cross-link gaps, custom-envelope worked example, parseYamlString cast hint ([#230](https://github.com/aahoughton/oav/issues/230)) ([b65c75d](https://github.com/aahoughton/oav/commit/b65c75dc54ca2afc128858587d2ab7ffec0d3f57)), closes [#229](https://github.com/aahoughton/oav/issues/229)
* **publish:** tighten pack/install scripts (closes [#165](https://github.com/aahoughton/oav/issues/165) [#166](https://github.com/aahoughton/oav/issues/166) [#167](https://github.com/aahoughton/oav/issues/167)) ([#178](https://github.com/aahoughton/oav/issues/178)) ([7d33cc1](https://github.com/aahoughton/oav/commit/7d33cc1d8d77dae261f46715fd422d11a4aa6352))


### Documentation

* add packages/oav/README.md and reflect adapter family ([#181](https://github.com/aahoughton/oav/issues/181)) ([757d4bd](https://github.com/aahoughton/oav/commit/757d4bd73211a2d6210b8fbf9bce73eee2ada5e2))
* cleanup pass, spelling normalization, TSDoc tightening ([#260](https://github.com/aahoughton/oav/issues/260)) ([77fcf4d](https://github.com/aahoughton/oav/commit/77fcf4ddafe8e6a30b8108fc0dee78a31a8e1a6b))
* drop [@aahoughton](https://github.com/aahoughton) scope from narrative prose ([#138](https://github.com/aahoughton/oav/issues/138)) ([2d157d0](https://github.com/aahoughton/oav/commit/2d157d0c04ec73f5c2a3b1644c8c9b59b89f3725))
* move root markdown into docs/ subdir ([#237](https://github.com/aahoughton/oav/issues/237)) ([365af48](https://github.com/aahoughton/oav/commit/365af48ab7394bf18ddc498419f15be67079ba3a))
* tightening pass — remove unshipped-adapter promises, drop defensive language ([#207](https://github.com/aahoughton/oav/issues/207)) ([09a40af](https://github.com/aahoughton/oav/commit/09a40afec3585b211bd4d9e656518ef1e7f46877))

## [3.1.0](https://github.com/aahoughton/oav/compare/oav-v3.0.0...oav-v3.1.0) (2026-06-09)


### Features

* synchronous spec loader (loadSpecSync) ([#362](https://github.com/aahoughton/oav/issues/362)) ([efbf842](https://github.com/aahoughton/oav/commit/efbf842a99d9405066ed4f3fc451ec3b9eb6ea9c))

## [3.0.0](https://github.com/aahoughton/oav/compare/oav-v2.4.0...oav-v3.0.0) (2026-06-08)


### Chore

* **oav:** Synchronize oav versions

## [2.4.0](https://github.com/aahoughton/oav/compare/oav-v2.3.0...oav-v2.4.0) (2026-06-06)


### Chore

* **oav:** Synchronize oav versions

## [2.3.0](https://github.com/aahoughton/oav/compare/oav-v2.2.1...oav-v2.3.0) (2026-06-06)


### Features

* **oav:** make esbuild an optional peer dependency ([#313](https://github.com/aahoughton/oav/issues/313)) ([daad9dd](https://github.com/aahoughton/oav/commit/daad9dd8b5848f6df5e5f1917b613c78208527f0))

## [2.2.1](https://github.com/aahoughton/oav/compare/oav-v2.2.0...oav-v2.2.1) (2026-06-05)


### Chore

* **oav:** Synchronize oav versions

## [2.2.0](https://github.com/aahoughton/oav/compare/oav-v2.1.0...oav-v2.2.0) (2026-05-19)


### Features

* **overlay-spec:** translator for OpenAPI Overlay 1.0 spec format ([#290](https://github.com/aahoughton/oav/issues/290)) ([e8ae711](https://github.com/aahoughton/oav/commit/e8ae71100586922f55040db59537866d3e2d8938))

## [2.1.0](https://github.com/aahoughton/oav/compare/oav-v2.0.0...oav-v2.1.0) (2026-05-04)


### Documentation

* cleanup pass, spelling normalization, TSDoc tightening ([#260](https://github.com/aahoughton/oav/issues/260)) ([77fcf4d](https://github.com/aahoughton/oav/commit/77fcf4ddafe8e6a30b8108fc0dee78a31a8e1a6b))

## [2.0.0](https://github.com/aahoughton/oav/compare/oav-v1.1.1...oav-v2.0.0) (2026-05-02)


### Documentation

* move root markdown into docs/ subdir ([#237](https://github.com/aahoughton/oav/issues/237)) ([365af48](https://github.com/aahoughton/oav/commit/365af48ab7394bf18ddc498419f15be67079ba3a))

## [1.1.1](https://github.com/aahoughton/oav/compare/oav-v1.1.0...oav-v1.1.1) (2026-04-27)


### Bug Fixes

* **docs:** cross-link gaps, custom-envelope worked example, parseYamlString cast hint ([#230](https://github.com/aahoughton/oav/issues/230)) ([b65c75d](https://github.com/aahoughton/oav/commit/b65c75dc54ca2afc128858587d2ab7ffec0d3f57)), closes [#229](https://github.com/aahoughton/oav/issues/229)

## [1.1.0](https://github.com/aahoughton/oav/compare/oav-v1.0.0...oav-v1.1.0) (2026-04-26)


### Features

* **core:** add formatSummary + toJsonObject; deprecate three misnamed exports ([#218](https://github.com/aahoughton/oav/issues/218)) ([23ce743](https://github.com/aahoughton/oav/commit/23ce743e1241b58998a385ecfb4ccb56a34daa3c))

## 1.0.0 (2026-04-25)

Initial release. Batteries-included distribution of
[`@aahoughton/oav-core`](https://www.npmjs.com/package/@aahoughton/oav-core):
same programmatic surface, plus YAML readers and the `oav` CLI.
