# Third-party notice: icon catalog

The SVG icons and metadata under `2.0.0/` are converted, at build time, from a pinned commit of
IBM's public [`IBM-Cloud/architecture-icons`](https://github.com/IBM-Cloud/architecture-icons)
repository (see `packages/catalog-build`, `docs/04-icon-catalog.md`):

- **Upstream repo:** https://github.com/IBM-Cloud/architecture-icons
- **Pinned commit:** `32d9c311b0dadb95f0fe4fa88b27f3af41c1dbc5` (also recorded in
  `2.0.0/index.json`'s `upstream.ref`)

**License status: not confirmed.** As of this writing, GitHub does not detect a `LICENSE` file in
the upstream repository (`gh api repos/IBM-Cloud/architecture-icons/license` returns 404). The
Apache-2.0 license covering the rest of this repository (see the root `LICENSE` file) applies to
ICAD's own source code — it is **not** asserted over the icon SVGs in this directory, since their
redistribution terms have not been confirmed with IBM. Until that's resolved, treat this directory
as "IBM-owned assets, used here, terms TBD" rather than as Apache-2.0-licensed content.
