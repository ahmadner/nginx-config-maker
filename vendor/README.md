# Vendored libraries

The app has no build step, so its two runtime libraries are committed here as plain ES modules, pinned to exact versions. Each folder name carries the version.

| Library | Version | File | Taken from (npm) | License | Used for |
|---------|---------|------|------------------|---------|----------|
| [js-yaml](https://github.com/nodeca/js-yaml) | 4.1.1 | `js-yaml@4.1.1/js-yaml.mjs` | `js-yaml/dist/js-yaml.mjs` | MIT | Parsing and writing project YAML files |
| [fflate](https://github.com/101arrowz/fflate) | 0.8.2 | `fflate@0.8.2/fflate.js` | `fflate/esm/browser.js` | MIT | Creating the ZIP package in the browser |

Why these versions:

- **js-yaml 4.1.1** is the current release of the mature 4.x line. It includes the November 2025 fix for prototype pollution through merge keys (`<<`). The 4.x default schema has no executable types (`!!js/function` and similar are rejected).
- **fflate 0.8.2** is small, has no dependencies, and its synchronous `zipSync` runs in browsers and Node without workers.

`checksums.json` records the SHA-256 of each file. `npm test` and `npm run vendor:check` fail if a vendored file changes.

## Updating

1. Change the exact version in `package.json` (`devDependencies`) and rename the matching folder reference in the imports (`js/core/yaml-io.js`, `js/core/package.js`, tests).
2. `npm install` (only needed for this step).
3. `npm run vendor:update` copies the files and licenses from `node_modules` and rewrites `checksums.json`.
4. Run `npm test` and review the diff.
