# Changelog — lapeau-ab-compare

All notable changes are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

**Updating this file is mandatory at the end of every work session.**

---

## [Unreleased]

## 2026-03-25 — v1.4.1 — srcset URL fix + badge fade on divider

### Fixed
- **srcset not rendering** (`lapeau-ab-compare.php`): `attachment_url_to_postid()` requires a fully-qualified URL but page content commonly uses root-relative paths (e.g. `/wp-content/uploads/…`). `render_img()` now detects URLs without a scheme and prefixes them with `home_url()` before the lookup. The original URL is still used for the `src` output; only the internal lookup is resolved to absolute.

### Added
- **Badge fade on divider position** (`lpc-slider.js`, `lpc-slider.css`): as the slider divider passes the midpoint, the badge for the minority side (less than 50% visible area) fades out smoothly, reaching minimum opacity 0.25 at the extreme. This reinforces which image is dominant without hiding the label entirely. The dominant side’s badge stays at full opacity. A CSS `transition: opacity 0.2s ease` on `.lpc-badge` makes the fade smooth during drag. Both horizontal and vertical directions use the same `position` value so the logic is direction-agnostic.
- Badge element references (`badgeBefore`, `badgeAfter`) cached at init alongside existing element refs.

### Changed
- `applyPosition()` docblock updated to describe badge behaviour.
- Version bumped to 1.4.1 across all 5 files.

 — Responsive images (srcset) + container width control

### Added
- **Responsive image markup** (`lapeau-ab-compare.php`): new `render_img()` private method generates `srcset` and `sizes` attributes for each slider image. Uses `attachment_url_to_postid()` to resolve the attachment ID from the URL, then `wp_get_attachment_image_srcset( $id, 'full' )` to emit all registered image sizes. Falls back to plain `src`-only markup when the attachment cannot be resolved. Uses `'large'` size (≤1024 px) as the default `src` to avoid loading full-res on non-srcset browsers.
- **Per-request ID cache** (`lapeau-ab-compare.php`): static `$id_cache` array in `render_img()` avoids redundant `attachment_url_to_postid()` DB queries for repeated URLs (composite mode, multiple shortcodes sharing images).
- **`compute_sizes()` helper** (`lapeau-ab-compare.php`): computes a CSS `sizes` attribute value from the saved container width and composite flag. Returns `100vw` (default), `{N}vw` (percent width), or `(max-width: Xpx) 100vw, Xpx` (px width). Doubles the value for composite mode (image stretches to 200%).
- **Attachment ID persistence** (`lapeau-ab-compare.php`, `lpc-editor.js`): AJAX save now accepts and stores `image_id` (attachment ID) per side in post meta as `attachment_id`. Used on next render to skip URL lookup entirely.
- **Container width shortcode attribute** (`lapeau-ab-compare.php`): new `width` attribute (e.g. `width="80%"` or `width="400px"`). Saved meta overrides the shortcode attribute. Validated by regex before use.
- **Width override in rendered markup** (`lapeau-ab-compare.php`): when a width is set, the container gets `style="aspect-ratio: …; width: X; margin-left: auto; margin-right: auto;"` and `data-lpc-width="X"` so the editor can initialise from it.
- **Width control in editor panel** (`lpc-editor.js`, `lpc-editor.css`): new `Container width` section in the panel with a range slider (20–100%, step 5) and five preset buttons (100%, 80%, 60%, 50%, 40%). Manipulates the actual `slider.style.width` and `marginLeft`/`marginRight` for true WYSIWYG positioning. `applyWidth()` drives all updates; panel repositions after width changes via `positionPanel()`.
- **Width preset button styles** (`lpc-editor.css`): `.lpc-width-btn` and `.lpc-width-btn--active` classes matching the existing ratio-button appearance.
- **`WIDTH_PRESETS` constant** (`lpc-editor.js`): array of five preset width strings consumed by `buildPanelHTML()`.

### Changed
- `saveSide()` (`lpc-editor.js`): now appends `width` (empty string = clear override) and `image_id` (when a new image was picked from media library) to the AJAX FormData.
- `ajax_save_transform()` (`lapeau-ab-compare.php`): handles new `image_id` (per-side `attachment_id` in meta) and `width` (slider-level; empty string unsets the saved key) POST params.
- Media picker `select` handler (`lpc-editor.js`): clears stale `srcset` attribute on the `<img>` element (`img.removeAttribute('srcset')`) and stores `attachment.id` as `data-{side}Id` on the slider for the next save.
- `render()` (`lapeau-ab-compare.php`): **bug fix** — saved `url` overrides from post meta are now applied before the shortcode URL variables are finalised. Previously, the stored URL replacement was saved to meta but never read back during render.
- Version bumped to 1.4.0 across all 5 files.

## 2026-03-24 — v1.3.1 — Shift-key slider preview during edit mode

### Added
- **Shift-key preview** (`lpc-editor.js`, `lpc-slider.js`): while the editor panel is open, holding Shift temporarily re-activates the slider divider so the user can drag it to preview how the current pan/zoom settings look at any divider position. Releasing Shift returns the pointer back to drag-to-pan mode. A `lpc-compare--shift-preview` class is toggled on keydown/keyup to drive cursor feedback.
- **Shift-preview cursor** (`lpc-editor.css`): `col-resize` (horizontal) or `row-resize` (vertical) cursor applied when shift-preview is active, replacing the `grab` cursor, to visually indicate the divider is draggable.

### Changed
- `lpc-slider.js` `onPointerDown`: editing-mode bail now checks `&& !e.shiftKey` so the divider drag fires through when Shift is held.
- `lpc-editor.js` drag `pointerdown`: bails early when `e.shiftKey` is set, yielding to the slider divider handler.

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
