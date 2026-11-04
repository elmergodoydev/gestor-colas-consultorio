
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  // Base configurable: /gestor-colas/ o /
  const rawBasePath = (env.APP_BASE_PATH || "/").trim();

  const basePath =
    rawBasePath === "/" || rawBasePath === ""
      ? "/"
      : `/${rawBasePath.replace(/^\/+|\/+$/g, "")}/`;

  const basePrefix = basePath === "/" ? "" : basePath.slice(0, -1);

  // Quitar el prefijo para las rutas API y WebSocket de Django.
  const rewritePath = (path) => {
    if (basePrefix && path.startsWith(`${basePrefix}/`)) {
      return path.slice(basePrefix.length) || "/";
    }
    return path;
  };

  const backend = "http://127.0.0.1:8000";

  return {
    base: basePath,

    plugins: [react()],

    server: {
      proxy: {
        [`${basePrefix}/api`]: {
          target: backend,
          changeOrigin: true,
          rewrite: rewritePath,
        },

        [`${basePrefix}/ws`]: {
          target: "ws://127.0.0.1:8000",
          changeOrigin: true,
          ws: true,
          rewrite: rewritePath,
        },

        // Media y static conservan el prefijo:
        // Django los configura con APP_BASE_PATH.
        [`${basePrefix}/media`]: {
          target: backend,
          changeOrigin: true,
        },

        [`${basePrefix}/static`]: {
          target: backend,
          changeOrigin: true,
        },

        // Django Admin utiliza su ruta interna /admin/.
        [`${basePrefix}/admin`]: {
          target: backend,
          changeOrigin: true,
          rewrite: rewritePath,
        },
      },
    },
  };
});
