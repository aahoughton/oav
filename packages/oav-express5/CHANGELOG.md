# Changelog

## [2.0.0](https://github.com/aahoughton/oav/compare/oav-express5-v1.1.1...oav-express5-v2.0.0) (2026-05-02)


### Documentation

* move root markdown into docs/ subdir ([#237](https://github.com/aahoughton/oav/issues/237)) ([365af48](https://github.com/aahoughton/oav/commit/365af48ab7394bf18ddc498419f15be67079ba3a))

## [1.1.1](https://github.com/aahoughton/oav/compare/oav-express5-v1.1.0...oav-express5-v1.1.1) (2026-04-27)


### Bug Fixes

* **docs:** cross-link gaps, custom-envelope worked example, parseYamlString cast hint ([#230](https://github.com/aahoughton/oav/issues/230)) ([b65c75d](https://github.com/aahoughton/oav/commit/b65c75dc54ca2afc128858587d2ab7ffec0d3f57)), closes [#229](https://github.com/aahoughton/oav/issues/229)

## [1.1.0](https://github.com/aahoughton/oav/compare/oav-express5-v1.0.0...oav-express5-v1.1.0) (2026-04-26)


### Features

* **core:** add formatSummary + toJsonObject; deprecate three misnamed exports ([#218](https://github.com/aahoughton/oav/issues/218)) ([23ce743](https://github.com/aahoughton/oav/commit/23ce743e1241b58998a385ecfb4ccb56a34daa3c))

## 1.0.0 (2026-04-25)

Initial release. Express 5 adapter for
[`@aahoughton/oav-core`](https://www.npmjs.com/package/@aahoughton/oav-core)
— promise-native middleware factory plus standalone helpers
(`httpRequestFromExpress`, `renderProblemDetails`) for callers composing
their own middleware.
