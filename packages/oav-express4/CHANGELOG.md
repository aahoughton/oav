# Changelog

## 1.0.0 (2026-04-25)


### ⚠ BREAKING CHANGES

* **validator:** ValidatorOptions.validateSecurity now defaults to false. Apps that relied on the previous default-true behaviour need to opt in explicitly with createValidator(spec, { validateSecurity: true }).

### Features

* **oav-express4:** ship Express 4 adapter as v0 of the companion-package family ([#180](https://github.com/aahoughton/oav/issues/180)) ([713e500](https://github.com/aahoughton/oav/commit/713e50053b7367c2a6f1b9cda5fea8c2d7f87e6b)), closes [#171](https://github.com/aahoughton/oav/issues/171)


### Bug Fixes

* **validator:** default validateSecurity to false ([#184](https://github.com/aahoughton/oav/issues/184)) ([b53e7fc](https://github.com/aahoughton/oav/commit/b53e7fc20955be6a4bcac81a10cf4ce8bf66e7b5)), closes [#183](https://github.com/aahoughton/oav/issues/183)


### Documentation

* address [#198](https://github.com/aahoughton/oav/issues/198) [#199](https://github.com/aahoughton/oav/issues/199) [#200](https://github.com/aahoughton/oav/issues/200) — multer global pattern, YAML constraint, pointer + envelope shapes ([#202](https://github.com/aahoughton/oav/issues/202)) ([c419117](https://github.com/aahoughton/oav/commit/c4191170314dadb700b7def5fe5be3211b5c485a))
* migration trio + auth dispatch recipe + friction-batch follow-ons ([#193](https://github.com/aahoughton/oav/issues/193)) ([8a490c5](https://github.com/aahoughton/oav/commit/8a490c55fc610d459d5561fc9763c67623bdd264)), closes [#186](https://github.com/aahoughton/oav/issues/186) [#187](https://github.com/aahoughton/oav/issues/187) [#188](https://github.com/aahoughton/oav/issues/188) [#189](https://github.com/aahoughton/oav/issues/189) [#190](https://github.com/aahoughton/oav/issues/190) [#191](https://github.com/aahoughton/oav/issues/191) [#192](https://github.com/aahoughton/oav/issues/192)
* tightening pass — remove unshipped-adapter promises, drop defensive language ([#207](https://github.com/aahoughton/oav/issues/207)) ([09a40af](https://github.com/aahoughton/oav/commit/09a40afec3585b211bd4d9e656518ef1e7f46877))
