# @icad/catalog-build

Build-time converter: a pinned [IBM-Cloud/architecture-icons](https://github.com/IBM-Cloud/architecture-icons)
commit → the generated catalog in [`packages/catalog`](../catalog) (a manifest plus optimized
SVG glyphs).

This runs at build time, not at runtime
([D11](../../docs/decision-log.md#d11--build-time-icon-conversion-bundled-offline-catalog--locked)) —
the shipped app carries a bundled, offline catalog with no network dependency.

## Docs

- [Icon catalog pipeline](./docs/icon-catalog.md) — extraction, normalization, categories,
  keyword generation, the refresh cadence, and the diff/migration tooling

## Layout

```
src/
  build.ts              orchestrates a full catalog generation
  extract.ts            stencil/SVG → normalized 24×24 glyph
  keywordOverrides.ts   hand-maintained search terms for architecture jargon
                        with no overlap with an icon's literal upstream name
  diff.ts, diffCatalog.ts   catalog-version diffing for migration
.cache/                 pinned upstream checkout (not committed)
```

## Regenerating the catalog

A full regeneration is gated by IBM Design sign-off
([D17](../../docs/decision-log.md#d17--official--ibm-internal-tool--locked)) — keyword-only
fixes are applied directly to the generated `packages/catalog/<version>/index.json` instead. See
the pipeline doc above before running a rebuild.

```bash
pnpm --filter @icad/catalog-build test
```
