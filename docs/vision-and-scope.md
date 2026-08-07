# Vision & Scope

## The problem

IBM Cloud solution architects and developers produce architecture diagrams constantly — for
proposals, design reviews, runbooks, and documentation. Today the sanctioned path is **draw.io
with the IBM Cloud stencil library**. That works, but it has friction:

- **Conventions are manual.** The IBM spec has real rules — boxes are `deployedOn`, groups are
  `deployedTo`, nodes are square, actors are rounded, flow runs west→east, connectors follow a
  standard nomenclature — and nothing enforces them. Diagrams drift off-spec.
- **draw.io is a general tool.** It knows nothing about IBM semantics, so it can't validate,
  can't autocomplete a topology, and can't be driven cleanly by an agent.
- **No first-class file identity.** Diagrams live as generic `.drawio`/`.xml`, not as a format
  that _means_ "IBM Cloud architecture diagram."
- **No agent story.** Architects increasingly want an assistant to draft the first diagram from
  requirements. draw.io has no clean, semantic authoring API for that.

## The product

A **purpose-built IBM Cloud Architecture Diagram editor** — think "Excalidraw, but for IBM Cloud
architecture, and spec-aware." It renders crisp, IBM-Design-faithful diagrams, understands IBM
element semantics natively, saves to a first-class `.icad` file, and (from v2) can be driven by
agents through an MCP server and Agent Skills.

Product name (working): **ICAD — IBM Cloud Architecture Diagrams**. File extension: `.icad`.

## Who it's for

| Persona                    | Needs                                                                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Solution Architect**     | Fast, on-spec diagrams for proposals and reviews; templates for the IBM diagram levels; clean SVG/PNG export for decks and docs. |
| **Cloud Developer**        | Lightweight, file-in-repo diagrams that live next to code; keyboard-first editing; git-friendly diffs.                           |
| **AI Agent** (v2)          | A semantic authoring API to generate and validate a diagram from requirements, then hand it to a human to refine.                |
| **Reviewer / Stakeholder** | Receives an SVG that looks right, reads correctly, and can be reopened and edited.                                               |

## Goals

1. Produce **spec-compliant** IBM Cloud architecture diagrams by default.
2. Be **faster and more correct** than generic draw.io for IBM work.
3. Treat diagrams as **files** — local-first, private, git-friendly.
4. Make the diagram **machine-authorable** (v2) without compromising the human editor.
5. Meet **IBM Equal Access / WCAG 2.1 AA** as a first-class requirement, not an afterthought.

## Non-goals (v1)

- Not a general-purpose whiteboard or mind-mapping tool.
- Not a draw.io replacement / round-trip editor ([D7](./decision-log.md#d7--export-only-interop-svgpng-no-drawio-import--locked)).
- No real-time multi-user collaboration ([D4](./decision-log.md#d4--local-first-single-user-files--locked)).
- No cloud backend, accounts, or billing.
- No hand-drawn/sketch aesthetic ([D5](./decision-log.md#d5--crisp--professional-visual-style--locked)).

## Positioning

Official IBM-internal tool ([D17](./decision-log.md#d17--official--ibm-internal-tool--locked)). This grants IBM branding and sanctioned use of the
[IBM Cloud architecture icons](https://github.com/IBM-Cloud/architecture-icons), and it means
releases are gated by **IBM Design sign-off**. Distribution is internal first; a public open-source
posture is out of scope unless IBM decides otherwise.

## Success criteria

- An architect can go from blank canvas to a correct system-context diagram in **under 10 minutes**.
- Exported SVGs are **visually indistinguishable** from IBM-spec draw.io output to a reviewer.
- The linter catches **>90%** of common spec violations with a one-click quick-fix.
- (v2) An agent can generate a **valid, non-trivial** topology from a paragraph of requirements
  that a human accepts with minor edits.

## Reference material

- [IBM Cloud — Creating an architecture diagram](https://cloud.ibm.com/docs/architecture-framework?topic=architecture-framework-architecture-diagram)
- [IBM-Cloud/architecture-icons](https://github.com/IBM-Cloud/architecture-icons)
- [IBM Design Language](https://www.ibm.com/design/language/) · [Carbon Design System](https://carbondesignsystem.com/) · [IBM Equal Access Toolkit](https://www.ibm.com/able/toolkit/)
