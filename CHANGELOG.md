# Changelog

## [4.0.0](https://github.com/aahoughton/oav/compare/oav-core-v3.1.0...oav-core-v4.0.0) (2026-06-09)


### ⚠ BREAKING CHANGES

* **cli:** `oav compile-spec` output now returns the v3 result object ({ valid, ... }) instead of `ValidationError | null`, and defaults to flat + maxErrors:1. Consumers reading the old null/tree shape should read `result.valid` / `result.errors` (or pass `--output-mode tree` for the nested `error`).
* compileSchema and createValidator default to flat error output and maxErrors:1. validateRequest/validateResponse return a result object ({ valid, errors?, error?, truncated }) instead of ValidationError|null. Adapter onError receives a ValidationError[] leaf list. ValidationResult and CompiledSchema now name the flat shapes (tree is TreeValidationResult/CompiledTreeSchema). undefined-valued object properties count as absent. formatJson/summarize/formatFlat and the validateSecurity boolean form are removed. See docs/migration-v3.md.
* **core:** formatSummary separator + includeCode ([#241](https://github.com/aahoughton/oav/issues/241))
* **validator:** ValidatorOptions.validateSecurity now defaults to false. Apps that relied on the previous default-true behaviour need to opt in explicitly with createValidator(spec, { validateSecurity: true }).
* split into @aahoughton/oav-core + @aahoughton/oav ([#98](https://github.com/aahoughton/oav/issues/98))
* **validator:** the path shape for response-side leaf errors changed. Code that parses `path[0] === "response"` or that joins paths for display will need to update. The branch error's `code` field remains the authoritative request-vs-response discriminator.

### Features

* add httpStatusFor + allowHeaderFor helpers; documentation pass ([#112](https://github.com/aahoughton/oav/issues/112)) ([e5a824b](https://github.com/aahoughton/oav/commit/e5a824b542668e2067e588dcd51f6a6685046176))
* **cli:** accept http:// and https:// URLs for spec / overlay args ([#103](https://github.com/aahoughton/oav/issues/103)) ([f159479](https://github.com/aahoughton/oav/commit/f159479a4448ffa07d988cda0ca9eaab11d4c8e7))
* **cli:** compile-spec — AOT-compile OpenAPI to a standalone HTTP validator ([#126](https://github.com/aahoughton/oav/issues/126)) ([967e0ff](https://github.com/aahoughton/oav/commit/967e0fff45bc400db4a3cda00c5fadea8693c811))
* **cli:** compile-spec result-shape parity with createValidator ([#355](https://github.com/aahoughton/oav/issues/355)) ([5081b4a](https://github.com/aahoughton/oav/commit/5081b4a2a6bfb3ed313f655fc568403dde7be163))
* **cli:** oav compile --standalone — bundle runtime helpers via esbuild ([#119](https://github.com/aahoughton/oav/issues/119)) ([b2cf36e](https://github.com/aahoughton/oav/commit/b2cf36eff6c3821d2db9c20ff2ff4ddc2d2b8dbf))
* **cli:** oav compile — standalone ES module emission ([#96](https://github.com/aahoughton/oav/issues/96)) ([e8b3db7](https://github.com/aahoughton/oav/commit/e8b3db70dfcd362009b921e7aec3dcdd62b70bf1)), closes [#81](https://github.com/aahoughton/oav/issues/81)
* **cli:** thread CommandIo + stdout/stderr/exit through buildProgram ([1b239fe](https://github.com/aahoughton/oav/commit/1b239fe3952bbb7996f2dacc0c51a07e18192fa3)), closes [#31](https://github.com/aahoughton/oav/issues/31)
* **core:** add formatSummary + toJsonObject; deprecate three misnamed exports ([#218](https://github.com/aahoughton/oav/issues/218)) ([23ce743](https://github.com/aahoughton/oav/commit/23ce743e1241b58998a385ecfb4ccb56a34daa3c))
* **core:** add summarize() helper and use it for toProblemDetails.detail ([#179](https://github.com/aahoughton/oav/issues/179)) ([5746fe5](https://github.com/aahoughton/oav/commit/5746fe58c2572a910a7dbd3b607d4d5f73ffe7ba))
* **core:** drop formatGithub / --format github ([#79](https://github.com/aahoughton/oav/issues/79)) ([c30e181](https://github.com/aahoughton/oav/commit/c30e181680f2a7eea845ea1239e710c3176e6601))
* **core:** formatSummary separator + includeCode ([#241](https://github.com/aahoughton/oav/issues/241)) ([4cf7148](https://github.com/aahoughton/oav/commit/4cf7148d84f0c42e37359335c3ea297a8e74a9f9))
* **formats:** export fromAjvFormats migration helper ([#88](https://github.com/aahoughton/oav/issues/88)) ([817e559](https://github.com/aahoughton/oav/commit/817e559e3d81fced78fa07b297e2b5cb7c0637d6)), closes [#85](https://github.com/aahoughton/oav/issues/85)
* **oav-express4:** ship Express 4 adapter as v0 of the companion-package family ([#180](https://github.com/aahoughton/oav/issues/180)) ([713e500](https://github.com/aahoughton/oav/commit/713e50053b7367c2a6f1b9cda5fea8c2d7f87e6b)), closes [#171](https://github.com/aahoughton/oav/issues/171)
* **oav-express5:** ship Express 5 adapter ([#194](https://github.com/aahoughton/oav/issues/194)) ([#205](https://github.com/aahoughton/oav/issues/205)) ([d6ba95d](https://github.com/aahoughton/oav/commit/d6ba95d0f061c3a429b53e634bc4a0631271570f))
* **oav-fastify:** ship Fastify adapter ([#195](https://github.com/aahoughton/oav/issues/195)) ([#206](https://github.com/aahoughton/oav/issues/206)) ([b1bb80c](https://github.com/aahoughton/oav/commit/b1bb80c63f636bc7cc3660f1689c8dcdf73c044d))
* **oav:** make esbuild an optional peer dependency ([#313](https://github.com/aahoughton/oav/issues/313)) ([daad9dd](https://github.com/aahoughton/oav/commit/daad9dd8b5848f6df5e5f1917b613c78208527f0))
* **overlay-spec:** translator for OpenAPI Overlay 1.0 spec format ([#290](https://github.com/aahoughton/oav/issues/290)) ([e8ae711](https://github.com/aahoughton/oav/commit/e8ae71100586922f55040db59537866d3e2d8938))
* **router,validator:** distinguish 405 method-not-allowed from 404 ([#80](https://github.com/aahoughton/oav/issues/80)) ([e156393](https://github.com/aahoughton/oav/commit/e1563932dceedddc017b1b9339b0cead3c3eecab))
* **router:** error on param-only overlap; test literal-colon paths ([e78116e](https://github.com/aahoughton/oav/commit/e78116eba648718a6f14ca17612b8840b82e3e1e)), closes [#16](https://github.com/aahoughton/oav/issues/16)
* **router:** route HEAD to GET when no explicit HEAD is declared ([f7b0f0d](https://github.com/aahoughton/oav/commit/f7b0f0dd0b6e4e5c7ca2b5734c0eb303f25e3ff6)), closes [#13](https://github.com/aahoughton/oav/issues/13)
* **schema,validator:** expose counters for compile-time optimizations ([4b9a0b1](https://github.com/aahoughton/oav/commit/4b9a0b12210a79f94d95863a9e84d229d2c61c0b)), closes [#36](https://github.com/aahoughton/oav/issues/36)
* **schema,validator:** strict-mode schema linting ([#90](https://github.com/aahoughton/oav/issues/90)) ([7718a58](https://github.com/aahoughton/oav/commit/7718a58d2481aaa8c03f5012e0cab83abdeaf55b)), closes [#82](https://github.com/aahoughton/oav/issues/82)
* **schema:** add compileAndCallSubschema helper; dedupe allOf/anyOf ([#74](https://github.com/aahoughton/oav/issues/74)) ([7720a46](https://github.com/aahoughton/oav/commit/7720a469bcafc3b3d023726d87ee382151a02662)), closes [#64](https://github.com/aahoughton/oav/issues/64)
* **schema:** add maxDepth to bound recursion through $ref cycles ([#333](https://github.com/aahoughton/oav/issues/333)) ([cd05fa1](https://github.com/aahoughton/oav/commit/cd05fa1938db3714d3c19026a90b3971a88aeb80))
* **schema:** flat error-collection mode ([#337](https://github.com/aahoughton/oav/issues/337)) ([7c4852e](https://github.com/aahoughton/oav/commit/7c4852e23e8c83880231bb83d0c9985e7a070a59))
* **schema:** predicate mode ([f484a74](https://github.com/aahoughton/oav/commit/f484a74d7ab91ab7f1d021552868b133d8b0d764))
* **schema:** recognise xml, externalDocs, and the JSON Schema content vocabulary as annotation keywords ([#130](https://github.com/aahoughton/oav/issues/130)) ([6bc1e83](https://github.com/aahoughton/oav/commit/6bc1e830aaa3ebee278881b8209701939bc3743b))
* **schema:** regexCompiler option for pattern and format: regex ([#289](https://github.com/aahoughton/oav/issues/289)) ([a9418c2](https://github.com/aahoughton/oav/commit/a9418c28db2c508a39a88b33a406fd0c8091b685))
* **schema:** silent-rewrite/* lint family with three checks ([#245](https://github.com/aahoughton/oav/issues/245)) ([1dda495](https://github.com/aahoughton/oav/commit/1dda495d998b8add5db57aadddbfa537ab95f3cd))
* **schema:** support pre-registered external schemas via base-URI stack ([4ebaa5e](https://github.com/aahoughton/oav/commit/4ebaa5e06a8979382d19f5683ba238126719e15f))
* **schema:** thread evaluated-key sets through compiled subvalidators ([f9d7579](https://github.com/aahoughton/oav/commit/f9d7579c2b3e1d5a7405d05d12cbb717c2ac49cc))
* **spec:** expand SpecOverlay typed verbs to cover OpenAPI Overlay axes ([#284](https://github.com/aahoughton/oav/issues/284)) ([2e0423b](https://github.com/aahoughton/oav/commit/2e0423b4868a5f02b29ccfd31cd4fb74d438c287))
* **spec:** fill the overlay verb matrix — add, augment, replace, remove ([#107](https://github.com/aahoughton/oav/issues/107)) ([aa22fad](https://github.com/aahoughton/oav/commit/aa22fadd634ca28b442ad8bdeaadb07ea9408429)), closes [#106](https://github.com/aahoughton/oav/issues/106)
* **spec:** spec-hygiene lint (resolveSpec / createValidator / oav resolve --lint) ([#243](https://github.com/aahoughton/oav/issues/243)) ([af3b1da](https://github.com/aahoughton/oav/commit/af3b1da327197ea353aaa4ac9a39029cb890de37))
* **spec:** spec-hygiene lint with four checks; surfaces from resolveSpec, loadSpec, createValidator, oav resolve ([af3b1da](https://github.com/aahoughton/oav/commit/af3b1da327197ea353aaa4ac9a39029cb890de37))
* split into @aahoughton/oav-core + @aahoughton/oav ([#98](https://github.com/aahoughton/oav/issues/98)) ([c46bb9e](https://github.com/aahoughton/oav/commit/c46bb9e88114763b1cedb7e00a8d338567691156))
* synchronous spec loader (loadSpecSync) ([#362](https://github.com/aahoughton/oav/issues/362)) ([efbf842](https://github.com/aahoughton/oav/commit/efbf842a99d9405066ed4f3fc451ec3b9eb6ea9c))
* v3 - flat error output and maxErrors:1 as zero-config defaults ([#344](https://github.com/aahoughton/oav/issues/344)) ([4d4c52e](https://github.com/aahoughton/oav/commit/4d4c52e521b5e171b9834eafca80e6ae7508ea67))
* **validator:** assemble form/explode and deepObject query params ([5558208](https://github.com/aahoughton/oav/commit/555820809607aec519b5a42dbab1e40d66c12213)), closes [#25](https://github.com/aahoughton/oav/issues/25)
* **validator:** enforce readOnly/writeOnly per direction ([f0bd670](https://github.com/aahoughton/oav/commit/f0bd670613a8cd29d3ca7ce7a3e6a79781d99894)), closes [#9](https://github.com/aahoughton/oav/issues/9)
* **validator:** enum-valued validateSecurity with strict mode ([#262](https://github.com/aahoughton/oav/issues/262)) ([df1bb4d](https://github.com/aahoughton/oav/commit/df1bb4d20a2662d927a0758a772f1c546ebec6c8))
* **validator:** getOperation introspection + examples/spec-digest.ts ([#110](https://github.com/aahoughton/oav/issues/110)) ([a998385](https://github.com/aahoughton/oav/commit/a998385bb9e6bdc2459364f540f19469bd69f341)), closes [#109](https://github.com/aahoughton/oav/issues/109)
* **validator:** honour parameter.content (JSON-in-query etc.) ([e988f02](https://github.com/aahoughton/oav/commit/e988f023b2629078cf664655c5260aeed6cfa2eb)), closes [#10](https://github.com/aahoughton/oav/issues/10)
* **validator:** ignoreUndocumented / ignorePaths options ([#89](https://github.com/aahoughton/oav/issues/89)) ([c537c7a](https://github.com/aahoughton/oav/commit/c537c7ae2ae9e73e736b3380f77e5662c4119182)), closes [#84](https://github.com/aahoughton/oav/issues/84)
* **validator:** inject warn sink for onUnknownVersion: 'warn' ([#70](https://github.com/aahoughton/oav/issues/70)) ([3bab862](https://github.com/aahoughton/oav/commit/3bab862e0904ca023d7e21a08e3827d91e40c978)), closes [#61](https://github.com/aahoughton/oav/issues/61)
* **validator:** readBody override on validateFetchRequest ([6f18620](https://github.com/aahoughton/oav/commit/6f186204e95dc864ff01096c017f8762ba503a72))
* **validator:** shape-only security validation (bearer, basic, apiKey) ([#105](https://github.com/aahoughton/oav/issues/105)) ([dd93b38](https://github.com/aahoughton/oav/commit/dd93b38c7edc5b39b28c11a54992bedffd9eb829))
* **validator:** validateFetchRequest + validateFetchResponse for Web Standards ([674827f](https://github.com/aahoughton/oav/commit/674827f67486bcd1fb1d3b552379a114d37dd020))


### Bug Fixes

* **build:** conditional exports so CJS TypeScript consumers can resolve types ([#115](https://github.com/aahoughton/oav/issues/115)) ([6fa3006](https://github.com/aahoughton/oav/commit/6fa30063ebd04935083e2d0028078bf09e00a7c0))
* **cli:** carry AOT dialect-fallback warnings into the emitted module ([#155](https://github.com/aahoughton/oav/issues/155)) ([dc55c61](https://github.com/aahoughton/oav/commit/dc55c61f0faea8eabc13d7c92309593ddac6e3ea))
* **cli:** emit full pathItem/operation for AOT getOperation ([#154](https://github.com/aahoughton/oav/issues/154)) ([b9065a3](https://github.com/aahoughton/oav/commit/b9065a36a111e1de94515c2014ed022202bf367a))
* **cli:** the "-o" arg should redirect stdout, not duplicate it ([#101](https://github.com/aahoughton/oav/issues/101)) ([a755946](https://github.com/aahoughton/oav/commit/a755946488167817b28673cedfca4d941077485c)), closes [#100](https://github.com/aahoughton/oav/issues/100)
* **core,validator:** tighten BuiltInErrorParams narrowing; fix *-param drift ([#73](https://github.com/aahoughton/oav/issues/73)) ([0ce3d9f](https://github.com/aahoughton/oav/commit/0ce3d9fe8faebf3eb07a2aef89b308d3ee826c8f)), closes [#58](https://github.com/aahoughton/oav/issues/58) [#59](https://github.com/aahoughton/oav/issues/59)
* **core:** correct BuiltInErrorParams drift + add cross-check test ([d2a977b](https://github.com/aahoughton/oav/commit/d2a977b5cf5535ee6e3facdb9287c3dc189f81d7)), closes [#27](https://github.com/aahoughton/oav/issues/27)
* **core:** widen frozen empty-children cast ([3276ed9](https://github.com/aahoughton/oav/commit/3276ed94ef2dc3a47c7d03135539399b3bdc0ede))
* correctness fixes from review (path decode, spaceDelimited, emit dedup) ([#326](https://github.com/aahoughton/oav/issues/326)) ([47ec36b](https://github.com/aahoughton/oav/commit/47ec36b6e35c3cea807b86cb199f56b3c6c92017))
* **docs:** cross-link gaps, custom-envelope worked example, parseYamlString cast hint ([#230](https://github.com/aahoughton/oav/issues/230)) ([b65c75d](https://github.com/aahoughton/oav/commit/b65c75dc54ca2afc128858587d2ab7ffec0d3f57)), closes [#229](https://github.com/aahoughton/oav/issues/229)
* drop preinstall script; too belt+suspender-y ([#228](https://github.com/aahoughton/oav/issues/228)) ([2ca850d](https://github.com/aahoughton/oav/commit/2ca850d9ba77cd696423b407a80445c758adf379)), closes [#227](https://github.com/aahoughton/oav/issues/227)
* **examples:** add tsconfig for examples; fix typing issue in spec-digest ([#161](https://github.com/aahoughton/oav/issues/161)) ([f1ac835](https://github.com/aahoughton/oav/commit/f1ac835f395b89d18ce00328e088d06f03d21613)), closes [#160](https://github.com/aahoughton/oav/issues/160)
* **performance:** repair bench script ([692b93c](https://github.com/aahoughton/oav/commit/692b93c33ae91125edf88997b6bf345703aa6f76))
* **publish:** tighten pack/install scripts (closes [#165](https://github.com/aahoughton/oav/issues/165) [#166](https://github.com/aahoughton/oav/issues/166) [#167](https://github.com/aahoughton/oav/issues/167)) ([#178](https://github.com/aahoughton/oav/issues/178)) ([7d33cc1](https://github.com/aahoughton/oav/commit/7d33cc1d8d77dae261f46715fd422d11a4aa6352))
* **release:** prefix tarball path with ./ for npm publish ([#308](https://github.com/aahoughton/oav/issues/308)) ([ddd0524](https://github.com/aahoughton/oav/commit/ddd052479e6c0d2147abbda135d33285d9cb94ac))
* **release:** revert OIDC; pnpm publish doesn't do trusted-publisher exchange ([#223](https://github.com/aahoughton/oav/issues/223)) ([2fc681e](https://github.com/aahoughton/oav/commit/2fc681ed9d0dcc824bc11cf856bc0494532ff54c))
* **release:** revert to NPM_TOKEN auth; pnpm doesn't yet do OIDC exchange ([2fc681e](https://github.com/aahoughton/oav/commit/2fc681ed9d0dcc824bc11cf856bc0494532ff54c))
* **release:** unblock OIDC trusted publishing; add dispatch recovery handle ([#221](https://github.com/aahoughton/oav/issues/221)) ([a3ae3e5](https://github.com/aahoughton/oav/commit/a3ae3e57619ce77e915f5ff47a55d1c443920d5e))
* **router:** per-method ambiguity check, not per-structure ([#132](https://github.com/aahoughton/oav/issues/132)) ([bcbe11b](https://github.com/aahoughton/oav/commit/bcbe11bf2db43461530122b85f097f3487c6ef81))
* **router:** support compound path segments (e.g. {sha}.{diffType}) ([#133](https://github.com/aahoughton/oav/issues/133)) ([e772df7](https://github.com/aahoughton/oav/commit/e772df764d0bd6bb4eae2e3af0d7247c141e535c))
* **schema,validator:** reject maxErrors &lt;= 0 and non-integers ([#136](https://github.com/aahoughton/oav/issues/136)) ([50455db](https://github.com/aahoughton/oav/commit/50455dbd4a614743a964fd2bd70f3949eb7b21c8))
* **schema:** close codegen-injection vectors in keyword compilation ([#253](https://github.com/aahoughton/oav/issues/253)) ([b456f08](https://github.com/aahoughton/oav/commit/b456f0834d0544d61248eab564e7a21189d2c39a))
* **schema:** count code points without allocating a spread array ([#156](https://github.com/aahoughton/oav/issues/156)) ([d8e0b18](https://github.com/aahoughton/oav/commit/d8e0b18dae663b6a1265365b59f9e641241a1946))
* **schema:** fall back to no-flag regex when 'u' rejects stray escapes ([f915763](https://github.com/aahoughton/oav/commit/f915763363673ca4a15f6d9befcef8965f5b33b2))
* **schema:** make deepEqual iterative to stop stack overflow on deep data ([#332](https://github.com/aahoughton/oav/issues/332)) ([5aaa4dd](https://github.com/aahoughton/oav/commit/5aaa4ddce3f8bfdde1e9e29e8f4d99b513539cbf))
* **schema:** preserve if-branch annotations and nested unevaluated:true ([ca8b877](https://github.com/aahoughton/oav/commit/ca8b8774513fcf1a79166e0d394571c04c2b867d))
* **schema:** scale multipleOf tolerance with value magnitude ([0e4e44c](https://github.com/aahoughton/oav/commit/0e4e44c2e356aef911870b7ed363542fc2304b9d)), closes [#20](https://github.com/aahoughton/oav/issues/20)
* **schema:** tolerate IEEE-754 rounding in multipleOf ([caf2f78](https://github.com/aahoughton/oav/commit/caf2f78cca7e1eed3c5569bb089e43b6d1962084)), closes [#8](https://github.com/aahoughton/oav/issues/8)
* **spec:** materialize circular external $refs under $defs.__ext__ ([efabdf3](https://github.com/aahoughton/oav/commit/efabdf35b446e9a9a0e9f97bc98ef484a0c97716))
* **spec:** percent-decode JSON Pointer fragments per RFC 6901 ([e0ff994](https://github.com/aahoughton/oav/commit/e0ff994328e24a569e792b7ffdca90a60487b820))
* **spec:** percent-decode paths in createFileReader ([4be679d](https://github.com/aahoughton/oav/commit/4be679d8879492658844937c21a62ed9d391e8c4)), closes [#37](https://github.com/aahoughton/oav/issues/37)
* **spec:** rewrite internal refs inside inlined external subtrees ([ddf1060](https://github.com/aahoughton/oav/commit/ddf106047e9bad550326221affc50e85e82e07e6)), closes [#38](https://github.com/aahoughton/oav/issues/38)
* **validator:** bypass type check for format:binary body fields ([83df7b9](https://github.com/aahoughton/oav/commit/83df7b984703763946a45fc3a9efa807de0b61bd)), closes [#23](https://github.com/aahoughton/oav/issues/23)
* **validator:** check required response headers when res.headers is absent ([1561395](https://github.com/aahoughton/oav/commit/1561395bebd646528e683357f34c6ecd2830a782))
* **validator:** default validateSecurity to false ([#184](https://github.com/aahoughton/oav/issues/184)) ([b53e7fc](https://github.com/aahoughton/oav/commit/b53e7fc20955be6a4bcac81a10cf4ce8bf66e7b5)), closes [#183](https://github.com/aahoughton/oav/issues/183)
* **validator:** drop redundant response prefix from response leaf paths ([f83291d](https://github.com/aahoughton/oav/commit/f83291dae9d2e2fbe3e4f6a05ef02cc078191e90)), closes [#30](https://github.com/aahoughton/oav/issues/30)
* **validator:** empty-string params aren't missing; honour allowEmptyValue ([853d2e2](https://github.com/aahoughton/oav/commit/853d2e21cdf872c943660a56bab8af670c6a81d6)), closes [#11](https://github.com/aahoughton/oav/issues/11)
* **validator:** enforce readOnly/writeOnly across \$ref composition ([e84aa42](https://github.com/aahoughton/oav/commit/e84aa425441a30d75a5cffeee9a2df92e70e9c8d)), closes [#17](https://github.com/aahoughton/oav/issues/17)
* **validator:** gate content-type check before schema validation ([#116](https://github.com/aahoughton/oav/issues/116)) ([8418a57](https://github.com/aahoughton/oav/commit/8418a57efd487099c908b48021c614944c0639e4))
* **validator:** honour media-type parameters in content negotiation ([18a5386](https://github.com/aahoughton/oav/commit/18a53863fe147899cf0b1853935eb2ed8e5c925e)), closes [#18](https://github.com/aahoughton/oav/issues/18)
* **validator:** op-level parameter override replaces path-level ([789cb49](https://github.com/aahoughton/oav/commit/789cb496100c6d0fc1152af3369345cd28b8ba75)), closes [#22](https://github.com/aahoughton/oav/issues/22)
* **validator:** reject non-3.x specs at construction; narrow onUnknownVersion ([#123](https://github.com/aahoughton/oav/issues/123)) ([b11e4cd](https://github.com/aahoughton/oav/commit/b11e4cd770827b7d20d40c3fd447bb396a38fecc))
* **validator:** required response headers when res.headers is absent ([#261](https://github.com/aahoughton/oav/issues/261)) ([1561395](https://github.com/aahoughton/oav/commit/1561395bebd646528e683357f34c6ecd2830a782))
* **validator:** surface 415 when body is absent but Content-Type is unmatched ([#176](https://github.com/aahoughton/oav/issues/176)) ([f20da56](https://github.com/aahoughton/oav/commit/f20da562c8be0483e8bcc99ed8c8c7aeee537229)), closes [#163](https://github.com/aahoughton/oav/issues/163)
* **validator:** use singular "header" path on response side ([#68](https://github.com/aahoughton/oav/issues/68)) ([1942f1c](https://github.com/aahoughton/oav/commit/1942f1c548684e51a2db86b68104ea81aa53902d)), closes [#65](https://github.com/aahoughton/oav/issues/65)


### Performance

* add --spec mode to run.ts; rewrite README ([b261b03](https://github.com/aahoughton/oav/commit/b261b039a1c46e6051e708e54522fc6aa46cdcf7))
* **core:** share frozen empty params default across errors ([#317](https://github.com/aahoughton/oav/issues/317)) ([bad7cfb](https://github.com/aahoughton/oav/commit/bad7cfb3e866eef3f0da334e7100556000e4c9f0))
* HTTP-server steady-state memory benchmark ([#118](https://github.com/aahoughton/oav/issues/118)) ([260dcb8](https://github.com/aahoughton/oav/commit/260dcb8092144e73fd6cea86101a05c6c05446bc))
* large-response benchmarks (stress + error-tree anatomy) ([#318](https://github.com/aahoughton/oav/issues/318)) ([4bbc1e7](https://github.com/aahoughton/oav/commit/4bbc1e7666763c78cac04f85794c79ee41da5ad0))
* publishable benchmark harness + host-stamped c7i.large numbers ([#364](https://github.com/aahoughton/oav/issues/364)) ([3a58999](https://github.com/aahoughton/oav/commit/3a5899981ccaaf4716413aa0e60dcca55f8c2d27))
* real-world spec benchmark driver ([92b4874](https://github.com/aahoughton/oav/commit/92b4874a52923a248c4fb7017bf06a7e3978549d))
* **schema:** bind property value to a local before validating it ([#324](https://github.com/aahoughton/oav/issues/324)) ([cb167f3](https://github.com/aahoughton/oav/commit/cb167f3753ed20706df6076cb56ec2be7b8849a1))
* **schema:** bound minLength/maxLength by string length before walking code points ([#322](https://github.com/aahoughton/oav/issues/322)) ([35a32f2](https://github.com/aahoughton/oav/commit/35a32f243318de3b32c20e7d634bb7cbd6728188))
* **schema:** cheaper leaf error construction (levers A + B) ([a91be64](https://github.com/aahoughton/oav/commit/a91be6434d68d0bab32845ae281b3f0a3ffde655))
* **schema:** cheaper property presence via !== undefined ([#343](https://github.com/aahoughton/oav/issues/343)) ([32010b3](https://github.com/aahoughton/oav/commit/32010b3216137d964412cdec280cfefc77e302a7))
* **schema:** elide pure-\$ref wrapper functions ([#51](https://github.com/aahoughton/oav/issues/51)) ([22ca453](https://github.com/aahoughton/oav/commit/22ca4531b99d22e3f71a69377c39f00ec6b84a9a))
* **schema:** emit direct property checks for small required arrays ([#358](https://github.com/aahoughton/oav/issues/358)) ([fa4b111](https://github.com/aahoughton/oav/commit/fa4b111015afc613832893eaafbb83abee32eb04))
* **schema:** flag oas30 modifier keywords as annotations ([#69](https://github.com/aahoughton/oav/issues/69)) ([a2defe9](https://github.com/aahoughton/oav/commit/a2defe9b9328839dc401ad87e26f733946c234f6)), closes [#63](https://github.com/aahoughton/oav/issues/63)
* **schema:** gate unevaluated-key tracking on a compile-time schema walk ([92217a2](https://github.com/aahoughton/oav/commit/92217a2543fad076d902f811d5dd66f768370f9c))
* **schema:** hoist compile-time constants out of validator body ([#47](https://github.com/aahoughton/oav/issues/47)) ([5ccf178](https://github.com/aahoughton/oav/commit/5ccf178ab4723d874164f119f291bc7baa6a0185))
* **schema:** lazy errors array, elide wrapErrors on happy path ([#48](https://github.com/aahoughton/oav/issues/48)) ([ea8e539](https://github.com/aahoughton/oav/commit/ea8e539582684553a54f2b46f6399771e63eaa72))
* **schema:** lazy path — skip push/pop on the happy path ([#49](https://github.com/aahoughton/oav/issues/49)) ([8a69d2a](https://github.com/aahoughton/oav/commit/8a69d2ac246caf90f6f9bf3c372d49093007397e))
* **schema:** low-risk codegen cleanups ([7a2863c](https://github.com/aahoughton/oav/commit/7a2863c35b225b903f45cdc2003c529c8a771fc9))
* **schema:** low-risk codegen cleanups (redundant isFinite, length hoist, unused eval params) ([#323](https://github.com/aahoughton/oav/issues/323)) ([7a2863c](https://github.com/aahoughton/oav/commit/7a2863c35b225b903f45cdc2003c529c8a771fc9))
* **schema:** low-risk codegen wins (regex hoist, primitive equality, oneOf cleanup, required predicate) ([#265](https://github.com/aahoughton/oav/issues/265)) ([a9bc49d](https://github.com/aahoughton/oav/commit/a9bc49d9298ef6609990f6f0fd4ade51eebfaadc))
* **schema:** object hot-path codegen (single-pass required + shared guard) ([#316](https://github.com/aahoughton/oav/issues/316)) ([6dc008f](https://github.com/aahoughton/oav/commit/6dc008f876bf9b6b39ad2a10edf2ac95da99c53e))
* **schema:** thread pathSegments through tryInline's inlined ctx ([#52](https://github.com/aahoughton/oav/issues/52)) ([ae2a51c](https://github.com/aahoughton/oav/commit/ae2a51c68f32124c3cd666fd804d316bcd50bbad))
* **schema:** two-phase composition (predicate decision + lazy errors) ([#342](https://github.com/aahoughton/oav/issues/342)) ([6a832d4](https://github.com/aahoughton/oav/commit/6a832d41e55d54d411c5b8c433783bf0a783ebdb))
* **schema:** uniqueItems primitive fast path via findDuplicate helper ([#157](https://github.com/aahoughton/oav/issues/157)) ([1153373](https://github.com/aahoughton/oav/commit/1153373cb4e7613a335cdfe6a80fe7eb3f19fb86))
* **validator:** defer response-schema compilation until validateResponse ([87dc228](https://github.com/aahoughton/oav/commit/87dc2282a978234483d51a3cd8df99cda7a69989))


### Documentation

* accuracy pass — eov mechanisms, deps, AOT framing, swagger 2.0, cross-field example ([#131](https://github.com/aahoughton/oav/issues/131)) ([a5cb310](https://github.com/aahoughton/oav/commit/a5cb3104f4707054a15a7e187c7e5e7823a6d5a0))
* **adapters:** add Hardening section to adapter READMEs ([#334](https://github.com/aahoughton/oav/issues/334)) ([73bdcb2](https://github.com/aahoughton/oav/commit/73bdcb28180f9ae64ccd8e5ea9f44b2efa673497))
* add 'Why this exists', conformance table, and INTEGRATION.md ([371c804](https://github.com/aahoughton/oav/commit/371c80458e77a6a6057a0d5a399d7063148f8a00))
* add Contribution principles section to CLAUDE.md ([#182](https://github.com/aahoughton/oav/issues/182)) ([b9eed74](https://github.com/aahoughton/oav/commit/b9eed74bac03b9dc6c35060cb3341368e3dedd69))
* add packages/oav/README.md and reflect adapter family ([#181](https://github.com/aahoughton/oav/issues/181)) ([757d4bd](https://github.com/aahoughton/oav/commit/757d4bd73211a2d6210b8fbf9bce73eee2ada5e2))
* address [#198](https://github.com/aahoughton/oav/issues/198) [#199](https://github.com/aahoughton/oav/issues/199) [#200](https://github.com/aahoughton/oav/issues/200) — multer global pattern, YAML constraint, pointer + envelope shapes ([#202](https://github.com/aahoughton/oav/issues/202)) ([c419117](https://github.com/aahoughton/oav/commit/c4191170314dadb700b7def5fe5be3211b5c485a))
* ajv policy, tone pass, overlays guide + examples ([#78](https://github.com/aahoughton/oav/issues/78)) ([ae55701](https://github.com/aahoughton/oav/commit/ae5570192e38e5ecf25898b517e661ef3e795354))
* **claude:** refresh architecture descriptions and maxErrors guidance ([#139](https://github.com/aahoughton/oav/issues/139)) ([792b02b](https://github.com/aahoughton/oav/commit/792b02b024c75f60bbf3a26f214d09ba0b4b3538))
* **claude:** replace prefixPath with startPath reference ([#67](https://github.com/aahoughton/oav/issues/67)) ([0c7daa3](https://github.com/aahoughton/oav/commit/0c7daa3bc511c6ceaada5d430f58ee5fe0295e1f)), closes [#66](https://github.com/aahoughton/oav/issues/66)
* cleanup pass, spelling normalization, TSDoc tightening ([#260](https://github.com/aahoughton/oav/issues/260)) ([77fcf4d](https://github.com/aahoughton/oav/commit/77fcf4ddafe8e6a30b8108fc0dee78a31a8e1a6b))
* **core:** toProblemDetails echoes request values + schema metadata ([#304](https://github.com/aahoughton/oav/issues/304)) ([1f566fc](https://github.com/aahoughton/oav/commit/1f566fc045823b1099722963bb7f8197bfabd63b))
* correct stale README claims against code ([#361](https://github.com/aahoughton/oav/issues/361)) ([bdd2654](https://github.com/aahoughton/oav/commit/bdd265431797255aa118ab3e9ddb33a4c50c0b56))
* document ajv-formats format-shape adapter as a 3-line helper ([757f85a](https://github.com/aahoughton/oav/commit/757f85a8a0f94cacc7d8c5c4db0ceb12b10f6111))
* document deepObject single-level nesting limitation ([#153](https://github.com/aahoughton/oav/issues/153)) ([9e8704b](https://github.com/aahoughton/oav/commit/9e8704b0a368b2847b2477f53bfc3599c04538ec))
* drop "matching Ajv" framing from the defaults ([#356](https://github.com/aahoughton/oav/issues/356)) ([1d287b6](https://github.com/aahoughton/oav/commit/1d287b64ff409f06436d83ffa375124c0ee5902d))
* drop [@aahoughton](https://github.com/aahoughton) scope from narrative prose ([#138](https://github.com/aahoughton/oav/issues/138)) ([2d157d0](https://github.com/aahoughton/oav/commit/2d157d0c04ec73f5c2a3b1644c8c9b59b89f3725))
* fix REPORT.md reference, reduce em-dash density ([97d9445](https://github.com/aahoughton/oav/commit/97d94455bd3ab89ca54277c20245e4154099e409))
* harden recursion-depth guidance and slim CLAUDE.md ([#331](https://github.com/aahoughton/oav/issues/331)) ([8c91e50](https://github.com/aahoughton/oav/commit/8c91e5012c1e03726e6f0a161f33d4c3c008795e))
* migration trio + auth dispatch recipe + friction-batch follow-ons ([#193](https://github.com/aahoughton/oav/issues/193)) ([8a490c5](https://github.com/aahoughton/oav/commit/8a490c55fc610d459d5561fc9763c67623bdd264)), closes [#186](https://github.com/aahoughton/oav/issues/186) [#187](https://github.com/aahoughton/oav/issues/187) [#188](https://github.com/aahoughton/oav/issues/188) [#189](https://github.com/aahoughton/oav/issues/189) [#190](https://github.com/aahoughton/oav/issues/190) [#191](https://github.com/aahoughton/oav/issues/191) [#192](https://github.com/aahoughton/oav/issues/192)
* move root markdown into docs/ subdir ([#237](https://github.com/aahoughton/oav/issues/237)) ([365af48](https://github.com/aahoughton/oav/commit/365af48ab7394bf18ddc498419f15be67079ba3a))
* note task-4a validate regression and gating todo ([6cea432](https://github.com/aahoughton/oav/commit/6cea4324c810f20d2cfabb94e14b12f4cf85434a))
* post-v3 cleanup of stale deprecation notes ([#347](https://github.com/aahoughton/oav/issues/347)) ([f0922f4](https://github.com/aahoughton/oav/commit/f0922f4eb64eba1ccf996beeb52d8dee16b060c5))
* **readme:** note ReDoS exposure on attacker-controlled specs ([bb34d8b](https://github.com/aahoughton/oav/commit/bb34d8b96f1f0dfce5af5e06141d22a06f53bdee))
* refresh benchmark and comparison perf claims after perf work ([#325](https://github.com/aahoughton/oav/issues/325)) ([6e70129](https://github.com/aahoughton/oav/commit/6e7012952dc02336b2c928945b254945460ff96d))
* remove unevaluatedProperties-across-composition limitation ([45644ca](https://github.com/aahoughton/oav/commit/45644cac3aced86b594ec4b30e995b527a4f3126))
* rework INTEGRATION.md as per-framework recipe book; extract MIGRATION-FROM-EOV.md ([#197](https://github.com/aahoughton/oav/issues/197)) ([#204](https://github.com/aahoughton/oav/issues/204)) ([4fa7a35](https://github.com/aahoughton/oav/commit/4fa7a35088d679233a6aa585e23798fd6624059b))
* rework readme to surface goals ([#226](https://github.com/aahoughton/oav/issues/226)) ([babe3e5](https://github.com/aahoughton/oav/commit/babe3e5c199bda9ebc0b59af311b2cac93d2ae7e)), closes [#225](https://github.com/aahoughton/oav/issues/225)
* sharpen performance framing in README + COMPARISON ([#117](https://github.com/aahoughton/oav/issues/117)) ([feddb47](https://github.com/aahoughton/oav/commit/feddb47ffb910f90a369b6da612f90abda340462))
* sweep stale v2 result-shape and pre-maxDepth language ([#354](https://github.com/aahoughton/oav/issues/354)) ([0bc3c2b](https://github.com/aahoughton/oav/commit/0bc3c2b98eb4ceefc55310d1f78ba5cd9d4cdd97))
* sync examples table in README with examples/ directory ([#134](https://github.com/aahoughton/oav/issues/134)) ([9939ffe](https://github.com/aahoughton/oav/commit/9939ffe64716b98ef3fd86d02e1d9c99c51eaad7))
* tightening pass — remove unshipped-adapter promises, drop defensive language ([#207](https://github.com/aahoughton/oav/issues/207)) ([09a40af](https://github.com/aahoughton/oav/commit/09a40afec3585b211bd4d9e656518ef1e7f46877))
* trim README; extract reference content into docs/ ([#239](https://github.com/aahoughton/oav/issues/239)) ([db25a46](https://github.com/aahoughton/oav/commit/db25a46c4c3e6ca04a5a531cd48396561022b0b5))
* **validator:** make ValidatorOptions the canonical option reference ([#175](https://github.com/aahoughton/oav/issues/175)) ([991ffca](https://github.com/aahoughton/oav/commit/991ffca3c6bf590852b0a9d5812421ba46a7113a)), closes [#173](https://github.com/aahoughton/oav/issues/173)


### Refactoring

* consolidate three parallel JSON Pointer implementations ([b5a13fe](https://github.com/aahoughton/oav/commit/b5a13fedfbae5ce4e7c978623589c42dac06da69)), closes [#28](https://github.com/aahoughton/oav/issues/28)
* **core:** move output-format dispatch to @oav/core ([#71](https://github.com/aahoughton/oav/issues/71)) ([ab54cbd](https://github.com/aahoughton/oav/commit/ab54cbdc81ee628deac89ca87216861e8ee37f5a)), closes [#60](https://github.com/aahoughton/oav/issues/60)
* **router:** rename trie.ts to matcher.ts; fix misleading big-O ([22f97b6](https://github.com/aahoughton/oav/commit/22f97b6333403fe6ee9e8f27756db3067c947d93))
* **schema:** derive compiled artifact variants from CompiledSchema ([#348](https://github.com/aahoughton/oav/issues/348)) ([e66af95](https://github.com/aahoughton/oav/commit/e66af95fec5ff2ac20069e5622b62b33288dc377))
* **schema:** derive inliner classification from KeywordDefinition flags ([8962e63](https://github.com/aahoughton/oav/commit/8962e63e506d72ad0f965e0ae82fc1c38b47663d)), closes [#34](https://github.com/aahoughton/oav/issues/34)
* **schema:** expose emittedTreeRuntime compile stat ([#72](https://github.com/aahoughton/oav/issues/72)) ([a7b00d1](https://github.com/aahoughton/oav/commit/a7b00d12e73fdee957c540d28977599c7d633147)), closes [#62](https://github.com/aahoughton/oav/issues/62)
* **schema:** promote annotation keywords to a Meta-Data vocabulary ([0f6913c](https://github.com/aahoughton/oav/commit/0f6913c7affa2497cebdf56275bb7253b1c81ddd))
* **schema:** stratify public surface; add internals subpath ([#76](https://github.com/aahoughton/oav/issues/76)) ([2671a95](https://github.com/aahoughton/oav/commit/2671a950e1608046c7a832f5e9038f6ee930c7fe)), closes [#57](https://github.com/aahoughton/oav/issues/57)
* **validator:** no-console lint in core; warnings as a property ([#125](https://github.com/aahoughton/oav/issues/125)) ([c869cf7](https://github.com/aahoughton/oav/commit/c869cf71dc3da5f3301fa6decbad99a06a012895))
* **validator:** rename direction.ts, add dedicated test file ([a5897b3](https://github.com/aahoughton/oav/commit/a5897b3e37d86dd3bf27993eaa52a6da73fb1b27)), closes [#26](https://github.com/aahoughton/oav/issues/26)
* **validator:** rename OavValidator interface to Validator ([#174](https://github.com/aahoughton/oav/issues/174)) ([d906e18](https://github.com/aahoughton/oav/commit/d906e187ab792185f656c3c3965b7bc4f377cafb)), closes [#172](https://github.com/aahoughton/oav/issues/172)
* **validator:** split validator.test.ts by subject + extract helpers ([b5aa55b](https://github.com/aahoughton/oav/commit/b5aa55ba2f4c38d1de76d797bbb2df6741a778ab)), closes [#29](https://github.com/aahoughton/oav/issues/29)
* **validator:** split validator.ts into orchestrator + cache + step ([#75](https://github.com/aahoughton/oav/issues/75)) ([d14543e](https://github.com/aahoughton/oav/commit/d14543edaeae5d4c35a1dd0e3cfce567639585bf)), closes [#56](https://github.com/aahoughton/oav/issues/56)
* **validator:** stratify public surface; add internals subpath ([#77](https://github.com/aahoughton/oav/issues/77)) ([0b361a8](https://github.com/aahoughton/oav/commit/0b361a8c771518e329419d9e73831b8375321aaf))

## [3.1.0](https://github.com/aahoughton/oav/compare/oav-core-v3.0.0...oav-core-v3.1.0) (2026-06-09)


### Features

* synchronous spec loader (loadSpecSync) ([#362](https://github.com/aahoughton/oav/issues/362)) ([efbf842](https://github.com/aahoughton/oav/commit/efbf842a99d9405066ed4f3fc451ec3b9eb6ea9c))


### Performance

* publishable benchmark harness + host-stamped c7i.large numbers ([#364](https://github.com/aahoughton/oav/issues/364)) ([3a58999](https://github.com/aahoughton/oav/commit/3a5899981ccaaf4716413aa0e60dcca55f8c2d27))
* **schema:** emit direct property checks for small required arrays ([#358](https://github.com/aahoughton/oav/issues/358)) ([fa4b111](https://github.com/aahoughton/oav/commit/fa4b111015afc613832893eaafbb83abee32eb04))


### Documentation

* correct stale README claims against code ([#361](https://github.com/aahoughton/oav/issues/361)) ([bdd2654](https://github.com/aahoughton/oav/commit/bdd265431797255aa118ab3e9ddb33a4c50c0b56))

## [3.0.0](https://github.com/aahoughton/oav/compare/oav-core-v2.4.0...oav-core-v3.0.0) (2026-06-08)


### ⚠ BREAKING CHANGES

* **cli:** `oav compile-spec` output now returns the v3 result object ({ valid, ... }) instead of `ValidationError | null`, and defaults to flat + maxErrors:1. Consumers reading the old null/tree shape should read `result.valid` / `result.errors` (or pass `--output-mode tree` for the nested `error`).
* compileSchema and createValidator default to flat error output and maxErrors:1. validateRequest/validateResponse return a result object ({ valid, errors?, error?, truncated }) instead of ValidationError|null. Adapter onError receives a ValidationError[] leaf list. ValidationResult and CompiledSchema now name the flat shapes (tree is TreeValidationResult/CompiledTreeSchema). undefined-valued object properties count as absent. formatJson/summarize/formatFlat and the validateSecurity boolean form are removed. See docs/migration-v3.md.

### Features

* **cli:** compile-spec result-shape parity with createValidator ([#355](https://github.com/aahoughton/oav/issues/355)) ([5081b4a](https://github.com/aahoughton/oav/commit/5081b4a2a6bfb3ed313f655fc568403dde7be163))
* **schema:** flat error-collection mode ([#337](https://github.com/aahoughton/oav/issues/337)) ([7c4852e](https://github.com/aahoughton/oav/commit/7c4852e23e8c83880231bb83d0c9985e7a070a59))
* v3 - flat error output and maxErrors:1 as zero-config defaults ([#344](https://github.com/aahoughton/oav/issues/344)) ([4d4c52e](https://github.com/aahoughton/oav/commit/4d4c52e521b5e171b9834eafca80e6ae7508ea67))


### Performance

* **schema:** cheaper property presence via !== undefined ([#343](https://github.com/aahoughton/oav/issues/343)) ([32010b3](https://github.com/aahoughton/oav/commit/32010b3216137d964412cdec280cfefc77e302a7))
* **schema:** two-phase composition (predicate decision + lazy errors) ([#342](https://github.com/aahoughton/oav/issues/342)) ([6a832d4](https://github.com/aahoughton/oav/commit/6a832d41e55d54d411c5b8c433783bf0a783ebdb))


### Documentation

* drop "matching Ajv" framing from the defaults ([#356](https://github.com/aahoughton/oav/issues/356)) ([1d287b6](https://github.com/aahoughton/oav/commit/1d287b64ff409f06436d83ffa375124c0ee5902d))
* post-v3 cleanup of stale deprecation notes ([#347](https://github.com/aahoughton/oav/issues/347)) ([f0922f4](https://github.com/aahoughton/oav/commit/f0922f4eb64eba1ccf996beeb52d8dee16b060c5))
* sweep stale v2 result-shape and pre-maxDepth language ([#354](https://github.com/aahoughton/oav/issues/354)) ([0bc3c2b](https://github.com/aahoughton/oav/commit/0bc3c2b98eb4ceefc55310d1f78ba5cd9d4cdd97))


### Refactoring

* **schema:** derive compiled artifact variants from CompiledSchema ([#348](https://github.com/aahoughton/oav/issues/348)) ([e66af95](https://github.com/aahoughton/oav/commit/e66af95fec5ff2ac20069e5622b62b33288dc377))

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
