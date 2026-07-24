---
name: ibm-diagram-spec
description: Reference for IBM Cloud architecture diagram conventions — element semantics (Box/Group/Zone/Actor/Connector), color usage, connector nomenclature, categories/tiers, layout, and the conformance linter's rule categories. Load this before authoring or exporting an ICAD diagram so element choices, colors, and connector types are right the first time instead of getting flagged by lint(). Pairs with ibm-diagram-authoring (build) and ibm-diagram-export (validate/export).
---

# IBM Cloud diagram conventions

ICAD models the published [IBM Cloud Architecture Framework](https://cloud.ibm.com/docs/architecture-framework?topic=architecture-framework-architecture-diagram)
diagram spec, not generic boxes-and-arrows. This is the convention reference the
`ibm-diagram-authoring` and `ibm-diagram-export` skills build on and the `lint` MCP tool enforces.
If you're operating inside the `ibm-cloud-diagram` repo, the full source is
`docs/05-ibm-spec-conformance.md` / `docs/04-icon-catalog.md` — this file is the compact version for
authoring against the MCP server directly.

## Element semantics

Shapes carry meaning, not just geometry. Pick the element by what it *means*, not what it looks like:

| Element | MCP tool | IBM semantic | Visual convention |
|---|---|---|---|
| **Box** | `element_add_box` | `deployedOn` — a location (logical/virtual/physical) that infra/services are deployed **on** | Solid-border container |
| **Group** | `element_add_group` | `deployedTo` — grouping of services/apps deployed **to** a box | Dashed-border container |
| **Zone** (labelled "Boundary" in the UI) | `element_add_zone` | Region / availability zone / VPC / subnet / on-prem boundary | Labeled boundary; set `zoneKind`: `region`\|`az`\|`vpc`\|`subnet`\|`on-prem` |
| **IconNode** | `element_add_icon` | Standalone component/device, from the catalog | Square container, IBM icon (48×48, 1px outline) |
| **Actor** | `element_add_actor` | Role/user/external system | Rounded shape |
| **Connector** | `connect` / `connect_nearest` | Relationship or traffic flow | See nomenclature below |
| **Frame** | `element_add_frame` | Presentation section, always top-level, never a semantic container | Named, orderable region |

Worked example from IBM's own docs: *a virtual server instance is `deployedOn` a subnet and
`deployedTo` a security group* — model both: a Zone (`subnet`) containing a Box (the instance's
platform), and separately a Group (the security group) the instance is `deployedTo`. Don't force
every Group under a Box — the published guidance doesn't require that nesting.

## Containment & nesting

- Every non-frame, non-top-level element needs `parentId` pointing at its containing
  Box/Group/Zone/Frame.
- The engine auto-applies a **16px inset** from the parent's border when you place a child inside
  it — don't hand-compute padding, just pick a sensible `at`/`w`/`h` inside the parent's bounds.
- Alternate white and light-tint (10%) fills between nesting levels for readability — this is a
  `style` concern, not a containment one; the linter flags primary (50/60) colors used as a fill.
- Build **outside-in**: create the outermost container first (get its id), then children with
  `parentId` set to it, so nothing is ever placed before its parent exists.

## Color usage

| Role | Palette weight | Used for |
|---|---|---|
| Primary | 50/60 (full saturation) | Outlines, side-bar accents, color blocks, connectors |
| Secondary | 10 (light tint) or white | Fills only |
| Alert | Red/Yellow/Green alert tokens | Badges only |

Never rely on color alone — labels and icons must carry meaning too. The nine category colors
(also baked into each catalog icon's `color` field):

| Category | Primary (outline/connector) | Secondary (10-tint fill) |
|---|---|---|
| Security | Red 50 `#fa4d56` | Red 10 `#fff1f1` |
| DevOps | Magenta 50 `#ee5396` | Magenta 10 `#fff0f7` |
| Applications | Purple 50 `#a56eff` | Purple 10 `#f6f2ff` |
| Data & Storage | Blue 60 `#0f62fe` | Blue 10 `#edf5ff` |
| Network | Cyan 50 `#1192e8` | Cyan 10 `#e5f6ff` |
| Observability | Teal 50 `#009d9a` | Teal 10 `#d9fbfb` |
| Compute | Green 60 `#198038` | Green 10 `#defbe6` |
| Backend / generic location | Cool Gray 50 `#878d96` | Cool Gray 10 `#f2f4f8` |
| User / Actors | Black `#000000` | — |

In practice: don't hand-set `style.stroke`/`style.fill` unless you're deviating deliberately —
default element styling already follows this table, and the linter's quick-fixes correct drift.

## Layout convention

**West → East (left → right) = public traffic flow.** Public entry points (actors, external
systems) go on the left (smallest `x`); the flow moves rightward/inward. The linter flags gross
reversals (public entry on the right). `connect_nearest`/`connect` route orthogonally and
obstacle-avoid automatically.

## Connector nomenclature

Connector **type** is first-class, not just a line style. Pass it as `connectorType` to
`connect`/`connect_nearest`. Two families:

### Connection types — physical/protocol traffic
Each has a `direction`: `unidirectional` (source dot, destination arrow) or `bidirectional` (dots
at both ends).

| `connectorType` value | Meaning |
|---|---|
| `logical-connection` | Logical message exchanged between elements |
| `connection` | Network connection |
| `physical-connection` | Physical/cabled connection |
| `tunneling-connection` | Traffic through a tunnel/encapsulation |
| `traffic-through-double-tunnel` | Traffic through nested tunnels |

Set `flowColor`: `"private"` (green) or `"public"` (blue) — independent of the type above, and
independent of direction. Label connections `[Protocol/Application NAME] [Encryption/Security]:[PORT]`,
e.g. `label: "HTTPS TLS1.3:443"`.

### Relationship types — logical, not traffic

| `connectorType` value | Meaning |
|---|---|
| `dependency` | Standard — used ~99% of the time, with a description label |
| `association` | Standard |
| `aggregation` | UML "has-a" — part can outlive the whole |
| `composition` | UML "owns-a" — part's lifetime bound to the whole |
| `implementation` | UML — realizes an interface |
| `extends` | UML — inheritance |

`association`/`aggregation`/`composition` may carry `cardinality: { from, to }` (e.g. `"0..N"`).
Relationships don't take `flowColor` — that's a connection-family concept.

**Rule of thumb:** if it's network/protocol traffic, use a connection type + `flowColor`. If it's a
logical/structural relationship (depends-on, has-a, implements), use a relationship type instead —
don't default everything to `connection`.

## Categories & tiers

Catalog icons are organized by functional category — `compute`, `network`, `storage`, `security`,
`data`, `devops`, `ai`, `actors`, `applications`, `observability` — and by IBM tier (`ibm-core`,
`ibm-cloud`, `domains`, `third-party`; only `ibm-cloud` is populated in the current catalog). Always
resolve a `catalogRef` via `catalog_search`/`catalog_categories` — never invent an id like
`ibm-cloud/some-guess`; if nothing matches well, pick the closest generic icon and let the label
carry the specificity.

## What the linter checks (`lint` tool)

Five rule categories, each yielding `error`/`warn`/`info` diagnostics, most with a `quickfix_apply`
fix:

1. **Semantics vs. visuals** — Box used as a grouping (should be Group) or vice versa; a Node
   without a catalog icon; primary color used as a fill; secondary/alert color used as an
   outline/connector.
2. **Containment** — a Node with no enclosing Box/Boundary when the topology implies a location
   (enforced on `high-level`/`detailed` diagrams; `system-context`/`blank` allow standalone nodes).
3. **Labels** — missing required labels on boxes/groups/zones/actors; ambiguous/duplicate labels.
4. **Connectors** — non-standard type; endpoint not bound to a port; dangling connector; a route
   that crosses a shape it isn't attached to.
5. **Layout** — gross west→east reversal on public connections; icon sizing/outline drift from the
   48×48/1px spec.

The export gate (`error`-severity diagnostics block `export_diagram` when the document's gate is
`"block"`; default is `"warn"`, which never blocks). See `ibm-diagram-export` for the
validate-then-export workflow.
