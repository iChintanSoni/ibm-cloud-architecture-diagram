import { Search } from "@carbon/react";
import type { Catalog, IconMeta } from "@icad/core";
import { useMemo, useState } from "react";
import { groupLibraryIcons } from "./libraryModel.js";
import {
  containerKindLabel,
  confirmedContainerPresets,
  type PrimitiveKind,
  type ContainerPreset
} from "./presets.js";

export type LibraryPlacement =
  | { type: "icon"; icon: IconMeta }
  | { type: "primitive"; kind: PrimitiveKind }
  | { type: "preset"; preset: ContainerPreset };

export interface LibraryPanelProps {
  catalog: Catalog;
  activePlacement?: LibraryPlacement | undefined;
  /** `immediate` is true for a keyboard activation (Enter/Space), which has no canvas click to
   * follow — the host should place it straight away rather than arm a mouse-aiming mode. */
  onChoose: (placement: LibraryPlacement, immediate?: boolean) => void;
}

function placementKey(placement: LibraryPlacement | undefined): string | undefined {
  if (!placement) return undefined;
  if (placement.type === "icon") return `icon:${placement.icon.id}`;
  if (placement.type === "preset") return `preset:${placement.preset.id}`;
  return `primitive:${placement.kind}`;
}

export function LibraryPanel({ catalog, activePlacement, onChoose }: LibraryPanelProps) {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => groupLibraryIcons(catalog, query), [catalog, query]);
  const activeKey = placementKey(activePlacement);
  const resultCount = groups.reduce((total, group) => total + group.icons.length, 0);

  return (
    <aside className="icad-library" aria-label="Diagram library">
      <div className="icad-library__heading">
        <h2>Library</h2>
        {activePlacement && <span>Choose a point on the canvas</span>}
      </div>
      <Search
        size="sm"
        labelText="Search IBM Cloud icons"
        placeholder="Search icons"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      {!query && (
        <>
          <section className="icad-library__section">
            <h3>Containers &amp; frames</h3>
            <div className="icad-library__grid">
              {(["box", "group", "zone", "frame"] as const).map((kind) => {
                const item: LibraryPlacement = { type: "primitive", kind };
                const key = placementKey(item);
                return (
                  <button
                    key={kind}
                    type="button"
                    className="icad-library__item"
                    aria-pressed={activeKey === key}
                    onClick={(event) => onChoose(item, event.detail === 0)}
                  >
                    <span className={`icad-library__primitive icad-library__primitive--${kind}`} />
                    <span>{containerKindLabel(kind)}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="icad-library__section">
            <h3>Confirmed presets</h3>
            <div className="icad-library__presets">
              {confirmedContainerPresets.map((preset) => {
                const item: LibraryPlacement = { type: "preset", preset };
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className="icad-library__preset"
                    aria-pressed={activeKey === placementKey(item)}
                    onClick={(event) => onChoose(item, event.detail === 0)}
                  >
                    <span style={{ borderColor: preset.color }} />
                    {preset.name}
                  </button>
                );
              })}
            </div>
          </section>
        </>
      )}

      <div className="icad-library__results" aria-live="polite">
        {query && <p className="icad-library__count">{resultCount} matching icons</p>}
        {groups.map(({ category, icons }) => (
          <details key={category.id} open={Boolean(query) || category.id === "compute"}>
            <summary>
              {category.name} <span>{icons.length}</span>
            </summary>
            <div className="icad-library__grid">
              {icons.map((icon) => {
                const item: LibraryPlacement = { type: "icon", icon };
                return (
                  <button
                    key={icon.id}
                    type="button"
                    className="icad-library__item"
                    title={icon.name}
                    aria-pressed={activeKey === placementKey(item)}
                    onClick={(event) => onChoose(item, event.detail === 0)}
                  >
                    {/* Mirrors SvgRenderer's iconNode/actor tile (packages/core/src/render/svgRenderer.ts):
                        a solid category-color tile (square, or a circle for "rounded"/actor-style
                        icons) with the catalog's white glyph inset on top — the glyph asset is always
                        white by design (D25, docs/00-decision-log.md), so without a tile behind it
                        here it was rendering invisibly on the panel's own light background. viewBox is
                        24 (GLYPH_VIEWBOX_SIZE in svgRenderer.ts), not 20 — a stale leftover from before
                        M14 moved glyph geometry to a 24x24 frame; declaring 20 clipped the outer few
                        units of any glyph that actually uses them. */}
                    <svg viewBox="0 0 48 48" aria-hidden="true">
                      {icon.container === "rounded" ? (
                        <circle cx={24} cy={24} r={24} fill={icon.color ?? "#000000"} />
                      ) : (
                        <rect width={48} height={48} fill={icon.color ?? "#8d8d8d"} />
                      )}
                      <svg x={12} y={12} width={24} height={24} viewBox="0 0 24 24">
                        <g dangerouslySetInnerHTML={{ __html: catalog.svg(icon.id) ?? "" }} />
                      </svg>
                    </svg>
                    <span>{icon.name}</span>
                  </button>
                );
              })}
            </div>
          </details>
        ))}
        {query && resultCount === 0 && <p className="icad-library__empty">No icons match “{query}”.</p>}
      </div>
    </aside>
  );
}
