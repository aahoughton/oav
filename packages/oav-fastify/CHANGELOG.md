# Changelog

## [1.1.0](https://github.com/aahoughton/oav/compare/oav-fastify-v1.0.0...oav-fastify-v1.1.0) (2026-04-26)


### Features

* **core:** add formatSummary + toJsonObject; deprecate three misnamed exports ([#218](https://github.com/aahoughton/oav/issues/218)) ([23ce743](https://github.com/aahoughton/oav/commit/23ce743e1241b58998a385ecfb4ccb56a34daa3c))

## 1.0.0 (2026-04-25)

Initial release. Fastify adapter for
[`@aahoughton/oav-core`](https://www.npmjs.com/package/@aahoughton/oav-core)
— a `preValidation` hook factory plus standalone helpers
(`httpRequestFromFastify`, `renderProblemDetails`) for callers composing
their own hooks.
