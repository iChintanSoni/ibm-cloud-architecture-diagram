import {
  Button,
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
  TreeView
} from "@carbon/react";
import { ChevronDown, ChevronUp, Play, Stop } from "@carbon/react/icons";
import type {
  ConnectorType,
  ElementId,
  ElementPropertiesPatch,
  FrameElement,
  SceneElement,
  ZoneKind
} from "@icad/core";
import type { ReactNode } from "react";
import {
  buildLayerTree,
  elementDisplayName,
  eligibleParentElements,
  type LayerNode
} from "./inspectorModel.js";

const CONNECTION_TYPES: ConnectorType[] = [
  "logical-connection",
  "connection",
  "physical-connection",
  "tunneling-connection",
  "traffic-through-double-tunnel"
];

const RELATIONSHIP_TYPES: ConnectorType[] = [
  "dependency",
  "association",
  "aggregation",
  "composition",
  "implementation",
  "extends"
];

const CONNECTOR_TYPES = [...CONNECTION_TYPES, ...RELATIONSHIP_TYPES];

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

function LayerBranch({ node, onSelect }: { node: LayerNode; onSelect: (id: ElementId) => void }) {
  return (
    <TreeNode
      id={node.element.id}
      value={node.element.id}
      isExpanded={node.children.length > 0}
      label={
        <span className="icad-layers__label">
          <span>{elementDisplayName(node.element)}</span>
          <small>{labelForType(node.element.type)}</small>
        </span>
      }
      onSelect={(_event, selectedNode) => {
        if (selectedNode.id) onSelect(selectedNode.id);
      }}
    >
      {node.children.map((child) => (
        <LayerBranch key={child.element.id} node={child} onSelect={onSelect} />
      ))}
    </TreeNode>
  );
}

function commitNumber(
  id: ElementId,
  field: "x" | "y" | "w" | "h" | "order",
  raw: string,
  onUpdate: InspectorPanelProps["onUpdate"]
) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return;
  if ((field === "w" || field === "h") && value < 1) return;
  onUpdate(id, { [field]: value });
}

function ElementProperties({
  element,
  elements,
  onUpdate,
  onReparent
}: {
  element: SceneElement;
  elements: SceneElement[];
  onUpdate: InspectorPanelProps["onUpdate"];
  onReparent: InspectorPanelProps["onReparent"];
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

  return (
    <div className="icad-properties">
      <div className="icad-properties__identity">
        <div>
          <span className="icad-eyebrow">Selected element</span>
          <h2>{elementDisplayName(element)}</h2>
        </div>
        <Tag type="blue">{labelForType(element.type)}</Tag>
      </div>

      <TextInput
        key={`${element.id}:label:${label}`}
        id={`icad-property-label-${element.id}`}
        size="sm"
        labelText={element.type === "text" ? "Text" : element.type === "frame" ? "Name" : "Label"}
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
                onBlur={(event) => commitNumber(element.id, field, event.target.value, onUpdate)}
              />
            ))}
          </div>

          <Select
            id={`icad-property-parent-${element.id}`}
            size="sm"
            labelText="Parent container"
            value={element.parentId ?? ""}
            onChange={(event) => onReparent(element.id, event.target.value || undefined)}
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
          onChange={(event) => onUpdate(element.id, { zoneKind: event.target.value as ZoneKind })}
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
          onBlur={(event) => commitNumber(element.id, "order", event.target.value, onUpdate)}
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
              onUpdate(element.id, { connectorType: event.target.value as ConnectorType })
            }
          >
            {CONNECTOR_TYPES.map((type) => (
              <SelectItem key={type} value={type} text={type} />
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
                    direction: event.target.value as "unidirectional" | "bidirectional"
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
                  onUpdate(element.id, { flowColor: event.target.value as "private" | "public" })
                }
              >
                <SelectItem value="private" text="Private" />
                <SelectItem value="public" text="Public" />
              </Select>
            </>
          )}
        </>
      )}

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
  onPresentStep
}: Pick<
  InspectorPanelProps,
  "frames" | "presentingFrameId" | "onJumpToFrame" | "onTogglePresent" | "onPresentStep"
>) {
  const ordered = [...frames].sort((a, b) => a.order - b.order);
  const presenting = presentingFrameId !== undefined;

  if (ordered.length === 0) {
    return (
      <div className="icad-inspector__empty">
        <h2>No frames yet</h2>
        <p>Add a Frame from the library to split the diagram into sections and drive Find/presentation.</p>
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
            <Button kind="ghost" size="sm" hasIconOnly iconDescription="Previous frame" renderIcon={ChevronUp} onClick={() => onPresentStep(-1)} />
            <Button kind="ghost" size="sm" hasIconOnly iconDescription="Next frame" renderIcon={ChevronDown} onClick={() => onPresentStep(1)} />
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
  onReparent
}: InspectorPanelProps) {
  const selected = selectedIds.length === 1 ? elements.find((element) => element.id === selectedIds[0]) : undefined;
  const layers = buildLayerTree(elements);

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
                onUpdate={onUpdate}
                onReparent={onReparent}
              />
            ) : (
              <div className="icad-inspector__empty">
                <h2>{selectedIds.length > 1 ? `${selectedIds.length} elements selected` : "Nothing selected"}</h2>
                <p>Select an element on the canvas or in Layers to edit its properties.</p>
              </div>
            )}
          </TabPanel>
          <TabPanel className="icad-inspector__panel">
            {layers.length > 0 ? (
              <TreeView label="Diagram layers" size="sm" selected={selectedIds}>
                {layers.map((node) => (
                  <LayerBranch key={node.element.id} node={node} onSelect={onSelect} />
                ))}
              </TreeView>
            ) : (
              <div className="icad-inspector__empty">
                <h2>No layers yet</h2>
                <p>Place an IBM Cloud element to start the diagram hierarchy.</p>
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
