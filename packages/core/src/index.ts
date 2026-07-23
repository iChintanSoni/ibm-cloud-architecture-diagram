// Scene model
export * from "./scene/types.js";
export { Scene, type SceneChangeEvent } from "./scene/scene.js";

// Commands
export type { Command } from "./commands/types.js";
export {
  addElement,
  removeElement,
  updateElement,
  moveElements,
  reparentElement,
  setManualWaypoints,
  autoRouteConnector,
  batch
} from "./commands/commands.js";
export { CommandBus } from "./commands/commandBus.js";

// Interaction
export { SelectionManager } from "./interaction/selection.js";
export { hitTest } from "./interaction/hitTest.js";

// Rendering
export { SvgRenderer, type ResolvedTheme } from "./render/svgRenderer.js";
export { portPoint, type Point } from "./render/port.js";

// Routing
export { routeOrthogonal, pathCrossesObstacles, type Rect, type RoutePort } from "./routing/orthogonalRouter.js";
export { routeConnectorInScene, connectorPathPoints } from "./routing/routeConnector.js";

// Catalog
export { Catalog } from "./catalog/catalog.js";
export type { CatalogManifest, CatalogCategory, IconMeta, IconTier } from "./catalog/types.js";

// Linter
export { Linter } from "./linter/linter.js";
export {
  defaultRules,
  missingLabelRule,
  danglingConnectorRule,
  connectorCrossesObstacleRule,
  groupWithoutBoxAncestorRule
} from "./linter/rules.js";
export type { Diagnostic, Rule, Severity } from "./linter/types.js";

// IO
export { ICAD_FORMAT, ICAD_VERSION, toIcad, fromIcad, applyIcad, type IcadDocument } from "./io/icad.js";
export { exportSvg, exportPng, type SvgExportOptions, type PngExportOptions } from "./io/export.js";

// Public API
export { createEditor, Editor, type CreateEditorOptions, type ExportOptions } from "./api/createEditor.js";
