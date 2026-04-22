# Changelog

## [2.0.0](https://github.com/aahoughton/oav/compare/oav-v1.0.0...oav-v2.0.0) (2026-04-22)


### ⚠ BREAKING CHANGES

* **validator:** the path shape for response-side leaf errors changed. Code that parses `path[0] === "response"` or that joins paths for display will need to update. The branch error's `code` field remains the authoritative request-vs-response discriminator.

### Features

* **cli:** thread CommandIo + stdout/stderr/exit through buildProgram ([1b239fe](https://github.com/aahoughton/oav/commit/1b239fe3952bbb7996f2dacc0c51a07e18192fa3)), closes [#31](https://github.com/aahoughton/oav/issues/31)
* **core:** drop formatGithub / --format github ([#79](https://github.com/aahoughton/oav/issues/79)) ([c30e181](https://github.com/aahoughton/oav/commit/c30e181680f2a7eea845ea1239e710c3176e6601))
* **formats:** export fromAjvFormats migration helper ([#88](https://github.com/aahoughton/oav/issues/88)) ([817e559](https://github.com/aahoughton/oav/commit/817e559e3d81fced78fa07b297e2b5cb7c0637d6)), closes [#85](https://github.com/aahoughton/oav/issues/85)
* **router,validator:** distinguish 405 method-not-allowed from 404 ([#80](https://github.com/aahoughton/oav/issues/80)) ([e156393](https://github.com/aahoughton/oav/commit/e1563932dceedddc017b1b9339b0cead3c3eecab))
* **router:** error on param-only overlap; test literal-colon paths ([e78116e](https://github.com/aahoughton/oav/commit/e78116eba648718a6f14ca17612b8840b82e3e1e)), closes [#16](https://github.com/aahoughton/oav/issues/16)
* **router:** route HEAD to GET when no explicit HEAD is declared ([f7b0f0d](https://github.com/aahoughton/oav/commit/f7b0f0dd0b6e4e5c7ca2b5734c0eb303f25e3ff6)), closes [#13](https://github.com/aahoughton/oav/issues/13)
* **schema,validator:** expose counters for compile-time optimizations ([4b9a0b1](https://github.com/aahoughton/oav/commit/4b9a0b12210a79f94d95863a9e84d229d2c61c0b)), closes [#36](https://github.com/aahoughton/oav/issues/36)
* **schema,validator:** strict-mode schema linting ([#90](https://github.com/aahoughton/oav/issues/90)) ([7718a58](https://github.com/aahoughton/oav/commit/7718a58d2481aaa8c03f5012e0cab83abdeaf55b)), closes [#82](https://github.com/aahoughton/oav/issues/82)
* **schema:** add compileAndCallSubschema helper; dedupe allOf/anyOf ([#74](https://github.com/aahoughton/oav/issues/74)) ([7720a46](https://github.com/aahoughton/oav/commit/7720a469bcafc3b3d023726d87ee382151a02662)), closes [#64](https://github.com/aahoughton/oav/issues/64)
* **schema:** predicate mode ([f484a74](https://github.com/aahoughton/oav/commit/f484a74d7ab91ab7f1d021552868b133d8b0d764))
* **schema:** support pre-registered external schemas via base-URI stack ([4ebaa5e](https://github.com/aahoughton/oav/commit/4ebaa5e06a8979382d19f5683ba238126719e15f))
* **schema:** thread evaluated-key sets through compiled subvalidators ([f9d7579](https://github.com/aahoughton/oav/commit/f9d7579c2b3e1d5a7405d05d12cbb717c2ac49cc))
* **validator:** assemble form/explode and deepObject query params ([5558208](https://github.com/aahoughton/oav/commit/555820809607aec519b5a42dbab1e40d66c12213)), closes [#25](https://github.com/aahoughton/oav/issues/25)
* **validator:** enforce readOnly/writeOnly per direction ([f0bd670](https://github.com/aahoughton/oav/commit/f0bd670613a8cd29d3ca7ce7a3e6a79781d99894)), closes [#9](https://github.com/aahoughton/oav/issues/9)
* **validator:** honour parameter.content (JSON-in-query etc.) ([e988f02](https://github.com/aahoughton/oav/commit/e988f023b2629078cf664655c5260aeed6cfa2eb)), closes [#10](https://github.com/aahoughton/oav/issues/10)
* **validator:** ignoreUndocumented / ignorePaths options ([#89](https://github.com/aahoughton/oav/issues/89)) ([c537c7a](https://github.com/aahoughton/oav/commit/c537c7ae2ae9e73e736b3380f77e5662c4119182)), closes [#84](https://github.com/aahoughton/oav/issues/84)
* **validator:** inject warn sink for onUnknownVersion: 'warn' ([#70](https://github.com/aahoughton/oav/issues/70)) ([3bab862](https://github.com/aahoughton/oav/commit/3bab862e0904ca023d7e21a08e3827d91e40c978)), closes [#61](https://github.com/aahoughton/oav/issues/61)
* **validator:** readBody override on validateFetchRequest ([6f18620](https://github.com/aahoughton/oav/commit/6f186204e95dc864ff01096c017f8762ba503a72))
* **validator:** validateFetchRequest + validateFetchResponse for Web Standards ([674827f](https://github.com/aahoughton/oav/commit/674827f67486bcd1fb1d3b552379a114d37dd020))


### Bug Fixes

* **core,validator:** tighten BuiltInErrorParams narrowing; fix *-param drift ([#73](https://github.com/aahoughton/oav/issues/73)) ([0ce3d9f](https://github.com/aahoughton/oav/commit/0ce3d9fe8faebf3eb07a2aef89b308d3ee826c8f)), closes [#58](https://github.com/aahoughton/oav/issues/58) [#59](https://github.com/aahoughton/oav/issues/59)
* **core:** correct BuiltInErrorParams drift + add cross-check test ([d2a977b](https://github.com/aahoughton/oav/commit/d2a977b5cf5535ee6e3facdb9287c3dc189f81d7)), closes [#27](https://github.com/aahoughton/oav/issues/27)
* **core:** widen frozen empty-children cast ([3276ed9](https://github.com/aahoughton/oav/commit/3276ed94ef2dc3a47c7d03135539399b3bdc0ede))
* **performance:** repair bench script ([692b93c](https://github.com/aahoughton/oav/commit/692b93c33ae91125edf88997b6bf345703aa6f76))
* **schema:** fall back to no-flag regex when 'u' rejects stray escapes ([f915763](https://github.com/aahoughton/oav/commit/f915763363673ca4a15f6d9befcef8965f5b33b2))
* **schema:** preserve if-branch annotations and nested unevaluated:true ([ca8b877](https://github.com/aahoughton/oav/commit/ca8b8774513fcf1a79166e0d394571c04c2b867d))
* **schema:** scale multipleOf tolerance with value magnitude ([0e4e44c](https://github.com/aahoughton/oav/commit/0e4e44c2e356aef911870b7ed363542fc2304b9d)), closes [#20](https://github.com/aahoughton/oav/issues/20)
* **schema:** tolerate IEEE-754 rounding in multipleOf ([caf2f78](https://github.com/aahoughton/oav/commit/caf2f78cca7e1eed3c5569bb089e43b6d1962084)), closes [#8](https://github.com/aahoughton/oav/issues/8)
* **spec:** materialize circular external $refs under $defs.__ext__ ([efabdf3](https://github.com/aahoughton/oav/commit/efabdf35b446e9a9a0e9f97bc98ef484a0c97716))
* **spec:** percent-decode JSON Pointer fragments per RFC 6901 ([e0ff994](https://github.com/aahoughton/oav/commit/e0ff994328e24a569e792b7ffdca90a60487b820))
* **spec:** percent-decode paths in createFileReader ([4be679d](https://github.com/aahoughton/oav/commit/4be679d8879492658844937c21a62ed9d391e8c4)), closes [#37](https://github.com/aahoughton/oav/issues/37)
* **spec:** rewrite internal refs inside inlined external subtrees ([ddf1060](https://github.com/aahoughton/oav/commit/ddf106047e9bad550326221affc50e85e82e07e6)), closes [#38](https://github.com/aahoughton/oav/issues/38)
* **validator:** bypass type check for format:binary body fields ([83df7b9](https://github.com/aahoughton/oav/commit/83df7b984703763946a45fc3a9efa807de0b61bd)), closes [#23](https://github.com/aahoughton/oav/issues/23)
* **validator:** drop redundant response prefix from response leaf paths ([f83291d](https://github.com/aahoughton/oav/commit/f83291dae9d2e2fbe3e4f6a05ef02cc078191e90)), closes [#30](https://github.com/aahoughton/oav/issues/30)
* **validator:** empty-string params aren't missing; honour allowEmptyValue ([853d2e2](https://github.com/aahoughton/oav/commit/853d2e21cdf872c943660a56bab8af670c6a81d6)), closes [#11](https://github.com/aahoughton/oav/issues/11)
* **validator:** enforce readOnly/writeOnly across \$ref composition ([e84aa42](https://github.com/aahoughton/oav/commit/e84aa425441a30d75a5cffeee9a2df92e70e9c8d)), closes [#17](https://github.com/aahoughton/oav/issues/17)
* **validator:** honour media-type parameters in content negotiation ([18a5386](https://github.com/aahoughton/oav/commit/18a53863fe147899cf0b1853935eb2ed8e5c925e)), closes [#18](https://github.com/aahoughton/oav/issues/18)
* **validator:** op-level parameter override replaces path-level ([789cb49](https://github.com/aahoughton/oav/commit/789cb496100c6d0fc1152af3369345cd28b8ba75)), closes [#22](https://github.com/aahoughton/oav/issues/22)
* **validator:** use singular "header" path on response side ([#68](https://github.com/aahoughton/oav/issues/68)) ([1942f1c](https://github.com/aahoughton/oav/commit/1942f1c548684e51a2db86b68104ea81aa53902d)), closes [#65](https://github.com/aahoughton/oav/issues/65)


### Performance

* add --spec mode to run.ts; rewrite README ([b261b03](https://github.com/aahoughton/oav/commit/b261b039a1c46e6051e708e54522fc6aa46cdcf7))
* real-world spec benchmark driver ([92b4874](https://github.com/aahoughton/oav/commit/92b4874a52923a248c4fb7017bf06a7e3978549d))
* **schema:** cheaper leaf error construction (levers A + B) ([a91be64](https://github.com/aahoughton/oav/commit/a91be6434d68d0bab32845ae281b3f0a3ffde655))
* **schema:** elide pure-\$ref wrapper functions ([#51](https://github.com/aahoughton/oav/issues/51)) ([22ca453](https://github.com/aahoughton/oav/commit/22ca4531b99d22e3f71a69377c39f00ec6b84a9a))
* **schema:** flag oas30 modifier keywords as annotations ([#69](https://github.com/aahoughton/oav/issues/69)) ([a2defe9](https://github.com/aahoughton/oav/commit/a2defe9b9328839dc401ad87e26f733946c234f6)), closes [#63](https://github.com/aahoughton/oav/issues/63)
* **schema:** gate unevaluated-key tracking on a compile-time schema walk ([92217a2](https://github.com/aahoughton/oav/commit/92217a2543fad076d902f811d5dd66f768370f9c))
* **schema:** hoist compile-time constants out of validator body ([#47](https://github.com/aahoughton/oav/issues/47)) ([5ccf178](https://github.com/aahoughton/oav/commit/5ccf178ab4723d874164f119f291bc7baa6a0185))
* **schema:** lazy errors array, elide wrapErrors on happy path ([#48](https://github.com/aahoughton/oav/issues/48)) ([ea8e539](https://github.com/aahoughton/oav/commit/ea8e539582684553a54f2b46f6399771e63eaa72))
* **schema:** lazy path — skip push/pop on the happy path ([#49](https://github.com/aahoughton/oav/issues/49)) ([8a69d2a](https://github.com/aahoughton/oav/commit/8a69d2ac246caf90f6f9bf3c372d49093007397e))
* **schema:** thread pathSegments through tryInline's inlined ctx ([#52](https://github.com/aahoughton/oav/issues/52)) ([ae2a51c](https://github.com/aahoughton/oav/commit/ae2a51c68f32124c3cd666fd804d316bcd50bbad))
* **validator:** defer response-schema compilation until validateResponse ([87dc228](https://github.com/aahoughton/oav/commit/87dc2282a978234483d51a3cd8df99cda7a69989))


### Documentation

* add 'Why this exists', conformance table, and INTEGRATION.md ([371c804](https://github.com/aahoughton/oav/commit/371c80458e77a6a6057a0d5a399d7063148f8a00))
* ajv policy, tone pass, overlays guide + examples ([#78](https://github.com/aahoughton/oav/issues/78)) ([ae55701](https://github.com/aahoughton/oav/commit/ae5570192e38e5ecf25898b517e661ef3e795354))
* **claude:** replace prefixPath with startPath reference ([#67](https://github.com/aahoughton/oav/issues/67)) ([0c7daa3](https://github.com/aahoughton/oav/commit/0c7daa3bc511c6ceaada5d430f58ee5fe0295e1f)), closes [#66](https://github.com/aahoughton/oav/issues/66)
* document ajv-formats format-shape adapter as a 3-line helper ([757f85a](https://github.com/aahoughton/oav/commit/757f85a8a0f94cacc7d8c5c4db0ceb12b10f6111))
* fix REPORT.md reference, reduce em-dash density ([97d9445](https://github.com/aahoughton/oav/commit/97d94455bd3ab89ca54277c20245e4154099e409))
* note task-4a validate regression and gating todo ([6cea432](https://github.com/aahoughton/oav/commit/6cea4324c810f20d2cfabb94e14b12f4cf85434a))
* remove unevaluatedProperties-across-composition limitation ([45644ca](https://github.com/aahoughton/oav/commit/45644cac3aced86b594ec4b30e995b527a4f3126))


### Refactoring

* consolidate three parallel JSON Pointer implementations ([b5a13fe](https://github.com/aahoughton/oav/commit/b5a13fedfbae5ce4e7c978623589c42dac06da69)), closes [#28](https://github.com/aahoughton/oav/issues/28)
* **core:** move output-format dispatch to @oav/core ([#71](https://github.com/aahoughton/oav/issues/71)) ([ab54cbd](https://github.com/aahoughton/oav/commit/ab54cbdc81ee628deac89ca87216861e8ee37f5a)), closes [#60](https://github.com/aahoughton/oav/issues/60)
* **router:** rename trie.ts to matcher.ts; fix misleading big-O ([22f97b6](https://github.com/aahoughton/oav/commit/22f97b6333403fe6ee9e8f27756db3067c947d93))
* **schema:** derive inliner classification from KeywordDefinition flags ([8962e63](https://github.com/aahoughton/oav/commit/8962e63e506d72ad0f965e0ae82fc1c38b47663d)), closes [#34](https://github.com/aahoughton/oav/issues/34)
* **schema:** expose emittedTreeRuntime compile stat ([#72](https://github.com/aahoughton/oav/issues/72)) ([a7b00d1](https://github.com/aahoughton/oav/commit/a7b00d12e73fdee957c540d28977599c7d633147)), closes [#62](https://github.com/aahoughton/oav/issues/62)
* **schema:** promote annotation keywords to a Meta-Data vocabulary ([0f6913c](https://github.com/aahoughton/oav/commit/0f6913c7affa2497cebdf56275bb7253b1c81ddd))
* **schema:** stratify public surface; add internals subpath ([#76](https://github.com/aahoughton/oav/issues/76)) ([2671a95](https://github.com/aahoughton/oav/commit/2671a950e1608046c7a832f5e9038f6ee930c7fe)), closes [#57](https://github.com/aahoughton/oav/issues/57)
* **validator:** rename direction.ts, add dedicated test file ([a5897b3](https://github.com/aahoughton/oav/commit/a5897b3e37d86dd3bf27993eaa52a6da73fb1b27)), closes [#26](https://github.com/aahoughton/oav/issues/26)
* **validator:** split validator.test.ts by subject + extract helpers ([b5aa55b](https://github.com/aahoughton/oav/commit/b5aa55ba2f4c38d1de76d797bbb2df6741a778ab)), closes [#29](https://github.com/aahoughton/oav/issues/29)
* **validator:** split validator.ts into orchestrator + cache + step ([#75](https://github.com/aahoughton/oav/issues/75)) ([d14543e](https://github.com/aahoughton/oav/commit/d14543edaeae5d4c35a1dd0e3cfce567639585bf)), closes [#56](https://github.com/aahoughton/oav/issues/56)
* **validator:** stratify public surface; add internals subpath ([#77](https://github.com/aahoughton/oav/issues/77)) ([0b361a8](https://github.com/aahoughton/oav/commit/0b361a8c771518e329419d9e73831b8375321aaf))

## Changelog

All notable changes to `@aahoughton/oav` will be documented in this
file. The format follows [Keep a Changelog](https://keepachangelog.com/)
and the project adheres to [Semantic Versioning](https://semver.org/).

Entries below this line are generated automatically by
[release-please](https://github.com/googleapis/release-please) from
[Conventional Commits](https://www.conventionalcommits.org/) on `main`.
