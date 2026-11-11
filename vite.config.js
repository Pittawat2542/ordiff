import { defineConfig, normalizePath } from "vite";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { resolve } from "node:path";
import { WorkspaceStore } from "./server/workspace.js";
import { createApi } from "./server/api.js";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const pdfjsPath = dirname(require.resolve("pdfjs-dist/package.json"));

export default defineConfig({
  worker: { format: "es" },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  preview: { host: "127.0.0.1", port: 5173, strictPort: true },
  plugins: [
    react(),
    tailwindcss(),
    viteStaticCopy({
      targets: ["cmaps", "standard_fonts", "wasm"].map((directory) => ({
        src: normalizePath(join(pdfjsPath, directory, "*")),
        dest: `pdfjs/${directory}`,
        rename: { stripBase: true },
      })),
    }),
    {
      name: "ordiff-local-api",
      configureServer(server) {
        server.middlewares.use(
          createApi({
            store: new WorkspaceStore({
              stateFile: resolve(".ordiff/workspace.json"),
            }),
          }),
        );
      },
      configurePreviewServer(server) {
        server.middlewares.use(
          createApi({
            store: new WorkspaceStore({
              stateFile: resolve(".ordiff/workspace.json"),
            }),
          }),
        );
      },
    },
  ],
});
