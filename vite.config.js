import { defineConfig } from "vite";
import { resolve } from "node:path";
import { WorkspaceStore } from "./server/workspace.js";
import { createApi } from "./server/api.js";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  preview: { host: "127.0.0.1", port: 5173, strictPort: true },
  plugins: [
    react(),
    tailwindcss(),
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
