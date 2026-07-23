import { Button, Tag, Theme } from "@carbon/react";
import { createEditor, type Diagnostic, type Editor } from "@icad/core";
import { useEffect, useRef, useState } from "react";
import { createDemoCatalog } from "./demoCatalog";
import { type ThemePreference, useResolvedTheme } from "./useResolvedTheme";

/** West-to-east demo layout (docs/05-ibm-spec-conformance.md#layout-convention). */
function seedDemoDiagram(editor: Editor): void {
  const ROW_Y = 150;

  const customer = editor.addActor({ at: { x: 40, y: ROW_Y }, label: "Customer" });

  const vpc = editor.addBox({ at: { x: 220, y: 60 }, w: 560, h: 220, label: "VPC" });
  const zone = editor.addGroup({
    at: { x: 250, y: 100 },
    w: 380,
    h: 140,
    parentId: vpc,
    label: "Security group"
  });

  const gateway = editor.addIcon("demo/vpc", { at: { x: 280, y: ROW_Y }, parentId: zone, label: "API Gateway" });
  const compute = editor.addIcon("demo/compute", { at: { x: 500, y: ROW_Y }, parentId: zone, label: "App server" });
  const storage = editor.addIcon("demo/storage", { at: { x: 680, y: ROW_Y }, parentId: vpc, label: "Object storage" });

  editor.connect({ elementId: customer, port: "e" }, { elementId: gateway, port: "w" }, {
    connectorType: "actor-to-node"
  });
  editor.connect({ elementId: gateway, port: "e" }, { elementId: compute, port: "w" }, {
    connectorType: "flow"
  });
  editor.connect({ elementId: compute, port: "e" }, { elementId: storage, port: "w" }, {
    connectorType: "dependency"
  });
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

export function App() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [themePreference, setThemePreference] = useState<ThemePreference>("auto");
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const carbonTheme = useResolvedTheme(themePreference);

  useEffect(() => {
    if (!canvasRef.current) return;

    const editor = createEditor({
      container: canvasRef.current,
      catalog: createDemoCatalog(),
      theme: themePreference
    });
    editorRef.current = editor;
    seedDemoDiagram(editor);
    setDiagnostics(editor.lint());

    const unsubscribe = editor.on(() => setDiagnostics(editor.lint()));

    return () => {
      unsubscribe();
      editor.destroy();
      editorRef.current = null;
    };
    // Mounted once: the editor owns its own theme thereafter via setTheme().
  }, []);

  useEffect(() => {
    editorRef.current?.setTheme(themePreference);
  }, [themePreference]);

  const handleExportSvg = () => {
    const svg = editorRef.current?.export({ format: "svg" });
    if (typeof svg === "string") download("diagram.svg", svg, "image/svg+xml");
  };

  const handleSaveIcad = () => {
    const doc = editorRef.current?.toIcad();
    if (doc) download(`${doc.meta.title.replace(/\s+/g, "-").toLowerCase()}.icad`, JSON.stringify(doc, null, 2), "application/json");
  };

  const handleOpenIcad = (file: File) => {
    file.text().then((text) => {
      editorRef.current?.loadIcad(JSON.parse(text));
    });
  };

  return (
    <Theme theme={carbonTheme}>
      <div className="icad-shell">
        <header className="icad-topbar">
          <span className="icad-brand">ICAD — IBM Cloud Architecture Diagrams</span>
          <div className="icad-toolbar">
            <Button kind="tertiary" size="sm" onClick={() => editorRef.current?.commands.undo()}>
              Undo
            </Button>
            <Button kind="tertiary" size="sm" onClick={() => editorRef.current?.commands.redo()}>
              Redo
            </Button>
            <Button kind="secondary" size="sm" onClick={handleSaveIcad}>
              Save .icad
            </Button>
            <Button kind="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
              Open .icad
            </Button>
            <Button kind="primary" size="sm" onClick={handleExportSvg}>
              Export SVG
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".icad,application/json"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleOpenIcad(file);
                e.target.value = "";
              }}
            />
            <div className="icad-theme-switch">
              {(["auto", "light", "dark"] as const).map((option) => (
                <Button
                  key={option}
                  kind={themePreference === option ? "primary" : "ghost"}
                  size="sm"
                  onClick={() => setThemePreference(option)}
                >
                  {option}
                </Button>
              ))}
            </div>
          </div>
        </header>

        <div className="icad-body">
          <div className="icad-canvas" ref={canvasRef} />
          <aside className="icad-validation">
            <h2>Validation</h2>
            {diagnostics.length === 0 && <p className="icad-muted">No conformance issues found.</p>}
            <ul>
              {diagnostics.map((d) => (
                <li key={d.id}>
                  <Tag type={d.severity === "error" ? "red" : d.severity === "warn" ? "warm-gray" : "blue"}>
                    {d.severity}
                  </Tag>
                  <span>{d.message}</span>
                  {d.quickFix && (
                    <Button
                      kind="ghost"
                      size="sm"
                      onClick={() => {
                        editorRef.current!.commands.dispatch(d.quickFix!);
                        setDiagnostics(editorRef.current!.lint());
                      }}
                    >
                      Fix
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </div>
    </Theme>
  );
}
