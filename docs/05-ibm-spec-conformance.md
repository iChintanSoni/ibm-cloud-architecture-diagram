# IBM Spec Conformance

The reason this tool exists instead of generic draw.io: it *understands* the IBM Cloud architecture
diagram spec and helps users stay on it. This document defines the semantics we model, the
conventions we enforce, and how the linter works.

## Element semantics

Per IBM's guidance, shapes carry meaning, not just geometry:

| Element | IBM semantic | Visual convention |
|---|---|---|
| **Box** | `deployedOn` — a location (logical/virtual/physical) that platforms, infra, network, services are deployed **on** | **Solid** border container |
| **Group** | `deployedTo` — grouping of services/apps deployed **to** a box | **Dashed** border container |
| **Node** | Standalone component/device | **Square** container, IBM icon (20×20 glyph in 48×48, 1px outline) |
| **Actor** | Role/user | **Rounded** shape |
| **Zone** | Region / availability zone / VPC / subnet boundary | Labeled boundary |
| **Connector** | Relationship / flow | IBM connector nomenclature (below) |

Example the IBM docs give: *a virtual server instance is `deployedOn` a subnet and `deployedTo` a
security group.* The tool models exactly this — the VSI node sits inside a subnet **box** and a
security-group **group**.

## Layout convention

- **West → East (left → right) = public traffic flow.** Diagrams read with external/public entry
  on the left flowing inward to the right. Templates seed this; the linter flags major reversals.

## Connector nomenclature

IBM ships a standard connector set ("IBM connectors," dotted-end variants). We model connector
**type** as first-class:

- Endpoint styles (plain / arrow / dotted-end) and line styles map to IBM's set.
- Connectors bind to **ports** on shapes and re-route when shapes move ([Architecture → Connectors](02-architecture.md#connectors)).
- Default routing is **orthogonal**, obstacle-avoiding, west→east biased; manual waypoints override.
- The picker labels types by IBM meaning, not by raw appearance.

## Categories & tiers

Icons are organized by the IBM tiers — IBM (Core), IBM Cloud, IBM Domains/Industries, 3rd Party —
and by functional category (compute, network, storage, security, data, devops, ai, actors,
groups). The library panel mirrors this. See [Icon Catalog](04-icon-catalog.md).

## The linter (`core/linter`)

**Advisory by default, with quick-fixes and an optional export gate** ([D12](00-decision-log.md#d12--advisory-linter--quick-fixes--optional-export-gate--locked)). It never blocks
editing; it guides. Each rule yields a diagnostic (`error`/`warn`/`info`), a target element, a
human explanation, and — where possible — an automatic **quick-fix** command.

### Rule categories

1. **Semantics vs. visuals**
   - Box drawn but used as a grouping (should be a dashed Group), or vice versa → quick-fix:
     convert container type.
   - Node placed without an IBM icon / using a non-catalog glyph.
2. **Containment correctness**
   - Node not placed in any box/zone when the topology implies a location.
   - `deployedTo` group not inside a `deployedOn` box (illegal nesting per the model).
3. **Labels & metadata**
   - Missing required labels on boxes/groups/zones/actors.
   - Ambiguous or duplicate labels.
4. **Connectors**
   - Non-standard connector type; endpoints not bound to ports; dangling connector.
   - Crossing/overlapping routes where a clean orthogonal route exists → quick-fix: re-route.
5. **Layout**
   - Gross west→east flow reversal (public entry on the right).
   - Icon sizing/outline drift from the 48×48 / 1px spec.
6. **Export readiness** (only enforced if the export gate is on)
   - Any `error`-level diagnostic present.

### Quick-fixes

Quick-fixes are ordinary [commands](02-architecture.md#command-bus--history) (`ApplyQuickFix`
wraps them), so they're undoable and also callable by the [agent API](08-agent-integration.md).
Examples: *convert Box→Group*, *bind connector to nearest port*, *add missing label*, *snap icon to
spec size*, *re-route orthogonally*.

### Surfacing

- A **Validation panel** (Carbon) lists diagnostics grouped by severity, click-to-select the
  element, and one-click "Fix" / "Fix all of this type."
- Inline affordances on the canvas (a small badge on offending elements).
- Export dialog shows a compliance summary; the gate setting decides warn vs. block.

## Configurability

Rule severities are configurable per document (with an IBM-default preset). Teams that want strict
output can turn the export gate to **block**; ideation-heavy users can keep everything advisory.
The default is IBM-recommended with the gate set to **warn**.
