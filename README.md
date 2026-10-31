# TileForge Studio

A browser-based seamless texture tiler. **All image processing runs locally**; uploaded textures never leave your device.

## Open

Open `index.html` through a local HTTP server (workers are generally blocked on `file://`). Either run `npm run dev` and visit http://localhost:5173, or serve the directory with any static host (including GitHub Pages).

The original Replit preview, built earlier, is: https://mountainous-joint-leads--joramvan2.replit.app

> **Provenance:** This GitHub implementation was committed directly because the Replit integration did not expose the original project's source or successfully push it. It is a functional standalone implementation of the requested product, **not a verified byte-for-byte copy of the Replit project**.

## Features

- Drag/drop, paste, or select PNG/JPEG/WebP; includes generated stone, wood and brick demos.
- **Periodic + Smooth**: Fourier-domain discrete Poisson solver for power-of-two images, smooth boundary repair for arbitrary dimensions.
- **Image Quilting**: overlapping texture patch synthesis with dynamic-programming minimum-error seam selection (not GraphCut).
- **PatchMatch-inspired reconstruction**: nearest-patch propagation, random search, weighted patch voting and seam-area inpainting.
- **Structure-aware Hybrid**: gradient-weighted patch matching and correction.
- **Auto**: contrast, directionality and sampled-offset repeat analysis chooses a mode.
- Dedicated Web Worker, progress indicator, cancel, seeded generation, quality/patch controls.
- Original/result previews with 1×, 3× and 5× repetitions, visible boundary overlays, numeric edge-error measurements.
- Download processed image as a real PNG, including alpha. No cloud service, accounts or API keys.

## Limitations and processing notes

- Auto classification uses inexpensive heuristics, not a trained model.
- The quilting seam is a minimum-error dynamic-programming cut; it is **not a graph-cut/min-flow implementation**.
- Patch reconstruction is a practical approximate-nearest-neighbor variant, not a reference implementation of the entire PatchMatch research pipeline.
- FFT Poisson decomposition is used for power-of-two sizes only. For non-power-of-two dimensions, a spatial edge correction is used to preserve dimensions rather than rescale.
- The optional periodic-boundary enforcement makes opposite outermost rows/columns numerically identical. This ensures zero *edge-color* discrepancy, but does **not** guarantee cracks, lines, or recognizable objects remain structurally continuous.
- Quilting alters more of the input than PatchMatch; try different modes and inspect the 3×3 preview. Large structured materials may require manual editing.
- Processing may be slow on high-resolution images, especially with large patches and multiple iterations.
- The app's maximum decoded image dimension is 4096 px; processing caps by quality at 512/1024/2048 px. Saved PNG matches the **processed** dimensions, which are indicated in the UI.
- No synchronized multi-channel PBR processing is included yet. Process channel bundles together only after adding shared correspondence maps.

## Developer

Requires Node.js 20+ for the optional dev server and automated tests (the app itself requires no package dependencies).

```bash
npm run dev
npm test
```

Files: `index.html` (UI), `app.js` (browser interactions), `tiler-worker.js` (processing), `server.mjs` (local static hosting), `tests/worker.test.mjs` (algorithm regression checks).

## Test conditions

The automated tests validate: dimensions, exact opposite-edge continuity, transparency retention, deterministic seeded results, and behavior of every selectable processing mode. Visual quality must still be evaluated with a repeated preview on representative materials.

