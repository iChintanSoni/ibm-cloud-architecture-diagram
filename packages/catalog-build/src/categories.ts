/**
 * Maps upstream `svg/<folder>` names (IBM-Cloud/architecture-icons) to catalog categories.
 * Folders absent from this table are skipped entirely — see SKIPPED_FOLDERS below for why.
 */
export const CATEGORY_BY_FOLDER: Record<string, { id: string; name: string }> = {
  AI: { id: "ai", name: "AI" },
  Actors: { id: "actors", name: "Actors" },
  Applications: { id: "applications", name: "Applications" },
  Compute: { id: "compute", name: "Compute" },
  "Data & Storage": { id: "data", name: "Data" },
  DevOps: { id: "devops", name: "DevOps" },
  "Extra Storage": { id: "storage", name: "Storage" },
  Networking: { id: "network", name: "Network" },
  Observability: { id: "observability", name: "Observability" },
  Security: { id: "security", name: "Security" }
};

/**
 * Folders intentionally excluded from the source tree, with why:
 * - "Extra Storage 2": byte-identical duplicate of "Extra Storage".
 * - "Sketch Files": empty (no .svg assets).
 * - "DevOps/Network": a near-complete duplicate of the top-level "Networking" folder
 *   (36 of its ~50 icons collide by name); "Networking" is treated as the canonical source.
 */
export const SKIPPED_FOLDERS = new Set(["Extra Storage 2", "Sketch Files"]);
export const SKIPPED_SUBPATHS = ["DevOps/Network"];
