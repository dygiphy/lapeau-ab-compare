/**
 * Lapeau A/B Compare â€“ Inline WYSIWYG editor.
 *
 * Loaded only for logged-in editors. Adds a control panel below each
 * editable slider that manipulates the SAME CSS transform properties the
 * public view uses â€” ensuring true WYSIWYG.
 *
 * Coverage enforcement:
 *   - Pan is clamped to (scale âˆ’ 1) / 2 Ã— 100 % per axis so the image
 *     always fully covers the container.
 *   - Rotate snaps to 90Â° multiples. At 90Â°/270Â° the minimum scale is
 *     auto-raised to max(cW/cH, cH/cW) and pan is zeroed (because pan
 *     axes are swapped by the rotation).
 *
 * @package Lapeau_AB_Compare
 * @version 1.3.0
 */
( function () {
    'use strict';

    /* global lpcEditor */

    /** Preset aspect ratios shown as toggles. */
    var RATIO_PRESETS = [ '1/1', '4/3', '3/4', '16/9', '9/16' ];

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
     * Return the maximum safe pan percentage for a given scale at 0Â°/180Â°.
     * At scale = 1 object-fit:cover exactly fills the container; any pan
     * would reveal the background.
     *
     * @param {number} scale
     * @returns {number} max absolute pan % per axis
     */
    function maxPanForScale( scale ) {
        return ( scale - 1 ) / 2 * 100;
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
     * Enforce coverage constraints on the given side state object:
     * - Clamp pan to safe range for current scale.
     * - At non-0Â°/180Â° rotation, zero the pan (axes are swapped).
     *
     * @param {{ scale:number, offsetX:number, offsetY:number, rotate:number }} s
     */
    function enforceCoverage( s ) {
        var norm = ( ( s.rotate % 360 ) + 360 ) % 360;
        if ( norm === 90 || norm === 270 ) {
            // Pan is meaningless / wrong-axis after 90Â° rotation in this transform model.
            s.offsetX = 0;
            s.offsetY = 0;
        } else {
            var mp = maxPanForScale( s.scale );
            s.offsetX = clamp( s.offsetX, -mp, mp );
            s.offsetY = clamp( s.offsetY, -mp, mp );
        }
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

        // Read any saved transforms already rendered as inline styles.
        parseExistingTransform( slider.querySelector( '.lpc-img--before' ), state.before );
        parseExistingTransform( slider.querySelector( '.lpc-img--after'  ), state.after  );

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
            ratioBtns:  panel.querySelectorAll( '[data-ratio]'         )
        };

        // â”€â”€ Toggle open/close â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        toggleBtn.addEventListener( 'click', function ( e ) {
            e.stopPropagation();
            var isOpen = panel.classList.toggle( 'lpc-editor-panel--open' );
            slider.classList.toggle( 'lpc-compare--editing', isOpen );
            if ( isOpen ) {
                positionPanel();
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

            // Disable pan when rotation prevents safe axis-aligned pan.
            var norm = ( ( s.rotate % 360 ) + 360 ) % 360;
            var panDisabled = ( norm === 90 || norm === 270 );
            els.panX.disabled = panDisabled;
            els.panY.disabled = panDisabled;

            // Update pan range limits to reflect current scale.
            var mp = panDisabled ? 0 : maxPanForScale( s.scale );
            els.panX.min = -mp; els.panX.max = mp;
            els.panY.min = -mp; els.panY.max = mp;
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
            var s     = state[ side ];
            var parts = [];
            if ( s.offsetX !== 0 || s.offsetY !== 0 ) {
                parts.push( 'translate(' + s.offsetX + '%, ' + s.offsetY + '%)' );
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
            var s     = state[ activeSide ];
            s.scale   = parseFloat( els.zoom.value );
            els.zoomVal.textContent = s.scale.toFixed( 2 ) + 'x';
            // Pan bounds shrink when zooming out â€” clamp and update sliders.
            enforceCoverage( s );
            els.panX.value = s.offsetX;
            els.panXVal.textContent = s.offsetX.toFixed( 1 ) + '%';
            els.panY.value = s.offsetY;
            els.panYVal.textContent = s.offsetY.toFixed( 1 ) + '%';
            var mp = maxPanForScale( s.scale );
            els.panX.min = -mp; els.panX.max = mp;
            els.panY.min = -mp; els.panY.max = mp;
            applyTransform( activeSide );
        } );

        // â”€â”€ Pan X â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        els.panX.addEventListener( 'input', function () {
            var s   = state[ activeSide ];
            var raw = parseFloat( els.panX.value );
            var mp  = maxPanForScale( s.scale );
            s.offsetX = clamp( raw, -mp, mp );
            els.panX.value = s.offsetX;
            els.panXVal.textContent = s.offsetX.toFixed( 1 ) + '%';
            applyTransform( activeSide );
        } );

        // â”€â”€ Pan Y â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        els.panY.addEventListener( 'input', function () {
            var s   = state[ activeSide ];
            var raw = parseFloat( els.panY.value );
            var mp  = maxPanForScale( s.scale );
            s.offsetY = clamp( raw, -mp, mp );
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
            var s    = state[ activeSide ];
            var norm = ( ( s.rotate % 360 ) + 360 ) % 360;
            // Only initiate pan when there is room to pan and rotation allows it.
            if ( norm === 90 || norm === 270 || maxPanForScale( s.scale ) === 0 ) {
                return;
            }
            dragActive = true;
            dragLastX  = e.clientX;
            dragLastY  = e.clientY;
            slider.setPointerCapture( e.pointerId );
            slider.classList.add( 'lpc-compare--panning-active' );
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

            var mp   = maxPanForScale( s.scale );
            s.offsetX = clamp( s.offsetX + ( dx / rect.width  * 100 ), -mp, mp );
            s.offsetY = clamp( s.offsetY + ( dy / rect.height * 100 ), -mp, mp );

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

        // -- Shift-key preview -----------------------------------------------
        //
        // While Shift is held the slider divider becomes draggable again so the
        // editor can preview position changes live. A class drives the cursor.

        window.addEventListener( 'keydown', function ( e ) {
            if ( e.key === 'Shift' && panel.classList.contains( 'lpc-editor-panel--open' ) ) {
                slider.classList.add( 'lpc-compare--shift-preview' );
            }
        } );

        window.addEventListener( 'keyup', function ( e ) {
            if ( e.key === 'Shift' ) {
                slider.classList.remove( 'lpc-compare--shift-preview' );
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

            // Pan bounds change with scale -- clamp and sync controls.
            enforceCoverage( s );
            var mp = maxPanForScale( s.scale );
            els.panX.min = -mp; els.panX.max = mp;
            els.panY.min = -mp; els.panY.max = mp;
            els.panX.value = s.offsetX;
            els.panXVal.textContent = s.offsetX.toFixed( 1 ) + '%';
            els.panY.value = s.offsetY;
            els.panYVal.textContent = s.offsetY.toFixed( 1 ) + '%';

            applyTransform( activeSide );
        }, { passive: false } );

        els.resetBtn.addEventListener( 'click', function () {
            state[ activeSide ] = { scale: 1, offsetX: 0, offsetY: 0, rotate: 0 };
            syncControlsToState();
            applyTransform( activeSide );
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
                    slider.dataset[ activeSide + 'Url' ] = attachment.url;
                }
            } );
            frame.open();
        } );

        // â”€â”€ Save â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        els.saveBtn.addEventListener( 'click', function () {
            saveSide( 'before', function () {
                saveSide( 'after', showSaved );
            } );
        } );

        /**
         * POST one side's transform data (plus ratio) to the AJAX endpoint.
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

            var imgUrl = slider.dataset[ side + 'Url' ] || '';
            if ( imgUrl ) {
                data.append( 'image_url', imgUrl );
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
    function parseExistingTransform( img, s ) {
        if ( ! img || ! img.style.transform ) {
            return;
        }
        var t = img.style.transform;
        var m;
        m = t.match( /translate\(\s*([-\d.]+)%\s*,\s*([-\d.]+)%\s*\)/ );
        if ( m ) { s.offsetX = parseFloat( m[1] ); s.offsetY = parseFloat( m[2] ); }
        m = t.match( /scale\(\s*([-\d.]+)\s*\)/ );
        if ( m ) { s.scale = parseFloat( m[1] ); }
        m = t.match( /rotate\(\s*([-\d.]+)deg\s*\)/ );
        if ( m ) { s.rotate = parseFloat( m[1] ); }
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
                        '<input type="range" class="lpc-range-panx" min="0" max="0" step="0.5" value="0">' +
                        '<span class="lpc-control-value lpc-val-panx">0.0%</span>' +
                    '</div>' +
                '</div>' +
                '<div class="lpc-control">' +
                    '<label>Pan Y</label>' +
                    '<div class="lpc-control-row">' +
                        '<input type="range" class="lpc-range-pany" min="0" max="0" step="0.5" value="0">' +
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
                    '<button type="button" class="lpc-media-btn">\uD83D\uDCF7 Choose image</button>' +
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
