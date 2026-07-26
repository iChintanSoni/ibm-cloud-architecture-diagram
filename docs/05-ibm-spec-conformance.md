# IBM Spec Conformance

The reason this tool exists instead of generic draw.io: it _understands_ the IBM Cloud architecture
diagram spec and helps users stay on it. This document defines the semantics we model, the
conventions we enforce, and how the linter works.

## Normative sources

When published IBM sources disagree, ICAD uses this precedence:

1. [IBM Cloud Architecture Framework — Creating an architecture diagram](https://cloud.ibm.com/docs/architecture-framework?topic=architecture-framework-architecture-diagram)
2. IBM Design-approved internal guidance
3. Native IBM Cloud stencils in Draw.io
4. The architecture-icons repository inventory and complementary stencil XML
5. Raw SVG exports and repository prose

The Architecture Framework is normative for Box/Group semantics, icon geometry, west→east layout,
and export guidance. The stencil repository remains the pinned source for assets and supplemental
inventory metadata; its raw SVG presentation is not itself the rendering specification.

## Element semantics

Per IBM's guidance, shapes carry meaning, not just geometry:

| Element                          | IBM semantic                                                                                                      | Visual convention                                                                                                                                                                              |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Box**                          | `deployedOn` — a location (logical/virtual/physical) that platforms, infra, network, services are deployed **on** | **Solid** border container, colored left sidebar accent                                                                                                                                        |
| **Group**                        | `deployedTo` — grouping of services/apps deployed **to** a box                                                    | **Dashed** border container, no sidebar                                                                                                                                                        |
| **Node**                         | Standalone component/device                                                                                       | **Square** container — a solid category-color 48×48 tile with a 24×24 white glyph, no outline ([D25](00-decision-log.md#d25--icons-render-as-ibm-authors-them-solid-tile-white-glyph--locked)) |
| **Actor**                        | Role/user                                                                                                         | **Rounded** shape — a solid black circle with a 24×24 white glyph, no outline                                                                                                                  |
| **Boundary** (`zone` internally) | Geographic/organizational boundary — availability zone, on-premises                                               | **Fine-dotted** border, no sidebar, muted gray                                                                                                                                                 |
| **Connector**                    | Relationship / flow                                                                                               | IBM connector nomenclature (below)                                                                                                                                                             |

**Region, VPC, and Subnet are Box** (`deployedOn`), not Boundary — resolved by
[D24](00-decision-log.md#d24--regionvpcsubnet-are-box-only-availability-zoneon-prem-are-boundary--locked)
against direct evidence: the sidebar-tab rect present in every Box-style stencil in
`not_released_in_drawio.xml`, and the kit's own worked examples (`images/DeployedTo.png`; the
`IKS_SR_MZ_VPC`/`ROKS_SR_MZ_VPC`/`*_Classic` reference diagrams) — all render Region/VPC/Subnet as
solid-border boxes with a sidebar accent. Only availability zone (and, by the same logic,
on-premises) renders as the dotted Boundary primitive. This is direct-evidence confirmation, not a
substitute for the [D17](00-decision-log.md#d17--official--ibm-internal-tool--locked) IBM Design
sign-off gate.

Example the IBM docs give: _a virtual server instance is `deployedOn` a subnet and `deployedTo` a
security group._ ICAD models both meanings, but the published guidance does not require every
Group to be a child of a Box. Whether `deployedTo` can be multi-valued remains an IBM Design
follow-up before any `.icad` schema change. The same worked example (`images/DeployedTo.png`)
confirms Security Group itself renders as a dashed **Group**, not a dotted Boundary — see D24.

## Color usage

Color carries meaning, and IBM's guidance is specific about _where_ each weight of the palette may
appear:

| Role          | Palette weight                | Used for                                             |
| ------------- | ----------------------------- | ---------------------------------------------------- |
| **Primary**   | 50/60 (full saturation)       | Outlines, side-bar accents, color blocks, connectors |
| **Secondary** | 10 (light tint) or white      | Fills only                                           |
| **Alert**     | Red/Yellow/Green alert tokens | Badges only                                          |

Never rely on color alone to convey meaning — labels and icons must carry it too.

The nine primary colors map 1:1 to functional category and match the accent color already baked
into each catalog icon ([Icon Catalog](04-icon-catalog.md)):

| Category                   | Primary (outline/connector) | Secondary (10-tint fill) |
| -------------------------- | --------------------------- | ------------------------ |
| Security                   | Red 50 `#fa4d56`            | Red 10 `#fff1f1`         |
| DevOps                     | Magenta 50 `#ee5396`        | Magenta 10 `#fff0f7`     |
| Applications               | Purple 50 `#a56eff`         | Purple 10 `#f6f2ff`      |
| Data & Storage             | Blue 60 `#0f62fe`           | Blue 10 `#edf5ff`        |
| Network                    | Cyan 50 `#1192e8`           | Cyan 10 `#e5f6ff`        |
| Observability              | Teal 50 `#009d9a`           | Teal 10 `#d9fbfb`        |
| Compute                    | Green 60 `#198038`          | Green 10 `#defbe6`       |
| Backend / generic location | Cool Gray 50 `#878d96`      | Cool Gray 10 `#f2f4f8`   |
| User / Actors              | Black `#000000`             | —                        |

Source: _IBM_IT Architecture diagrams kit_ v1.1, "Color" slide.

## Layout convention

- **West → East (left → right) = public traffic flow.** Diagrams read with external/public entry
  on the left flowing inward to the right. Templates seed this; the linter flags major reversals.

## Connector nomenclature

IBM ships a standard connector set ("IBM connectors"). We model connector **type** as first-class,
not just a line style:

- Connectors bind to **ports** on shapes and re-route when shapes move ([Architecture → Connectors](02-architecture.md#connectors)).
- Default routing is **orthogonal**, obstacle-avoiding, west→east biased; manual waypoints override.
- The picker labels types by IBM meaning, not by raw appearance.

### Connection types

Physical/protocol connections and messages between elements. Each has a bidirectional and
unidirectional variant (arrowhead on one end vs. both):

| Type                                                  | Line style                                                       | Meaning                                                                                                                                                                                                                                          |
| ----------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Logical Connection / Link                             | even dash                                                        | Logical message exchanged between elements                                                                                                                                                                                                       |
| Connection                                            | solid                                                            | Network connection                                                                                                                                                                                                                               |
| Physical Connection                                   | double line, hollow square end-caps                              | Physical/cabled connection                                                                                                                                                                                                                       |
| Tunneling Connection (schema: `tunneling-connection`) | solid, on a `#FFD7D9` highlighted band                           | Traffic through a tunnel/encapsulation — what IBM's own `Connectors.drawio` actually labels "Traffic Through Tunnel/Encapsulation"; "Tunneling Connection" itself is a caption in that stencil with no edge behind it, not a distinct line style |
| Traffic Through Double Tunnel                         | solid, on a `#FFD7D9` + Carbon Yellow 30 (`#f1c21b`) double band | Traffic through nested tunnels                                                                                                                                                                                                                   |

Connection endpoints follow the published IBM reference: bidirectional connections use dots at
both ends; unidirectional connections use a source dot and destination arrow. Stroke width is 2px
by default, confirmed against `Connectors.drawio`'s own style strings. The double-tunnel's second
band color has no literal value anywhere in that stencil — it renders via a proprietary
`mxgraph.ibm2mondrian` shape — so Carbon Yellow 30 is a reasoned placeholder pending direct IBM
Design confirmation, the same posture [D21](00-decision-log.md#d21--container-presets-are-a-named-shortcut-layer-not-new-element-types--locked)
takes for other unconfirmed specifics.

**Color coding** (independent of the type above): green `#198038` = private connection, blue
`#4376BB` = public connection. `#4376BB` is a distinct "link blue" from `Connectors.drawio`'s own
color-code legend — not the Data & Storage category's Blue 60 (`#0f62fe`) from the [Color
usage](#color-usage) table below; don't conflate the two.

**Structured annotations.** A connection/physical-connection carries a "Protocol/Application
NAME" annotation; a tunnel type carries an "Encapsulation NAME" one instead — which reading
applies is inferred from the connector's own type. Each has an optional Encryption/Security
descriptor and port, formatted as `NAME SECURITY:PORT`, e.g. `HTTPS TLS1.3:443` — IBM's kit shows
this wrapped in a literal `[...]` bracket, treated here as template placeholder notation (the same
convention `[PORT]` itself uses) rather than literal punctuation to render, following this same
worked example. The linter flags a security/port set with no name, and a non-numeric port.

**Sequencing.** Connectors may carry a short sequencing/numbering badge (e.g. "1", "2a"), rendered
as a small circle at the connector's midpoint — IBM's kit captions this "Sequencing or numbering
for flowcharts or use cases".

### Relationships

Logical relationships between elements — not network traffic. IBM's own arrowhead
(`Connectors.drawio`: `endArrow=open`) is an open chevron with no closing base line, distinct from
implementation/extends's closed hollow triangle (`endArrow=block;endFill=0`):

| Type           | Line style                          | Meaning                                                    |
| -------------- | ----------------------------------- | ---------------------------------------------------------- |
| Dependency     | dashed, open-chevron arrow          | Standard — used ~99% of the time, with a description label |
| Association    | solid, open-chevron arrow           | Standard                                                   |
| Aggregation    | open-diamond + open-chevron arrow   | UML — "has-a," part can outlive the whole                  |
| Composition    | filled-diamond + open-chevron arrow | UML — "owns-a," part's lifetime bound to the whole         |
| Implementation | dashed + closed hollow triangle     | UML — realizes an interface                                |
| Extends        | solid + closed hollow triangle      | UML — inheritance                                          |

Association/Aggregation/Composition edges may carry `0..N`-style cardinality labels at each end.

Source: _IBM_IT Architecture diagrams kit_ v1.1, "Connectors" slide, cross-checked against
`Connectors.drawio`'s own style strings where the two disagreed.

## Categories & tiers

The catalog schema is designed for IBM's tiers — IBM (Core), IBM Cloud, IBM Domains/Industries,
3rd Party — as well as functional category (compute, network, storage, security, data, devops, ai,
actors, applications, groups). Today's generated catalog tags all 242 icons under a single tier
(`ibm-cloud`); the tier taxonomy isn't populated yet, so the Library panel currently groups by
category only. See [Icon Catalog](04-icon-catalog.md).

## The linter (`core/linter`)

**Advisory by default, with quick-fixes and an optional export gate** ([D12](00-decision-log.md#d12--advisory-linter--quick-fixes--optional-export-gate--locked)). It never blocks
editing; it guides. Each rule yields a diagnostic (`error`/`warn`/`info`), a target element, a
human explanation, and — where possible — an automatic **quick-fix** command.

### Rule categories

1. **Semantics vs. visuals**
   - Box drawn but used as a grouping (should be a dashed Group), or vice versa → quick-fix:
     convert container type.
   - Node placed without an IBM icon / using a non-catalog glyph.
   - Fill uses a primary (50/60) color instead of the category's secondary 10-tint/white →
     quick-fix: swap to the secondary tint ([Color usage](#color-usage)).
   - Outline, side-bar accent, or connector uses a secondary/alert color instead of primary →
     quick-fix: swap to the category's primary.
2. **Containment correctness**
   - Node not placed in any box/boundary when the topology implies a location.
3. **Labels & metadata**
   - Missing required labels on boxes/groups/zones/actors.
   - Ambiguous or duplicate labels.
4. **Connectors**
   - Non-standard connector type; endpoints not bound to ports; dangling connector.
   - Crossing/overlapping routes where a clean orthogonal route exists → quick-fix: re-route.
   - Structured annotation with a security/port descriptor but no name; a non-numeric port.
5. **Layout**
   - Gross west→east flow reversal (public entry on the right).
   - Icon sizing/outline drift from the 48×48 / 1px spec.
6. **Export readiness** (only enforced if the export gate is on)
   - Any `error`-level diagnostic present.

### Quick-fixes

Quick-fixes are ordinary [commands](02-architecture.md#command-bus--history) (`ApplyQuickFix`
wraps them), so they're undoable and also callable by the [agent API](08-agent-integration.md).
Examples: _convert Box→Group_, _bind connector to nearest port_, _add missing label_, _snap icon to
spec size_, _re-route orthogonally_.

### Surfacing

- A **Validation panel** (Carbon) lists diagnostics grouped by severity, click-to-select the
  element, and one-click "Fix" / "Fix all of this type."
- Inline affordances on the canvas (a small badge on offending elements).
- Export dialog shows a compliance summary; the gate setting decides warn vs. block.

## Configurability

Rule severities are configurable per document (with an IBM-default preset). Teams that want strict
output can turn the export gate to **block**; ideation-heavy users can keep everything advisory.
The default is IBM-recommended with the gate set to **warn**.

The current implementation ships 16 rules across semantics, containment, labels, connectors, and
layout. The location-context check applies to high-level/detailed diagrams (system-context and
blank diagrams intentionally allow standalone nodes), and west→east reversal checks target public
connections. Per-rule overrides and the export gate are stored in `.icad`; validation fixes and
settings changes are ordinary undoable commands.
