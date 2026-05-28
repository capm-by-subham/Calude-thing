# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository scope

Single-file project: `blackboard.html` is the entire application — a fullscreen HTML5 canvas "chalkboard" with pencil, eraser, and clear tools. No build system, no dependencies, no package manager, no tests. Open the file directly in a browser to run it (`xdg-open blackboard.html` or just double-click).

## Architecture of `blackboard.html`

Everything lives in one file with three layers: inline `<style>`, two DOM elements (`<canvas id="board">` and a `#toolbar` with three buttons), and an inline `<script>` that owns all behavior. The script is organized into numbered sections (matching the comment banners in the file) — preserve that structure when editing:

- **Canvas sizing (§5, `resizeCanvas`)**: fills the window, scales the backing store by `devicePixelRatio` for crispness, and **snapshots the current drawing to a temp canvas before resize, then redraws it** so art survives window resizes. `ctx.setTransform(dpr, …)` resets on every resize, so `applyBrush()` must be re-called afterward (and is).
- **Brush state (§6, `applyBrush`)**: the eraser is not "draw background color" — it uses `globalCompositeOperation = "destination-out"` to actually remove pixels, which is why the dark board (a CSS `radial-gradient` on `<body>`) shows through. Any new tool must set the composite mode it needs.
- **Stroke smoothing (§7, `draw`)**: uses the midpoint-quadratic-curve trick — each segment is `quadraticCurveTo(lastPoint, midpoint)`, then a new path starts at the midpoint. Don't replace this with `lineTo` between raw pointer samples; fast strokes will look jagged.
- **Input (§9)**: `pointerdown` is on the canvas, but `pointermove`/`pointerup` are on `window` so a stroke continues if the cursor briefly leaves the canvas. Keep this split if adding new input handlers.

Constants `CHALK_COLOR`, `PENCIL_SIZE`, `ERASER_SIZE` at the top of the script are the only tuning knobs — there is intentionally no color picker or thickness slider.
