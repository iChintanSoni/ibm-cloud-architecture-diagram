import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { ToolError } from "./state.js";

/**
 * Confines every filesystem-touching MCP tool (`doc_open`/`doc_save`/`export_diagram`) to a
 * single workspace root (I13, docs/improvement-plan.md#i13--mcp-filesystem-confinement) — without
 * this, a bare `path.resolve(process.cwd(), input)` let an agent (or a prompt-injected `.icad`
 * file instructing one) read or overwrite anything the process's OS user could reach:
 * `../../../.git/hooks/pre-commit`, `~/.ssh/config`, a mounted share.
 *
 * Two-stage check on every path, not one:
 *
 * 1. A lexical check on the *requested* path against the root's own unresolved form — cheap, no
 *    filesystem access, catches `..` traversal and absolute-path escapes outright.
 * 2. A `realpath`-based check on what the path *actually* resolves to, against the root's own
 *    `realpath`'d form — catches a symlink planted inside the root that points back out, which
 *    the lexical check alone can't see through.
 *
 * Both sides of each comparison are resolved the same way (both lexical, or both real) — comparing
 * a `realpath`'d root against an un-resolved candidate would reject legitimate paths whenever the
 * root itself sits under a symlinked ancestor, which is the common case for OS temp directories
 * (macOS's `/tmp` → `/private/tmp`) and is exactly what this module's own tests run under.
 */
export interface WorkspaceRoot {
  /** Absolute, but not `realpath`'d — used for the cheap first-pass lexical check. */
  readonly original: string;
  /** Absolute and `realpath`'d — the authoritative form every resolved target is checked against. */
  readonly real: string;
}

/**
 * Resolves and `realpath`'s the configured workspace root once, at server startup, so every later
 * confinement check compares against a root already free of its own symlinks. Throws if the root
 * doesn't exist — a misconfigured root should fail loudly at startup, not silently run unconfined.
 */
export async function resolveWorkspaceRoot(
  input: string | undefined,
): Promise<WorkspaceRoot> {
  const original = path.resolve(input ?? process.cwd());
  try {
    return { original, real: await realpath(original) };
  } catch {
    throw new ToolError(
      `MCP workspace root "${original}" does not exist or is not accessible.`,
    );
  }
}

function isWithin(root: string, target: string): boolean {
  return target === root || target.startsWith(root + path.sep);
}

/** True if any path segment is literally `.git` — rejected unconditionally, read or write, since
 * a hooks/config file there is a plausible secret-leak or code-execution target regardless of the
 * workspace root's own boundary. */
function hasGitSegment(target: string): boolean {
  return target.split(path.sep).includes(".git");
}

function assertAllowedExtension(
  target: string,
  allowedExtensions: readonly string[],
): void {
  const ext = path.extname(target).toLowerCase();
  if (!allowedExtensions.includes(ext)) {
    throw new ToolError(
      `"${target}" has an extension this tool doesn't allow here — expected one of: ${allowedExtensions.join(", ")}.`,
    );
  }
}

function outsideRootError(root: WorkspaceRoot, input: string): ToolError {
  return new ToolError(
    `"${input}" resolves outside the MCP workspace root ("${root.original}") — refusing to use it.`,
  );
}

/**
 * Resolves a path an agent supplied for a *read* (`doc_open`), confined to `root`. The target
 * must already exist — a genuinely missing file surfaces its own clear "not found" error rather
 * than a confinement one, so the two failure modes aren't confusable.
 */
export async function resolveReadPath(
  root: WorkspaceRoot,
  input: string,
  allowedExtensions: readonly string[],
): Promise<string> {
  const candidate = path.resolve(root.original, input);
  if (!isWithin(root.original, candidate) || hasGitSegment(candidate)) {
    throw outsideRootError(root, input);
  }
  assertAllowedExtension(candidate, allowedExtensions);

  let real: string;
  try {
    real = await realpath(candidate);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ToolError(`No file at "${candidate}".`);
    }
    throw err;
  }
  if (!isWithin(root.real, real) || hasGitSegment(real)) {
    throw outsideRootError(root, input);
  }
  return real;
}

/**
 * Resolves a path an agent supplied for a *write* (`doc_save`/`export_diagram`), confined to
 * `root`. The target file itself need not exist yet, but its containing directory must — this
 * tool set never creates directories on an agent's behalf.
 */
export async function resolveWritePath(
  root: WorkspaceRoot,
  input: string,
  allowedExtensions: readonly string[],
): Promise<string> {
  const candidate = path.resolve(root.original, input);
  if (!isWithin(root.original, candidate) || hasGitSegment(candidate)) {
    throw outsideRootError(root, input);
  }
  assertAllowedExtension(candidate, allowedExtensions);

  const dir = path.dirname(candidate);
  let realDir: string;
  try {
    realDir = await realpath(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ToolError(`Directory "${dir}" does not exist.`);
    }
    throw err;
  }
  if (!isWithin(root.real, realDir) || hasGitSegment(realDir)) {
    throw outsideRootError(root, input);
  }
  return path.join(realDir, path.basename(candidate));
}

/** Whether a file already exists at `target` — the overwrite guard (see {@link assertOverwritable})
 * uses this to tell "fresh write" from "about to clobber something". */
async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Throws unless writing to `target` is safe: it's brand new, this session already put it there or
 * opened it (`knownPaths`), or the caller passed `force`. The overwrite guard for
 * `doc_save`/`export_diagram` — confinement alone stops an agent writing *outside* the workspace,
 * this stops it silently clobbering something *inside* it that some other process (or the human
 * using the same directory) actually cares about.
 */
export async function assertOverwritable(
  target: string,
  knownPaths: ReadonlySet<string>,
  force: boolean | undefined,
): Promise<void> {
  if (force || knownPaths.has(target)) return;
  if (await pathExists(target)) {
    throw new ToolError(
      `"${target}" already exists and this session didn't create or open it — pass force: true to overwrite it.`,
    );
  }
}
