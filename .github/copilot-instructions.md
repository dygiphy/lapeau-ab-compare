# lapeau-ab-compare — Plugin Spec

Standalone WordPress plugin providing the `[lpc_compare]` shortcode for before/after image comparison sliders with an inline WYSIWYG positioning editor for logged-in users.

---

## Quick facts

| Key | Value |
|---|---|
| **Plugin slug** | `lapeau-ab-compare` |
| **Shortcode** | `[lpc_compare]` |
| **Post meta key** | `_lpc_transforms` |
| **AJAX action** | `lpc_save_transform` (nonce action: `lpc_save`) |
| **Current version** | 1.4.0 |
| **Minimum PHP** | 7.4 |
| **Tested WP** | 6.9+ |

---

## File map

```
lapeau-ab-compare/
├── lapeau-ab-compare.php     Main plugin — shortcode, AJAX, asset enqueue
├── assets/
│   ├── css/
│   │   ├── lpc-slider.css    Public slider styles (clip-path reveal, divider, badges, composite)
│   │   └── lpc-editor.css    Editor overlay styles (loaded for logged-in editors only)
│   └── js/
│       ├── lpc-slider.js     Public drag/touch behaviour + custom event listeners
│       └── lpc-editor.js     WYSIWYG editor (zoom, pan, rotate, aspect ratio, WP media, save)
├── .github/
│   ├── copilot-instructions.md  This file
│   └── instructions/
│       └── changelog.md      Session-by-session change log (mandatory — update every session)
└── readme.txt                WordPress plugin readme
```

---

## Shortcode attributes

| Attribute | Default | Description |
|---|---|---|
| `id` | auto | Unique slider ID — must be set manually for editor persistence. |
| `before` | — | URL of the "before" image. Required unless `composite` is set. |
| `after` | — | URL of the "after" image. Required unless `composite` is set. |
| `composite` | — | URL of a single side-by-side image (left = before, right = after). Sets both before and after to the same URL and applies `lpc-compare--composite` class. |
| `before_alt` | Before treatment | Alt text for before image. |
| `after_alt` | After treatment | Alt text for after image. |
| `before_label` | Before | Badge label shown over before side. |
| `after_label` | After | Badge label shown over after side. |
| `direction` | horizontal | `horizontal` or `vertical`. |
| `ratio` | 4/3 | CSS aspect-ratio of the container (e.g. `16/9`, `3/4`, `1/1`). Overridden by saved meta. |
| `width` | — | Optional container width override (e.g. `80%`, `400px`). Centres the slider when less than 100%. Overridden by saved meta. |
| `start` | 50 | Initial divider position 0–100. |

---

## Post meta structure

```
_lpc_transforms = [
    'slider-id' => [
        'before' => [ 'scale' => 1.0, 'offsetX' => 0.0, 'offsetY' => 0.0, 'rotate' => 0.0, 'url' => '', 'attachment_id' => 0 ],
        'after'  => [ ... same ... ],
        'ratio'  => '4/3',
        'width'  => '80%',
    ],
    ...
]
```

Saved ratio and width override shortcode attributes. A `url` key overrides the shortcode image URL for that side; `attachment_id` caches the WP media ID to avoid `attachment_url_to_postid()` DB queries on subsequent renders.

---

## Architecture principles

- **No jQuery, no build step.** Vanilla ES5-compatible JS wrapped in an IIFE.
- **True WYSIWYG.** The editor manipulates inline `transform` CSS on the exact same `<img>` elements visible to the public — no separate preview.
- **Clip-path reveal.** `.lpc-before` uses `clip-path: inset()` for the reveal effect. No JavaScript clipping.
- **Custom events.** Editor–slider communication is decoupled via custom DOM events (`lpc:setposition`, `lpc:refresh`, `lpc:setratio`). Never call slider internals from editor JS directly.
- **Coverage enforcement.** Pan is clamped to `(scale − 1) / 2 × 100%` per axis. Rotate snaps to 90° multiples; auto-scales at 90°/270°; pan is zeroed at non-0° rotations.
- **Security.** All AJAX endpoints check `wp_verify_nonce` and `current_user_can('edit_posts')`. All output is escaped with `esc_attr`, `esc_url`, `esc_html`. All input is sanitised before storage.

---

## Composite mode

When `composite="url"` is set, both before and after images point to the same side-by-side image. CSS positions the before image to show the left half and the after image to show the right half:

```css
.lpc-compare--composite .lpc-img { object-fit: fill; width: 200%; max-width: none; }
.lpc-compare--composite .lpc-img--before { left: 0; right: auto; }
.lpc-compare--composite .lpc-img--after  { right: 0; left: auto; }
```

The container `ratio` attribute should match the aspect ratio of one half of the composite image.

---

## Custom events (dispatched on `.lpc-compare` element)

| Event | Detail | Purpose |
|---|---|---|
| `lpc:setposition` | `{ position: 0–100 }` | Snap divider to position |
| `lpc:refresh` | — | Re-apply current position after direction change |
| `lpc:setratio` | `{ ratio: 'W/H' }` | Apply aspect ratio to slider + `.lp-concern-slider` parent |

---

## Coding standards

- All functions and methods must have docblocks with `@param` and `@return` types.
- PHP: exit-early pattern to avoid deep nesting; single responsibility per method.
- JS: ES5-compatible (no arrow functions, no `const`/`let` at the IIFE level); `var` declarations at top of scope.
- CSS: BEM-style classes prefixed `lpc-`; no inline styles; no `!important` except cursor overrides.
- No inline styles in rendered PHP HTML — use CSS classes; all dynamic values go in `data-` attributes.

---

## Release checklist

Before any release or deployment:

1. Bump version in `lapeau-ab-compare.php` (plugin header + `VERSION` constant).
2. Bump `@version` in all 4 asset file headers (lpc-slider.css, lpc-editor.css, lpc-slider.js, lpc-editor.js).
3. Run `phpcs` for PHP compatibility.
4. Update `.github/instructions/changelog.md` — **mandatory**.
5. Commit, push to the `lapeau-ab-compare` GitHub repo.
6. Update the submodule ref in the parent `lapeau` repo.
7. Deploy via `ftpsync` from the `lapeau` project root.

---

## Changelog

All changes must be logged in [.github/instructions/changelog.md](.github/instructions/changelog.md). **Updating the changelog is mandatory at the end of every work session — this requirement must never be skipped.**

Use [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format with ISO 8601 date headers. Newest session at the top.
