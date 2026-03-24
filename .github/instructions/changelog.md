# Changelog — lapeau-ab-compare

All notable changes are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

**Updating this file is mandatory at the end of every work session.**

---

## [Unreleased]

## 2026-03-24 — v1.3.0 — Drag-to-pan + mouse-wheel zoom in editor

### Added
- **Drag-to-pan** (`lpc-editor.js`): when the editor panel is open, dragging anywhere on the image container pans the active side's image in real time. Uses pointer capture so tracking continues even when the cursor briefly leaves the element. Pan deltas are clamped to the coverage-safe range (`maxPanForScale`). Disabled when scale is 1 (no room to pan) or when rotation is 90°/270°. Panel controls sync live during drag.
- **Mouse-wheel zoom** (`lpc-editor.js`): scrolling the mouse wheel over the slider when the editor is open adjusts the active side's zoom by ±0.05 per tick, clamped to [1, 3]. Pan is re-clamped after each zoom step to prevent uncovering the container edge. All panel controls update in sync.
- **Edit-mode cursor** (`lpc-editor.css`): the slider shows a `grab` cursor when the editor panel is open; switches to `grabbing` while actively dragging.

### Changed
- `lpc-slider.js` `onPointerDown`: bails early when the slider has the `lpc-compare--editing` class, preventing the divider from moving while the editor is controlling pointer events.
- Version bumped to 1.3.0.

### Added
- **Composite mode** (`lapeau-ab-compare.php`, `lpc-slider.css`): new `composite="url"` shortcode attribute accepts a single side-by-side image (left = before, right = after). Plugin sets both slots to the same URL and adds `lpc-compare--composite` class + `data-composite="1"` attribute. CSS positions before image to show left half and after image to show right half via `object-fit: fill; width: 200%` with opposing `left`/`right` anchors.
- Plugin instructions file at `.github/copilot-instructions.md` — covers architecture, attributes, meta structure, custom events, composite mode, coding standards, and release checklist.
- This changelog file at `.github/instructions/changelog.md`.

### Changed
- Version bumped to 1.2.0 across all 5 files (PHP, 2× CSS, 2× JS).

## 2026-03-24 — v1.1.0 — Coverage enforcement, tab snap, vertical fix, aspect ratio

### Fixed
- **Vertical drag bug** (`lpc-slider.js`): `isVertical` was a closed-over `const` captured at init time. Changed to a dynamic function reading `el.dataset.direction` on every call — editor direction toggle now works immediately.
- **Stale divider style bug** (`lpc-slider.js`): direction switch left orphaned `left` or `top` inline styles. `applyPosition()` now clears the opposite axis.
- **Tab click did not snap divider** (`lpc-editor.js`): clicking the Before/After tab now dispatches `lpc:setposition` (75 for before, 25 for after) so the slider handle snaps to reveal the active side.

### Added
- **Coverage enforcement** (`lpc-editor.js`): pan clamped to `(scale − 1) / 2 × 100%` per axis. Pan bounds update as zoom changes. Pan inputs disabled when rotation is active (axes are swapped).
- **Rotate snapping** (`lpc-editor.js`): rotate snaps to 90° multiples; auto-raises scale at 90°/270° to `max(cW/cH, cH/cW)`; zeroes pan at non-0° rotations.
- **Aspect ratio control** (`lpc-editor.js`, `lpc-editor.css`, `lapeau-ab-compare.php`): five preset toggle buttons (1:1, 4:3, 3:4, 16:9, 9:16) and a free-form text input in the editor panel. Ratio applied to the `.lpc-compare` slider and its nearest `.lp-concern-slider` ancestor.
- **Ratio persistence** (`lapeau-ab-compare.php`): `ratio` saved to `_lpc_transforms[id]['ratio']`, overrides shortcode attribute on page load, emitted as `data-lpc-ratio` attribute.
- **Custom events** (`lpc-slider.js`): `lpc:setposition`, `lpc:refresh`, `lpc:setratio` custom events decouple editor from slider internals.

## 2026-03-24 — v1.0.0 — Initial release

### Added
- New plugin `lapeau-ab-compare` — standalone `[lpc_compare]` shortcode.
- Clip-path reveal with draggable divider (horizontal and vertical).
- `object-fit: cover` with `transform: translate/scale/rotate` image positioning — same CSS in editor and public view (WYSIWYG).
- Before/after badge labels.
- Keyboard-accessible handle (arrow keys, ARIA slider role).
- Pointer/touch drag via `setPointerCapture`.
- Inline front-end editor for logged-in editors: pencil toggle, A/B side tabs, zoom/pan-x/pan-y/rotate range sliders, WP media picker, H/V direction toggle, reset, save.
- Editor panel appended to `<body>` to escape `overflow:hidden` ancestors; repositioned on scroll/resize.
- AJAX save (`lpc_save_transform`) with nonce + capability check.
- Per-slider transform persistence in `_lpc_transforms` post meta.
- Image URL override saved per-side to post meta.
- Lazy loading + async decoding on all slider images.
- `filemtime()` cache busting on all enqueued assets.
