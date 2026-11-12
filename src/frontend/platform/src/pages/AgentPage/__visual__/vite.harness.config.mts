// Dev-only visual harness config (S10b evidence). Does NOT touch the app build.
// Run from src/frontend/platform: pnpm exec vite --config src/pages/AgentPage/__visual__/vite.harness.config.mts
import { defineConfig } from "vite";
import type { Connect, Plugin, ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";

const platformRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../..",
);

/**
 * Serve locale JSON from <platform>/public/locales directly. Without this the Vite SPA
 * fallback turns missing locale files into index.html (or a 500), which i18next-http-backend
 * then tries to parse as JSON.
 */
const harnessLocaleMiddleware: Connect.NextHandleFunction = (req, res, next) => {
  const localesRoot = path.join(platformRoot, "public", "locales");
  const rawPath = decodeURIComponent((req.url || "").split("?")[0]);
  const match = rawPath.match(/^\/locales\/([^/]+)\/([^/]+)\.json$/);
  if (!match) return next();
  const [, lng, ns] = match;
  const flat = path.join(localesRoot, `${lng}.json`);
  const nested = path.join(localesRoot, lng, `${ns}.json`);
  const candidate = existsSync(flat) ? flat : existsSync(nested) ? nested : null;
  if (!candidate) {
    res.statusCode = 404;
    res.end("{}");
    return;
  }
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-cache");
  res.end(readFileSync(candidate));
};

const harnessLocalePlugin: Plugin = {
  name: "harness-locale-json",
  configureServer(devServer: ViteDevServer) {
    devServer.middlewares.use(harnessLocaleMiddleware);
  },
};

export default defineConfig({
  // The app entry injects this via the platform build; the harness must provide it too
  // (src/i18n.js reads __APP_ENV__.BASE_URL for locale loadPath).
  define: { __APP_ENV__: JSON.stringify({ BASE_URL: "" }) },
  root: platformRoot,
  base: "./",
  plugins: [react(), harnessLocalePlugin],
  resolve: {
    alias: {
      "@": path.join(platformRoot, "src"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5299,
    strictPort: true,
  },
});
