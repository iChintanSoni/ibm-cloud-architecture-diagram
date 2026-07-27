import {
  ActionableNotification,
  Button,
  Modal,
  Select,
  SelectItem,
  Tag,
  Theme,
} from "@carbon/react";
import {
  CanvasController,
  createEditor,
  isContainer,
  ruleMetadata,
  type CanvasMode,
  type ConformanceSeverity,
  type Diagnostic,
  type DiagramTemplateId,
  type ElementId,
  type ElementPropertiesPatch,
  type Editor,
  type ExportGate,
  type FrameElement,
  type Point,
  type SceneElement,
} from "@icad/core";
import {
  CommandPalette,
  ContextMenu,
  FindBar,
  InspectorPanel,
  LibraryPanel,
  LiveRegion,
  NewDiagramDialog,
  TopBar,
  elementDisplayName,
  findMatches,
  type CommandItem,
  type InsertKind,
  type LibraryPlacement,
} from "@icad/ui-web";
import { useEffect, useMemo, useRef, useState } from "react";
import { createIbmCloudCatalog } from "./catalog";
import {
  clearDraft,
  debounceAutosave,
  loadDraft,
  saveDraft,
} from "./persistence/autosave";
import {
  openIcadFile,
  saveIcadFile,
  supportsFileSystemAccess,
} from "./persistence/fileSystem";
import {
  consumeStartupFile,
  isTauri,
  onNativeFileOpen,
  openIcadFileNative,
  saveExportNative,
  saveIcadFileNative,
  setNativeTheme,
} from "./persistence/tauri";
import { placeLibraryItem, viewportCenter } from "./placement";
import {
  loadGridPreference,
  saveGridPreference,
} from "./persistence/gridPreference";
import {
  loadThemePreference,
  saveThemePreference,
} from "./persistence/themePreference";
import { type ThemePreference, useResolvedTheme } from "./useResolvedTheme";
import { buildValidationView } from "./validation";

/** Live-region wording for CanvasController's onClipboardAction (M16.5) — also reused by the
 * context menu's own clipboard items (M16.6), which call Editor.copy/cut/paste/duplicateElements
 * directly rather than through CanvasController, so they need to format the same announcement
 * themselves rather than relying on that callback firing. */
const CLIPBOARD_VERBS: Record<"copy" | "cut" | "paste" | "duplicate", string> =
  {
    copy: "copied",
    cut: "cut",
    paste: "pasted",
    duplicate: "duplicated",
  };

function formatClipboardAnnouncement(
  action: "copy" | "cut" | "paste" | "duplicate",
  elements: SceneElement[],
): string {
  const names = elements.map(elementDisplayName);
  const verb = CLIPBOARD_VERBS[action];
  return names.length === 1
    ? `${names[0]} ${verb}`
    : `${names.length} elements ${verb}`;
}

/** Shared with the context menu's own Delete item (M16.6), which calls Editor.deleteElements
 * directly rather than through CanvasController's own keyboard path. */
function formatDeletedAnnouncement(elements: SceneElement[]): string {
  const names = elements.map(elementDisplayName);
  return names.length === 1
    ? `${names[0]} deleted`
    : `${names.length} elements deleted`;
}

/** Ctrl/Cmd+K and Ctrl/Cmd+F stay global; other shortcuts back off while the user is typing. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable
  );
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function download(filename: string, content: string, mime: string): void {
  downloadBlob(filename, new Blob([content], { type: mime }));
}

function filenameFor(title: string): string {
  return `${title.trim().replace(/\s+/g, "-").toLowerCase() || "diagram"}.icad`;
}

export function App() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const controllerRef = useRef<CanvasController | null>(null);
  // Only used to diff against the next onDrillChange path (grew = entered, shrank = exited) —
  // not state, since nothing here needs to trigger a re-render.
  const drillPathRef = useRef<ElementId[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileHandleRef = useRef<FileSystemFileHandle | null>(null);
  const nativeFilePathRef = useRef<string | null>(null);
  const autosaveRef = useRef(
    debounceAutosave((doc: unknown) => void saveDraft(doc)),
  );
  const [catalog] = useState(createIbmCloudCatalog);

  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(
    () => loadThemePreference() ?? "auto",
  );
  // Background grid visibility (M17.2, docs/10-canvas-parity-plan.md) — a view preference like
  // theme, independent of any one `.icad` document.
  const [gridVisible, setGridVisibleState] = useState<boolean>(
    () => loadGridPreference() ?? true,
  );
  // Mirrors CanvasController's own mode (D27, docs/00-decision-log.md) for rendering only —
  // CanvasController is the source of truth, this is just what triggers a re-render. The
  // *specific* LibraryPlacement being armed is a ui-web concept core's controller can't know
  // about, so it's tracked separately, only for the Library panel's "armed" highlight.
  const [canvasMode, setCanvasMode] = useState<CanvasMode>({ kind: "idle" });
  const [activeLibraryPlacement, setActiveLibraryPlacement] =
    useState<LibraryPlacement>();
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [elements, setElements] = useState<SceneElement[]>([]);
  const [selectedIds, setSelectedIds] = useState<ElementId[]>([]);
  const [recoveredDraft, setRecoveredDraft] = useState(false);
  const [newDiagramOpen, setNewDiagramOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<"svg" | "png">("svg");
  const [pngScale, setPngScale] = useState<1 | 2 | 3>(1);
  const [pngBackground, setPngBackground] = useState<"transparent" | "white">(
    "transparent",
  );
  const [exportGate, setExportGateState] = useState<ExportGate>("warn");
  const [zoomPercent, setZoomPercent] = useState(100);
  const [presentingFrameId, setPresentingFrameId] = useState<ElementId>();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<
    { x: number; y: number; scenePoint: Point } | undefined
  >();
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findActiveIndex, setFindActiveIndex] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const carbonTheme = useResolvedTheme(themePreference);

  // Live region for meaningful changes (docs/07-accessibility.md#canvas-the-hard-20): briefly
  // clears first so the same message announces again even if it repeats back to back.
  const announce = (message: string) => {
    setAnnouncement("");
    window.setTimeout(() => setAnnouncement(message), 50);
  };

  const setThemePreference = (preference: ThemePreference) => {
    setThemePreferenceState(preference);
    saveThemePreference(preference);
  };

  const toggleGridVisible = () => {
    const next = !gridVisible;
    setGridVisibleState(next);
    saveGridPreference(next);
  };

  const frames = useMemo(
    () =>
      elements
        .filter((element): element is FrameElement => element.type === "frame")
        .sort((a, b) => a.order - b.order),
    [elements],
  );
  const findMatchesList = useMemo(
    () => findMatches(elements, catalog, findQuery),
    [elements, catalog, findQuery],
  );

  // Recomputed every render (not tracked in state): editorRef mutations don't cause
  // re-renders by themselves, but every dispatch/undo/redo already flows through the
  // scene "change" listener below, which does setState and triggers one — by the time
  // that render runs, the command stacks have fully settled.
  const canUndo = editorRef.current?.commands.canUndo() ?? false;
  const canRedo = editorRef.current?.commands.canRedo() ?? false;
  const singleSelected =
    selectedIds.length === 1
      ? elements.find((element) => element.id === selectedIds[0])
      : undefined;
  const canGroup = selectedIds.length >= 2;
  const canUngroup =
    singleSelected !== undefined && isContainer(singleSelected);

  useEffect(() => {
    if (!canvasRef.current) return;

    const editor = createEditor({
      container: canvasRef.current,
      catalog,
      theme: themePreference,
    });
    editorRef.current = editor;
    editor.setGridVisible(gridVisible);

    // The canvas's own pointer + keyboard interaction, as one state machine (D27,
    // docs/00-decision-log.md) — wheel pan/zoom, click-to-select, drag-to-connect, and the
    // canvas's own keyboard operability all live here now, not as separate listeners in this
    // component. App.tsx's job shrinks to wiring: mirroring mode changes into React state for
    // rendering, and formatting announcement text core can't own (it stays string-agnostic).
    const controller = new CanvasController(editor, canvasRef.current, {
      onConnected: (_id, fromId, toId) => {
        const from = editor.scene.get(fromId);
        const to = editor.scene.get(toId);
        if (from && to)
          announce(
            `Connected ${elementDisplayName(from)} to ${elementDisplayName(to)}`,
          );
      },
      onDeleted: (deletedElements) => {
        announce(formatDeletedAnnouncement(deletedElements));
      },
      onClipboardAction: (action, elements) => {
        announce(formatClipboardAnnouncement(action, elements));
      },
      onContextMenu: (screenPoint, scenePoint) => {
        setContextMenu({ x: screenPoint.x, y: screenPoint.y, scenePoint });
      },
    });
    controllerRef.current = controller;
    const unsubscribeMode = controller.onModeChange((mode) => {
      setCanvasMode(mode);
      // The Library panel's "armed" highlight is a ui-web-only concept, so it isn't part of
      // CanvasController's own mode — clear it in lockstep whenever placement mode ends, however
      // it ended (a completed click, or Escape from anywhere).
      if (mode.kind !== "placing") setActiveLibraryPlacement(undefined);
    });
    // Double-click/Enter drill and Escape step-out (M16.4) are each a discrete, meaningful change
    // (not a continuous gesture like drag/resize/marquee, which stay silent), so — like
    // onConnected/onDeleted above — this is worth its own live-region announcement.
    const unsubscribeDrill = controller.onDrillChange((path) => {
      const previous = drillPathRef.current;
      drillPathRef.current = path;
      if (path.length > previous.length) {
        const el = editor.scene.get(path[path.length - 1]!);
        if (el) announce(`Entered ${elementDisplayName(el)}`);
      } else if (path.length < previous.length) {
        const id = path[path.length - 1];
        const el = id ? editor.scene.get(id) : undefined;
        announce(
          el ? `Exited to ${elementDisplayName(el)}` : "Exited to canvas",
        );
      }
    });

    let cancelled = false;
    // A file opened via OS double-click/"Open With" (Tauri only) takes priority over
    // an unrelated leftover autosave draft — the user asked for a specific document.
    const startupFile = isTauri()
      ? consumeStartupFile()
      : Promise.resolve(null);
    Promise.all([startupFile, loadDraft()]).then(([opened, draft]) => {
      if (cancelled) return;
      if (opened) {
        nativeFilePathRef.current = opened.path;
        editor.loadIcad(JSON.parse(opened.text));
        editor.setTheme(themePreference);
      } else if (draft) {
        editor.loadIcad(draft);
        // Theme-only changes never mutate the scene through a command, so they never
        // trigger the autosave below — the recovered draft's theme can be stale. Keep
        // the user's persisted chrome preference instead of adopting it.
        editor.setTheme(themePreference);
        setRecoveredDraft(true);
      } else {
        editor.newDocument("blank");
        setNewDiagramOpen(true);
      }
      setExportGateState(editor.scene.conformance.exportGate);
      setDiagnostics(editor.lint());
    });

    const unsubscribe = editor.on(() => {
      setElements(editor.scene.all());
      setDiagnostics(editor.lint());
      autosaveRef.current(editor.toIcad());
    });
    const unsubscribeSelection = editor.onSelectionChange(setSelectedIds);
    const unsubscribeViewport = editor.viewport.on((viewport) =>
      setZoomPercent(viewport.scale * 100),
    );
    setElements(editor.scene.all());
    setSelectedIds(editor.selection.get());
    setZoomPercent(editor.viewport.get().scale * 100);

    return () => {
      cancelled = true;
      unsubscribe();
      unsubscribeSelection();
      unsubscribeViewport();
      unsubscribeMode();
      unsubscribeDrill();
      controller.destroy();
      controllerRef.current = null;
      editor.destroy();
      editorRef.current = null;
    };
    // Mounted once: the editor owns its own theme thereafter via setTheme().
  }, [catalog]);

  useEffect(() => {
    editorRef.current?.setTheme(themePreference);
  }, [themePreference]);

  useEffect(() => {
    editorRef.current?.setGridVisible(gridVisible);
  }, [gridVisible]);

  // Native window chrome (Tauri only): "auto" hands theming back to the OS (matching an
  // unset window `theme` config); an explicit light/dark choice forces the titlebar to
  // match rather than leaving it OS-driven while the canvas itself has been overridden.
  useEffect(() => {
    if (!isTauri()) return;
    void setNativeTheme(themePreference === "auto" ? null : themePreference);
  }, [themePreference]);

  // A `.icad` opened while the app is already running (Tauri only): a second launch
  // caught by the single-instance plugin, or a macOS "Open With" after startup.
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    onNativeFileOpen((file) => {
      nativeFilePathRef.current = file.path;
      loadIntoEditor(file.text);
    }).then((unsub) => {
      if (cancelled) unsub();
      else unsubscribe = unsub;
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  // Global command palette / find / zoom shortcuts (docs/06-editor-ux.md#keyboard-first).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openPalette();
        return;
      }
      if (meta && event.key.toLowerCase() === "f") {
        event.preventDefault();
        openFind();
        return;
      }
      if (isEditableTarget(event.target)) return;
      if (meta && event.key.toLowerCase() === "z" && event.shiftKey) {
        event.preventDefault();
        editorRef.current?.commands.redo();
      } else if (meta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        editorRef.current?.commands.undo();
      } else if (meta && event.key.toLowerCase() === "y") {
        event.preventDefault();
        editorRef.current?.commands.redo();
      } else if (meta && (event.key === "=" || event.key === "+")) {
        event.preventDefault();
        editorRef.current?.zoomIn();
      } else if (meta && event.key === "-") {
        event.preventDefault();
        editorRef.current?.zoomOut();
      } else if (meta && event.key === "0") {
        event.preventDefault();
        editorRef.current?.resetView();
      } else if (meta && event.key.toLowerCase() === "g" && event.shiftKey) {
        event.preventDefault();
        handleUngroup();
      } else if (meta && event.key.toLowerCase() === "g") {
        event.preventDefault();
        handleGroup();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Presentation-mode stepping (docs/06-editor-ux.md#frames-sections--presentation).
  useEffect(() => {
    if (presentingFrameId === undefined) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      if (
        event.key === "ArrowRight" ||
        event.key === "ArrowDown" ||
        event.key === "PageDown"
      ) {
        event.preventDefault();
        stepPresentation(1);
      } else if (
        event.key === "ArrowLeft" ||
        event.key === "ArrowUp" ||
        event.key === "PageUp"
      ) {
        event.preventDefault();
        stepPresentation(-1);
      } else if (event.key === "Escape") {
        setPresentingFrameId(undefined);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [presentingFrameId, frames]);

  // Presentation mode owns the keyboard while active (docs/06-editor-ux.md#frames-sections--
  // presentation, handled by the effect above) — an app-level concern CanvasController doesn't
  // know about, so it's suspended from outside rather than checking presentingFrameId itself.
  useEffect(() => {
    controllerRef.current?.setSuspended(presentingFrameId !== undefined);
  }, [presentingFrameId]);

  // Find jumps the viewport to the active match as the query or selection changes.
  useEffect(() => {
    if (!findOpen || findMatchesList.length === 0) return;
    const match = findMatchesList[findActiveIndex % findMatchesList.length];
    if (!match) return;
    editorRef.current?.selection.set([match.id]);
    editorRef.current?.focusOnElements([match.id]);
  }, [findOpen, findActiveIndex, findMatchesList]);

  useEffect(() => {
    setFindActiveIndex(0);
  }, [findQuery]);

  const openExport = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const summary = editor.complianceSummary();
    setDiagnostics(summary.diagnostics);
    setExportGateState(editor.scene.conformance.exportGate);
    setExportOpen(true);
  };

  /** Native Save dialog when running under Tauri, browser download otherwise (D22). */
  const saveExport = async (
    filename: string,
    blob: Blob,
    filters: { name: string; extensions: string[] }[],
  ) => {
    if (isTauri()) {
      await saveExportNative(blob, filename, filters);
      return;
    }
    downloadBlob(filename, blob);
  };

  const handleExportSvg = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const svg = editor.export({ format: "svg" });
    if (typeof svg === "string") {
      void saveExport(
        "diagram.svg",
        new Blob([svg], { type: "image/svg+xml" }),
        [{ name: "SVG image", extensions: ["svg"] }],
      ).then(() => setExportOpen(false));
    }
  };

  const handleExportPng = () => {
    const editor = editorRef.current;
    if (!editor) return;
    Promise.resolve(
      editor.export({
        format: "png",
        scale: pngScale,
        background: pngBackground,
      }),
    ).then((result) => {
      if (result instanceof Blob) {
        void saveExport("diagram.png", result, [
          { name: "PNG image", extensions: ["png"] },
        ]).then(() => setExportOpen(false));
      }
    });
  };

  const handleExport = () =>
    exportFormat === "svg" ? handleExportSvg() : handleExportPng();

  const persistIcad = async (forceSaveAs: boolean) => {
    const editor = editorRef.current;
    if (!editor) return;
    const doc = editor.toIcad();
    const content = JSON.stringify(doc, null, 2);
    const filename = filenameFor(doc.meta.title);

    if (isTauri()) {
      const path = await saveIcadFileNative(
        content,
        forceSaveAs ? null : nativeFilePathRef.current,
        filename,
      );
      if (path) {
        nativeFilePathRef.current = path;
        await clearDraft();
      }
      return;
    }

    if (supportsFileSystemAccess()) {
      const handle = await saveIcadFile(
        content,
        forceSaveAs ? null : fileHandleRef.current,
        filename,
      );
      if (handle) {
        fileHandleRef.current = handle;
        await clearDraft();
      }
      return;
    }

    download(filename, content, "application/json");
    await clearDraft();
  };

  const handleSaveIcad = () => void persistIcad(false);
  const handleSaveIcadAs = () => void persistIcad(true);

  const loadIntoEditor = (text: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.loadIcad(JSON.parse(text));
    setThemePreference(editor.scene.canvas.theme);
    setExportGateState(editor.scene.conformance.exportGate);
    setDiagnostics(editor.lint());
    setRecoveredDraft(false);
    setPresentingFrameId(undefined);
    void saveDraft(editor.toIcad());
  };

  const handleOpenClick = async () => {
    if (isTauri()) {
      const opened = await openIcadFileNative();
      if (!opened) return; // user canceled the picker
      nativeFilePathRef.current = opened.path;
      loadIntoEditor(opened.text);
      return;
    }
    if (supportsFileSystemAccess()) {
      const opened = await openIcadFile();
      if (!opened) return; // user canceled the picker
      fileHandleRef.current = opened.handle;
      loadIntoEditor(opened.text);
      return;
    }
    fileInputRef.current?.click();
  };

  const handleOpenIcadFallback = (file: File) => {
    fileHandleRef.current = null;
    file.text().then(loadIntoEditor);
  };

  const handleDiscardDraft = () => {
    clearDraft().then(() => window.location.reload());
  };

  const handleCreateDiagram = (templateId: DiagramTemplateId) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.newDocument(templateId);
    fileHandleRef.current = null;
    controllerRef.current?.cancelPlacement();
    setRecoveredDraft(false);
    setExportGateState(editor.scene.conformance.exportGate);
    setDiagnostics(editor.lint());
    setNewDiagramOpen(false);
    setPresentingFrameId(undefined);
    void saveDraft(editor.toIcad());
  };

  const stepPresentation = (direction: 1 | -1) => {
    if (frames.length === 0) return;
    const currentIndex = frames.findIndex(
      (frame) => frame.id === presentingFrameId,
    );
    const nextIndex =
      (((currentIndex === -1 ? 0 : currentIndex + direction) % frames.length) +
        frames.length) %
      frames.length;
    const next = frames[nextIndex]!;
    setPresentingFrameId(next.id);
    editorRef.current?.selection.set([next.id]);
    editorRef.current?.focusOnElements([next.id]);
  };

  const onTogglePresent = () => {
    if (presentingFrameId !== undefined) {
      setPresentingFrameId(undefined);
      return;
    }
    const first = frames[0];
    if (!first) return;
    setPresentingFrameId(first.id);
    editorRef.current?.selection.set([first.id]);
    editorRef.current?.focusOnElements([first.id]);
  };

  const onJumpToFrame = (id: ElementId) => {
    editorRef.current?.selection.set([id]);
    editorRef.current?.focusOnElements([id]);
    if (presentingFrameId !== undefined) setPresentingFrameId(id);
  };

  const closeFind = () => {
    setFindOpen(false);
    setFindQuery("");
  };

  const openFind = () => {
    setPaletteOpen(false);
    setFindOpen(true);
  };

  const openPalette = () => {
    closeFind();
    setPaletteOpen(true);
  };

  const findNext = () => {
    if (findMatchesList.length === 0) return;
    setFindActiveIndex((index) => (index + 1) % findMatchesList.length);
  };

  const findPrevious = () => {
    if (findMatchesList.length === 0) return;
    setFindActiveIndex(
      (index) => (index - 1 + findMatchesList.length) % findMatchesList.length,
    );
  };

  const handleInsert = (kind: InsertKind) => {
    const editor = editorRef.current;
    if (!editor || !canvasRef.current) return;
    const center = viewportCenter(editor, canvasRef.current);

    let id: ElementId;
    if (kind === "actor") {
      id = editor.addActor({
        at: { x: center.x - 24, y: center.y - 24 },
        label: "Actor",
      });
    } else if (kind === "text") {
      id = editor.addText({
        at: { x: center.x - 60, y: center.y - 10 },
        text: "Text",
      });
    } else {
      const placement: LibraryPlacement =
        kind === "boundary"
          ? { type: "primitive", kind: "zone" }
          : { type: "primitive", kind };
      id = placeLibraryItem(editor, placement, center);
    }
    editor.selection.set([id]);
    editor.focusElement(id);
    announce(`${elementDisplayName(editor.scene.get(id)!)} added`);
  };

  // Mouse users arm a placement, then click a canvas location for it. A keyboard activation
  // (Enter/Space on the library button) has no click position to give, so it places immediately
  // at the viewport center instead of entering that mouse-only aiming mode (docs/07-accessibility.md#canvas-the-hard-20).
  const handleChooseFromLibrary = (
    placement: LibraryPlacement,
    immediate?: boolean,
  ) => {
    const editor = editorRef.current;
    const controller = controllerRef.current;
    if (!editor || !controller || !canvasRef.current) return;

    if (!immediate) {
      setActiveLibraryPlacement(placement);
      controller.armPlacement((point) => {
        const id = placeLibraryItem(editor, placement, point);
        editor.selection.set([id]);
        editor.focusElement(id);
        announce(`${elementDisplayName(editor.scene.get(id)!)} added`);
      });
      return;
    }
    const id = placeLibraryItem(
      editor,
      placement,
      viewportCenter(editor, canvasRef.current),
    );
    editor.selection.set([id]);
    editor.focusElement(id);
    announce(`${elementDisplayName(editor.scene.get(id)!)} added`);
  };

  const handleGroup = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const ids = editor.selection.get();
    const groupId = editor.groupElements(ids);
    if (groupId) announce(`Grouped ${ids.length} elements`);
  };

  const handleUngroup = () => {
    const editor = editorRef.current;
    const id = editor?.selection.get()[0];
    const element = id ? editor?.scene.get(id) : undefined;
    // ungroupElement() already no-ops on a non-container (docs above it in createEditor.ts), but
    // this check keeps the live-region announcement from firing when nothing actually happened —
    // e.g. the keyboard shortcut fires unconditionally, unlike the Edit menu item's canUngroup gate.
    if (!editor || !id || !element || !isContainer(element)) return;
    const name = elementDisplayName(element);
    editor.ungroupElement(id);
    announce(`Ungrouped ${name}`);
  };

  const commands: CommandItem[] = [
    {
      id: "new",
      label: "New diagram…",
      category: "File",
      run: () => setNewDiagramOpen(true),
    },
    {
      id: "open",
      label: "Open .icad…",
      category: "File",
      run: () => void handleOpenClick(),
    },
    {
      id: "save",
      label: "Save .icad",
      category: "File",
      shortcut: "Ctrl+S",
      run: handleSaveIcad,
    },
    ...(isTauri() || supportsFileSystemAccess()
      ? [
          {
            id: "save-as",
            label: "Save As…",
            category: "File",
            run: handleSaveIcadAs,
          },
        ]
      : []),
    { id: "export", label: "Export…", category: "File", run: openExport },
    {
      id: "undo",
      label: "Undo",
      category: "Edit",
      shortcut: "Ctrl+Z",
      disabled: !canUndo,
      run: () => editorRef.current?.commands.undo(),
    },
    {
      id: "redo",
      label: "Redo",
      category: "Edit",
      shortcut: "Ctrl+Shift+Z",
      disabled: !canRedo,
      run: () => editorRef.current?.commands.redo(),
    },
    {
      id: "group",
      label: "Group",
      category: "Edit",
      shortcut: "Ctrl+G",
      disabled: !canGroup,
      run: handleGroup,
    },
    {
      id: "ungroup",
      label: "Ungroup",
      category: "Edit",
      shortcut: "Ctrl+Shift+G",
      disabled: !canUngroup,
      run: handleUngroup,
    },
    {
      id: "zoom-in",
      label: "Zoom in",
      category: "View",
      run: () => editorRef.current?.zoomIn(),
    },
    {
      id: "zoom-out",
      label: "Zoom out",
      category: "View",
      run: () => editorRef.current?.zoomOut(),
    },
    {
      id: "zoom-reset",
      label: "Reset zoom to 100%",
      category: "View",
      run: () => editorRef.current?.resetView(),
    },
    {
      id: "fit",
      label: "Fit to content",
      category: "View",
      run: () => editorRef.current?.fitToContent(),
    },
    {
      id: "find",
      label: "Find on canvas…",
      category: "View",
      shortcut: "Ctrl+F",
      run: openFind,
    },
    {
      id: "theme-auto",
      label: "Theme: Auto",
      category: "View",
      run: () => setThemePreference("auto"),
    },
    {
      id: "theme-light",
      label: "Theme: Light",
      category: "View",
      run: () => setThemePreference("light"),
    },
    {
      id: "theme-dark",
      label: "Theme: Dark",
      category: "View",
      run: () => setThemePreference("dark"),
    },
    {
      id: "insert-box",
      label: "Insert Box",
      category: "Insert",
      run: () => handleInsert("box"),
    },
    {
      id: "insert-group",
      label: "Insert Group",
      category: "Insert",
      run: () => handleInsert("group"),
    },
    {
      id: "insert-boundary",
      label: "Insert Boundary",
      category: "Insert",
      run: () => handleInsert("boundary"),
    },
    {
      id: "insert-actor",
      label: "Insert Actor",
      category: "Insert",
      run: () => handleInsert("actor"),
    },
    {
      id: "insert-text",
      label: "Insert Text",
      category: "Insert",
      run: () => handleInsert("text"),
    },
    {
      id: "insert-frame",
      label: "Insert Frame",
      category: "Insert",
      run: () => handleInsert("frame"),
    },
    {
      id: "present",
      label:
        presentingFrameId !== undefined
          ? "Exit presentation"
          : "Present frames",
      category: "Frames",
      disabled: presentingFrameId === undefined && frames.length === 0,
      run: onTogglePresent,
    },
    ...frames.map((frame) => ({
      id: `frame:${frame.id}`,
      label: `Go to frame: ${frame.name.trim() || "Untitled frame"}`,
      category: "Frames",
      run: () => onJumpToFrame(frame.id),
    })),
  ];

  // Right-click (or the Menu key / Shift+F10) canvas menu, contextual to the hit target (M16.6):
  // CanvasController has already synced `selection` to whatever was right-clicked by the time
  // `onContextMenu` fires, so this just reads that same state the rest of the UI already reads.
  // Each action calls straight into the Editor API rather than through CanvasController's own
  // keyboard path, so it needs to format its own announcement (the shared helpers above).
  const contextMenuItems: CommandItem[] = [
    {
      id: "ctx-cut",
      label: "Cut",
      shortcut: "Ctrl+X",
      disabled: selectedIds.length === 0,
      run: () => {
        const editor = editorRef.current;
        if (!editor) return;
        const cut = editor.cut(selectedIds);
        if (cut.length > 0) announce(formatClipboardAnnouncement("cut", cut));
      },
    },
    {
      id: "ctx-copy",
      label: "Copy",
      shortcut: "Ctrl+C",
      disabled: selectedIds.length === 0,
      run: () => {
        const editor = editorRef.current;
        if (!editor) return;
        const copied = editor.copy(selectedIds);
        if (copied.length > 0)
          announce(formatClipboardAnnouncement("copy", copied));
      },
    },
    {
      id: "ctx-paste",
      label: "Paste",
      shortcut: "Ctrl+V",
      disabled: !(editorRef.current?.canPaste() ?? false),
      run: () => {
        const editor = editorRef.current;
        if (!editor || !contextMenu) return;
        const pasted = editor
          .paste(contextMenu.scenePoint)
          .map((id) => editor.scene.get(id))
          .filter((el): el is SceneElement => el !== undefined);
        if (pasted.length > 0)
          announce(formatClipboardAnnouncement("paste", pasted));
      },
    },
    {
      id: "ctx-duplicate",
      label: "Duplicate",
      shortcut: "Ctrl+D",
      disabled: selectedIds.length === 0,
      run: () => {
        const editor = editorRef.current;
        if (!editor) return;
        const duplicated = editor
          .duplicateElements(selectedIds)
          .map((id) => editor.scene.get(id))
          .filter((el): el is SceneElement => el !== undefined);
        if (duplicated.length > 0)
          announce(formatClipboardAnnouncement("duplicate", duplicated));
      },
    },
    {
      id: "ctx-delete",
      label: "Delete",
      danger: true,
      disabled: selectedIds.length === 0,
      run: () => {
        const editor = editorRef.current;
        if (!editor) return;
        const deleted = selectedIds
          .map((id) => editor.scene.get(id))
          .filter((el): el is SceneElement => el !== undefined);
        if (deleted.length === 0) return;
        editor.deleteElements(selectedIds);
        announce(formatDeletedAnnouncement(deleted));
      },
    },
    {
      id: "ctx-group",
      label: "Group",
      shortcut: "Ctrl+G",
      disabled: !canGroup,
      run: handleGroup,
    },
    {
      id: "ctx-ungroup",
      label: "Ungroup",
      shortcut: "Ctrl+Shift+G",
      disabled: !canUngroup,
      run: handleUngroup,
    },
    {
      id: "ctx-select-all",
      label: "Select All",
      shortcut: "Ctrl+A",
      run: () => {
        const editor = editorRef.current;
        editor?.selection.set(editor.scene.all().map((el) => el.id));
      },
    },
  ];

  const {
    groups: groupedDiagnostics,
    counts,
    fixableByRule,
    exportBlocked,
  } = buildValidationView(diagnostics, exportGate);

  return (
    <Theme theme={carbonTheme}>
      <div className="icad-shell">
        <LiveRegion message={announcement} />
        <TopBar
          onNew={() => setNewDiagramOpen(true)}
          onOpen={() => void handleOpenClick()}
          onSave={handleSaveIcad}
          {...(isTauri() || supportsFileSystemAccess()
            ? { onSaveAs: handleSaveIcadAs }
            : {})}
          onExport={openExport}
          onUndo={() => editorRef.current?.commands.undo()}
          onRedo={() => editorRef.current?.commands.redo()}
          canUndo={canUndo}
          canRedo={canRedo}
          onGroup={handleGroup}
          onUngroup={handleUngroup}
          canGroup={canGroup}
          canUngroup={canUngroup}
          zoomPercent={zoomPercent}
          onZoomIn={() => editorRef.current?.zoomIn()}
          onZoomOut={() => editorRef.current?.zoomOut()}
          onResetZoom={() => editorRef.current?.resetView()}
          onFitToContent={() => editorRef.current?.fitToContent()}
          onOpenFind={openFind}
          onOpenCommandPalette={openPalette}
          onInsert={handleInsert}
          themePreference={themePreference}
          onThemeChange={setThemePreference}
          gridVisible={gridVisible}
          onToggleGrid={toggleGridVisible}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept=".icad,application/json"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleOpenIcadFallback(file);
            e.target.value = "";
          }}
        />

        <main className="icad-body" aria-label="Diagram editor">
          <h1 className="icad-visually-hidden">
            ICAD — IBM Cloud Architecture Diagrams
          </h1>
          <LibraryPanel
            catalog={catalog}
            activePlacement={activeLibraryPlacement}
            onChoose={handleChooseFromLibrary}
          />
          <div className="icad-canvas-region">
            <div
              className="icad-canvas"
              ref={canvasRef}
              data-placement-active={
                canvasMode.kind === "placing" ? "true" : "false"
              }
            />
            {recoveredDraft && (
              <div className="icad-recovered-notification">
                <ActionableNotification
                  kind="info"
                  lowContrast
                  title="Recovered unsaved changes"
                  subtitle="Restored automatically from your last session."
                  actionButtonLabel="Discard"
                  onActionButtonClick={handleDiscardDraft}
                  onCloseButtonClick={() => setRecoveredDraft(false)}
                />
              </div>
            )}
            <FindBar
              open={findOpen}
              query={findQuery}
              matches={findMatchesList}
              activeIndex={findActiveIndex}
              onQueryChange={setFindQuery}
              onNext={findNext}
              onPrevious={findPrevious}
              onClose={closeFind}
            />
            {canvasMode.kind === "connecting" && (
              <div className="icad-connect-hint" role="status">
                Connecting from{" "}
                <strong>
                  {elementDisplayName(
                    elements.find((el) => el.id === canvasMode.fromId)!,
                  )}
                </strong>{" "}
                — Tab to a target, Enter to confirm, Esc to cancel.
              </div>
            )}
          </div>
          <InspectorPanel
            elements={elements}
            selectedIds={selectedIds}
            validationCount={diagnostics.length}
            frames={frames}
            presentingFrameId={presentingFrameId}
            onJumpToFrame={onJumpToFrame}
            onTogglePresent={onTogglePresent}
            onPresentStep={stepPresentation}
            onSelect={(id) => editorRef.current?.selection.set([id])}
            onUpdate={(id: ElementId, patch: ElementPropertiesPatch) =>
              editorRef.current?.updateElementProperties(id, patch)
            }
            onReparent={(id, parentId) =>
              editorRef.current?.setElementParent(id, parentId)
            }
            validationContent={
              <>
                <div className="icad-validation-heading">
                  <h2>Validation</h2>
                  <span aria-label={`${diagnostics.length} issues`}>
                    {diagnostics.length}
                  </span>
                </div>
                {diagnostics.length === 0 && (
                  <p className="icad-muted">No conformance issues found.</p>
                )}
                {groupedDiagnostics.map(
                  ({ severity, items }) =>
                    items.length > 0 && (
                      <section className="icad-diagnostic-group" key={severity}>
                        <h3>
                          {severity} <span>{items.length}</span>
                        </h3>
                        <ul>
                          {items.map((diagnostic) => (
                            <li key={diagnostic.id}>
                              <Tag
                                type={
                                  severity === "error"
                                    ? "red"
                                    : severity === "warn"
                                      ? "warm-gray"
                                      : "blue"
                                }
                              >
                                {diagnostic.ruleId}
                              </Tag>
                              <button
                                className="icad-diagnostic-target"
                                type="button"
                                disabled={!diagnostic.elementId}
                                onClick={() => {
                                  if (diagnostic.elementId)
                                    editorRef.current?.selection.set([
                                      diagnostic.elementId,
                                    ]);
                                }}
                              >
                                {diagnostic.message}
                              </button>
                              {diagnostic.quickFix && (
                                <div className="icad-fix-actions">
                                  <Button
                                    kind="ghost"
                                    size="sm"
                                    onClick={() => {
                                      editorRef.current?.applyQuickFix(
                                        diagnostic,
                                      );
                                      setDiagnostics(
                                        editorRef.current?.lint() ?? [],
                                      );
                                      announce(`Fixed: ${diagnostic.message}`);
                                    }}
                                  >
                                    {diagnostic.quickFixLabel ?? "Fix"}
                                  </Button>
                                  {(fixableByRule.get(diagnostic.ruleId) ?? 0) >
                                    1 && (
                                    <Button
                                      kind="ghost"
                                      size="sm"
                                      onClick={() => {
                                        const count =
                                          editorRef.current?.applyQuickFixes(
                                            diagnostic.ruleId,
                                          ) ?? 0;
                                        setDiagnostics(
                                          editorRef.current?.lint() ?? [],
                                        );
                                        announce(
                                          `Fixed ${count} issue${count === 1 ? "" : "s"} of this type`,
                                        );
                                      }}
                                    >
                                      Fix all of this type
                                    </Button>
                                  )}
                                </div>
                              )}
                            </li>
                          ))}
                        </ul>
                      </section>
                    ),
                )}
                <details className="icad-rule-settings">
                  <summary>Rule settings</summary>
                  <p className="icad-muted">
                    Overrides are saved in this .icad document.
                  </p>
                  {ruleMetadata.map((rule) => (
                    <Select
                      key={rule.id}
                      id={`icad-rule-${rule.id}`}
                      size="sm"
                      labelText={rule.title}
                      value={
                        editorRef.current?.scene.conformance.ruleSeverities[
                          rule.id
                        ] ?? "default"
                      }
                      onChange={(event) => {
                        const value = event.target.value;
                        editorRef.current?.setRuleSeverity(
                          rule.id,
                          value === "default"
                            ? undefined
                            : (value as ConformanceSeverity),
                        );
                        setDiagnostics(editorRef.current?.lint() ?? []);
                      }}
                    >
                      <SelectItem
                        value="default"
                        text={`Default (${rule.defaultSeverity})`}
                      />
                      <SelectItem value="error" text="Error" />
                      <SelectItem value="warn" text="Warning" />
                      <SelectItem value="info" text="Info" />
                      <SelectItem value="off" text="Off" />
                    </Select>
                  ))}
                </details>
              </>
            }
          />
        </main>

        <Modal
          open={exportOpen}
          size="sm"
          modalLabel="Export"
          modalHeading="Export diagram"
          primaryButtonText={
            exportBlocked ? "Resolve errors to export" : "Export"
          }
          primaryButtonDisabled={exportBlocked}
          secondaryButtonText="Cancel"
          onRequestClose={() => setExportOpen(false)}
          onRequestSubmit={handleExport}
        >
          <div className="icad-export-summary">
            <p>IBM conformance summary</p>
            <div className="icad-summary-counts">
              <Tag type="red">{counts.error} errors</Tag>
              <Tag type="warm-gray">{counts.warn} warnings</Tag>
              <Tag type="blue">{counts.info} info</Tag>
            </div>
            {diagnostics.length === 0 && (
              <p className="icad-muted">
                Ready to export with no known issues.
              </p>
            )}
            {diagnostics.length > 0 && exportGate === "warn" && (
              <p className="icad-muted">
                Advisory mode: export remains available with validation issues.
              </p>
            )}
            {exportBlocked && (
              <p className="icad-export-blocked">
                Export is blocked because the diagram has error-level
                diagnostics.
              </p>
            )}
            <Select
              id="icad-export-format"
              labelText="Format"
              value={exportFormat}
              onChange={(event) =>
                setExportFormat(event.target.value as "svg" | "png")
              }
            >
              <SelectItem value="svg" text="SVG (re-editable, per D8)" />
              <SelectItem value="png" text="PNG (raster)" />
            </Select>
            {exportFormat === "png" && (
              <>
                <Select
                  id="icad-export-png-scale"
                  labelText="Scale"
                  value={String(pngScale)}
                  onChange={(event) =>
                    setPngScale(Number(event.target.value) as 1 | 2 | 3)
                  }
                >
                  <SelectItem value="1" text="1×" />
                  <SelectItem value="2" text="2×" />
                  <SelectItem value="3" text="3×" />
                </Select>
                <Select
                  id="icad-export-png-background"
                  labelText="Background"
                  value={pngBackground}
                  onChange={(event) =>
                    setPngBackground(
                      event.target.value as "transparent" | "white",
                    )
                  }
                >
                  <SelectItem value="transparent" text="Transparent" />
                  <SelectItem value="white" text="White" />
                </Select>
              </>
            )}
            <Select
              id="icad-export-gate"
              labelText="Export gate"
              value={exportGate}
              onChange={(event) => {
                const gate = event.target.value as ExportGate;
                setExportGateState(gate);
                editorRef.current?.setExportGate(gate);
                setDiagnostics(editorRef.current?.lint() ?? []);
              }}
            >
              <SelectItem value="warn" text="Warn (advisory)" />
              <SelectItem value="block" text="Block on errors" />
            </Select>
          </div>
        </Modal>
        <NewDiagramDialog
          open={newDiagramOpen}
          hasExistingContent={elements.length > 0}
          onClose={() => setNewDiagramOpen(false)}
          onCreate={handleCreateDiagram}
        />
        <CommandPalette
          open={paletteOpen}
          commands={commands}
          onClose={() => setPaletteOpen(false)}
        />
        <ContextMenu
          open={contextMenu !== undefined}
          x={contextMenu?.x ?? 0}
          y={contextMenu?.y ?? 0}
          items={contextMenuItems}
          onClose={() => setContextMenu(undefined)}
        />
      </div>
    </Theme>
  );
}
