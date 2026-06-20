# Changelog

## 1.0.0 (2026-06-20)


### Features

* **stream-validator:** make maxUniqueItems actually bound the buffered uniqueItems island ([#415](https://github.com/aahoughton/oav/issues/415)) ([aba2171](https://github.com/aahoughton/oav/commit/aba217188fef40f6bc8dab1148b675588907dfda))
* **stream-validator:** make maxUniqueItems bound the buffered uniqueItems island ([aba2171](https://github.com/aahoughton/oav/commit/aba217188fef40f6bc8dab1148b675588907dfda))
* **stream-validator:** publish as @aahoughton/oav-stream-validator (experimental) ([#419](https://github.com/aahoughton/oav/issues/419)) ([c459c11](https://github.com/aahoughton/oav/commit/c459c1122608f2462a6348cc7fca13b1a176e646))
* **stream-validator:** streaming JSON Schema 2020-12 validator ([#408](https://github.com/aahoughton/oav/issues/408)) ([b9d488e](https://github.com/aahoughton/oav/commit/b9d488ebaa38ff7ab533e7a1cc22f30ab2dbd61e))
* **stream-validator:** surface scalar value spans on a value channel ([#412](https://github.com/aahoughton/oav/issues/412)) ([b8d5dd7](https://github.com/aahoughton/oav/commit/b8d5dd7d76b2bdb6e91ed16544f5557bab2d57dc)), closes [#411](https://github.com/aahoughton/oav/issues/411)


### Bug Fixes

* **stream-validator:** eager over-limits + value-event full path (first-consumer fixes) ([#414](https://github.com/aahoughton/oav/issues/414)) ([ba7a0f6](https://github.com/aahoughton/oav/commit/ba7a0f604c4787d283853fcf6dc59352aae83c46))
* **stream-validator:** memoize $ref resolution on the spine hot path ([#410](https://github.com/aahoughton/oav/issues/410)) ([89d0b49](https://github.com/aahoughton/oav/commit/89d0b499a74d4851a4684898ed27cc1ee50e79ea))


### Documentation

* scrub internal references and clean up docs/comments ([#413](https://github.com/aahoughton/oav/issues/413)) ([b21b357](https://github.com/aahoughton/oav/commit/b21b35702155651bb2e6d9a81a7ee7b27cc78bc7))


### Refactoring

* **stream-validator:** tighten public surface before publish ([#418](https://github.com/aahoughton/oav/issues/418)) ([3edb2c9](https://github.com/aahoughton/oav/commit/3edb2c9d262c55f41cbd41bdd66702220b943c1e))
