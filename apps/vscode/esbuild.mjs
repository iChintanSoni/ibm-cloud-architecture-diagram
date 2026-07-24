import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const options = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.cjs",
  platform: "node",
  target: "node20",
  format: "cjs",
  // The extension host loads this module via Node's `require`, so bundle every dependency
  // (including workspace packages like @icad/core) except the `vscode` module, which only
  // exists inside a running VS Code process and is injected at load time.
  external: ["vscode"],
  sourcemap: true,
  logLevel: "info"
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
