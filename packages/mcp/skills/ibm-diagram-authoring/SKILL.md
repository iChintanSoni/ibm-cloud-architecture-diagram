---
name: ibm-diagram-authoring
description: Translate a requirements paragraph into an IBM Cloud architecture diagram by driving the ICAD MCP server's authoring tools — choose a diagram level, resolve catalog icons, model deployedOn/deployedTo containment correctly, connect elements with proper IBM connector types, and lay out west→east. Use whenever asked to generate, draft, or extend an ICAD (.icad) architecture diagram from a natural-language description of a system.
---

# Authoring an IBM Cloud architecture diagram

You are driving the ICAD MCP server (`packages/mcp`), a thin wrapper over the same headless engine
the human editor uses — every tool call is an undoable command against a real document. Load
**`ibm-diagram-spec`** alongside this skill for the element/color/connector conventions referenced
below; this skill is the _workflow_, that one is the _reference_.

## Workflow

### 1. Read the requirement like an architect, not a parser

Before calling any tool, identify from the prompt:

- **Actors** — people or external systems initiating traffic (→ `element_add_actor`).
- **Deployment locations** — regions, VPCs, subnets, on-prem, availability zones (→ `element_add_zone`
  with the matching `zoneKind`), and the platforms things run _on_ (→ `element_add_box`,
  `deployedOn`).
- **Workload groupings** — services/apps deployed _to_ a location, e.g. an application tier or
  security group (→ `element_add_group`, `deployedTo`).
- **Concrete components** — the actual services/instances (→ `element_add_icon`, resolved through
  `catalog_search`).
- **Relationships between all of the above** — network/protocol traffic vs. logical relationships
  (see `ibm-diagram-spec`'s connector nomenclature) — these become `connect`/`connect_nearest` calls.

A requirement rarely states containment explicitly — infer it. "A web app behind an API gateway in
a VPC" means: Zone (`vpc`) → Box or Group for the app tier → icons for gateway and app inside it.

### 2. Pick a diagram level and create the document

Call `doc_create({ level, seedExampleContent: false })` first — every authoring tool errors until a
document is open.

| `level`          | Use when the requirement is about...                                               |
| ---------------- | ---------------------------------------------------------------------------------- |
| `system-context` | Actors, external systems, and one solution boundary — no internal detail.          |
| `high-level`     | Zones/boxes/groups, key services, and their main flows. Most requests land here.   |
| `detailed`       | Concrete deployment: region → VPC → subnet → security group → instances.           |
| `blank`          | Freeform, doesn't fit the above, or the user explicitly asked for an empty canvas. |

**Always pass `seedExampleContent: false`** for any level but `blank`, unless the user explicitly
asked to start from IBM's worked example and modify it. Without it, `doc_create` seeds a full
example diagram (frame, boxes, icons, connectors) at fixed coordinates — whatever gets built next
lands in the same space and collides with it (duplicate labels, overlapping shapes). Don't reach
for `level: "blank"` as the workaround instead: it's exempt from an entire category of linter
rules that only run for `high-level`/`detailed` (e.g. the containment check that flags an icon
with no Box/Boundary ancestor), so it trades one problem for a quieter one.

If replacing a document that has unsaved changes, `doc_create` errors unless you pass
`force: true` — don't pass it reflexively; only when you've confirmed discarding is intended.

### 3. Resolve every icon through the catalog — never guess a `catalogRef`

Call `catalog_search({ query })` for each concrete component before `element_add_icon`. Use the
returned `id` verbatim (e.g. `ibm-cloud/vpc`). If nothing matches well, pick the closest generic
icon (e.g. an instance/application icon) rather than inventing an id — a wrong-but-plausible-looking
`catalogRef` fails at placement time. `catalog_categories()` helps when you need to browse rather
than search.

### 4. Build outside-in, west→east

**Prefer one `scene_apply` call over many individual `element_add_*`/`connect*` calls.** For a
diagram's initial build, batch every container, icon, actor, and connector for that section into a
single `scene_apply({ ops: [...] })` call rather than one tool round-trip per element — it commits
as one undo step, is all-or-nothing (nothing is applied if any op is invalid, and every failing op
is reported, not just the first), and avoids the back-and-forth latency of dozens of sequential
round-trips for what is conceptually one build. Reach for individual `element_add_*`/`connect*`/
`connect_nearest` calls for later single-element touch-ups or edits to an existing diagram, not for
the initial build of a section.

Within one `scene_apply` call (or across individual calls), the same rules apply:

1. Create containers before their contents: Zone → Box/Group → IconNode/Actor, always passing
   `parentId` from the container's own `id`. **An op referenced later in the same `scene_apply`
   array (as a `parentId` or a connector's `fromId`/`toId`) must be given an explicit `id` — there
   is no automatic back-reference to an id `scene_apply` generated for an earlier op in the same
   call.** The engine applies the 16px inset automatically — just give each child an `at`/`w`/`h`
   inside its parent's bounds.
2. Place public entry points (actors, external systems) at the smallest `x`; increasing `x`
   rightward through the flow, per the west→east convention. A rough 200–300px horizontal
   spacing between tiers reads cleanly at the default 48×48 icon size.
3. Connect with `connect_nearest` (`{ kind: "connect_nearest", fromId, toId, connectorType,
direction?, flowColor?, label? }` inside `scene_apply`, or the standalone tool with the same
   fields) unless a specific port matters, in which case use `connect`/`{ kind: "connect" }` with
   explicit `{ elementId, port }` refs (`port` ∈ `n`/`e`/`s`/`w`/`center`). Pick `connectorType` and
   `flowColor` per `ibm-diagram-spec`'s nomenclature — don't default everything to `"connection"`.
   **These two are not interchangeable and their endpoint fields are shaped differently — do not
   mix them up:**
   - `connect_nearest` takes flat string ids: `{ kind: "connect_nearest", fromId: "a", toId: "b" }`.
     Never `from`/`to` here.
   - `connect` takes port-ref objects, not plain ids: `{ kind: "connect", from: { elementId: "a",
port: "e" }, to: { elementId: "b", port: "w" } }`. Never `fromId`/`toId` here.

   Sending the wrong shape (e.g. `connect_nearest` with `from`/`to` objects, or `connect` with
   bare `fromId`/`toId` strings) fails schema validation before the call ever reaches the
   document — if that happens, don't guess again with another variant; re-read this exact list and
   match one of the two shapes precisely.

4. Use `element_add_frame`/`{ kind: "add_frame" }` (`{ name, at, w, h }`) if the diagram has
   distinct sections worth presenting separately (e.g. multiple environments) — frames are always
   top-level.

### 5. Validate as you go, not just at the end

Call `lint()` after each meaningful chunk (a finished container, a finished flow), not only once at
the very end — catching a missing label or wrong container type early is cheaper than re-deriving
context after building ten more elements on top of it. Use `quickfix_apply_all()` to clear the easy
stuff immediately rather than accumulating diagnostics.

### 6. Hand off to `ibm-diagram-export`

Once the topology is complete, switch to the `ibm-diagram-export` skill for the final
validate → resolve → export sequence, and `doc_save({ path })` if the `.icad` source itself should
persist (export produces an SVG; saving the document is separate).

## Worked example

Requirement: _"Customers hit a public API gateway, which routes to an application tier running in a
private VPC subnet; the app talks to an object storage bucket."_

```
doc_create({ level: "high-level", seedExampleContent: false })
catalog_search({ query: "vpc" })                 → ibm-cloud/vpc
catalog_search({ query: "api gateway" })          → ibm-cloud/gateway-api
catalog_search({ query: "object storage" })       → ibm-cloud/object-storage-application

scene_apply({
  ops: [
    { kind: "add_zone", id: "vpc", zoneKind: "vpc", at: {x: 200, y: 60}, w: 700, h: 420, label: "VPC" },
    { kind: "add_group", id: "app-tier", parentId: "vpc", at: {x: 260, y: 140}, w: 380, h: 240, label: "Application tier" },
    { kind: "add_actor", id: "customer", at: {x: 40, y: 220}, label: "Customer" },
    { kind: "add_icon", id: "gateway", parentId: "app-tier", catalogRef: "ibm-cloud/gateway-api",
      at: {x: 300, y: 220}, label: "API Gateway" },
    { kind: "add_icon", id: "app", parentId: "app-tier", catalogRef: "ibm-cloud/instance-bx",
      at: {x: 540, y: 220}, label: "Application" },
    { kind: "add_icon", id: "storage", parentId: "vpc", catalogRef: "ibm-cloud/object-storage-application",
      at: {x: 760, y: 220}, label: "Object storage" },
    { kind: "connect_nearest", fromId: "customer", toId: "gateway", connectorType: "connection",
      direction: "unidirectional", flowColor: "public", label: "HTTPS TLS1.3:443" },
    { kind: "connect_nearest", fromId: "gateway", toId: "app", connectorType: "connection",
      direction: "unidirectional", flowColor: "private" },
    { kind: "connect_nearest", fromId: "app", toId: "storage", connectorType: "connection",
      direction: "unidirectional", flowColor: "private" },
  ]
})

lint()
quickfix_apply_all()
```

One `scene_apply` call built the whole section as a single undo step — containers (`vpc`, then
`app-tier`, which references `vpc` as its `parentId`) come before the elements placed inside them,
and every op the connectors reference (`customer`, `gateway`, `app`, `storage`) carries an explicit
`id` since nothing after the first op in the array can rely on an auto-generated one.

Then proceed to `ibm-diagram-export` to finish clean and produce the SVG.
