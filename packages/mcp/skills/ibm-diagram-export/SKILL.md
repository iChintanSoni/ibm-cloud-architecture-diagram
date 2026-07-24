---
name: ibm-diagram-export
description: Validate a finished ICAD diagram against the IBM conformance linter, resolve diagnostics with quick-fixes, then export a canonical SVG (optionally with an embedded re-editable .icad source). Use after ibm-diagram-authoring, or whenever asked to check, clean up, or export an existing .icad document via the ICAD MCP server.
---

# Validating and exporting an ICAD diagram

The finish line for any document built through `ibm-diagram-authoring`: drive it to zero (or
acceptable) diagnostics, then export. Every step here is an MCP tool call against the currently
open document (`doc_create`/`doc_open` must already have run).

## Workflow

### 1. Lint

```
lint()
```

Returns `{ diagnostics[], counts: { error, warn, info }, blocked }`. `blocked` tells you whether
`export_diagram` would refuse right now under the document's export gate (`"warn"`, the default,
never blocks; `"block"` refuses while any `error`-severity diagnostic remains).

### 2. Resolve diagnostics

Prefer the bulk path first — it's one undo step:

```
quickfix_apply_all()                    // every fixable diagnostic
quickfix_apply_all({ ruleId: "..." })   // scoped to one rule, if you want to fix incrementally
```

For a diagnostic you want to handle individually (or after inspecting `quickFixLabel` to decide
whether the fix is actually what you want), use the per-diagnostic form:

```
quickfix_apply({ diagnosticId })
```

**`diagnosticId` values go stale the moment you apply any fix** (document mutated, ids from the old
`lint()` no longer resolve) — always call `lint()` again after `quickfix_apply`/`quickfix_apply_all`
before referencing more diagnostic ids.

Diagnostics with `hasQuickFix: false` need a manual fix — typically `element_update` (wrong label,
wrong style), `connect`/`connect_nearest` (dangling/missing connector), or `element_update` with a
`catalogRef` change (Node missing a catalog icon). Re-lint after.

### 3. Loop until clean (or deliberately not)

Repeat lint → resolve until `counts.error === 0`, or until remaining errors are a conscious choice
(e.g. the user explicitly wants a partial/WIP diagram and the export gate is `"warn"`, so it won't
block anyway). Don't silently loop forever on a diagnostic with no quick-fix and no obvious manual
resolution — surface it rather than guessing at a fix that might contradict the requirement.

### 4. Export

```
export_diagram({ format: "svg" })
export_diagram({ format: "svg", embedSource: true, path: "diagram.svg" })
```

- `format` is currently `"svg"` only — **PNG isn't supported by this server** (it needs a real
  browser canvas the headless server doesn't have). Don't attempt `format: "png"`; it fails schema
  validation. Say so if the user specifically asked for PNG.
- `embedSource` (default per the document's own export settings) controls whether the re-editable
  `.icad` JSON is embedded in the SVG — keep it on unless the user wants a public/external asset
  with no editable source attached.
- Pass `path` to write the file directly; omit it to get the SVG back inline as text (useful when
  the caller wants to inspect or relay the bytes rather than have the server touch disk).
- If the export gate is `"block"` and errors remain, the call fails with a message listing every
  blocking diagnostic (`ruleId: message`) — go back to step 2, don't retry the same call unchanged.

### 5. Don't forget the `.icad` source

`export_diagram` only produces the SVG. If the user wants the editable document persisted too
(normally yes, unless they only asked for "an image"), also call:

```
doc_save({ path: "diagram.icad" })
```

`doc_save` defaults to the path last used by `doc_open`/`doc_save` for this document if `path` is
omitted — but a freshly `doc_create`d document has never been saved, so pass a path the first time.

## Quick reference

| Situation | Call |
|---|---|
| Check current state | `lint()` |
| Fix everything fixable | `quickfix_apply_all()` |
| Fix one rule only | `quickfix_apply_all({ ruleId })` |
| Fix one specific diagnostic | `quickfix_apply({ diagnosticId })` (re-`lint()` after) |
| Export canonical SVG | `export_diagram({ format: "svg" })` |
| Export without editable source | `export_diagram({ format: "svg", embedSource: false })` |
| Persist the `.icad` document | `doc_save({ path })` |
