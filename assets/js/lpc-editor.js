/**
 * Lapeau A/B Compare â€“ Inline WYSIWYG editor.
 *
 * Loaded only for logged-in editors. Adds a control panel below each
 * editable slider that manipulates the SAME CSS properties the
 * public view uses â€" ensuring true WYSIWYG.
 *
 * Pan model (v1.5.0+):
 *   - Pan uses CSS object-position (not transform:translate) so the focal
 *     point shifts within the container without ever exposing background.
 *     Works at scale = 1, including portrait images in landscape containers.
 *   - offsetX / offsetY are percentage points from the centred default
 *     (50% 50%); range -50 to +50.
 *   - Emitted as object-position: (50+offsetX)% (50+offsetY)%.
 * Zoom / Rotate:
 *   - Additional zoom via transform:scale(s); rotate snaps to 90° multiples.
 *   - At 90°/270° the minimum scale is raised to max(cW/cH, cH/cW) and pan
 *     is zeroed (axes are swapped by the rotation).
 *
 * @package Lapeau_AB_Compare
 * @version 1.7.1
 */
( function () {
    'use strict';

    /* global lpcEditor */

    /**
     * Set to true to enable diagnostic console logging for the editor.
     * Logs container/image dimensions, scale, pan limits, and drag bail reasons.
     *
     * @type {boolean}
     */
    var LPC_DEBUG = true;

    /**
     * Log a diagnostic message when LPC_DEBUG is enabled.
     *
     * @param {...*} args - Arguments forwarded to console.log.
     */
    function lpcLog() {
        if ( LPC_DEBUG ) {
            // eslint-disable-next-line no-console
            console.log.apply( console, [ '[lpc-editor]' ].concat( Array.prototype.slice.call( arguments ) ) );
        }
    }

    /** Preset aspect ratios shown as toggles. */
    var RATIO_PRESETS = [ '1/1', '4/3', '3/4', '16/9', '9/16' ];

    /** Preset container widths shown as toggles (percentage values). */
    var WIDTH_PRESETS = [ '100%', '80%', '60%', '50%', '40%' ];

    /**
     * Clamp a number between min and max.
     *
     * @param {number} val
     * @param {number} min
     * @param {number} max
     * @returns {number}
     */
    function clamp( val, min, max ) {
        return Math.min( Math.max( val, min ), max );
    }

    /**
     * Return the minimum scale required to keep the container fully covered
     * when the image is rotated by the given angle.
     *
     * At 0Â°/180Â° the cover scale is 1 (object-fit:cover handles it).
     * At 90Â°/270Â° the rotated element's visual dimensions are swapped, so
     * we need scale = max(cW/cH, cH/cW).
     *
     * @param {number}      deg       - Rotation in degrees (normalised to 0â€“360).
     * @param {HTMLElement} container - The .lpc-compare element.
     * @returns {number}
     */
    function minScaleForRotation( deg, container ) {
        var norm = ( ( deg % 360 ) + 360 ) % 360;
        if ( norm === 90 || norm === 270 ) {
            var rect = container.getBoundingClientRect();
            if ( rect.height > 0 ) {
                var r = rect.width / rect.height;
                return Math.max( r, 1 / r );
            }
        }
        return 1;
    }

    /**
     * Enforce coverage constraints on the given side state object.
     * Pan uses object-position (range -50..+50 from centre 50%).
     * object-position is applied in element space before any rotation and
     * cannot expose background at any angle (object-fit:cover guarantees fill).
     *
     * @param {{ scale:number, offsetX:number, offsetY:number, rotate:number }} s
     */
    function enforceCoverage( s ) {
        s.offsetX = clamp( s.offsetX, -50, 50 );
        s.offsetY = clamp( s.offsetY, -50, 50 );
    }

    /**
     * Build the editor UI for a single slider.
     *
     * @param {HTMLElement} slider - The .lpc-compare container.
     */
    function buildEditor( slider ) {
        var id = slider.id;
        if ( ! id ) {
            return;
        }

        // Per-side transform state.
        var state = {
            before: { scale: 1, offsetX: 0, offsetY: 0, rotate: 0 },
            after:  { scale: 1, offsetX: 0, offsetY: 0, rotate: 0 }
        };

        var activeSide   = 'before';
        var currentRatio = ( slider.style.aspectRatio || '4/3' ).replace( /\s/g, '' );
        var currentWidth = slider.dataset.lpcWidth || '';

        // Privacy blur mask state (slider-level, not per-side).
        var blurState = {
            enabled: false, x: 15, y: 25, w: 70, h: 12,
            rotate: 0, intensity: 20, feather: 8
        };

        // Hydrate blur state from server-rendered data attribute.
        if ( slider.dataset.lpcBlur ) {
            try {
                var savedBlur = JSON.parse( slider.dataset.lpcBlur );
                if ( savedBlur.enabled !== undefined ) { blurState.enabled   = !! savedBlur.enabled; }
                if ( savedBlur.x         !== undefined ) { blurState.x         = parseFloat( savedBlur.x ); }
                if ( savedBlur.y         !== undefined ) { blurState.y         = parseFloat( savedBlur.y ); }
                if ( savedBlur.w         !== undefined ) { blurState.w         = parseFloat( savedBlur.w ); }
                if ( savedBlur.h         !== undefined ) { blurState.h         = parseFloat( savedBlur.h ); }
                if ( savedBlur.rotate    !== undefined ) { blurState.rotate    = parseFloat( savedBlur.rotate ); }
                if ( savedBlur.intensity !== undefined ) { blurState.intensity = parseFloat( savedBlur.intensity ); }
                if ( savedBlur.feather   !== undefined ) { blurState.feather   = parseFloat( savedBlur.feather ); }
            } catch ( e ) { /* ignore parse errors */ }
        }

        // Read any saved transforms already rendered as inline styles.
        parseExistingTransform( slider.querySelector( '.lpc-img--before' ), state.before, slider );
        parseExistingTransform( slider.querySelector( '.lpc-img--after'  ), state.after,  slider );

        lpcLog( 'buildEditor: slider "' + id + '" initialised' );
        lpcLog( '  state.before =', JSON.stringify( state.before ) );
        lpcLog( '  state.after  =', JSON.stringify( state.after  ) );
        lpcLog( '  currentRatio =', currentRatio, '  currentWidth =', currentWidth || '(unset)' );

        // â”€â”€ Edit toggle button â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        var toggleBtn = document.createElement( 'button' );
        toggleBtn.className = 'lpc-edit-toggle';
        toggleBtn.type      = 'button';
        toggleBtn.textContent = '\u270E';
        toggleBtn.title       = 'Edit image positioning';
        slider.appendChild( toggleBtn );

        // â”€â”€ Panel (appended to body to escape overflow:hidden ancestors) â”€â”€
        var panel = document.createElement( 'div' );
        panel.className = 'lpc-editor-panel';
        document.body.appendChild( panel );
        panel.innerHTML = buildPanelHTML();

        /** Re-position the panel flush below the slider. */
        function positionPanel() {
            var rect        = slider.getBoundingClientRect();
            panel.style.top   = ( rect.bottom + window.scrollY ) + 'px';
            panel.style.left  = rect.left + 'px';
            panel.style.width = rect.width + 'px';
        }

        // Cache panel elements.
        var els = {
            tabBefore:  panel.querySelector( '[data-side="before"]' ),
            tabAfter:   panel.querySelector( '[data-side="after"]'  ),
            zoom:       panel.querySelector( '.lpc-range-zoom'   ),
            zoomVal:    panel.querySelector( '.lpc-val-zoom'     ),
            panX:       panel.querySelector( '.lpc-range-panx'   ),
            panXVal:    panel.querySelector( '.lpc-val-panx'     ),
            panY:       panel.querySelector( '.lpc-range-pany'   ),
            panYVal:    panel.querySelector( '.lpc-val-pany'     ),
            rotate:     panel.querySelector( '.lpc-range-rotate' ),
            rotateVal:  panel.querySelector( '.lpc-val-rotate'   ),
            mediaBtn:   panel.querySelector( '.lpc-media-btn'    ),
            resetBtn:   panel.querySelector( '.lpc-btn--danger'  ),
            saveBtn:    panel.querySelector( '.lpc-btn--primary' ),
            dirH:       panel.querySelector( '[data-dir="horizontal"]' ),
            dirV:       panel.querySelector( '[data-dir="vertical"]'   ),
            saving:     panel.querySelector( '.lpc-saving-indicator'   ),
            ratioInput: panel.querySelector( '.lpc-ratio-custom'       ),
            ratioBtns:  panel.querySelectorAll( '[data-ratio]'         ),
            widthRange: panel.querySelector( '.lpc-range-width'  ),
            widthVal:   panel.querySelector( '.lpc-val-width'    ),
            widthBtns:  panel.querySelectorAll( '[data-width]'   ),
            // Blur controls.
            blurEnabled:      panel.querySelector( '.lpc-blur-enabled' ),
            blurControls:     panel.querySelector( '.lpc-blur-controls' ),
            blurIntensity:    panel.querySelector( '.lpc-range-blur-intensity' ),
            blurIntensityVal: panel.querySelector( '.lpc-val-blur-intensity'   ),
            blurFeather:      panel.querySelector( '.lpc-range-blur-feather'   ),
            blurFeatherVal:   panel.querySelector( '.lpc-val-blur-feather'     ),
            blurW:            panel.querySelector( '.lpc-range-blur-w'         ),
            blurWVal:         panel.querySelector( '.lpc-val-blur-w'           ),
            blurH:            panel.querySelector( '.lpc-range-blur-h'         ),
            blurHVal:         panel.querySelector( '.lpc-val-blur-h'           ),
            blurRotate:       panel.querySelector( '.lpc-range-blur-rotate'    ),
            blurRotateVal:    panel.querySelector( '.lpc-val-blur-rotate'      ),
            blurPresets:      panel.querySelectorAll( '[data-preset]'           )
        };

        // ── Create / find blur mask element ─────────────────────────────
        var blurMaskEl = slider.querySelector( '.lpc-blur-mask' );
        if ( ! blurMaskEl ) {
            blurMaskEl = document.createElement( 'div' );
            blurMaskEl.className = 'lpc-blur-mask';
            var dividerInsertRef = slider.querySelector( '.lpc-divider' );
            if ( dividerInsertRef ) {
                slider.insertBefore( blurMaskEl, dividerInsertRef );
            } else {
                slider.appendChild( blurMaskEl );
            }
        }
        blurMaskEl.style.display = blurState.enabled ? '' : 'none';

        /**
         * Apply the current blurState to the blur mask element's inline styles.
         */
        function applyBlur() {
            if ( ! blurMaskEl ) { return; }
            blurMaskEl.style.display = blurState.enabled ? '' : 'none';
            if ( ! blurState.enabled ) { return; }
            blurMaskEl.style.left        = blurState.x + '%';
            blurMaskEl.style.top         = blurState.y + '%';
            blurMaskEl.style.width       = blurState.w + '%';
            blurMaskEl.style.height      = blurState.h + '%';
            blurMaskEl.style.setProperty( '--lpc-blur', blurState.intensity + 'px' );
            blurMaskEl.style.borderRadius = blurState.feather + 'px';
            blurMaskEl.style.transform    = blurState.rotate !== 0 ? 'rotate(' + blurState.rotate + 'deg)' : '';
        }

        /**
         * Push the current blurState values to the panel controls.
         */
        function syncBlurControls() {
            els.blurEnabled.checked              = blurState.enabled;
            els.blurControls.classList.toggle( 'lpc-blur-controls--visible', blurState.enabled );
            els.blurIntensity.value              = blurState.intensity;
            els.blurIntensityVal.textContent      = blurState.intensity + 'px';
            els.blurFeather.value                = blurState.feather;
            els.blurFeatherVal.textContent        = blurState.feather + 'px';
            els.blurW.value                      = blurState.w;
            els.blurWVal.textContent              = blurState.w + '%';
            els.blurH.value                      = blurState.h;
            els.blurHVal.textContent              = blurState.h + '%';
            els.blurRotate.value                 = blurState.rotate;
            els.blurRotateVal.textContent         = blurState.rotate + '\u00B0';
        }

        // Initialise blur controls from state.
        syncBlurControls();
        applyBlur();

        // â”€â”€ Toggle open/close â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        toggleBtn.addEventListener( 'click', function ( e ) {
            e.stopPropagation();
            var isOpen = panel.classList.toggle( 'lpc-editor-panel--open' );
            slider.classList.toggle( 'lpc-compare--editing', isOpen );
            if ( isOpen ) {
                positionPanel();
                var sliderRect = slider.getBoundingClientRect();
                var imgBefore  = slider.querySelector( '.lpc-img--before' );
                var imgAfter   = slider.querySelector( '.lpc-img--after'  );
                lpcLog( 'Panel opened for slider "' + id + '"' );
                lpcLog( '  container  w=' + Math.round( sliderRect.width ) + ' h=' + Math.round( sliderRect.height ) );
                if ( imgBefore ) {
                    lpcLog( '  img-before naturalW=' + imgBefore.naturalWidth + ' naturalH=' + imgBefore.naturalHeight +
                            ' renderedW=' + Math.round( imgBefore.getBoundingClientRect().width ) +
                            ' renderedH=' + Math.round( imgBefore.getBoundingClientRect().height ) );
                }
                if ( imgAfter ) {
                    lpcLog( '  img-after  naturalW=' + imgAfter.naturalWidth + ' naturalH=' + imgAfter.naturalHeight +
                            ' renderedW=' + Math.round( imgAfter.getBoundingClientRect().width ) +
                            ' renderedH=' + Math.round( imgAfter.getBoundingClientRect().height ) );
                }
                lpcLog( '  active side =', activeSide, '  scale =', state[ activeSide ].scale,
                        '  pan model: object-position (enabled at any scale)' );
                if ( imgBefore ) {
                    var arImg  = imgBefore.naturalWidth / ( imgBefore.naturalHeight || 1 );
                    var arCont = sliderRect.width / ( sliderRect.height || 1 );
                    var natOvX = Math.round( Math.max( 0, imgBefore.naturalWidth * ( sliderRect.height / imgBefore.naturalHeight ) - sliderRect.width ) );
                    var natOvY = Math.round( Math.max( 0, imgBefore.naturalHeight * ( sliderRect.width / imgBefore.naturalWidth ) - sliderRect.height ) );
                    lpcLog( '  before-img AR=' + arImg.toFixed( 2 ) + '  container AR=' + arCont.toFixed( 2 ),
                            '  naturalOverflowX~' + natOvX + 'px  naturalOverflowY~' + natOvY + 'px' );
                }
            }
        } );

        function onViewportChange() {
            if ( panel.classList.contains( 'lpc-editor-panel--open' ) ) {
                positionPanel();
            }
        }
        window.addEventListener( 'scroll', onViewportChange, { passive: true } );
        window.addEventListener( 'resize', onViewportChange, { passive: true } );

        // â”€â”€ Side tabs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

        /**
         * Switch active side, sync controls, and snap the divider to
         * reveal mostly that side so the editor can see what they're editing.
         *
         * @param {string} side - "before" or "after".
         */
        function setActiveSide( side ) {
            activeSide = side;
            els.tabBefore.classList.toggle( 'lpc-side-tab--active', side === 'before' );
            els.tabAfter.classList.toggle(  'lpc-side-tab--active', side === 'after'  );
            syncControlsToState();
            // Snap divider: reveal the active side predominantly.
            var snapPos = side === 'before' ? 75 : 25;
            slider.dispatchEvent( new CustomEvent( 'lpc:setposition', { detail: { position: snapPos } } ) );
        }

        els.tabBefore.addEventListener( 'click', function () { setActiveSide( 'before' ); } );
        els.tabAfter.addEventListener(  'click', function () { setActiveSide( 'after'  ); } );

        // â”€â”€ Controls â†’ state sync â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

        /** Push the current state values to the range inputs and value displays. */
        function syncControlsToState() {
            var s = state[ activeSide ];
            els.zoom.value    = s.scale;
            els.zoomVal.textContent = s.scale.toFixed( 2 ) + 'x';
            els.panX.value    = s.offsetX;
            els.panXVal.textContent = s.offsetX.toFixed( 1 ) + '%';
            els.panY.value    = s.offsetY;
            els.panYVal.textContent = s.offsetY.toFixed( 1 ) + '%';
            els.rotate.value  = s.rotate;
            els.rotateVal.textContent = s.rotate + '\u00B0';

            // Pan range is always ±50 (object-position percentage from centre 50%).
            // (Panning works at all rotation angles — see applyTransform for axis notes.)
            els.panX.disabled = false;
            els.panY.disabled = false;

            // Pan range is always ±50 (object-position percentage from centre 50%).
            els.panX.min = -50; els.panX.max = 50;
            els.panY.min = -50; els.panY.max = 50;
        }

        /**
         * Apply the current per-side state to the image element's inline
         * CSS â€” the same properties used in the public view (WYSIWYG).
         *
         * @param {string} side - "before" or "after".
         */
        function applyTransform( side ) {
            var img = slider.querySelector( '.lpc-img--' + side );
            if ( ! img ) {
                return;
            }
            var s    = state[ side ];
            var norm = ( ( s.rotate % 360 ) + 360 ) % 360;

            // Two-component pan model (coverage-safe on both axes):
            //
            // 1. object-position: (50-X)% (50-Y)%
            //    Shifts the visible crop within the element. Zero coverage risk — the
            //    element always fills the container; only the cropped region moves.
            //    Handles ALL intrinsic image overflow (portrait Y, landscape X, etc.).
            //
            // 2. transform: translate(X*(scale-1)%, Y*(scale-1)%) scale(s) [rotate]
            //    At scale=1 the translate is 0 (element fills container exactly).
            //    At scale>1 the element overflows (scale-1)/2*cDim per side, which is
            //    exactly what translate consumes — no background is ever exposed.
            //
            // Both components use +offsetX = image moves right semantics:
            //   object-position X decreases  → shows left part  → image goes right.
            //   translate X increases         → element goes right → container shows left part → image goes right.

            // object-position shifts the visible crop within element space.
            // It is always coverage-safe regardless of rotation angle.
            if ( s.offsetX !== 0 || s.offsetY !== 0 ) {
                img.style.objectPosition = ( 50 - s.offsetX ) + '% ' + ( 50 - s.offsetY ) + '%';
            } else {
                img.style.objectPosition = '';
            }

            var parts = [];
            // translate(X*(scale-1)%, Y*(scale-1)%) adds extra pan range at scale>1.
            // At 90°/270° the translate axis is visually perpendicular to its intended
            // direction, so skip it and rely solely on object-position for pan.
            if ( norm !== 90 && norm !== 270 ) {
                var txPct = s.offsetX * ( s.scale - 1 );
                var tyPct = s.offsetY * ( s.scale - 1 );
                if ( Math.abs( txPct ) > 0.001 || Math.abs( tyPct ) > 0.001 ) {
                    parts.push( 'translate(' + txPct.toFixed( 3 ) + '%, ' + tyPct.toFixed( 3 ) + '%)' );
                }
            }
            if ( s.scale !== 1 ) {
                parts.push( 'scale(' + s.scale + ')' );
            }
            if ( s.rotate !== 0 ) {
                parts.push( 'rotate(' + s.rotate + 'deg)' );
            }
            img.style.transform = parts.length ? parts.join( ' ' ) : '';
        }

        // â”€â”€ Zoom â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
                els.zoom.addEventListener( 'input', function () {
            var s   = state[ activeSide ];
            s.scale = parseFloat( els.zoom.value );
            els.zoomVal.textContent = s.scale.toFixed( 2 ) + 'x';
            enforceCoverage( s );
            els.panX.value = s.offsetX;
            els.panXVal.textContent = s.offsetX.toFixed( 1 ) + '%';
            els.panY.value = s.offsetY;
            els.panYVal.textContent = s.offsetY.toFixed( 1 ) + '%';
            applyTransform( activeSide );
        } );

        // â”€â”€ Pan X â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
                els.panX.addEventListener( 'input', function () {
            var s = state[ activeSide ];
            s.offsetX = clamp( parseFloat( els.panX.value ), -50, 50 );
            els.panX.value = s.offsetX;
            els.panXVal.textContent = s.offsetX.toFixed( 1 ) + '%';
            applyTransform( activeSide );
        } );

        // â”€â”€ Pan Y â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
                els.panY.addEventListener( 'input', function () {
            var s = state[ activeSide ];
            s.offsetY = clamp( parseFloat( els.panY.value ), -50, 50 );
            els.panY.value = s.offsetY;
            els.panYVal.textContent = s.offsetY.toFixed( 1 ) + '%';
            applyTransform( activeSide );
        } );

        // â”€â”€ Rotate: snap to 90Â° multiples â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        els.rotate.addEventListener( 'input', function () {
            var raw     = parseFloat( els.rotate.value );
            var snapped = Math.round( raw / 90 ) * 90;
            var s       = state[ activeSide ];
            s.rotate    = snapped;
            els.rotate.value = snapped;
            els.rotateVal.textContent = snapped + '\u00B0';

            // Auto-raise scale if needed to maintain coverage after rotation.
            var minScale = minScaleForRotation( snapped, slider );
            if ( s.scale < minScale ) {
                s.scale = parseFloat( minScale.toFixed( 2 ) );
                els.zoom.value = s.scale;
                els.zoomVal.textContent = s.scale.toFixed( 2 ) + 'x';
            }

            // Zero pan at 90Â°/270Â° (axes are swapped by rotation).
            enforceCoverage( s );
            syncControlsToState();
            applyTransform( activeSide );
        } );

        // â”€â”€ Reset â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        // -- Drag-to-pan on the slider container ----------------------------------
        //
        // When the editor panel is open, dragging anywhere on the image container
        // pans the active side's image. Pointer capture keeps tracking smooth even
        // when the cursor leaves the element during a fast drag.

        var dragActive = false;
        var dragLastX  = 0;
        var dragLastY  = 0;

        slider.addEventListener( 'pointerdown', function ( e ) {
            if ( ! panel.classList.contains( 'lpc-editor-panel--open' ) ) {
                return;
            }
            if ( e.button !== 0 ) {
                return;
            }
            if ( e.target.closest( '.lpc-edit-toggle' ) ) {
                return;
            }
            // Yield to slider divider drag while Shift is held (preview mode).
            if ( e.shiftKey ) {
                return;
            }
            // Yield to blur mask positioning while Ctrl/Meta is held.
            if ( e.ctrlKey || e.metaKey ) {
                return;
            }
            var s    = state[ activeSide ];
            var norm = ( ( s.rotate % 360 ) + 360 ) % 360;
            lpcLog( 'pointerdown on "' + id + '" (' + activeSide + ')' +
                    '  scale=' + s.scale +
                    '  offsetX=' + s.offsetX.toFixed( 1 ) + '%' +
                    '  offsetY=' + s.offsetY.toFixed( 1 ) + '%' +
                    '  rotate-norm=' + norm + 'deg' );
            dragActive = true;
            dragLastX  = e.clientX;
            dragLastY  = e.clientY;
            slider.setPointerCapture( e.pointerId );
            slider.classList.add( 'lpc-compare--panning-active' );
            lpcLog( '  → drag STARTED' );
            e.preventDefault();
        } );

        slider.addEventListener( 'pointermove', function ( e ) {
            if ( ! dragActive ) {
                return;
            }
            var s    = state[ activeSide ];
            var rect = slider.getBoundingClientRect();
            var dx   = e.clientX - dragLastX;
            var dy   = e.clientY - dragLastY;
            dragLastX = e.clientX;
            dragLastY = e.clientY;

            // Drag sensitivity = sum of both pan components per 50 units of offsetX/Y:
            //   natOv*  = object-position range (intrinsic overflow, pixels per side)
            //   scaleOv* = translate range   (scale-induced overhang, pixels per side)
            var img    = slider.querySelector( '.lpc-img--' + activeSide );
            var nW     = ( img && img.naturalWidth  ) || 1;
            var nH     = ( img && img.naturalHeight ) || 1;
            var natOvX  = Math.max( 0, nW * ( rect.height / nH ) - rect.width  ) / 2;
            var natOvY  = Math.max( 0, nH * ( rect.width  / nW ) - rect.height ) / 2;
            var scaleOvX = ( s.scale - 1 ) / 2 * rect.width;
            var scaleOvY = ( s.scale - 1 ) / 2 * rect.height;
            var rangeX  = natOvX + scaleOvX;
            var rangeY  = natOvY + scaleOvY;
            // At 90°/270° the image is rotated so visual axes differ from element axes.
            // 90° CW:  visual-x (+right) = element -y  → dx maps to offsetY (+=)
            //          visual-y (+down)  = element +x  → dy maps to offsetX (+=)
            // 270° CW: visual-x (+right) = element +y  → dx maps to offsetY (-=)
            //          visual-y (+down)  = element -x  → dy maps to offsetX (-=)
            // sensitivity: dx uses rangeY (element-Y overflow), dy uses rangeX.
            var dragNorm = ( ( s.rotate % 360 ) + 360 ) % 360;
            if ( dragNorm === 90 ) {
                if ( rangeY > 1 ) { s.offsetY = clamp( s.offsetY + dx / rangeY * 50, -50, 50 ); }
                if ( rangeX > 1 ) { s.offsetX = clamp( s.offsetX + dy / rangeX * 50, -50, 50 ); }
            } else if ( dragNorm === 270 ) {
                if ( rangeY > 1 ) { s.offsetY = clamp( s.offsetY - dx / rangeY * 50, -50, 50 ); }
                if ( rangeX > 1 ) { s.offsetX = clamp( s.offsetX - dy / rangeX * 50, -50, 50 ); }
            } else {
                // +dx/+dy = grab-and-drag: drag right → image moves right.
                if ( rangeX > 1 ) { s.offsetX = clamp( s.offsetX + dx / rangeX * 50, -50, 50 ); }
                if ( rangeY > 1 ) { s.offsetY = clamp( s.offsetY + dy / rangeY * 50, -50, 50 ); }
            }

            els.panX.value = s.offsetX;
            els.panXVal.textContent = s.offsetX.toFixed( 1 ) + '%';
            els.panY.value = s.offsetY;
            els.panYVal.textContent = s.offsetY.toFixed( 1 ) + '%';
            applyTransform( activeSide );
        } );

        function endDrag() {
            if ( ! dragActive ) {
                return;
            }
            dragActive = false;
            slider.classList.remove( 'lpc-compare--panning-active' );
        }

        slider.addEventListener( 'pointerup',     endDrag );
        slider.addEventListener( 'pointercancel', endDrag );

        // -- Auto side-switch on hover ----------------------------------------
        //
        // When the panel is open and no drag is in progress, detect which image
        // the pointer is over and automatically switch the active side so the
        // user can pan/zoom whichever image they hover over without clicking tabs.

        slider.addEventListener( 'pointermove', function ( e ) {
            if ( ! panel.classList.contains( 'lpc-editor-panel--open' ) ) {
                return;
            }
            if ( dragActive ) {
                return;  // Mid-drag: keep the locked side.
            }
            var rect       = slider.getBoundingClientRect();
            var dividerEl  = slider.querySelector( '.lpc-divider' );
            var isVert     = slider.dataset.direction === 'vertical';
            var dividerPct;
            if ( dividerEl ) {
                // Read the position the slider JS set on the divider element.
                dividerPct = parseFloat( isVert ? dividerEl.style.top : dividerEl.style.left ) || 50;
            } else {
                dividerPct = 50;
            }
            var pct = isVert
                ? ( e.clientY - rect.top  ) / rect.height * 100
                : ( e.clientX - rect.left ) / rect.width  * 100;
            var hoveredSide = ( pct <= dividerPct ) ? 'before' : 'after';
            if ( hoveredSide !== activeSide ) {
                // Switch side without snapping the divider — just update controls.
                activeSide = hoveredSide;
                els.tabBefore.classList.toggle( 'lpc-side-tab--active', activeSide === 'before' );
                els.tabAfter.classList.toggle(  'lpc-side-tab--active', activeSide === 'after'  );
                syncControlsToState();
            }
        } );

        // -- Shift-key preview -----------------------------------------------
        //
        // While Shift is held the slider divider becomes draggable again so the
        // editor can preview position changes live. A class drives the cursor.

        window.addEventListener( 'keydown', function ( e ) {
            if ( e.key === 'Shift' && panel.classList.contains( 'lpc-editor-panel--open' ) ) {
                slider.classList.add( 'lpc-compare--shift-preview' );
            }
            if ( ( e.key === 'Control' || e.key === 'Meta' ) && panel.classList.contains( 'lpc-editor-panel--open' ) && blurState.enabled ) {
                slider.classList.add( 'lpc-compare--ctrl-active' );
            }
        } );

        window.addEventListener( 'keyup', function ( e ) {
            if ( e.key === 'Shift' ) {
                slider.classList.remove( 'lpc-compare--shift-preview' );
            }
            if ( e.key === 'Control' || e.key === 'Meta' ) {
                slider.classList.remove( 'lpc-compare--ctrl-active' );
            }
        } );

        // -- Mouse-wheel zoom -----------------------------------------------------
        //
        // Scrolling over the slider when the editor is open zooms the active image.
        // Each wheel tick adjusts scale by +/-0.05, clamped to [1, 3].

        slider.addEventListener( 'wheel', function ( e ) {
            if ( ! panel.classList.contains( 'lpc-editor-panel--open' ) ) {
                return;
            }
            e.preventDefault();

            var s     = state[ activeSide ];
            var delta = e.deltaY > 0 ? -0.05 : 0.05;
            s.scale   = parseFloat( clamp( s.scale + delta, 1, 3 ).toFixed( 2 ) );

            els.zoom.value = s.scale;
            els.zoomVal.textContent = s.scale.toFixed( 2 ) + 'x';

            // Pan range is fixed (±50); clamp and sync controls.
            enforceCoverage( s );
            els.panX.value = s.offsetX;
            els.panXVal.textContent = s.offsetX.toFixed( 1 ) + '%';
            els.panY.value = s.offsetY;
            els.panYVal.textContent = s.offsetY.toFixed( 1 ) + '%';

            applyTransform( activeSide );
        }, { passive: false } );

        els.resetBtn.addEventListener( 'click', function () {
            // Reset both sides — image URLs are stored in slider.dataset (not in state)
            // so they are unaffected. The user must still click Save to persist.
            state.before = { scale: 1, offsetX: 0, offsetY: 0, rotate: 0 };
            state.after  = { scale: 1, offsetX: 0, offsetY: 0, rotate: 0 };
            syncControlsToState();
            applyTransform( 'before' );
            applyTransform( 'after'  );
            // Reset blur mask to defaults (disabled).
            blurState.enabled = false;
            blurState.x = 15; blurState.y = 25;
            blurState.w = 70; blurState.h = 12;
            blurState.rotate = 0; blurState.intensity = 20; blurState.feather = 8;
            syncBlurControls();
            applyBlur();
        } );

        // â”€â”€ Direction toggle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

        /**
         * Switch the slider direction and update data-direction so the
         * dynamic isVertical() check in lpc-slider.js picks it up.
         *
         * @param {string} dir - "horizontal" or "vertical".
         */
        function setDirection( dir ) {
            slider.dataset.direction = dir;
            slider.classList.remove( 'lpc-compare--horizontal', 'lpc-compare--vertical' );
            slider.classList.add( 'lpc-compare--' + dir );
            els.dirH.classList.toggle( 'lpc-direction-btn--active', dir === 'horizontal' );
            els.dirV.classList.toggle( 'lpc-direction-btn--active', dir === 'vertical'   );
            // Let the slider re-apply its own clip-path / divider position.
            slider.dispatchEvent( new CustomEvent( 'lpc:refresh' ) );
        }

        els.dirH.addEventListener( 'click', function () { setDirection( 'horizontal' ); } );
        els.dirV.addEventListener( 'click', function () { setDirection( 'vertical'   ); } );

        var currentDir = slider.dataset.direction || 'horizontal';
        els.dirH.classList.toggle( 'lpc-direction-btn--active', currentDir === 'horizontal' );
        els.dirV.classList.toggle( 'lpc-direction-btn--active', currentDir === 'vertical'   );

        // â”€â”€ Aspect ratio â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

        /**
         * Apply a CSS aspect ratio string to the slider and its parent
         * .lp-concern-slider, then reposition the panel.
         *
         * @param {string} ratioStr - e.g. "16/9".
         */
        function applyRatio( ratioStr ) {
            if ( ! /^\d+\/\d+$/.test( ratioStr ) ) {
                return;
            }
            currentRatio = ratioStr;
            slider.dispatchEvent( new CustomEvent( 'lpc:setratio', { detail: { ratio: ratioStr } } ) );
            // Reposition panel since slider height may have changed.
            setTimeout( positionPanel, 50 );
            // Sync preset button active state.
            els.ratioBtns.forEach( function ( btn ) {
                btn.classList.toggle( 'lpc-ratio-btn--active', btn.dataset.ratio === ratioStr );
            } );
            els.ratioInput.value = ratioStr.replace( '/', ':' );
        }

        els.ratioBtns.forEach( function ( btn ) {
            // Mark the current ratio active on first render.
            btn.classList.toggle( 'lpc-ratio-btn--active', btn.dataset.ratio === currentRatio );
            btn.addEventListener( 'click', function () {
                applyRatio( btn.dataset.ratio );
            } );
        } );

        // Initialise custom input with current ratio.
        els.ratioInput.value = currentRatio.replace( '/', ':' );

        els.ratioInput.addEventListener( 'change', function () {
            // Accept "W:H" or "W/H" format.
            var val = els.ratioInput.value.trim().replace( ':', '/' );
            applyRatio( val );
        } );

        // â”€â”€ Media library â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

        // -- Container width -------------------------------------------------------

        /**
         * Sync the active state on width preset buttons.
         */
        function updateWidthBtnState() {
            var active = currentWidth || '100%';
            els.widthBtns.forEach( function ( btn ) {
                btn.classList.toggle( 'lpc-width-btn--active', btn.dataset.width === active );
            } );
        }

        /**
         * Apply a CSS width value to the slider container (WYSIWYG) and sync controls.
         *
         * Passing '100%' or an empty string restores the native 100% width.
         *
         * @param {string} widthVal - CSS width value (e.g. '80%') or '' for default.
         */
        function applyWidth( widthVal ) {
            // Normalise '100%' to '' so the default renders without an inline override.
            currentWidth = ( widthVal === '100%' ) ? '' : widthVal;
            if ( ! currentWidth ) {
                slider.style.width       = '';
                slider.style.marginLeft  = '';
                slider.style.marginRight = '';
            } else {
                slider.style.width       = currentWidth;
                slider.style.marginLeft  = 'auto';
                slider.style.marginRight = 'auto';
            }
            var displayVal = currentWidth || '100%';
            els.widthVal.textContent = displayVal;
            if ( /^\d+%$/.test( displayVal ) ) {
                els.widthRange.value = parseInt( displayVal, 10 );
            }
            updateWidthBtnState();
            // Reposition editor panel since slider width may have changed.
            setTimeout( positionPanel, 50 );
        }

        // Initialise width controls from current slider DOM state.
        var initWidthPct = /^\d+%$/.test( currentWidth ) ? parseInt( currentWidth, 10 ) : 100;
        els.widthRange.value     = initWidthPct;
        els.widthVal.textContent = currentWidth || '100%';
        updateWidthBtnState();

        els.widthRange.addEventListener( 'input', function () {
            applyWidth( els.widthRange.value + '%' );
        } );

        els.widthBtns.forEach( function ( btn ) {
            btn.addEventListener( 'click', function () {
                applyWidth( btn.dataset.width );
            } );
        } );
        els.mediaBtn.addEventListener( 'click', function () {
            if ( ! window.wp || ! window.wp.media ) {
                return;
            }
            var frame = wp.media( {
                title:    'Select ' + activeSide + ' image',
                multiple: false,
                library:  { type: 'image' }
            } );
            frame.on( 'select', function () {
                var attachment = frame.state().get( 'selection' ).first().toJSON();
                var img = slider.querySelector( '.lpc-img--' + activeSide );
                if ( img ) {
                    img.src = attachment.url;
                    img.removeAttribute( 'srcset' );   // Clear stale srcset; regenerated after save + reload.
                    slider.dataset[ activeSide + 'Url' ] = attachment.url;
                    slider.dataset[ activeSide + 'Id'  ] = attachment.id;   // Store ID for server-side srcset.
                }
            } );
            frame.open();
        } );

        // -- Blur controls ----------------------------------------------------

        /** Toggle blur enabled state. */
        els.blurEnabled.addEventListener( 'change', function () {
            blurState.enabled = els.blurEnabled.checked;
            els.blurControls.classList.toggle( 'lpc-blur-controls--visible', blurState.enabled );
            applyBlur();
        } );

        /** Blur intensity (px). */
        els.blurIntensity.addEventListener( 'input', function () {
            blurState.intensity = parseInt( els.blurIntensity.value, 10 );
            els.blurIntensityVal.textContent = blurState.intensity + 'px';
            applyBlur();
        } );

        /** Blur feather / border-radius (px). */
        els.blurFeather.addEventListener( 'input', function () {
            blurState.feather = parseInt( els.blurFeather.value, 10 );
            els.blurFeatherVal.textContent = blurState.feather + 'px';
            applyBlur();
        } );

        /** Blur width (%). */
        els.blurW.addEventListener( 'input', function () {
            blurState.w = parseInt( els.blurW.value, 10 );
            els.blurWVal.textContent = blurState.w + '%';
            blurState.x = clamp( blurState.x, 0, 100 - blurState.w );
            applyBlur();
        } );

        /** Blur height (%). */
        els.blurH.addEventListener( 'input', function () {
            blurState.h = parseInt( els.blurH.value, 10 );
            els.blurHVal.textContent = blurState.h + '%';
            blurState.y = clamp( blurState.y, 0, 100 - blurState.h );
            applyBlur();
        } );

        /** Blur rotation (deg). */
        els.blurRotate.addEventListener( 'input', function () {
            blurState.rotate = parseInt( els.blurRotate.value, 10 );
            els.blurRotateVal.textContent = blurState.rotate + '\u00B0';
            applyBlur();
        } );

        /** Blur presets. */
        els.blurPresets.forEach( function ( btn ) {
            btn.addEventListener( 'click', function () {
                var preset = btn.dataset.preset;
                if ( preset === 'eyes' ) {
                    blurState.x = 15; blurState.y = 25;
                    blurState.w = 70; blurState.h = 12;
                    blurState.rotate = 0; blurState.feather = 8;
                    blurState.intensity = 20;
                } else if ( preset === 'face' ) {
                    blurState.x = 15; blurState.y = 8;
                    blurState.w = 70; blurState.h = 55;
                    blurState.rotate = 0; blurState.feather = 40;
                    blurState.intensity = 25;
                }
                blurState.enabled = true;
                syncBlurControls();
                applyBlur();
            } );
        } );

        // -- Ctrl+drag blur mask positioning ----------------------------------

        var blurDragActive  = false;
        var blurDragStartX  = 0;
        var blurDragStartY  = 0;
        var blurDragOriginX = 0;
        var blurDragOriginY = 0;

        slider.addEventListener( 'pointerdown', function ( e ) {
            if ( ! panel.classList.contains( 'lpc-editor-panel--open' ) ) { return; }
            if ( ! ( e.ctrlKey || e.metaKey ) ) { return; }
            if ( ! blurState.enabled ) { return; }
            if ( e.button !== 0 ) { return; }
            e.preventDefault();
            e.stopPropagation();

            blurDragActive  = true;
            blurDragStartX  = e.clientX;
            blurDragStartY  = e.clientY;
            blurDragOriginX = blurState.x;
            blurDragOriginY = blurState.y;

            slider.setPointerCapture( e.pointerId );
            slider.classList.add( 'lpc-compare--blur-dragging' );
        } );

        slider.addEventListener( 'pointermove', function ( e ) {
            if ( ! blurDragActive ) { return; }
            var rect = slider.getBoundingClientRect();
            var dx   = ( e.clientX - blurDragStartX ) / rect.width  * 100;
            var dy   = ( e.clientY - blurDragStartY ) / rect.height * 100;
            blurState.x = clamp( blurDragOriginX + dx, 0, 100 - blurState.w );
            blurState.y = clamp( blurDragOriginY + dy, 0, 100 - blurState.h );
            applyBlur();
            syncBlurControls();
        } );

        slider.addEventListener( 'pointerup', function () {
            if ( blurDragActive ) {
                blurDragActive = false;
                slider.classList.remove( 'lpc-compare--blur-dragging' );
            }
        } );

        slider.addEventListener( 'pointercancel', function () {
            if ( blurDragActive ) {
                blurDragActive = false;
                slider.classList.remove( 'lpc-compare--blur-dragging' );
            }
        } );

        // -- Save -------------------------------------------------------------
        els.saveBtn.addEventListener( 'click', function () {
            saveSide( 'before', function () {
                saveSide( 'after', showSaved );
            } );
        } );

        /**
         * POST one side's transform data (plus ratio and width) to the AJAX endpoint.
         *
         * @param {string}   side     - "before" or "after".
         * @param {Function} callback - Called on XHR load.
         */
        function saveSide( side, callback ) {
            els.saving.textContent = 'Savingâ€¦';
            els.saving.classList.add( 'lpc-saving-indicator--visible' );

            var s    = state[ side ];
            var data = new FormData();
            data.append( 'action',    'lpc_save_transform' );
            data.append( 'nonce',     lpcEditor.nonce );
            data.append( 'post_id',   lpcEditor.postId );
            data.append( 'slider_id', id );
            data.append( 'side',      side );
            data.append( 'scale',     s.scale   );
            data.append( 'offsetX',   s.offsetX );
            data.append( 'offsetY',   s.offsetY );
            data.append( 'rotate',    s.rotate  );
            data.append( 'ratio',     currentRatio );
            data.append( 'width',     currentWidth );  // Empty string clears saved width.

            // Blur mask data (slider-level, sent with both sides).
            data.append( 'blur_enabled',   blurState.enabled ? '1' : '0' );
            data.append( 'blur_x',         blurState.x );
            data.append( 'blur_y',         blurState.y );
            data.append( 'blur_w',         blurState.w );
            data.append( 'blur_h',         blurState.h );
            data.append( 'blur_rotate',    blurState.rotate );
            data.append( 'blur_intensity', blurState.intensity );
            data.append( 'blur_feather',   blurState.feather );

            var imgUrl = slider.dataset[ side + 'Url' ] || '';
            if ( imgUrl ) {
                data.append( 'image_url', imgUrl );
            }

            var imgId = parseInt( slider.dataset[ side + 'Id' ] || '0', 10 );
            if ( imgId ) {
                data.append( 'image_id', imgId );   // Avoids URL lookup on next render.
            }

            var xhr = new XMLHttpRequest();
            xhr.open( 'POST', lpcEditor.ajaxUrl );
            xhr.onload  = function () { if ( callback ) { callback(); } };
            xhr.onerror = function () { els.saving.textContent = 'Error saving.'; };
            xhr.send( data );
        }

        /** Flash a brief "Saved âœ“" message. */
        function showSaved() {
            els.saving.textContent = 'Saved \u2713';
            els.saving.classList.add( 'lpc-saving-indicator--visible' );
            setTimeout( function () {
                els.saving.classList.remove( 'lpc-saving-indicator--visible' );
            }, 2000 );
        }

        // Initialise UI.
        setActiveSide( 'before' );
        // Dispatch setposition(75) to show "before" side without a side-effect click.
        slider.dispatchEvent( new CustomEvent( 'lpc:setposition', { detail: { position: 75 } } ) );
    }

    // â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    /**
     * Parse inline transform CSS from an image element into a state object.
     *
     * @param {HTMLImageElement|null} img
     * @param {{ scale:number, offsetX:number, offsetY:number, rotate:number }} s
     */
    function parseExistingTransform( img, s, slider ) {
        if ( ! img ) {
            return;
        }
        // Read scale and rotate from transform string first (needed for legacy fallback).
        if ( img.style.transform ) {
            var t  = img.style.transform;
            var ms = t.match( /scale\(\s*([-\d.]+)\s*\)/ );
            var mr = t.match( /rotate\(\s*([-\d.]+)deg\s*\)/ );
            if ( ms ) { s.scale  = parseFloat( ms[ 1 ] ); }
            if ( mr ) { s.rotate = parseFloat( mr[ 1 ] ); }
        }
        // Read offsetX/Y from object-position (new model: opX = 50 - offsetX).
        if ( img.style.objectPosition ) {
            var op = img.style.objectPosition.split( /\s+/ );
            if ( op.length >= 2 ) {
                var opX = parseFloat( op[ 0 ] );
                var opY = parseFloat( op[ 1 ] );
                if ( ! isNaN( opX ) ) { s.offsetX = clamp( 50 - opX, -50, 50 ); }
                if ( ! isNaN( opY ) ) { s.offsetY = clamp( 50 - opY, -50, 50 ); }
            }
        } else if ( img.style.transform && s.scale > 1 ) {
            // Legacy fallback: translate was offsetX*(scale-1). Reverse: offsetX = txPct/(scale-1).
            var mt = img.style.transform.match( /translate\(\s*([-\d.]+)%\s*,\s*([-\d.]+)%\s*\)/ );
            if ( mt ) {
                s.offsetX = clamp( parseFloat( mt[ 1 ] ) / ( s.scale - 1 ), -50, 50 );
                s.offsetY = clamp( parseFloat( mt[ 2 ] ) / ( s.scale - 1 ), -50, 50 );
            }
        }
    }

    /**
     * Build the inner HTML for the editor panel.
     *
     * @returns {string}
     */
    function buildPanelHTML() {
        var presetBtns = RATIO_PRESETS.map( function ( r ) {
            return '<button type="button" class="lpc-ratio-btn" data-ratio="' + r + '">' + r.replace( '/', ':' ) + '</button>';
        } ).join( '' );

        var widthPresetBtns = WIDTH_PRESETS.map( function ( w ) {
            return '<button type="button" class="lpc-width-btn" data-width="' + w + '">' + w + '</button>';
        } ).join( '' );

        return (
            '<div class="lpc-editor-header">' +
                '<span class="lpc-editor-title">Image positioning</span>' +
                '<div class="lpc-side-tabs">' +
                    '<button type="button" class="lpc-side-tab lpc-side-tab--active" data-side="before">Before</button>' +
                    '<button type="button" class="lpc-side-tab" data-side="after">After</button>' +
                '</div>' +
                '<div class="lpc-direction-toggle">' +
                    '<button type="button" class="lpc-direction-btn" data-dir="horizontal" title="Horizontal">H</button>' +
                    '<button type="button" class="lpc-direction-btn" data-dir="vertical" title="Vertical">V</button>' +
                '</div>' +
            '</div>' +

            '<div class="lpc-control-group">' +
                '<div class="lpc-control">' +
                    '<label>Zoom</label>' +
                    '<div class="lpc-control-row">' +
                        '<input type="range" class="lpc-range-zoom" min="1" max="3" step="0.01" value="1">' +
                        '<span class="lpc-control-value lpc-val-zoom">1.00x</span>' +
                    '</div>' +
                '</div>' +
                '<div class="lpc-control">' +
                    '<label>Rotate</label>' +
                    '<div class="lpc-control-row">' +
                        '<input type="range" class="lpc-range-rotate" min="-180" max="180" step="1" value="0">' +
                        '<span class="lpc-control-value lpc-val-rotate">0\u00B0</span>' +
                    '</div>' +
                '</div>' +
                '<div class="lpc-control">' +
                    '<label>Pan X</label>' +
                    '<div class="lpc-control-row">' +
                        '<input type="range" class="lpc-range-panx" min="-50" max="50" step="0.5" value="0">' +
                        '<span class="lpc-control-value lpc-val-panx">0.0%</span>' +
                    '</div>' +
                '</div>' +
                '<div class="lpc-control">' +
                    '<label>Pan Y</label>' +
                    '<div class="lpc-control-row">' +
                        '<input type="range" class="lpc-range-pany" min="-50" max="50" step="0.5" value="0">' +
                        '<span class="lpc-control-value lpc-val-pany">0.0%</span>' +
                    '</div>' +
                '</div>' +

                '<div class="lpc-control lpc-control--full">' +
                    '<label>Aspect ratio</label>' +
                    '<div class="lpc-ratio-row">' +
                        '<div class="lpc-ratio-presets">' + presetBtns + '</div>' +
                        '<input type="text" class="lpc-ratio-custom" placeholder="e.g. 5/4" maxlength="9">' +
                    '</div>' +
                '</div>' +

                '<div class="lpc-control lpc-control--full">' +
                    '<label>Container width</label>' +
                    '<div class="lpc-control-row">' +
                        '<input type="range" class="lpc-range-width" min="20" max="100" step="5" value="100">' +
                        '<span class="lpc-control-value lpc-val-width">100%</span>' +
                    '</div>' +
                    '<div class="lpc-width-presets">' + widthPresetBtns + '</div>' +
                '</div>' +

                '<div class="lpc-control lpc-control--full">' +
                    '<button type="button" class="lpc-media-btn">\uD83D\uDCF7 Choose image</button>' +
                '</div>' +
            '</div>' +

            '<div class="lpc-blur-section">' +
                '<div class="lpc-blur-header">' +
                    '<span class="lpc-blur-title">Privacy blur</span>' +
                    '<label class="lpc-toggle">' +
                        '<input type="checkbox" class="lpc-blur-enabled">' +
                        '<span class="lpc-toggle-track"><span class="lpc-toggle-thumb"></span></span>' +
                    '</label>' +
                '</div>' +
                '<div class="lpc-blur-controls">' +
                    '<div class="lpc-blur-grid">' +
                        '<div class="lpc-control">' +
                            '<label>Intensity</label>' +
                            '<div class="lpc-control-row">' +
                                '<input type="range" class="lpc-range-blur-intensity" min="5" max="50" step="1" value="20">' +
                                '<span class="lpc-control-value lpc-val-blur-intensity">20px</span>' +
                            '</div>' +
                        '</div>' +
                        '<div class="lpc-control">' +
                            '<label>Feather</label>' +
                            '<div class="lpc-control-row">' +
                                '<input type="range" class="lpc-range-blur-feather" min="0" max="50" step="1" value="8">' +
                                '<span class="lpc-control-value lpc-val-blur-feather">8px</span>' +
                            '</div>' +
                        '</div>' +
                        '<div class="lpc-control">' +
                            '<label>Width</label>' +
                            '<div class="lpc-control-row">' +
                                '<input type="range" class="lpc-range-blur-w" min="5" max="100" step="1" value="70">' +
                                '<span class="lpc-control-value lpc-val-blur-w">70%</span>' +
                            '</div>' +
                        '</div>' +
                        '<div class="lpc-control">' +
                            '<label>Height</label>' +
                            '<div class="lpc-control-row">' +
                                '<input type="range" class="lpc-range-blur-h" min="3" max="100" step="1" value="12">' +
                                '<span class="lpc-control-value lpc-val-blur-h">12%</span>' +
                            '</div>' +
                        '</div>' +
                        '<div class="lpc-control lpc-control--full">' +
                            '<label>Rotation</label>' +
                            '<div class="lpc-control-row">' +
                                '<input type="range" class="lpc-range-blur-rotate" min="-45" max="45" step="1" value="0">' +
                                '<span class="lpc-control-value lpc-val-blur-rotate">0\u00B0</span>' +
                            '</div>' +
                        '</div>' +
                        '<div class="lpc-control lpc-control--full">' +
                            '<div class="lpc-blur-presets">' +
                                '<button type="button" class="lpc-blur-preset" data-preset="eyes">Eye strip</button>' +
                                '<button type="button" class="lpc-blur-preset" data-preset="face">Full face</button>' +
                            '</div>' +
                            '<div class="lpc-blur-hint">Hold <kbd>Ctrl</kbd> and drag to position</div>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</div>' +

            '<div class="lpc-editor-actions">' +
                '<button type="button" class="lpc-btn lpc-btn--danger">Reset</button>' +
                '<span class="lpc-saving-indicator"></span>' +
                '<button type="button" class="lpc-btn lpc-btn--primary">Save</button>' +
            '</div>'
        );
    }

    /** Initialise editors for all editable sliders on the page. */
    function init() {
        document.querySelectorAll( '.lpc-compare[data-lpc-editable]' ).forEach( buildEditor );
    }

    if ( document.readyState === 'loading' ) {
        document.addEventListener( 'DOMContentLoaded', init );
    } else {
        init();
    }
} )();
