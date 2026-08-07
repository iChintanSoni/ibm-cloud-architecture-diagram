import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ToolError } from "./state.js";
import {
  assertOverwritable,
  resolveReadPath,
  resolveWritePath,
  resolveWorkspaceRoot,
} from "./workspace.js";

describe("workspace confinement (I13, docs/improvement-plan.md#i13--mcp-filesystem-confinement)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "icad-mcp-workspace-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("resolveWorkspaceRoot resolves against an OS temp dir that is itself a symlink (macOS /tmp) without rejecting legitimate paths later", async () => {
    // The regression this specifically guards: comparing a realpath'd root against an
    // un-resolved candidate would reject every path on a machine where the configured root
    // sits under a symlinked ancestor — which mkdtemp(tmpdir()) itself is, on macOS.
    const root = await resolveWorkspaceRoot(dir);
    await writeFile(path.join(dir, "doc.icad"), "{}");
    const resolved = await resolveReadPath(root, "doc.icad", [".icad"]);
    expect(resolved.endsWith("doc.icad")).toBe(true);
  });

  it("throws if the configured root doesn't exist", async () => {
    await expect(
      resolveWorkspaceRoot(path.join(dir, "does-not-exist")),
    ).rejects.toThrow(ToolError);
  });

  describe("resolveReadPath", () => {
    it("rejects .. traversal above the root", async () => {
      const root = await resolveWorkspaceRoot(dir);
      await expect(
        resolveReadPath(root, "../outside.icad", [".icad"]),
      ).rejects.toThrow(ToolError);
    });

    it("rejects an absolute path outside the root", async () => {
      const root = await resolveWorkspaceRoot(dir);
      const outside = await mkdtemp(path.join(tmpdir(), "icad-mcp-outside-"));
      try {
        await writeFile(path.join(outside, "secret.icad"), "{}");
        await expect(
          resolveReadPath(root, path.join(outside, "secret.icad"), [".icad"]),
        ).rejects.toThrow(ToolError);
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });

    it("rejects a symlink planted inside the root that points back out", async () => {
      const root = await resolveWorkspaceRoot(dir);
      const outside = await mkdtemp(path.join(tmpdir(), "icad-mcp-outside-"));
      try {
        await writeFile(path.join(outside, "secret.icad"), "{}");
        await symlink(
          path.join(outside, "secret.icad"),
          path.join(dir, "innocuous.icad"),
        );
        await expect(
          resolveReadPath(root, "innocuous.icad", [".icad"]),
        ).rejects.toThrow(ToolError);
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });

    it("rejects a disallowed extension", async () => {
      const root = await resolveWorkspaceRoot(dir);
      await writeFile(path.join(dir, "notes.txt"), "hello");
      await expect(
        resolveReadPath(root, "notes.txt", [".icad"]),
      ).rejects.toThrow(ToolError);
    });

    it("rejects any path through a .git segment", async () => {
      const root = await resolveWorkspaceRoot(dir);
      await mkdir(path.join(dir, ".git", "hooks"), { recursive: true });
      await writeFile(path.join(dir, ".git", "hooks", "pre-commit.icad"), "{}");
      await expect(
        resolveReadPath(root, ".git/hooks/pre-commit.icad", [".icad"]),
      ).rejects.toThrow(ToolError);
    });

    it("gives a clear not-found error for a genuinely missing file inside the root", async () => {
      const root = await resolveWorkspaceRoot(dir);
      await expect(
        resolveReadPath(root, "missing.icad", [".icad"]),
      ).rejects.toThrow(/no file/i);
    });

    it("accepts a legitimate nested path inside the root", async () => {
      const root = await resolveWorkspaceRoot(dir);
      await mkdir(path.join(dir, "sub"), { recursive: true });
      await writeFile(path.join(dir, "sub", "doc.icad"), "{}");
      const resolved = await resolveReadPath(root, "sub/doc.icad", [".icad"]);
      expect(resolved.endsWith(path.join("sub", "doc.icad"))).toBe(true);
    });
  });

  describe("resolveWritePath", () => {
    it("rejects .. traversal above the root", async () => {
      const root = await resolveWorkspaceRoot(dir);
      await expect(
        resolveWritePath(root, "../escape.icad", [".icad"]),
      ).rejects.toThrow(ToolError);
    });

    it("rejects a disallowed extension", async () => {
      const root = await resolveWorkspaceRoot(dir);
      await expect(
        resolveWritePath(root, "out.txt", [".icad"]),
      ).rejects.toThrow(ToolError);
    });

    it("rejects writing through a .git segment", async () => {
      const root = await resolveWorkspaceRoot(dir);
      await mkdir(path.join(dir, ".git"), { recursive: true });
      await expect(
        resolveWritePath(root, ".git/config.icad", [".icad"]),
      ).rejects.toThrow(ToolError);
    });

    it("rejects a symlinked directory inside the root that points back out", async () => {
      const root = await resolveWorkspaceRoot(dir);
      const outside = await mkdtemp(path.join(tmpdir(), "icad-mcp-outside-"));
      try {
        await symlink(outside, path.join(dir, "link"));
        await expect(
          resolveWritePath(root, "link/out.icad", [".icad"]),
        ).rejects.toThrow(ToolError);
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });

    it("errors clearly when the containing directory doesn't exist", async () => {
      const root = await resolveWorkspaceRoot(dir);
      await expect(
        resolveWritePath(root, "no-such-dir/out.icad", [".icad"]),
      ).rejects.toThrow(/does not exist/);
    });

    it("resolves a fresh path that doesn't exist yet", async () => {
      const root = await resolveWorkspaceRoot(dir);
      const resolved = await resolveWritePath(root, "out.icad", [".icad"]);
      expect(resolved.endsWith("out.icad")).toBe(true);
    });
  });

  describe("assertOverwritable", () => {
    it("allows a brand-new path with no force needed", async () => {
      const target = path.join(dir, "fresh.icad");
      await expect(
        assertOverwritable(target, new Set(), undefined),
      ).resolves.toBeUndefined();
    });

    it("throws for a pre-existing file this session doesn't know about, without force", async () => {
      const target = path.join(dir, "existing.icad");
      await writeFile(target, "{}");
      await expect(
        assertOverwritable(target, new Set(), undefined),
      ).rejects.toThrow(ToolError);
    });

    it("allows overwriting when force is passed", async () => {
      const target = path.join(dir, "existing.icad");
      await writeFile(target, "{}");
      await expect(
        assertOverwritable(target, new Set(), true),
      ).resolves.toBeUndefined();
    });

    it("allows overwriting a path this session already knows about, no force needed", async () => {
      const target = path.join(dir, "existing.icad");
      await writeFile(target, "{}");
      await expect(
        assertOverwritable(target, new Set([target]), undefined),
      ).resolves.toBeUndefined();
    });
  });
});
