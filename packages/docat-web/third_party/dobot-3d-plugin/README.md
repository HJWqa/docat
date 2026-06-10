# Dobot 3D Plugin Source Snapshot

This directory contains a recovered source snapshot for the Dobot 3D plugin served from `packages/docat-web/public/3d`.

The files under `src/` were reconstructed from the production sourcemaps in `public/3d/static/js/main.f984a736.chunk.js.map` and `public/3d/static/css/main.86a0b9dc.chunk.css.map`. The vendor chunk map (`2.3e6c01a5.chunk.js.map`) contains third-party `node_modules` sources and is intentionally not restored here.

This snapshot is for maintenance and review of the embedded plugin source. It is not currently wired into the docat-web build pipeline.

Notable local fixes preserved in this snapshot:

- `src/protocol/messageCenterDispense.ts` dispatches through `postMessageCenter`.
- `src/protocol/postMessageCenter.ts` ignores non-business messages without a `method` field.
- `src/protocol/index.ts` silently ignores empty or unknown methods.

CSS recovery notes:

- `src/component/coordinate.css` and `src/index.css` come directly from the CSS sourcemap `sourcesContent`.
- `src/component/secWallinfo/index.css` was restored from the compiled CSS because the component imports it, but the sourcemap only preserved it in the generated CSS output.
