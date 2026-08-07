# @icad/catalog

**Generated — do not edit by hand.** The bundled IBM Cloud icon catalog: a manifest plus optimized
SVG glyphs, produced from a pinned
[IBM-Cloud/architecture-icons](https://github.com/IBM-Cloud/architecture-icons) commit by
[`@icad/catalog-build`](../catalog-build).

241 icons across 11 categories, versioned by directory (`2.0.0/`) so a `.icad` file can pin the
catalog version it was authored against
([D6](../../docs/decision-log.md#d6--icad-is-a-single-human-readable-json-file--locked)).

Shells load this and inject it into `@icad/core` — core never imports it directly.

- Pipeline, refresh cadence, and migration tooling: [Icon catalog](../catalog-build/docs/icon-catalog.md)
- Upstream licensing and attribution: [NOTICE.md](NOTICE.md)

```
2.0.0/
  index.json      manifest: id, name, category, semantic, container, color, keywords
  icons/          normalized 24×24 glyph SVGs, by category
```
