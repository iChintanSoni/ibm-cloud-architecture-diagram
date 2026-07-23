# File Format — `.icad`

`.icad` (**I**BM **C**loud **A**rchitecture **D**iagram) is the native, first-class file type.

## Principles

- **Single human-readable JSON file** ([D6](00-decision-log.md#d6--icad-is-a-single-human-readable-json-file--locked)) — reviewable in a PR, diffable, agent-generatable.
- **Icons referenced by catalog ID**, never embedded — files stay small and diffs stay clean.
- **Versioned + migratable** — a `restore/migrate` layer upgrades older files on open (the same
  discipline Excalidraw uses via its `restore.ts`).
- **Geometry + semantics** — every element records both its shape and its IBM meaning.

## Top-level shape

```jsonc
{
  "format": "icad",
  "version": 1,                         // schema version (migrations key off this)
  "catalog": { "id": "ibm-cloud", "version": "2.0.0" }, // pinned icon catalog (see D11)
  "meta": {
    "title": "Payments platform — system context",
    "diagramLevel": "system-context",   // system-context | high-level | detailed | blank
    "createdAt": "2026-07-22T00:00:00Z",
    "updatedAt": "2026-07-22T00:00:00Z",
    "author": "…"
  },
  "canvas": { "theme": "auto", "grid": 8, "background": "transparent" },
  "elements": [ /* see below */ ],
  "frames": [ /* sectioning + presentation order */ ]
}
```

## Element model

Elements are a discriminated union on `type`. Shared fields:

```jsonc
{
  "id": "el_9f3a",            // stable, unique
  "type": "iconNode",         // iconNode | box | group | zone | actor | connector | text | frame
  "semantic": "node",         // IBM meaning: deployedOn | deployedTo | node | actor | boundary
  "x": 320, "y": 160, "w": 48, "h": 48,
  "rotation": 0,
  "parentId": "el_box1",      // container membership (moves-with)
  "label": { "text": "VPC", "position": "s" },
  "style": { /* stroke, fill, dashed, color token */ },
  "z": 12
}
```

Type-specific additions:

| `type` | Extra fields | IBM meaning |
|---|---|---|
| `iconNode` | `catalogRef: "ibm-cloud/vpc"` | Standalone component/device (square container, 1px outline) |
| `box` | — (solid border) | `deployedOn` location (logical/virtual/physical) |
| `group` | — (dashed border) | `deployedTo` grouping of services/apps |
| `zone` | `zoneKind: "region"\|"az"\|"vpc"…` | Boundary/location |
| `actor` | `catalogRef?` | Role/user (rounded) |
| `connector` | `from`, `to` (port refs), `connectorType`, `waypoints[]`, `routing?`, `direction?`, `flowColor?`, `cardinality?` | IBM connector nomenclature |
| `text` | `text`, typography | Free annotation |
| `frame` | `name`, `order`, `bounds` | Section + presentation step |

Ports are referenced as `{ elementId, port: "n"|"e"|"s"|"w"|"center" }`. Connectors store their
routed `waypoints` for stable re-open, but the router can re-derive them — `routing: "auto"`
(default) re-routes on every endpoint move/resize; `routing: "manual"` keeps whatever waypoints
were last set. `direction` (`"unidirectional"` default, or `"bidirectional"`) and `flowColor`
(`"private"`/`"public"`) apply to connection-type connectors; `cardinality` (`{ from?, to? }`
labels) applies to relationship-type connectors. See
[Connector nomenclature](05-ibm-spec-conformance.md#connector-nomenclature) for the full type list.

## Catalog references, not embeds

`catalogRef` is a stable ID resolved against the bundled [Icon Catalog](04-icon-catalog.md) pinned
by `catalog.version`. Benefits: tiny files, clean diffs, and icons that update in lockstep when we
bump the catalog. If a referenced ID is missing after a catalog change, the migration layer maps it
via the catalog's `aliases` and, failing that, renders a labeled placeholder with a lint warning.

## Versioning & migration

- `version` is an integer schema version. `io/migrations` holds ordered `migrate(vN → vN+1)` steps.
- Files always load through the migration + repair layer (fix dangling `parentId`, re-bind
  connectors, clamp geometry) so the in-memory scene is always valid regardless of source.
- Forward-compat: unknown fields are preserved on round-trip where safe.

## Export

Handled by `core/io`. See also [Editor UX → Export](06-editor-ux.md#export).

### SVG (canonical)
- Produced directly from the render tree, so export == on-screen.
- Defaults mirror IBM guidance: transparent background, embedded fonts/images, spec colors.
- **Re-editable copy ([D8](00-decision-log.md#d8--re-editable-svg-via-embedded-icad-copy--locked)):** the full `.icad` JSON is embedded in a
  `<metadata>`/`<desc>` block so the tool can reopen the SVG and restore the editable scene. An
  **"export without source"** option omits it for public assets.

```xml
<svg …>
  <metadata id="icad:source" data-icad-version="1">{ …base64(.icad JSON)… }</metadata>
  …
</svg>
```

### PNG
- Rasterized from the SVG at selectable scale (1×/2×/3×), transparent or white background.

### Export gate
The [linter](05-ibm-spec-conformance.md) can optionally **warn or block** export when the diagram
has spec violations ([D12](00-decision-log.md#d12--advisory-linter--quick-fixes--optional-export-gate--locked)). Configurable; default = warn.

## Why not a zip container

We considered a zipped container (embedding assets/fonts). Rejected for v1: it defeats
git-diffability and clean PR review, which are core to the local-first, files-first stance
([D4](00-decision-log.md#d4--local-first-single-user-files--locked)). Self-contained sharing is served by the embedded-source SVG instead.
