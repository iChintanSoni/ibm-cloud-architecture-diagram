// Scene model
export * from "./scene/types.js";
export { Scene, type SceneChangeEvent } from "./scene/scene.js";
export { boundsOf } from "./scene/bounds.js";
export {
  accessibleName,
  accessibleRole,
  type AccessibleRole,
} from "./scene/accessibleName.js";
export { formatConnectorAnnotation } from "./scene/connectorAnnotation.js";

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
  batch,
  updateConformance,
  distributeElements,
  lockElements,
  unlockElements,
  hideElements,
  showElements,
} from "./commands/commands.js";
export { CommandBus } from "./commands/commandBus.js";

// Interaction
export { SelectionManager } from "./interaction/selection.js";
export {
  hitTest,
  hitTestAll,
  hitTestRect,
  type HitTestOptions,
} from "./interaction/hitTest.js";
export { computeTabOrder } from "./interaction/tabOrder.js";
export {
  CanvasController,
  type CanvasMode,
  type CanvasControllerOptions,
} from "./interaction/canvasController.js";
export {
  snapMove,
  PARENT_INSET,
  type SnapGuide,
  type SnapResult,
  type SnapOptions,
} from "./interaction/snapping.js";

// Rendering
export { SvgRenderer, type ResolvedTheme } from "./render/svgRenderer.js";
export { portPoint, type Point } from "./render/port.js";
export { clientPointToCanvas } from "./render/dom.js";
export {
  ViewportController,
  MIN_SCALE,
  MAX_SCALE,
  type ViewportState,
  type ViewportSize,
} from "./render/viewport.js";

// Routing
export {
  routeOrthogonal,
  pathCrossesObstacles,
  type Rect,
  type RoutePort,
  type SoftObstacle,
} from "./routing/orthogonalRouter.js";
export {
  routeConnectorInScene,
  connectorPathPoints,
} from "./routing/routeConnector.js";
export { pickPorts } from "./routing/pickPorts.js";

// Catalog
export { Catalog } from "./catalog/catalog.js";
export type {
  CatalogManifest,
  CatalogCategory,
  IconMeta,
  IconTier,
} from "./catalog/types.js";

// Linter
export { Linter } from "./linter/linter.js";
export {
  defaultRules,
  ruleMetadata,
  missingLabelRule,
  duplicateLabelRule,
  catalogIconRule,
  containerSemanticRule,
  containerBorderRule,
  primaryFillRule,
  secondaryStrokeRule,
  danglingConnectorRule,
  standardConnectorTypeRule,
  connectorPortRule,
  connectorCrossesObstacleRule,
  connectorAnnotationRule,
  nodeWithoutLocationRule,
  westEastFlowRule,
  iconGeometryRule,
} from "./linter/rules.js";
export { applyQuickFix, applyQuickFixes } from "./linter/quickFix.js";
export type {
  Diagnostic,
  Rule,
  RuleCategory,
  RuleContext,
  RuleMetadata,
  Severity,
} from "./linter/types.js";

// IO
export {
  ICAD_FORMAT,
  ICAD_VERSION,
  toIcad,
  fromIcad,
  applyIcad,
  type IcadDocument,
} from "./io/icad.js";
export {
  exportSvg,
  exportPng,
  type SvgExportOptions,
  type PngExportOptions,
} from "./io/export.js";

// Templates
export {
  DIAGRAM_TEMPLATES,
  createTemplateDocument,
  type CreateTemplateDocumentOptions,
  type DiagramTemplate,
  type DiagramTemplateId,
} from "./templates/templates.js";

// Public API
export {
  createEditor,
  Editor,
  ExportBlockedError,
  type BatchOperation,
  type BatchOpResult,
  type BatchOpError,
  type BatchResult,
  type ComplianceSummary,
  type ConnectOptions,
  type ContainerPlacementOptions,
  type CreateEditorOptions,
  type ElementPropertiesPatch,
  type ExportOptions,
  type FramePlacementOptions,
  type Interaction,
  type PlacementOptions,
} from "./api/createEditor.js";
