import {
  Button,
  Checkbox,
  NumberInput,
  Select,
  SelectItem,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Tag,
  TextInput,
  TreeNode,
  TreeView,
} from "@carbon/react";
import {
  ChevronDown,
  ChevronUp,
  Locked,
  Play,
  Stop,
  Unlocked,
  View,
  ViewOff,
} from "@carbon/react/icons";
import type {
  ConnectorType,
  ElementId,
  ElementPropertiesPatch,
  FrameElement,
  SceneElement,
  ZoneKind,
} from "@icad/core";
import type { ReactNode } from "react";
import {
  buildLayerTree,
  elementDisplayName,
  eligibleParentElements,
  type LayerNode,
} from "./inspectorModel.js";

const CONNECTION_TYPES: ConnectorType[] = [
  "logical-connection",
  "connection",
  "physical-connection",
  "tunneling-connection",
  "traffic-through-double-tunnel",
];

/** The annotation's name field reads "Encapsulation NAME" for these, "Protocol/Application NAME" otherwise (packages/core/docs/ibm-spec-conformance.md#connector-nomenclature). */
const TUNNEL_TYPES: ConnectorType[] = [
  "tunneling-connection",
  "traffic-through-double-tunnel",
];

const RELATIONSHIP_TYPES: ConnectorType[] = [
  "dependency",
  "association",
  "aggregation",
  "composition",
  "implementation",
  "extends",
];

const CONNECTOR_TYPES = [...CONNECTION_TYPES, ...RELATIONSHIP_TYPES];

/**
 * IBM's own connector names (packages/core/docs/ibm-spec-conformance.md#connector-nomenclature), not the
 * raw kebab-case schema value. "tunneling-connection" is labeled "Traffic Through Tunnel/
 * Encapsulation" — what `Connectors.drawio` actually names that line; "Tunneling Connection" is
 * a caption in IBM's own stencil with no edge/line style of its own, not a distinct connector.
 */
const CONNECTOR_TYPE_LABELS: Record<ConnectorType, string> = {
  "logical-connection": "Logical Connection / Link",
  connection: "Connection",
  "physical-connection": "Physical Connection",
  "tunneling-connection": "Traffic Through Tunnel/Encapsulation",
  "traffic-through-double-tunnel": "Traffic Through DoubleTunnel/Encapsulation",
  dependency: "Dependency",
  association: "Association",
  aggregation: "Aggregation",
  composition: "Composition",
  implementation: "Implementation",
  extends: "Extends",
};

/** IBM's 9 primary + 9 secondary palette colors for the IBM-palette swatches (D28, M20). */
const IBM_PALETTE_PRIMARIES = [
  "#fa4d56",
  "#ee5396",
  "#a56eff",
  "#0f62fe",
  "#1192e8",
  "#009d9a",
  "#198038",
  "#878d96",
  "#8d8d8d",
] as const;

export interface InspectorPanelProps {
  elements: SceneElement[];
  selectedIds: ElementId[];
  validationCount: number;
  validationContent: ReactNode;
  frames: FrameElement[];
  presentingFrameId?: ElementId | undefined;
  onJumpToFrame: (id: ElementId) => void;
  onTogglePresent: () => void;
  onPresentStep: (direction: 1 | -1) => void;
  onSelect: (id: ElementId) => void;
  onUpdate: (id: ElementId, patch: ElementPropertiesPatch) => void;
  onReparent: (id: ElementId, parentId: ElementId | undefined) => void;
  /** Resets a manually-routed connector back to auto-routing (M19). */
  onResetConnectorRouting?: (id: ElementId) => void;
  /** Toggles lock on a single element from the Layers tab (M18.5). */
  onToggleLockElement: (id: ElementId) => void;
  /** Toggles hide on a single element from the Layers tab (M18.5). */
  onToggleHideElement: (id: ElementId) => void;
}

function labelForType(type: SceneElement["type"]): string {
  switch (type) {
    case "iconNode":
      return "Icon";
    case "box":
      return "Box";
    case "group":
      return "Group";
    case "zone":
      return "Boundary";
    case "actor":
      return "Actor";
    case "connector":
      return "Connector";
    case "text":
      return "Text";
    case "frame":
      return "Frame";
  }
}

function LayerBranch({
  node,
  elementsById,
  onSelect,
  onToggleLock,
  onToggleHide,
}: {
  node: LayerNode;
  elementsById: Map<ElementId, SceneElement>;
  onSelect: (id: ElementId) => void;
  onToggleLock: (id: ElementId) => void;
  onToggleHide: (id: ElementId) => void;
}) {
  const { element } = node;
  return (
    <TreeNode
      id={element.id}
      value={element.id}
      isExpanded={node.children.length > 0}
      label={
        <span className="icad-layers__label">
          <span>{elementDisplayName(element, elementsById)}</span>
          <small>{labelForType(element.type)}</small>
          <span className="icad-layers__actions">
            <button
              type="button"
              className="icad-layers__action-btn"
              aria-label={element.hidden ? "Show element" : "Hide element"}
              title={element.hidden ? "Show" : "Hide"}
              onClick={(e) => {
                e.stopPropagation();
                onToggleHide(element.id);
              }}
            >
              {element.hidden ? <ViewOff size={16} /> : <View size={16} />}
            </button>
            <button
              type="button"
              className="icad-layers__action-btn"
              aria-label={element.locked ? "Unlock element" : "Lock element"}
              title={element.locked ? "Unlock" : "Lock"}
              onClick={(e) => {
                e.stopPropagation();
                onToggleLock(element.id);
              }}
            >
              {element.locked ? <Locked size={16} /> : <Unlocked size={16} />}
            </button>
          </span>
        </span>
      }
      onSelect={(_event, selectedNode) => {
        if (selectedNode.id) onSelect(selectedNode.id);
      }}
    >
      {node.children.map((child) => (
        <LayerBranch
          key={child.element.id}
          node={child}
          elementsById={elementsById}
          onSelect={onSelect}
          onToggleLock={onToggleLock}
          onToggleHide={onToggleHide}
        />
      ))}
    </TreeNode>
  );
}

function commitNumber(
  id: ElementId,
  field: "x" | "y" | "w" | "h" | "order",
  raw: string | number,
  onUpdate: InspectorPanelProps["onUpdate"],
) {
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value)) return;
  if ((field === "w" || field === "h") && value < 1) return;
  onUpdate(id, { [field]: value });
}

function ElementProperties({
  element,
  elements,
  elementsById,
  onUpdate,
  onReparent,
  onResetConnectorRouting,
}: {
  element: SceneElement;
  elements: SceneElement[];
  elementsById: Map<ElementId, SceneElement>;
  onUpdate: InspectorPanelProps["onUpdate"];
  onReparent: InspectorPanelProps["onReparent"];
  onResetConnectorRouting?: InspectorPanelProps["onResetConnectorRouting"];
}) {
  const parentOptions = eligibleParentElements(elements, element.id);
  const label =
    element.type === "text"
      ? element.text
      : element.type === "frame"
        ? element.name
        : (element.label?.text ?? "");

  const commitLabel = (value: string) => {
    if (element.type === "text") onUpdate(element.id, { text: value });
    else if (element.type === "frame") onUpdate(element.id, { name: value });
    else onUpdate(element.id, { label: { ...element.label, text: value } });
  };

  const commitAnnotation = (
    field: "name" | "security" | "port",
    value: string,
  ) => {
    if (element.type !== "connector") return;
    const current = element.annotation ?? { name: "" };
    onUpdate(element.id, { annotation: { ...current, [field]: value } });
  };

  return (
    <div className="icad-properties">
      <div className="icad-properties__identity">
        <div>
          <span className="icad-eyebrow">Selected element</span>
          <h2>{elementDisplayName(element, elementsById)}</h2>
        </div>
        <Tag type="blue">{labelForType(element.type)}</Tag>
      </div>

      <TextInput
        key={`${element.id}:label:${label}`}
        id={`icad-property-label-${element.id}`}
        size="sm"
        labelText={
          element.type === "text"
            ? "Text"
            : element.type === "frame"
              ? "Name"
              : "Label"
        }
        defaultValue={label}
        onBlur={(event) => commitLabel(event.target.value)}
      />

      {element.type !== "connector" && (
        <>
          <div className="icad-property-grid">
            {(["x", "y", "w", "h"] as const).map((field) => (
              <NumberInput
                key={`${element.id}:${field}:${element[field]}`}
                id={`icad-property-${field}-${element.id}`}
                size="sm"
                label={field.toUpperCase()}
                {...(field === "w" || field === "h" ? { min: 1 } : {})}
                defaultValue={element[field]}
                // Selects the existing value on focus so a click-then-type replaces it instead of
                // inserting at the click position — a bare <input type="number"> has no such
                // behavior by default, so typing into an already-populated field silently
                // concatenated (e.g. clicking a "48" width and typing "50" produced "4850").
                onFocus={(event) => event.target.select()}
                onBlur={(event) =>
                  commitNumber(element.id, field, event.target.value, onUpdate)
                }
                // The stepper +/- buttons already have focus when clicked (they don't move focus
                // away from the text input, since it was never focused to begin with), so they
                // never trigger the input's onBlur above — Carbon's dedicated onClick prop is what
                // actually fires for a stepper click (onChange would too, but also on every
                // keystroke while typing, which would spam the undo stack for a manual edit).
                onClick={(_event, state) =>
                  state &&
                  commitNumber(element.id, field, state.value, onUpdate)
                }
              />
            ))}
          </div>

          {/* Rotation (M20, packages/core/docs/canvas-parity-plan.md): only for non-frame elements.
              Frames are excluded from all direct-manipulation rotation operations. */}
          {element.type !== "frame" && (
            <NumberInput
              key={`${element.id}:rotation:${element.rotation ?? 0}`}
              id={`icad-property-rotation-${element.id}`}
              size="sm"
              label="Rotation (°)"
              min={0}
              max={359}
              defaultValue={element.rotation ?? 0}
              onFocus={(event) => event.target.select()}
              onBlur={(event) => {
                const v = Number(event.target.value);
                if (Number.isFinite(v))
                  onUpdate(element.id, {
                    rotation: ((Math.round(v) % 360) + 360) % 360,
                  });
              }}
              onClick={(_event, state) => {
                if (state)
                  onUpdate(element.id, {
                    rotation:
                      ((Math.round(Number(state.value)) % 360) + 360) % 360,
                  });
              }}
            />
          )}

          <Select
            id={`icad-property-parent-${element.id}`}
            size="sm"
            labelText="Parent container"
            value={element.parentId ?? ""}
            onChange={(event) =>
              onReparent(element.id, event.target.value || undefined)
            }
          >
            <SelectItem value="" text="Canvas root" />
            {parentOptions.map((parent) => (
              <SelectItem
                key={parent.id}
                value={parent.id}
                text={`${elementDisplayName(parent)} · ${labelForType(parent.type)}`}
              />
            ))}
          </Select>
        </>
      )}

      {"catalogRef" in element && element.catalogRef && (
        <TextInput
          id={`icad-property-catalog-${element.id}`}
          size="sm"
          labelText="IBM catalog reference"
          value={element.catalogRef}
          readOnly
        />
      )}

      {element.type === "zone" && (
        <Select
          id={`icad-property-zone-kind-${element.id}`}
          size="sm"
          labelText="Boundary kind"
          value={element.zoneKind}
          onChange={(event) =>
            onUpdate(element.id, { zoneKind: event.target.value as ZoneKind })
          }
        >
          {(["az", "on-prem"] as const).map((kind) => (
            <SelectItem key={kind} value={kind} text={kind} />
          ))}
        </Select>
      )}

      {element.type === "frame" && (
        <NumberInput
          key={`${element.id}:order:${element.order}`}
          id={`icad-property-order-${element.id}`}
          size="sm"
          label="Presentation order"
          min={0}
          defaultValue={element.order}
          onFocus={(event) => event.target.select()}
          onBlur={(event) =>
            commitNumber(element.id, "order", event.target.value, onUpdate)
          }
          onClick={(_event, state) =>
            state && commitNumber(element.id, "order", state.value, onUpdate)
          }
        />
      )}

      {element.type === "connector" && (
        <>
          <Select
            id={`icad-property-connector-type-${element.id}`}
            size="sm"
            labelText="Connector type"
            value={element.connectorType}
            onChange={(event) =>
              onUpdate(element.id, {
                connectorType: event.target.value as ConnectorType,
              })
            }
          >
            {CONNECTOR_TYPES.map((type) => (
              <SelectItem
                key={type}
                value={type}
                text={CONNECTOR_TYPE_LABELS[type]}
              />
            ))}
          </Select>
          {CONNECTION_TYPES.includes(element.connectorType) && (
            <>
              <Select
                id={`icad-property-direction-${element.id}`}
                size="sm"
                labelText="Direction"
                value={element.direction ?? "unidirectional"}
                onChange={(event) =>
                  onUpdate(element.id, {
                    direction: event.target.value as
                      "unidirectional" | "bidirectional",
                  })
                }
              >
                <SelectItem value="unidirectional" text="Unidirectional" />
                <SelectItem value="bidirectional" text="Bidirectional" />
              </Select>
              <Select
                id={`icad-property-flow-${element.id}`}
                size="sm"
                labelText="Flow color"
                value={element.flowColor ?? "private"}
                onChange={(event) =>
                  onUpdate(element.id, {
                    flowColor: event.target.value as "private" | "public",
                  })
                }
              >
                <SelectItem value="private" text="Private" />
                <SelectItem value="public" text="Public" />
              </Select>
              <TextInput
                key={`${element.id}:annotation-name:${element.annotation?.name ?? ""}`}
                id={`icad-property-annotation-name-${element.id}`}
                size="sm"
                labelText={
                  TUNNEL_TYPES.includes(element.connectorType)
                    ? "Encapsulation name"
                    : "Protocol/Application name"
                }
                defaultValue={element.annotation?.name ?? ""}
                onBlur={(event) => commitAnnotation("name", event.target.value)}
              />
              <div className="icad-property-grid">
                <TextInput
                  key={`${element.id}:annotation-security:${element.annotation?.security ?? ""}`}
                  id={`icad-property-annotation-security-${element.id}`}
                  size="sm"
                  labelText="Encryption/Security"
                  placeholder="e.g. TLS1.3"
                  defaultValue={element.annotation?.security ?? ""}
                  onBlur={(event) =>
                    commitAnnotation("security", event.target.value)
                  }
                />
                <TextInput
                  key={`${element.id}:annotation-port:${element.annotation?.port ?? ""}`}
                  id={`icad-property-annotation-port-${element.id}`}
                  size="sm"
                  labelText="Port"
                  placeholder="e.g. 443"
                  defaultValue={element.annotation?.port ?? ""}
                  onBlur={(event) =>
                    commitAnnotation("port", event.target.value)
                  }
                />
              </div>
            </>
          )}
          <TextInput
            key={`${element.id}:sequence:${element.sequence ?? ""}`}
            id={`icad-property-sequence-${element.id}`}
            size="sm"
            labelText="Sequence"
            placeholder="e.g. 1, 2a"
            defaultValue={element.sequence ?? ""}
            onBlur={(event) =>
              onUpdate(element.id, { sequence: event.target.value })
            }
          />

          {/* Reset-to-auto-routing (M19): only shown when the connector has manual waypoints. */}
          {element.routing === "manual" && onResetConnectorRouting && (
            <Button
              kind="ghost"
              size="sm"
              onClick={() => onResetConnectorRouting(element.id)}
            >
              Reset routing
            </Button>
          )}
        </>
      )}

      {/* Color picker (M20, packages/core/docs/canvas-parity-plan.md, D28): IBM 9-pair palette swatches +
          a free color input for deliberate off-spec one-offs. Shown for all non-connector elements
          (connectors use flowColor, not style.stroke/fill for their semantic color).
          The linter's `off-palette-color` rule flags non-palette choices as advisory. */}
      {element.type !== "connector" && (
        <div className="icad-color-picker">
          <div className="icad-color-picker__row">
            <span className="icad-color-picker__label">Stroke</span>
            <div className="icad-color-picker__swatches">
              {IBM_PALETTE_PRIMARIES.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`icad-color-swatch${element.style?.stroke === color ? " icad-color-swatch--active" : ""}`}
                  style={{ background: color }}
                  aria-label={`Set stroke to ${color}`}
                  title={color}
                  onClick={() =>
                    onUpdate(element.id, { style: { stroke: color } })
                  }
                />
              ))}
            </div>
            <input
              type="color"
              className="icad-color-picker__free"
              aria-label="Custom stroke color"
              title="Custom stroke color"
              value={element.style?.stroke ?? "#8d8d8d"}
              onChange={(e) =>
                onUpdate(element.id, { style: { stroke: e.target.value } })
              }
            />
          </div>
          <div className="icad-color-picker__row">
            <span className="icad-color-picker__label">Fill</span>
            <div className="icad-color-picker__swatches">
              {IBM_PALETTE_PRIMARIES.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`icad-color-swatch${element.style?.fill === color ? " icad-color-swatch--active" : ""}`}
                  style={{ background: color }}
                  aria-label={`Set fill to ${color}`}
                  title={color}
                  onClick={() =>
                    onUpdate(element.id, { style: { fill: color } })
                  }
                />
              ))}
            </div>
            <input
              type="color"
              className="icad-color-picker__free"
              aria-label="Custom fill color"
              title="Custom fill color"
              value={element.style?.fill ?? "#f4f4f4"}
              onChange={(e) =>
                onUpdate(element.id, { style: { fill: e.target.value } })
              }
            />
          </div>
        </div>
      )}

      {/* Lock / Hide (M18.4, packages/core/docs/canvas-parity-plan.md) */}
      <div className="icad-properties__lock-hide">
        <Checkbox
          id={`icad-property-locked-${element.id}`}
          labelText="Locked"
          checked={element.locked ?? false}
          onChange={(_event, { checked }) =>
            onUpdate(element.id, { locked: checked })
          }
        />
        <Checkbox
          id={`icad-property-hidden-${element.id}`}
          labelText="Hidden"
          checked={element.hidden ?? false}
          onChange={(_event, { checked }) =>
            onUpdate(element.id, { hidden: checked })
          }
        />
      </div>

      <dl className="icad-properties__metadata">
        <div>
          <dt>ID</dt>
          <dd>{element.id}</dd>
        </div>
        <div>
          <dt>Semantic</dt>
          <dd>{element.semantic}</dd>
        </div>
      </dl>
    </div>
  );
}

function FramesPanel({
  frames,
  presentingFrameId,
  onJumpToFrame,
  onTogglePresent,
  onPresentStep,
}: Pick<
  InspectorPanelProps,
  | "frames"
  | "presentingFrameId"
  | "onJumpToFrame"
  | "onTogglePresent"
  | "onPresentStep"
>) {
  const ordered = [...frames].sort((a, b) => a.order - b.order);
  const presenting = presentingFrameId !== undefined;

  if (ordered.length === 0) {
    return (
      <div className="icad-inspector__empty">
        <h2>No frames yet</h2>
        <p>
          Add a Frame from the library to split the diagram into sections and
          drive Find/presentation.
        </p>
      </div>
    );
  }

  return (
    <div className="icad-frames">
      <div className="icad-frames__toolbar">
        <Button
          kind={presenting ? "danger--tertiary" : "tertiary"}
          size="sm"
          renderIcon={presenting ? Stop : Play}
          onClick={onTogglePresent}
        >
          {presenting ? "Exit presentation" : "Present frames"}
        </Button>
        {presenting && (
          <>
            <Button
              kind="ghost"
              size="sm"
              hasIconOnly
              iconDescription="Previous frame"
              renderIcon={ChevronUp}
              onClick={() => onPresentStep(-1)}
            />
            <Button
              kind="ghost"
              size="sm"
              hasIconOnly
              iconDescription="Next frame"
              renderIcon={ChevronDown}
              onClick={() => onPresentStep(1)}
            />
          </>
        )}
      </div>
      <ol className="icad-frames__list">
        {ordered.map((frame) => (
          <li key={frame.id}>
            <button
              type="button"
              className="icad-frames__item"
              data-active={frame.id === presentingFrameId ? "true" : "false"}
              onClick={() => onJumpToFrame(frame.id)}
            >
              <span className="icad-frames__order">{frame.order}</span>
              <span>{frame.name.trim() || "Untitled frame"}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function InspectorPanel({
  elements,
  selectedIds,
  validationCount,
  validationContent,
  frames,
  presentingFrameId,
  onJumpToFrame,
  onTogglePresent,
  onPresentStep,
  onSelect,
  onUpdate,
  onReparent,
  onResetConnectorRouting,
  onToggleLockElement,
  onToggleHideElement,
}: InspectorPanelProps) {
  const selected =
    selectedIds.length === 1
      ? elements.find((element) => element.id === selectedIds[0])
      : undefined;
  const layers = buildLayerTree(elements);
  const elementsById = new Map(
    elements.map((element) => [element.id, element]),
  );

  return (
    <aside className="icad-inspector" aria-label="Diagram inspector">
      <Tabs defaultSelectedIndex={0}>
        <TabList aria-label="Inspector views" contained fullWidth>
          <Tab>Properties</Tab>
          <Tab>Layers</Tab>
          <Tab>Frames ({frames.length})</Tab>
          <Tab>Validation ({validationCount})</Tab>
        </TabList>
        <TabPanels>
          <TabPanel className="icad-inspector__panel">
            {selected ? (
              <ElementProperties
                element={selected}
                elements={elements}
                elementsById={elementsById}
                onUpdate={onUpdate}
                onReparent={onReparent}
                onResetConnectorRouting={onResetConnectorRouting}
              />
            ) : (
              <div className="icad-inspector__empty">
                <h2>
                  {selectedIds.length > 1
                    ? `${selectedIds.length} elements selected`
                    : "Nothing selected"}
                </h2>
                <p>
                  Select an element on the canvas or in Layers to edit its
                  properties.
                </p>
              </div>
            )}
          </TabPanel>
          <TabPanel className="icad-inspector__panel">
            {layers.length > 0 ? (
              <TreeView label="Diagram layers" size="sm" selected={selectedIds}>
                {layers.map((node) => (
                  <LayerBranch
                    key={node.element.id}
                    node={node}
                    elementsById={elementsById}
                    onSelect={onSelect}
                    onToggleLock={onToggleLockElement}
                    onToggleHide={onToggleHideElement}
                  />
                ))}
              </TreeView>
            ) : (
              <div className="icad-inspector__empty">
                <h2>No layers yet</h2>
                <p>
                  Place an IBM Cloud element to start the diagram hierarchy.
                </p>
              </div>
            )}
          </TabPanel>
          <TabPanel className="icad-inspector__panel">
            <FramesPanel
              frames={frames}
              presentingFrameId={presentingFrameId}
              onJumpToFrame={onJumpToFrame}
              onTogglePresent={onTogglePresent}
              onPresentStep={onPresentStep}
            />
          </TabPanel>
          <TabPanel className="icad-inspector__panel icad-validation-content">
            {validationContent}
          </TabPanel>
        </TabPanels>
      </Tabs>
    </aside>
  );
}
