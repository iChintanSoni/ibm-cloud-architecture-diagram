import {
  ActionableNotification,
  Button,
  Modal,
  Select,
  SelectItem,
  Tag,
  Theme
} from "@carbon/react";
import {
  createEditor,
  ruleMetadata,
  type ConformanceSeverity,
  type Diagnostic,
  type DiagramTemplateId,
  type ElementId,
  type ElementPropertiesPatch,
  type Editor,
  type ExportGate,
  type FrameElement,
  type SceneElement
} from "@icad/core";
import {
  CommandPalette,
  FindBar,
  InspectorPanel,
  LibraryPanel,
  NewDiagramDialog,
  TopBar,
  findMatches,
  type CommandItem,
  type InsertKind,
  type LibraryPlacement
} from "@icad/ui-web";
import { useEffect, useMemo, useRef, useState } from "react";
import { createIbmCloudCatalog } from "./catalog";
import { clearDraft, debounceAutosave, loadDraft, saveDraft } from "./persistence/autosave";
import { openIcadFile, saveIcadFile, supportsFileSystemAccess } from "./persistence/fileSystem";
import { clientPointToCanvas, placeLibraryItem } from "./placement";
import { loadThemePreference, saveThemePreference } from "./persistence/themePreference";
import { type ThemePreference, useResolvedTheme } from "./useResolvedTheme";
import { buildValidationView } from "./validation";

/** Ctrl/Cmd+K and Ctrl/Cmd+F stay global; other shortcuts back off while the user is typing. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
}

function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function filenameFor(title: string): string {
  return `${title.trim().replace(/\s+/g, "-").toLowerCase() || "diagram"}.icad`;
}

export function App() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileHandleRef = useRef<FileSystemFileHandle | null>(null);
  const autosaveRef = useRef(debounceAutosave((doc: unknown) => void saveDraft(doc)));
  const [catalog] = useState(createIbmCloudCatalog);

  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(
    () => loadThemePreference() ?? "auto"
  );
  const [activePlacement, setActivePlacement] = useState<LibraryPlacement>();
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [elements, setElements] = useState<SceneElement[]>([]);
  const [selectedIds, setSelectedIds] = useState<ElementId[]>([]);
  const [recoveredDraft, setRecoveredDraft] = useState(false);
  const [newDiagramOpen, setNewDiagramOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportGate, setExportGateState] = useState<ExportGate>("warn");
  const [zoomPercent, setZoomPercent] = useState(100);
  const [presentingFrameId, setPresentingFrameId] = useState<ElementId>();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findActiveIndex, setFindActiveIndex] = useState(0);
  const carbonTheme = useResolvedTheme(themePreference);

  const setThemePreference = (preference: ThemePreference) => {
    setThemePreferenceState(preference);
    saveThemePreference(preference);
  };

  const frames = useMemo(
    () =>
      elements
        .filter((element): element is FrameElement => element.type === "frame")
        .sort((a, b) => a.order - b.order),
    [elements]
  );
  const findMatchesList = useMemo(
    () => findMatches(elements, catalog, findQuery),
    [elements, catalog, findQuery]
  );

  // Recomputed every render (not tracked in state): editorRef mutations don't cause
  // re-renders by themselves, but every dispatch/undo/redo already flows through the
  // scene "change" listener below, which does setState and triggers one — by the time
  // that render runs, the command stacks have fully settled.
  const canUndo = editorRef.current?.commands.canUndo() ?? false;
  const canRedo = editorRef.current?.commands.canRedo() ?? false;

  useEffect(() => {
    if (!canvasRef.current) return;

    const editor = createEditor({
      container: canvasRef.current,
      catalog,
      theme: themePreference
    });
    editorRef.current = editor;

    let cancelled = false;
    loadDraft().then((draft) => {
      if (cancelled) return;
      if (draft) {
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
    const unsubscribeViewport = editor.viewport.on((viewport) => setZoomPercent(viewport.scale * 100));
    setElements(editor.scene.all());
    setSelectedIds(editor.selection.get());
    setZoomPercent(editor.viewport.get().scale * 100);

    return () => {
      cancelled = true;
      unsubscribe();
      unsubscribeSelection();
      unsubscribeViewport();
      editor.destroy();
      editorRef.current = null;
    };
    // Mounted once: the editor owns its own theme thereafter via setTheme().
  }, [catalog]);

  useEffect(() => {
    editorRef.current?.setTheme(themePreference);
  }, [themePreference]);

  useEffect(() => {
    const cancelPlacement = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActivePlacement(undefined);
    };
    window.addEventListener("keydown", cancelPlacement);
    return () => window.removeEventListener("keydown", cancelPlacement);
  }, []);

  // Scroll pans, Ctrl/Cmd+scroll zooms toward the cursor (docs/06-editor-ux.md#core-interactions).
  // Attached as a native, non-passive listener so preventDefault actually stops page scroll.
  useEffect(() => {
    const node = canvasRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      const editor = editorRef.current;
      const svg = node.querySelector("svg");
      if (!editor || !svg) return;
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const focal = clientPointToCanvas(svg, event.clientX, event.clientY);
        editor.viewport.zoomBy(Math.exp(-event.deltaY * 0.01), focal);
      } else {
        const { scale } = editor.viewport.get();
        editor.viewport.panBy(event.deltaX / scale, event.deltaY / scale);
      }
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
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
      if (meta && (event.key === "=" || event.key === "+")) {
        event.preventDefault();
        editorRef.current?.zoomIn();
      } else if (meta && event.key === "-") {
        event.preventDefault();
        editorRef.current?.zoomOut();
      } else if (meta && event.key === "0") {
        event.preventDefault();
        editorRef.current?.resetView();
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
      if (event.key === "ArrowRight" || event.key === "ArrowDown" || event.key === "PageDown") {
        event.preventDefault();
        stepPresentation(1);
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp" || event.key === "PageUp") {
        event.preventDefault();
        stepPresentation(-1);
      } else if (event.key === "Escape") {
        setPresentingFrameId(undefined);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [presentingFrameId, frames]);

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

  const handleExportSvg = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const svg = editor.export({ format: "svg" });
    if (typeof svg === "string") {
      download("diagram.svg", svg, "image/svg+xml");
      setExportOpen(false);
    }
  };

  const persistIcad = async (forceSaveAs: boolean) => {
    const editor = editorRef.current;
    if (!editor) return;
    const doc = editor.toIcad();
    const content = JSON.stringify(doc, null, 2);
    const filename = filenameFor(doc.meta.title);

    if (supportsFileSystemAccess()) {
      const handle = await saveIcadFile(content, forceSaveAs ? null : fileHandleRef.current, filename);
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
    setActivePlacement(undefined);
    setRecoveredDraft(false);
    setExportGateState(editor.scene.conformance.exportGate);
    setDiagnostics(editor.lint());
    setNewDiagramOpen(false);
    setPresentingFrameId(undefined);
    void saveDraft(editor.toIcad());
  };

  const stepPresentation = (direction: 1 | -1) => {
    if (frames.length === 0) return;
    const currentIndex = frames.findIndex((frame) => frame.id === presentingFrameId);
    const nextIndex = (((currentIndex === -1 ? 0 : currentIndex + direction) % frames.length) + frames.length) % frames.length;
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
    setFindActiveIndex((index) => (index - 1 + findMatchesList.length) % findMatchesList.length);
  };

  const handleInsert = (kind: InsertKind) => {
    const editor = editorRef.current;
    if (!editor || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const { x, y, scale } = editor.viewport.get();
    const center = { x: x + rect.width / (2 * scale), y: y + rect.height / (2 * scale) };

    let id: ElementId;
    if (kind === "actor") {
      id = editor.addActor({ at: { x: center.x - 24, y: center.y - 24 }, label: "Actor" });
    } else if (kind === "text") {
      id = editor.addText({ at: { x: center.x - 60, y: center.y - 10 }, text: "Text" });
    } else {
      const placement: LibraryPlacement =
        kind === "boundary" ? { type: "primitive", kind: "zone" } : { type: "primitive", kind };
      id = placeLibraryItem(editor, placement, center);
    }
    editor.selection.set([id]);
  };

  const commands: CommandItem[] = [
    { id: "new", label: "New diagram…", category: "File", run: () => setNewDiagramOpen(true) },
    { id: "open", label: "Open .icad…", category: "File", run: () => void handleOpenClick() },
    { id: "save", label: "Save .icad", category: "File", shortcut: "Ctrl+S", run: handleSaveIcad },
    ...(supportsFileSystemAccess()
      ? [{ id: "save-as", label: "Save As…", category: "File", run: handleSaveIcadAs }]
      : []),
    { id: "export", label: "Export…", category: "File", run: openExport },
    { id: "undo", label: "Undo", category: "Edit", disabled: !canUndo, run: () => editorRef.current?.commands.undo() },
    { id: "redo", label: "Redo", category: "Edit", disabled: !canRedo, run: () => editorRef.current?.commands.redo() },
    { id: "zoom-in", label: "Zoom in", category: "View", run: () => editorRef.current?.zoomIn() },
    { id: "zoom-out", label: "Zoom out", category: "View", run: () => editorRef.current?.zoomOut() },
    { id: "zoom-reset", label: "Reset zoom to 100%", category: "View", run: () => editorRef.current?.resetView() },
    { id: "fit", label: "Fit to content", category: "View", run: () => editorRef.current?.fitToContent() },
    { id: "find", label: "Find on canvas…", category: "View", shortcut: "Ctrl+F", run: openFind },
    { id: "theme-auto", label: "Theme: Auto", category: "View", run: () => setThemePreference("auto") },
    { id: "theme-light", label: "Theme: Light", category: "View", run: () => setThemePreference("light") },
    { id: "theme-dark", label: "Theme: Dark", category: "View", run: () => setThemePreference("dark") },
    { id: "insert-box", label: "Insert Box", category: "Insert", run: () => handleInsert("box") },
    { id: "insert-group", label: "Insert Group", category: "Insert", run: () => handleInsert("group") },
    { id: "insert-boundary", label: "Insert Boundary", category: "Insert", run: () => handleInsert("boundary") },
    { id: "insert-actor", label: "Insert Actor", category: "Insert", run: () => handleInsert("actor") },
    { id: "insert-text", label: "Insert Text", category: "Insert", run: () => handleInsert("text") },
    { id: "insert-frame", label: "Insert Frame", category: "Insert", run: () => handleInsert("frame") },
    {
      id: "present",
      label: presentingFrameId !== undefined ? "Exit presentation" : "Present frames",
      category: "Frames",
      disabled: presentingFrameId === undefined && frames.length === 0,
      run: onTogglePresent
    },
    ...frames.map((frame) => ({
      id: `frame:${frame.id}`,
      label: `Go to frame: ${frame.name.trim() || "Untitled frame"}`,
      category: "Frames",
      run: () => onJumpToFrame(frame.id)
    }))
  ];

  const {
    groups: groupedDiagnostics,
    counts,
    fixableByRule,
    exportBlocked
  } = buildValidationView(diagnostics, exportGate);

  return (
    <Theme theme={carbonTheme}>
      <div className="icad-shell">
        <TopBar
          onNew={() => setNewDiagramOpen(true)}
          onOpen={() => void handleOpenClick()}
          onSave={handleSaveIcad}
          {...(supportsFileSystemAccess() ? { onSaveAs: handleSaveIcadAs } : {})}
          onExport={openExport}
          onUndo={() => editorRef.current?.commands.undo()}
          onRedo={() => editorRef.current?.commands.redo()}
          canUndo={canUndo}
          canRedo={canRedo}
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

        {recoveredDraft && (
          <ActionableNotification
            inline
            kind="info"
            lowContrast
            title="Recovered unsaved changes"
            subtitle="Restored automatically from your last session."
            actionButtonLabel="Discard"
            onActionButtonClick={handleDiscardDraft}
            onCloseButtonClick={() => setRecoveredDraft(false)}
          />
        )}

        <div className="icad-body">
          <LibraryPanel
            catalog={catalog}
            activePlacement={activePlacement}
            onChoose={setActivePlacement}
          />
          <div className="icad-canvas-region">
            <div
              className="icad-canvas"
              ref={canvasRef}
              data-placement-active={activePlacement ? "true" : "false"}
              onClick={(event) => {
                const editor = editorRef.current;
                const svg = canvasRef.current?.querySelector("svg");
                if (!editor || !svg) return;
                if (activePlacement) {
                  const point = clientPointToCanvas(svg, event.clientX, event.clientY);
                  if (!point) return;
                  const id = placeLibraryItem(editor, activePlacement, point);
                  editor.selection.set([id]);
                  setActivePlacement(undefined);
                  return;
                }

                const target = event.target instanceof Element ? event.target.closest<SVGElement>("[data-icad-id]") : null;
                const id = target?.dataset.icadId;
                if (!id) {
                  editor.selection.clear();
                } else if (event.shiftKey) {
                  editor.selection.toggle(id);
                } else {
                  editor.selection.set([id]);
                }
              }}
            />
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
            onReparent={(id, parentId) => editorRef.current?.setElementParent(id, parentId)}
            validationContent={
              <>
                <div className="icad-validation-heading">
                  <h2>Validation</h2>
                  <span aria-label={`${diagnostics.length} issues`}>{diagnostics.length}</span>
                </div>
                {diagnostics.length === 0 && <p className="icad-muted">No conformance issues found.</p>}
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
                                type={severity === "error" ? "red" : severity === "warn" ? "warm-gray" : "blue"}
                              >
                                {diagnostic.ruleId}
                              </Tag>
                              <button
                                className="icad-diagnostic-target"
                                type="button"
                                disabled={!diagnostic.elementId}
                                onClick={() => {
                                  if (diagnostic.elementId) editorRef.current?.selection.set([diagnostic.elementId]);
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
                                      editorRef.current?.applyQuickFix(diagnostic);
                                      setDiagnostics(editorRef.current?.lint() ?? []);
                                    }}
                                  >
                                    {diagnostic.quickFixLabel ?? "Fix"}
                                  </Button>
                                  {(fixableByRule.get(diagnostic.ruleId) ?? 0) > 1 && (
                                    <Button
                                      kind="ghost"
                                      size="sm"
                                      onClick={() => {
                                        editorRef.current?.applyQuickFixes(diagnostic.ruleId);
                                        setDiagnostics(editorRef.current?.lint() ?? []);
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
                    )
                )}
                <details className="icad-rule-settings">
                  <summary>Rule settings</summary>
                  <p className="icad-muted">Overrides are saved in this .icad document.</p>
                  {ruleMetadata.map((rule) => (
                    <Select
                      key={rule.id}
                      id={`icad-rule-${rule.id}`}
                      size="sm"
                      labelText={rule.title}
                      value={editorRef.current?.scene.conformance.ruleSeverities[rule.id] ?? "default"}
                      onChange={(event) => {
                        const value = event.target.value;
                        editorRef.current?.setRuleSeverity(
                          rule.id,
                          value === "default" ? undefined : (value as ConformanceSeverity)
                        );
                        setDiagnostics(editorRef.current?.lint() ?? []);
                      }}
                    >
                      <SelectItem value="default" text={`Default (${rule.defaultSeverity})`} />
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
        </div>

        <Modal
          open={exportOpen}
          size="sm"
          modalLabel="Export"
          modalHeading="Export SVG"
          primaryButtonText={exportBlocked ? "Resolve errors to export" : "Export"}
          primaryButtonDisabled={exportBlocked}
          secondaryButtonText="Cancel"
          onRequestClose={() => setExportOpen(false)}
          onRequestSubmit={handleExportSvg}
        >
          <div className="icad-export-summary">
            <p>IBM conformance summary</p>
            <div className="icad-summary-counts">
              <Tag type="red">{counts.error} errors</Tag>
              <Tag type="warm-gray">{counts.warn} warnings</Tag>
              <Tag type="blue">{counts.info} info</Tag>
            </div>
            {diagnostics.length === 0 && <p className="icad-muted">Ready to export with no known issues.</p>}
            {diagnostics.length > 0 && exportGate === "warn" && (
              <p className="icad-muted">Advisory mode: export remains available with validation issues.</p>
            )}
            {exportBlocked && (
              <p className="icad-export-blocked">
                Export is blocked because the diagram has error-level diagnostics.
              </p>
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
        <CommandPalette open={paletteOpen} commands={commands} onClose={() => setPaletteOpen(false)} />
      </div>
    </Theme>
  );
}
