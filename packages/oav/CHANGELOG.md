# Changelog

## 1.0.0 (2026-04-25)


### ⚠ BREAKING CHANGES

* split into @aahoughton/oav-core + @aahoughton/oav ([#98](https://github.com/aahoughton/oav/issues/98))

### Features

* **cli:** accept http:// and https:// URLs for spec / overlay args ([#103](https://github.com/aahoughton/oav/issues/103)) ([f159479](https://github.com/aahoughton/oav/commit/f159479a4448ffa07d988cda0ca9eaab11d4c8e7))
* **cli:** compile-spec — AOT-compile OpenAPI to a standalone HTTP validator ([#126](https://github.com/aahoughton/oav/issues/126)) ([967e0ff](https://github.com/aahoughton/oav/commit/967e0fff45bc400db4a3cda00c5fadea8693c811))
* **cli:** oav compile --standalone — bundle runtime helpers via esbuild ([#119](https://github.com/aahoughton/oav/issues/119)) ([b2cf36e](https://github.com/aahoughton/oav/commit/b2cf36eff6c3821d2db9c20ff2ff4ddc2d2b8dbf))
* split into @aahoughton/oav-core + @aahoughton/oav ([#98](https://github.com/aahoughton/oav/issues/98)) ([c46bb9e](https://github.com/aahoughton/oav/commit/c46bb9e88114763b1cedb7e00a8d338567691156))


### Bug Fixes

* **build:** conditional exports so CJS TypeScript consumers can resolve types ([#115](https://github.com/aahoughton/oav/issues/115)) ([6fa3006](https://github.com/aahoughton/oav/commit/6fa30063ebd04935083e2d0028078bf09e00a7c0))
* **publish:** tighten pack/install scripts (closes [#165](https://github.com/aahoughton/oav/issues/165) [#166](https://github.com/aahoughton/oav/issues/166) [#167](https://github.com/aahoughton/oav/issues/167)) ([#178](https://github.com/aahoughton/oav/issues/178)) ([7d33cc1](https://github.com/aahoughton/oav/commit/7d33cc1d8d77dae261f46715fd422d11a4aa6352))


### Documentation

* add packages/oav/README.md and reflect adapter family ([#181](https://github.com/aahoughton/oav/issues/181)) ([757d4bd](https://github.com/aahoughton/oav/commit/757d4bd73211a2d6210b8fbf9bce73eee2ada5e2))
* drop [@aahoughton](https://github.com/aahoughton) scope from narrative prose ([#138](https://github.com/aahoughton/oav/issues/138)) ([2d157d0](https://github.com/aahoughton/oav/commit/2d157d0c04ec73f5c2a3b1644c8c9b59b89f3725))
* tightening pass — remove unshipped-adapter promises, drop defensive language ([#207](https://github.com/aahoughton/oav/issues/207)) ([09a40af](https://github.com/aahoughton/oav/commit/09a40afec3585b211bd4d9e656518ef1e7f46877))
