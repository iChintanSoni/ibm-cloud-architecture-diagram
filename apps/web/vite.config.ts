import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // @ibm/plex's compiled CSS uses webpack's `~pkg/path` convention in
      // font url()s; Vite doesn't resolve that prefix on its own.
      { find: /^~/, replacement: "" }
    ]
  }
});
