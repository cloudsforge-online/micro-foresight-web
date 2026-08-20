import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * There is deliberately no `define`, no `envPrefix` and no `.env` file in this repository.
 *
 * A build-time constant is an environment baked into an image, and an image with an environment
 * baked into it has to be rebuilt to be promoted — which means the artefact that reaches
 * production is not the artefact that passed CI. Every host this app talks to is resolved at
 * RUNTIME from `window.location.hostname` by `cloudsforgeHosts()`, so one image serves localhost,
 * staging, a preview deployment and production. `test/no-build-time-config.test.ts` fails the
 * build if `import.meta.env.VITE_` ever reappears.
 */
export default defineConfig({
  // The mount, WITH the trailing slash — it rewrites every `src` and `href` in index.html and
  // every asset URL in the bundle. Without it the built shell asks for `/assets/…` at the APEX
  // ROOT, which is micro-site's, and the application never loads. It does NOT rewrite `content`,
  // which is why the og:image carries the mount by hand.
  base: '/foresight/',
  plugins: [react()],
  resolve: {
    // @cloudsforge/ui is a linked package, so its own node_modules holds a second copy of React.
    // Two copies means two dispatchers, and the shared bar would throw on its first useState.
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    // The linked package now ships BUILT output — its entry points name a committed `dist` — so
    // the old reason for this line ("shipped as TypeScript source until it is published") is no
    // longer why it is here. The setting is still right, for the reason that outlives it: `link:`
    // resolves to a working tree edited beside this one, and pre-bundling copies it into
    // node_modules/.vite, where it stays until the dep hash changes. A rebuild in micro-ui does
    // not change this repository's lockfile, so `pnpm dev` would keep serving yesterday's `dist`.
    exclude: ['@cloudsforge/ui'],
  },
  build: {
    // The assets are immutable-cached by nginx, and that is only safe when every rebuild produces
    // a new filename. Source maps so a Lantern stack trace names a line somebody can read.
    sourcemap: true,
  },
  /**
   * 5182, so this dev server can run beside the marketing site (5170) and Forge Hub (5180)
   * without either having to move. A developer with the market open, the hub open and this open
   * is the normal case while a stake flow is being worked on, and two Vite servers on one port is
   * a five-minute confusion where the second one silently proxies the first.
   *
   * This is a developer convenience and nothing more. It is not the port the app is served on in
   * production, and nothing in the bundle knows about it.
   */
  server: { port: 5182 },
  preview: { port: 5182 },
})
