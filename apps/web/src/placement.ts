import { isContainer, type Editor, type Point, type SceneElement } from "@icad/core";
import type { LibraryPlacement } from "@icad/ui-web";

const ICON_SIZE = 48;
const CONTAINER_SIZE = { w: 240, h: 160 };
const FRAME_SIZE = { w: 800, h: 500 };
const CONTAINER_PADDING = 16;

function containingParent(
  editor: Editor,
  point: Point,
  size: { w: number; h: number }
): SceneElement | undefined {
  return editor.scene
    .all()
    .filter(
      (element) =>
        isContainer(element) &&
        element.w >= size.w + CONTAINER_PADDING * 2 &&
        element.h >= size.h + CONTAINER_PADDING * 2 &&
        point.x >= element.x &&
        point.x <= element.x + element.w &&
        point.y >= element.y &&
        point.y <= element.y + element.h
    )
    .sort((a, b) => a.w * a.h - b.w * b.h)[0];
}

function topLeftAt(
  point: Point,
  size: { w: number; h: number },
  parent?: SceneElement
): Point {
  const centered = { x: point.x - size.w / 2, y: point.y - size.h / 2 };
  if (!parent) return centered;
  return {
    x: Math.min(
      Math.max(centered.x, parent.x + CONTAINER_PADDING),
      parent.x + parent.w - CONTAINER_PADDING - size.w
    ),
    y: Math.min(
      Math.max(centered.y, parent.y + CONTAINER_PADDING),
      parent.y + parent.h - CONTAINER_PADDING - size.h
    )
  };
}

export function placeLibraryItem(editor: Editor, placement: LibraryPlacement, point: Point): string {
  const size =
    placement.type === "icon"
      ? { w: ICON_SIZE, h: ICON_SIZE }
      : placement.type === "primitive" && placement.kind === "frame"
        ? FRAME_SIZE
        : CONTAINER_SIZE;
  const parent =
    placement.type === "primitive" && placement.kind === "frame"
      ? undefined
      : containingParent(editor, point, size);
  const at = topLeftAt(point, size, parent);
  const parentOption = parent ? { parentId: parent.id } : {};

  if (placement.type === "icon") {
    const label = placement.icon.name;
    return placement.icon.semantic === "actor"
      ? editor.addActor({ at, label, catalogRef: placement.icon.id, ...parentOption })
      : editor.addIcon(placement.icon.id, { at, label, ...parentOption });
  }

  if (placement.type === "primitive") {
    if (placement.kind === "box") return editor.addBox({ at, ...parentOption });
    if (placement.kind === "group") return editor.addGroup({ at, ...parentOption });
    if (placement.kind === "frame") return editor.addFrame({ at, name: "Untitled frame" });
    return editor.addZone({ at, ...parentOption });
  }

  const { preset } = placement;
  const options = {
    at,
    label: preset.name,
    style: { stroke: preset.color },
    ...(preset.cornerIcon ? { catalogRef: preset.cornerIcon } : {}),
    ...parentOption
  };
  if (preset.kind === "box") return editor.addBox(options);
  if (preset.kind === "group") return editor.addGroup(options);
  return editor.addZone({
    ...options,
    ...(preset.zoneKind ? { zoneKind: preset.zoneKind } : {})
  });
}

export function clientPointToCanvas(svg: SVGSVGElement, clientX: number, clientY: number): Point | undefined {
  const matrix = svg.getScreenCTM();
  if (!matrix) return undefined;
  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  const transformed = point.matrixTransform(matrix.inverse());
  return { x: transformed.x, y: transformed.y };
}
