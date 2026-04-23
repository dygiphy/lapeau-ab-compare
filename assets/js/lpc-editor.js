/**
 * Lapeau A/B Compare – Inline WYSIWYG editor.
 *
 * Loaded only for logged-in editors. Adds a control panel below each
 * editable slider that manipulates the SAME CSS properties the
 * public view uses – ensuring true WYSIWYG.
 *
 * Transform model (v2.0.0):
 *   - Single CSS transform: translate(tx px, ty px) rotate(θ deg) scale(s)
 *   - CSS reads right-to-left: scale → rotate → translate in screen space.
 *   - No object-position used – all positioning via transform only.
 *   - Constraint engine ensures 100% container coverage at any rotation/scale:
 *     min scale = max(|cosθ| + (ch/cw)|sinθ|, |cosθ| + (cw/ch)|sinθ|)
 *     Pan clamped in rotated frame then converted back to screen space.
 *
 * Interaction:
 *   - Drag: pan active image (screen-space, side-sensitive).
 *   - Wheel: rotate active image (side-sensitive).
 *   - Ctrl+Drag: position blur mask.
 *   - Shift+Drag: move slider divider.
 *
 * @package Lapeau_AB_Compare
 * @version 2.0.0
 */
( function () {
    'use strict';

    /* global lpcEditor */

    /** @type {boolean} */
    var LPC_DEBUG = false;

    function lpcLog() {
        if ( LPC_DEBUG ) {
            console.log.apply( console, [ '[lpc-editor]' ].concat( Array.prototype.slice.call( arguments ) ) );
        }
    }

    var RATIO_PRESETS = [ '1/1', '4/3', '3/4', '16/9', '9/16' ];
    var WIDTH_PRESETS = [ '100%', '80%', '60%', '50%', '40%' ];

    function clamp( val, min, max ) {
        return Math.min( Math.max( val, min ), max );
    }

    /* ═══════════════════════════════════════════════════════════════════
     *  Constraint engine – ensures 100% coverage of the container.
     *
     *  The image element has position:absolute; inset:0; width:100%;
     *  height:100%; object-fit:cover – so at scale=1 rotation=0 it
     *  exactly fills the container (cw × ch). Pan is applied via
     *  object-position (moves image content within the static element),
     *  not CSS translate (which moves the element and exposes background).
     *  Pan limits come from the object-fit:cover overflow computed from
     *  img.naturalWidth / naturalHeight – independent of rotation/scale.
     * ═══════════════════════════════════════════════════════════════════ */

    /**
     * Compute the maximum pan offset (element-space px) available from the
     * object-fit:cover overflow for an image in a container, accounting for
     * the current zoom scale.
     *
     * When transform:scale(s) is applied to the image element, the visible
     * window in element-local space shrinks to cw/s × ch/s (centred). The
     * image (k×natural, from object-fit:cover) must still cover that window,
     * so the available pan range grows with scale:
     *
     *   maxPanX = max(0, (k·iw − cw/s) / 2)
     *   maxPanY = max(0, (k·ih − ch/s) / 2)
     *
     * At s=1 this equals the plain object-fit:cover overflow.
     *
     * @param {number} iw    – Image natural width.
     * @param {number} ih    – Image natural height.
     * @param {number} cw    – Container width (px).
     * @param {number} ch    – Container height (px).
     * @param {number} scale – Current CSS transform scale (default 1).
     * @returns {{ maxPanX: number, maxPanY: number }}
     */
    function coverPanRange( iw, ih, cw, ch, scale ) {
        if ( ! iw || ! ih ) { return { maxPanX: 0, maxPanY: 0 }; }
        var s = scale || 1;
        var k = Math.max( cw / iw, ch / ih );
        return {
            maxPanX: Math.max( 0, ( iw * k - cw / s ) / 2 ),
            maxPanY: Math.max( 0, ( ih * k - ch / s ) / 2 )
        };
    }

    /**
     * Minimum scale for a rotated rectangle of the same base size as the
     * container to fully cover the container.
     *
     * @param {number} cw       – Container width (px).
     * @param {number} ch       – Container height (px).
     * @param {number} angleDeg – Rotation in degrees.
     * @returns {number}
     */
    function minScaleForRotation( cw, ch, angleDeg ) {
        var rad  = angleDeg * Math.PI / 180;
        var cosA = Math.abs( Math.cos( rad ) );
        var sinA = Math.abs( Math.sin( rad ) );
        return Math.max(
            cosA + ( ch / cw ) * sinA,
            cosA + ( cw / ch ) * sinA
        );
    }

    /**
     * Build the CSS transform string for scale + rotation only (no translate).
     * Pan is handled separately via object-position.
     *
     * @param {{ scale: number, rotate: number }} s
     * @returns {string}
     */
    function buildTransformCSS( s ) {
        var parts = [];
        if ( Math.abs( s.rotate ) > 0.01 ) {
            parts.push( 'rotate(' + s.rotate.toFixed( 2 ) + 'deg)' );
        }
        if ( Math.abs( s.scale - 1 ) > 0.0001 ) {
            parts.push( 'scale(' + s.scale.toFixed( 4 ) + ')' );
        }
        return parts.join( ' ' );
    }

    /* ═══════════════════════════════════════════════════════════════════
     *  Editor builder
     * ═══════════════════════════════════════════════════════════════════ */

    function buildEditor( slider ) {
        var id = slider.id;
        if ( ! id ) { return; }

        // Per-side transform state (new model: pixel translations, free rotation).
        var state = {
            before: { scale: 1, rotate: 0, tx: 0, ty: 0 },
            after:  { scale: 1, rotate: 0, tx: 0, ty: 0 }
        };

        var activeSide   = 'before';
        var currentRatio = ( slider.style.aspectRatio || '4/3' ).replace( /\s/g, '' );
        var currentWidth = slider.dataset.lpcWidth || '';

        // Privacy blur mask state (slider-level).
        var blurState = {
            enabled: false, x: 15, y: 25, w: 70, h: 12,
            rotate: 0, intensity: 20, feather: 8
        };

        // Hydrate blur state from data attribute.
        if ( slider.dataset.lpcBlur ) {
            try {
                var savedBlur = JSON.parse( slider.dataset.lpcBlur );
                if ( savedBlur.enabled   !== undefined ) { blurState.enabled   = !! savedBlur.enabled; }
                if ( savedBlur.x         !== undefined ) { blurState.x         = parseFloat( savedBlur.x ); }
                if ( savedBlur.y         !== undefined ) { blurState.y         = parseFloat( savedBlur.y ); }
                if ( savedBlur.w         !== undefined ) { blurState.w         = parseFloat( savedBlur.w ); }
                if ( savedBlur.h         !== undefined ) { blurState.h         = parseFloat( savedBlur.h ); }
                if ( savedBlur.rotate    !== undefined ) { blurState.rotate    = parseFloat( savedBlur.rotate ); }
                if ( savedBlur.intensity !== undefined ) { blurState.intensity = parseFloat( savedBlur.intensity ); }
                if ( savedBlur.feather   !== undefined ) { blurState.feather   = parseFloat( savedBlur.feather ); }
            } catch ( e ) { /* ignore */ }
        }

        // Read saved transforms from inline styles.
        parseExistingTransform( slider.querySelector( '.lpc-img--before' ), state.before );
        parseExistingTransform( slider.querySelector( '.lpc-img--after'  ), state.after  );

        lpcLog( 'buildEditor:', id, JSON.stringify( state ) );

        // ── Edit toggle button ──────────────────────────────────────────
        var toggleBtn = document.createElement( 'button' );
        toggleBtn.className   = 'lpc-edit-toggle';
        toggleBtn.type        = 'button';
        toggleBtn.textContent = '\u270E';
        toggleBtn.title       = 'Edit image positioning';
        slider.appendChild( toggleBtn );

        // ── Panel (appended to body to escape overflow:hidden) ──────────
        var panel = document.createElement( 'div' );
        panel.className = 'lpc-editor-panel';
        document.body.appendChild( panel );
        panel.innerHTML = buildPanelHTML();

        function positionPanel() {
            var rect = slider.getBoundingClientRect();
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

        // ── Blur mask element ───────────────────────────────────────────
        var blurMaskEl = slider.querySelector( '.lpc-blur-mask' );
        if ( ! blurMaskEl ) {
            blurMaskEl = document.createElement( 'div' );
            blurMaskEl.className = 'lpc-blur-mask';
            var dividerRef = slider.querySelector( '.lpc-divider' );
            if ( dividerRef ) {
                slider.insertBefore( blurMaskEl, dividerRef );
            } else {
                slider.appendChild( blurMaskEl );
            }
        }
        blurMaskEl.style.display = blurState.enabled ? '' : 'none';

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

        function syncBlurControls() {
            els.blurEnabled.checked = blurState.enabled;
            els.blurControls.classList.toggle( 'lpc-blur-controls--visible', blurState.enabled );
            els.blurIntensity.value         = blurState.intensity;
            els.blurIntensityVal.textContent = blurState.intensity + 'px';
            els.blurFeather.value           = blurState.feather;
            els.blurFeatherVal.textContent   = blurState.feather + 'px';
            els.blurW.value                 = blurState.w;
            els.blurWVal.textContent         = blurState.w + '%';
            els.blurH.value                 = blurState.h;
            els.blurHVal.textContent         = blurState.h + '%';
            els.blurRotate.value            = blurState.rotate;
            els.blurRotateVal.textContent    = blurState.rotate + '\u00B0';
        }

        syncBlurControls();
        applyBlur();

        // ── Toggle open/close ───────────────────────────────────────────
        toggleBtn.addEventListener( 'click', function ( e ) {
            e.stopPropagation();
            var isOpen = panel.classList.toggle( 'lpc-editor-panel--open' );
            slider.classList.toggle( 'lpc-compare--editing', isOpen );
            if ( isOpen ) {
                positionPanel();
                lpcLog( 'Panel opened for', id );
            }
        } );

        function onViewportChange() {
            if ( panel.classList.contains( 'lpc-editor-panel--open' ) ) {
                positionPanel();
            }
        }
        window.addEventListener( 'scroll', onViewportChange, { passive: true } );
        window.addEventListener( 'resize', onViewportChange, { passive: true } );

        // ── Side tabs ───────────────────────────────────────────────────

        function setActiveSide( side ) {
            activeSide = side;
            els.tabBefore.classList.toggle( 'lpc-side-tab--active', side === 'before' );
            els.tabAfter.classList.toggle(  'lpc-side-tab--active', side === 'after'  );
            syncControlsToState();
            var snapPos = side === 'before' ? 75 : 25;
            slider.dispatchEvent( new CustomEvent( 'lpc:setposition', { detail: { position: snapPos } } ) );
        }

        els.tabBefore.addEventListener( 'click', function () { setActiveSide( 'before' ); } );
        els.tabAfter.addEventListener(  'click', function () { setActiveSide( 'after'  ); } );

        // ── Apply transform (THE core function) ─────────────────────────

        /**
         * Enforce constraints and apply CSS to the image element.
         *
         * @param {string} side – "before" or "after".
         */
        function applyTransform( side ) {
            var img = slider.querySelector( '.lpc-img--' + side );
            if ( ! img ) { return; }

            var s    = state[ side ];
            var rect = slider.getBoundingClientRect();
            var cw   = rect.width;
            var ch   = rect.height;

            if ( cw < 1 || ch < 1 ) { return; }

            // Enforce minimum scale for rotation coverage.
            var sMin = minScaleForRotation( cw, ch, s.rotate );
            if ( s.scale < sMin ) {
                s.scale = sMin;
            }

            // Clamp pan using object-fit:cover overflow (independent of rotation/scale).
            var range = coverPanRange( img.naturalWidth, img.naturalHeight, cw, ch, s.scale );
            s.tx = clamp( s.tx, -range.maxPanX, range.maxPanX );
            s.ty = clamp( s.ty, -range.maxPanY, range.maxPanY );

            // Apply CSS (WYSIWYG – same CSS the PHP render produces).
            // Pan via object-position; scale+rotate via transform.
            img.style.transform = buildTransformCSS( s ) || '';
            if ( Math.abs( s.tx ) > 0.01 || Math.abs( s.ty ) > 0.01 ) {
                img.style.objectPosition = 'calc(50% + ' + s.tx.toFixed( 2 ) + 'px) calc(50% + ' + s.ty.toFixed( 2 ) + 'px)';
            } else {
                img.style.objectPosition = '';
            }
        }

        function applyBothTransforms() {
            applyTransform( 'before' );
            applyTransform( 'after'  );
        }

        // ── Sync controls ↔ state ───────────────────────────────────────

        function syncControlsToState() {
            var s    = state[ activeSide ];
            var img  = slider.querySelector( '.lpc-img--' + activeSide );
            var rect = slider.getBoundingClientRect();
            var cw   = rect.width  || 600;
            var ch   = rect.height || 450;

            els.zoom.value            = s.scale;
            els.zoomVal.textContent   = s.scale.toFixed( 2 ) + 'x';
            els.rotate.value          = s.rotate;
            els.rotateVal.textContent = s.rotate.toFixed( 1 ) + '\u00B0';

            // Pan slider ranges from object-fit:cover overflow (independent of rotation/scale).
            var iw    = img ? ( img.naturalWidth  || cw ) : cw;
            var ih    = img ? ( img.naturalHeight || ch ) : ch;
            var range = coverPanRange( iw, ih, cw, ch, s.scale );
            var maxPanX = Math.max( 1, Math.ceil( range.maxPanX ) );
            var maxPanY = Math.max( 1, Math.ceil( range.maxPanY ) );
            els.panX.min = -maxPanX; els.panX.max = maxPanX;
            els.panY.min = -maxPanY; els.panY.max = maxPanY;
            els.panX.value          = s.tx;
            els.panXVal.textContent = s.tx.toFixed( 1 ) + 'px';
            els.panY.value          = s.ty;
            els.panYVal.textContent = s.ty.toFixed( 1 ) + 'px';
        }

        // ── Zoom control ────────────────────────────────────────────────
        els.zoom.addEventListener( 'input', function () {
            state[ activeSide ].scale = parseFloat( els.zoom.value );
            applyTransform( activeSide );
            syncControlsToState();
        } );

        // ── Pan X control ───────────────────────────────────────────────
        els.panX.addEventListener( 'input', function () {
            state[ activeSide ].tx = parseFloat( els.panX.value );
            applyTransform( activeSide );
            syncControlsToState();
        } );

        // ── Pan Y control ───────────────────────────────────────────────
        els.panY.addEventListener( 'input', function () {
            state[ activeSide ].ty = parseFloat( els.panY.value );
            applyTransform( activeSide );
            syncControlsToState();
        } );

        // ── Rotate control ──────────────────────────────────────────────
        els.rotate.addEventListener( 'input', function () {
            state[ activeSide ].rotate = parseFloat( els.rotate.value );
            applyTransform( activeSide );
            syncControlsToState();
        } );

        // ── Drag-to-pan on slider container ─────────────────────────────

        var dragActive = false;
        var dragLastX  = 0;
        var dragLastY  = 0;

        slider.addEventListener( 'pointerdown', function ( e ) {
            if ( ! panel.classList.contains( 'lpc-editor-panel--open' ) ) { return; }
            if ( e.button !== 0 ) { return; }
            if ( e.target.closest( '.lpc-edit-toggle' ) ) { return; }
            // Shift → slider divider drag.
            if ( e.shiftKey ) { return; }
            // Ctrl/Meta → blur mask positioning.
            if ( e.ctrlKey || e.metaKey ) { return; }

            e.preventDefault();
            dragActive = true;
            dragLastX  = e.clientX;
            dragLastY  = e.clientY;
            slider.setPointerCapture( e.pointerId );
            slider.classList.add( 'lpc-compare--panning-active' );
        } );

        slider.addEventListener( 'pointermove', function ( e ) {
            if ( ! dragActive ) { return; }
            var s  = state[ activeSide ];
            var dx = e.clientX - dragLastX;
            var dy = e.clientY - dragLastY;
            dragLastX = e.clientX;
            dragLastY = e.clientY;

            // Convert screen-space delta to element-local delta:
            // reverse the element's CSS rotation then divide by scale so
            // dragging feels 1:1 with content movement on screen.
            var rad  = s.rotate * Math.PI / 180;
            var cosT = Math.cos( rad );
            var sinT = Math.sin( rad );
            s.tx += (  dx * cosT + dy * sinT ) / s.scale;
            s.ty += ( -dx * sinT + dy * cosT ) / s.scale;
            applyTransform( activeSide );
            syncControlsToState();
        } );

        function endDrag() {
            if ( ! dragActive ) { return; }
            dragActive = false;
            slider.classList.remove( 'lpc-compare--panning-active' );
        }

        slider.addEventListener( 'pointerup',     endDrag );
        slider.addEventListener( 'pointercancel', endDrag );

        // ── Auto side-switch on hover ───────────────────────────────────

        slider.addEventListener( 'pointermove', function ( e ) {
            if ( ! panel.classList.contains( 'lpc-editor-panel--open' ) ) { return; }
            if ( dragActive ) { return; }
            var rect       = slider.getBoundingClientRect();
            var dividerEl  = slider.querySelector( '.lpc-divider' );
            var isVert     = slider.dataset.direction === 'vertical';
            var dividerPct = dividerEl
                ? ( parseFloat( isVert ? dividerEl.style.top : dividerEl.style.left ) || 50 )
                : 50;
            var pct = isVert
                ? ( e.clientY - rect.top  ) / rect.height * 100
                : ( e.clientX - rect.left ) / rect.width  * 100;
            var hoveredSide = ( pct <= dividerPct ) ? 'before' : 'after';
            if ( hoveredSide !== activeSide ) {
                activeSide = hoveredSide;
                els.tabBefore.classList.toggle( 'lpc-side-tab--active', activeSide === 'before' );
                els.tabAfter.classList.toggle(  'lpc-side-tab--active', activeSide === 'after'  );
                syncControlsToState();
            }
        } );

        // ── Shift-key preview (slider divider draggable) ────────────────

        window.addEventListener( 'keydown', function ( e ) {
            if ( e.key === 'Shift' && panel.classList.contains( 'lpc-editor-panel--open' ) ) {
                slider.classList.add( 'lpc-compare--shift-preview' );
            }
            if ( ( e.key === 'Control' || e.key === 'Meta' ) &&
                 panel.classList.contains( 'lpc-editor-panel--open' ) && blurState.enabled ) {
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

        // ── Mouse wheel → zoom ──────────────────────────────────────────

        slider.addEventListener( 'wheel', function ( e ) {
            if ( ! panel.classList.contains( 'lpc-editor-panel--open' ) ) { return; }
            e.preventDefault();

            var s     = state[ activeSide ];
            var delta = e.deltaY > 0 ? -0.05 : 0.05;
            if ( e.shiftKey ) { delta *= 0.2; }  // Fine control.

            s.scale = clamp( s.scale + delta, 1, 3 );
            applyTransform( activeSide );
            syncControlsToState();
        }, { passive: false } );

        // ── Reset ───────────────────────────────────────────────────────

        els.resetBtn.addEventListener( 'click', function () {
            state.before = { scale: 1, rotate: 0, tx: 0, ty: 0 };
            state.after  = { scale: 1, rotate: 0, tx: 0, ty: 0 };
            syncControlsToState();
            applyBothTransforms();
            blurState.enabled = false;
            blurState.x = 15; blurState.y = 25;
            blurState.w = 70; blurState.h = 12;
            blurState.rotate = 0; blurState.intensity = 20; blurState.feather = 8;
            syncBlurControls();
            applyBlur();
        } );

        // ── Direction toggle ────────────────────────────────────────────

        function setDirection( dir ) {
            slider.dataset.direction = dir;
            slider.classList.remove( 'lpc-compare--horizontal', 'lpc-compare--vertical' );
            slider.classList.add( 'lpc-compare--' + dir );
            els.dirH.classList.toggle( 'lpc-direction-btn--active', dir === 'horizontal' );
            els.dirV.classList.toggle( 'lpc-direction-btn--active', dir === 'vertical'   );
            slider.dispatchEvent( new CustomEvent( 'lpc:refresh' ) );
        }

        els.dirH.addEventListener( 'click', function () { setDirection( 'horizontal' ); } );
        els.dirV.addEventListener( 'click', function () { setDirection( 'vertical'   ); } );

        var currentDir = slider.dataset.direction || 'horizontal';
        els.dirH.classList.toggle( 'lpc-direction-btn--active', currentDir === 'horizontal' );
        els.dirV.classList.toggle( 'lpc-direction-btn--active', currentDir === 'vertical'   );

        // ── Aspect ratio ────────────────────────────────────────────────

        function applyRatio( ratioStr ) {
            if ( ! /^\d+\/\d+$/.test( ratioStr ) ) { return; }
            currentRatio = ratioStr;
            slider.dispatchEvent( new CustomEvent( 'lpc:setratio', { detail: { ratio: ratioStr } } ) );
            setTimeout( function () {
                applyBothTransforms();
                positionPanel();
            }, 50 );
            els.ratioBtns.forEach( function ( btn ) {
                btn.classList.toggle( 'lpc-ratio-btn--active', btn.dataset.ratio === ratioStr );
            } );
            els.ratioInput.value = ratioStr.replace( '/', ':' );
        }

        els.ratioBtns.forEach( function ( btn ) {
            btn.classList.toggle( 'lpc-ratio-btn--active', btn.dataset.ratio === currentRatio );
            btn.addEventListener( 'click', function () { applyRatio( btn.dataset.ratio ); } );
        } );
        els.ratioInput.value = currentRatio.replace( '/', ':' );
        els.ratioInput.addEventListener( 'change', function () {
            applyRatio( els.ratioInput.value.trim().replace( ':', '/' ) );
        } );

        // ── Container width ─────────────────────────────────────────────

        function updateWidthBtnState() {
            var active = currentWidth || '100%';
            els.widthBtns.forEach( function ( btn ) {
                btn.classList.toggle( 'lpc-width-btn--active', btn.dataset.width === active );
            } );
        }

        function applyWidth( widthVal ) {
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
            setTimeout( function () {
                applyBothTransforms();
                positionPanel();
            }, 50 );
        }

        var initWidthPct = /^\d+%$/.test( currentWidth ) ? parseInt( currentWidth, 10 ) : 100;
        els.widthRange.value     = initWidthPct;
        els.widthVal.textContent = currentWidth || '100%';
        updateWidthBtnState();

        els.widthRange.addEventListener( 'input', function () {
            applyWidth( els.widthRange.value + '%' );
        } );
        els.widthBtns.forEach( function ( btn ) {
            btn.addEventListener( 'click', function () { applyWidth( btn.dataset.width ); } );
        } );

        // ── Media library ───────────────────────────────────────────────

        els.mediaBtn.addEventListener( 'click', function () {
            if ( ! window.wp || ! window.wp.media ) { return; }
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
                    img.removeAttribute( 'srcset' );
                    slider.dataset[ activeSide + 'Url' ] = attachment.url;
                    slider.dataset[ activeSide + 'Id'  ] = attachment.id;
                }
            } );
            frame.open();
        } );

        // ── Blur controls ───────────────────────────────────────────────

        els.blurEnabled.addEventListener( 'change', function () {
            blurState.enabled = els.blurEnabled.checked;
            els.blurControls.classList.toggle( 'lpc-blur-controls--visible', blurState.enabled );
            applyBlur();
        } );

        els.blurIntensity.addEventListener( 'input', function () {
            blurState.intensity = parseInt( els.blurIntensity.value, 10 );
            els.blurIntensityVal.textContent = blurState.intensity + 'px';
            applyBlur();
        } );

        els.blurFeather.addEventListener( 'input', function () {
            blurState.feather = parseInt( els.blurFeather.value, 10 );
            els.blurFeatherVal.textContent = blurState.feather + 'px';
            applyBlur();
        } );

        els.blurW.addEventListener( 'input', function () {
            blurState.w = parseInt( els.blurW.value, 10 );
            els.blurWVal.textContent = blurState.w + '%';
            blurState.x = clamp( blurState.x, 0, 100 - blurState.w );
            applyBlur();
        } );

        els.blurH.addEventListener( 'input', function () {
            blurState.h = parseInt( els.blurH.value, 10 );
            els.blurHVal.textContent = blurState.h + '%';
            blurState.y = clamp( blurState.y, 0, 100 - blurState.h );
            applyBlur();
        } );

        els.blurRotate.addEventListener( 'input', function () {
            blurState.rotate = parseInt( els.blurRotate.value, 10 );
            els.blurRotateVal.textContent = blurState.rotate + '\u00B0';
            applyBlur();
        } );

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

        // ── Ctrl+drag blur mask positioning ─────────────────────────────

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

        // ── Save ────────────────────────────────────────────────────────

        els.saveBtn.addEventListener( 'click', function () {
            saveSide( 'before', function () {
                saveSide( 'after', showSaved );
            } );
        } );

        function saveSide( side, callback ) {
            els.saving.textContent = 'Saving\u2026';
            els.saving.classList.add( 'lpc-saving-indicator--visible' );

            var s    = state[ side ];
            var data = new FormData();
            data.append( 'action',    'lpc_save_transform' );
            data.append( 'nonce',     lpcEditor.nonce );
            data.append( 'post_id',   lpcEditor.postId );
            data.append( 'slider_id', id );
            data.append( 'side',      side );
            data.append( 'scale',     s.scale  );
            data.append( 'tx',        s.tx     );
            data.append( 'ty',        s.ty     );
            data.append( 'rotate',    s.rotate );
            data.append( 'ratio',     currentRatio );
            data.append( 'width',     currentWidth );

            // Blur (slider-level).
            data.append( 'blur_enabled',   blurState.enabled ? '1' : '0' );
            data.append( 'blur_x',         blurState.x );
            data.append( 'blur_y',         blurState.y );
            data.append( 'blur_w',         blurState.w );
            data.append( 'blur_h',         blurState.h );
            data.append( 'blur_rotate',    blurState.rotate );
            data.append( 'blur_intensity', blurState.intensity );
            data.append( 'blur_feather',   blurState.feather );

            var imgUrl = slider.dataset[ side + 'Url' ] || '';
            if ( imgUrl ) { data.append( 'image_url', imgUrl ); }

            var imgId = parseInt( slider.dataset[ side + 'Id' ] || '0', 10 );
            if ( imgId ) { data.append( 'image_id', imgId ); }

            var xhr = new XMLHttpRequest();
            xhr.open( 'POST', lpcEditor.ajaxUrl );
            xhr.onload  = function () { if ( callback ) { callback(); } };
            xhr.onerror = function () { els.saving.textContent = 'Error saving.'; };
            xhr.send( data );
        }

        function showSaved() {
            els.saving.textContent = 'Saved \u2713';
            els.saving.classList.add( 'lpc-saving-indicator--visible' );
            setTimeout( function () {
                els.saving.classList.remove( 'lpc-saving-indicator--visible' );
            }, 2000 );
        }

        // Initialise.
        setActiveSide( 'before' );
        slider.dispatchEvent( new CustomEvent( 'lpc:setposition', { detail: { position: 75 } } ) );
    }

    /* ═══════════════════════════════════════════════════════════════════
     *  Helpers
     * ═══════════════════════════════════════════════════════════════════ */

    /**
     * Parse inline transform CSS from an image element into a state object.
     *
     * Supports both the new model (translate px) and the legacy model
     * (translate %, object-position) for backward compatibility.
     *
     * @param {HTMLImageElement|null} img
     * @param {{ scale: number, rotate: number, tx: number, ty: number }} s
     */
    function parseExistingTransform( img, s ) {
        if ( ! img ) { return; }

        var t = img.style.transform || '';

        // Extract scale.
        var ms = t.match( /scale\(\s*([-\d.]+)\s*\)/ );
        if ( ms ) { s.scale = parseFloat( ms[ 1 ] ); }

        // Extract rotate.
        var mr = t.match( /rotate\(\s*([-\d.]+)deg\s*\)/ );
        if ( mr ) { s.rotate = parseFloat( mr[ 1 ] ); }

        // New model: pan stored as object-position calc(50% ± Xpx) calc(50% ± Ypx).
        var op  = img.style.objectPosition || '';
        var mop = op.match( /calc\(\s*50%\s*([+-])\s*([\d.]+)px\s*\)\s+calc\(\s*50%\s*([+-])\s*([\d.]+)px\s*\)/ );
        if ( mop ) {
            s.tx = parseFloat( mop[ 1 ] + mop[ 2 ] );
            s.ty = parseFloat( mop[ 3 ] + mop[ 4 ] );
            return;
        }

        // Legacy v2.0.0: translate(tx px, ty px) in transform (screen-space pixels).
        // Divide by scale to get approximate element-space pan.
        var mtPx = t.match( /translate\(\s*([-\d.]+)px\s*,\s*([-\d.]+)px\s*\)/ );
        if ( mtPx ) {
            var legacyScale = s.scale || 1;
            s.tx = parseFloat( mtPx[ 1 ] ) / legacyScale;
            s.ty = parseFloat( mtPx[ 2 ] ) / legacyScale;
            return;
        }

        // Legacy v1: translate in % + object-position — treat as zero pan.
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
                        '<input type="range" class="lpc-range-rotate" min="-180" max="180" step="0.5" value="0">' +
                        '<span class="lpc-control-value lpc-val-rotate">0.0\u00B0</span>' +
                    '</div>' +
                '</div>' +
                '<div class="lpc-control">' +
                    '<label>Pan X</label>' +
                    '<div class="lpc-control-row">' +
                        '<input type="range" class="lpc-range-panx" min="-300" max="300" step="0.5" value="0">' +
                        '<span class="lpc-control-value lpc-val-panx">0.0px</span>' +
                    '</div>' +
                '</div>' +
                '<div class="lpc-control">' +
                    '<label>Pan Y</label>' +
                    '<div class="lpc-control-row">' +
                        '<input type="range" class="lpc-range-pany" min="-300" max="300" step="0.5" value="0">' +
                        '<span class="lpc-control-value lpc-val-pany">0.0px</span>' +
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

    function init() {
        document.querySelectorAll( '.lpc-compare[data-lpc-editable]' ).forEach( buildEditor );
    }

    if ( document.readyState === 'loading' ) {
        document.addEventListener( 'DOMContentLoaded', init );
    } else {
        init();
    }
} )();
