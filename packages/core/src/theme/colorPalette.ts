/**
 * IBM's 9 category primary colors and their light secondary-fill counterparts
 * (docs/05-ibm-spec-conformance.md#color-usage). Single source of truth shared by the renderer
 * (container fill lookup) and the linter (primary/secondary misuse rules) — these used to be two
 * independently hardcoded copies that had drifted (the linter's was missing the gray pair).
 */
export const PRIMARY_TO_SECONDARY_FILL: Record<string, string> = {
  "#fa4d56": "#fff1f1",
  "#ee5396": "#fff0f7",
  "#a56eff": "#f6f2ff",
  "#0f62fe": "#edf5ff",
  "#1192e8": "#e5f6ff",
  "#009d9a": "#d9fbfb",
  "#198038": "#defbe6",
  "#878d96": "#f2f4f8",
  "#8d8d8d": "#f4f4f4"
};

export const SECONDARY_TO_PRIMARY_FILL: Record<string, string> = Object.fromEntries(
  Object.entries(PRIMARY_TO_SECONDARY_FILL).map(([primary, secondary]) => [secondary, primary])
);
