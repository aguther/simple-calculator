# Zeitrechner

A small installable web app for calculating with times and regular numbers.
It is intentionally built with plain HTML, CSS, and JavaScript: no framework,
no bundler, and no runtime dependencies.

## Features

- Time calculator with `H:MM` and `H:MM:SS` input.
- Fast shorthand time entry: `145` becomes `1:45`.
- Regular number calculator mode.
- Operator precedence and parentheses.
- Running tape with intermediate sums.
- Minutes conversion for time results.
- Separate saved state for time and number mode.
- Optional key sounds, haptic feedback where supported, and hardware keyboard input.
- Responsive mobile/desktop layout.
- PWA manifest and service worker for installation and offline use.

## Input

In time mode, entries without a colon treat the last two digits as minutes:

| Input | Meaning |
| --- | --- |
| `45` | `0:45` |
| `145` | `1:45` |
| `1230` | `12:30` |

Entries with colons are parsed left to right:

| Input | Meaning |
| --- | --- |
| `1:2` | `1:02` |
| `1:23` | `1:23` |
| `1::15` | `1:00:15` |

For multiplication and division in time mode, a plain entry after `x` or `/`
is treated as a scalar. For example, `1:30 x 2` gives `3:00`.

## Local Development

Run the core and browser smoke tests:

```sh
npm test
```

Run only the pure calculation tests:

```sh
npm run test:core
```

Run only the rendered browser smoke test:

```sh
npm run test:ui
```

Build the deployable static files into `dist`:

```sh
npm run build
```

The app can also be opened directly from `index.html` during development.
For service worker behavior, serve it over `http://localhost`.

## Deployment

The project is configured for Cloudflare Workers static assets:

```sh
npm run build
wrangler deploy
```

`build.js` copies the app into `dist` and replaces the `__COMMIT__` marker in
the About dialog with the current commit hash.

## Project Structure

- `index.html` contains the app shell and styles.
- `src/calculator-core.js` contains the pure parser, formatter, and evaluator.
- `src/app.js` contains UI state, rendering, persistence, and input handling.
- `test/calculator-core.test.js` covers pure calculation behavior.
- `test/browser-smoke.test.js` opens the rendered app in a headless browser and
  verifies a real user flow.
- `sw.js` provides the offline cache.
- `manifest.webmanifest` defines installable PWA metadata.
