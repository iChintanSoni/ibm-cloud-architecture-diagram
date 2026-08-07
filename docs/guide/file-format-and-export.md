# File format & export

## `.icad`

Every ICAD diagram is a single, human-readable JSON file — reviewable in a PR, diffable in git,
and easy for an agent to generate directly. Icons are referenced by catalog ID, never embedded, so
files stay small and diffs stay clean.

```jsonc
{
  "format": "icad",
  "version": 1,
  "catalog": { "id": "ibm-cloud", "version": "2.0.0" },
  "meta": {
    "title": "…",
    "diagramLevel": "high-level",
    "createdAt": "…",
    "updatedAt": "…",
  },
  "canvas": { "theme": "auto", "grid": 8, "background": "transparent" },
  "conformance": {
    "exportGate": "warn",
    "ruleSeverities": {/* per-rule overrides */},
  },
  "elements": [/* boxes, groups, zones, actors, icons, text, connectors */],
  "frames": [/* sectioning + presentation order */],
}
```

Elements are a discriminated union on `type` (`box | group | zone | actor | iconNode | connector |
text | frame`), each carrying both geometry (`x`/`y`/`w`/`h`, `parentId`) and its IBM `semantic`
(`deployedOn` | `deployedTo` | `boundary` | `actor` | `node`). The full schema, including
connector fields (`from`/`to` port refs, `connectorType`, `direction`, `flowColor`, `cardinality`,
`waypoints`), lives in [`packages/core/docs/file-format.md`](../../packages/core/docs/file-format.md) — this page summarizes the
parts relevant to using the tool day to day.

Files always load through a repair pass (drop dangling references, clamp degenerate geometry, fix
broken parent chains), so a `.icad` file is always safe to open regardless of how it was produced
— by hand, by an older schema version, or by an agent.

## Export

The Export dialog (Ctrl/Cmd via the Export button, File menu, or command palette) offers:

- **SVG** — the canonical export. Colors, layout, and fonts match what's on screen exactly. The
  full `.icad` document is always embedded in the SVG's `<metadata id="icad:source">` block, so
  the SVG itself is re-openable and editable later — there's currently no UI toggle to omit it
  (the underlying `core/io` export API accepts an `embedSource: false` option, but no surface
  exposes it as a setting yet).
- **PNG** — rasterized from the SVG at 1×, 2×, or 3× scale, with a transparent or white
  background.

Both formats respect the **export gate**: set to _Warn_, the linter's findings are advisory only;
set to _Block_, export is refused while any `error`-level diagnostic remains. The gate and any
per-rule severity overrides are stored in the document itself (`conformance`), so a team's
validation policy travels with the file.

See [The web editor → Export](../../apps/web/docs/web-editor.md#export) for what the dialog looks like, and
[The web editor → The linter](../../apps/web/docs/web-editor.md#the-linter) for how diagnostics and quick-fixes
work.
