# Zeitrechner

An installable time and number calculator built with plain HTML, CSS, and
JavaScript. The production app has no runtime dependencies; Playwright is used
only for development and CI verification.

## Features

- Time calculations with `H:MM` and `H:MM:SS`, including negative results.
- Fast shorthand input (`145` becomes `1:45`), operator precedence,
  parentheses, intermediate sums, and a scrollable calculation tape.
- A regular number mode with separately persisted calculator state.
- Explicit recovery from undefined operations such as division by zero.
- Keyboard input, optional key sounds, and haptic feedback where supported.
- Responsive portrait and landscape layouts with dynamic viewport and safe-area
  support, browser zoom, and accessible controls.
- Installable, offline-capable PWA with versioned app-shell updates.

## Input

In time mode, entries without a colon treat the last two digits as minutes:

| Input | Meaning |
| --- | --- |
| `45` | `0:45` |
| `145` | `1:45` |
| `1230` | `12:30` |

Entries containing colons are parsed from left to right. For example, `1:2`
means `1:02`, while `1::15` means `1:00:15`. After multiplication or division,
a plain entry is treated as a scalar: `1:30 × 2` produces `3:00`.

## Local development and tests

Install the development dependency and the three browser engines once:

```sh
npm ci
npx playwright install chromium firefox webkit
```

Run the complete release gate:

```sh
npm test
```

The gate runs Node unit tests, a deterministic production build, build and
security-contract tests, and Playwright scenarios in Chromium, Firefox, and
WebKit. The browser matrix covers compact phones, current phone proportions,
landscape orientations, desktop, keyboard/dialog behavior, 200% text sizing,
offline reloads, and atomic PWA updates.

Individual checks are available as `npm run test:unit`, `npm run test:build`,
`npm run test:ui`, and `npm run test:ui:chromium`.

Build deployable static files into `dist` with:

```sh
npm run build
```

The build emits content-hashed CSS and JavaScript assets, rewrites the HTML and
service-worker precache list to those exact names, and copies the Cloudflare
`_headers` contract. Run the app through an HTTP server when checking service
worker behavior; opening `index.html` directly remains useful only for simple
UI development.

## Diagnostics

Append `?diagnostics=1` to the URL to open a local-only diagnostic dialog. Its
copyable JSON contains viewport, screen, orientation, safe-area, display-mode,
app-build, and active service-worker-version information. It contains no stored
calculator data or personal information and does not change persisted state.

The normal release process does not depend on a personal iPhone or other
physical device. A real-device check can add evidence for an operating-system
specific issue, but is optional. Playwright WebKit is valuable cross-engine
coverage and does not fully emulate an installed iOS Home Screen PWA.

## Deployment

The project is configured for Cloudflare static assets:

```sh
npm run build
wrangler deploy
```

HTML, the manifest, and service worker are revalidated. Only content-hashed
assets receive immutable long-term caching. `_headers` also defines the CSP,
anti-framing, content-type, referrer, and permissions policies. No application
Worker logic is required.

## Project structure

- `index.html` contains the semantic application shell.
- `src/app.css` contains responsive layout and component styles.
- `src/calculator-core.js` contains the pure parser, formatter, and evaluator.
- `src/state-store.js` validates schema-v5 state and migrates valid v4 data.
- `src/app.js` contains rendering and input orchestration.
- `build.js`, `sw.js`, and `_headers` implement the production PWA contract.
- `test/*.test.js` contains unit and build-contract tests.
- `test/e2e/` contains the cross-browser layout, interaction, offline, and
  update scenarios.
