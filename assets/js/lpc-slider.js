/**
 * Lapeau A/B Compare – Front-end slider behaviour.
 *
 * Vanilla ES6. Handles pointer/touch drag on the divider to reveal
 * the before/after images via clip-path on .lpc-before.
 *
 * Direction is read dynamically so the editor can switch it live.
 * Listens for lpc:setposition, lpc:refresh, and lpc:setratio events
 * dispatched by the editor.
 *
 * @package Lapeau_AB_Compare
 * @version 1.3.0
 */
( function () {
    'use strict';

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
     * Initialise a single slider instance.
     *
     * @param {HTMLElement} el - The .lpc-compare container.
     */
    function initSlider( el ) {
        var position  = parseFloat( el.dataset.start ) || 50;
        var beforeEl  = el.querySelector( '.lpc-before' );
        var dividerEl = el.querySelector( '.lpc-divider' );
        var handle    = dividerEl ? dividerEl.querySelector( '.lpc-handle' ) : null;
        var dragging  = false;

        if ( ! beforeEl || ! dividerEl ) {
            return;
        }

        /**
         * Read direction dynamically — editor can change data-direction at any time.
         *
         * @returns {boolean}
         */
        function isVertical() {
            return el.dataset.direction === 'vertical';
        }

        /**
         * Apply saved ratio override to the slider and its nearest
         * .lp-concern-slider ancestor (if present) so both match.
         */
        function applyRatioToParent() {
            var r = el.dataset.lpcRatio;
            if ( ! r ) {
                return;
            }
            el.style.aspectRatio = r;
            var parent = el.closest( '.lp-concern-slider' );
            if ( parent ) {
                parent.style.aspectRatio = r;
            }
        }

        /**
         * Apply the current divider position to clip-path and divider offset.
         * Clears the opposite-axis inline style to prevent stale values when
         * direction switches.
         */
        function applyPosition() {
            if ( isVertical() ) {
                beforeEl.style.clipPath = 'inset(0 0 ' + ( 100 - position ) + '% 0)';
                dividerEl.style.top  = position + '%';
                dividerEl.style.left = '';
            } else {
                beforeEl.style.clipPath = 'inset(0 ' + ( 100 - position ) + '% 0 0)';
                dividerEl.style.left = position + '%';
                dividerEl.style.top  = '';
            }
            if ( handle ) {
                handle.setAttribute( 'aria-valuenow', String( Math.round( position ) ) );
            }
        }

        /**
         * Convert a pointer/touch event to a percentage 0–100 along the
         * active direction axis.
         *
         * @param {PointerEvent|TouchEvent} e
         * @returns {number}
         */
        function eventToPercent( e ) {
            var rect    = el.getBoundingClientRect();
            var clientX = e.touches ? e.touches[0].clientX : e.clientX;
            var clientY = e.touches ? e.touches[0].clientY : e.clientY;

            if ( isVertical() ) {
                return clamp( ( ( clientY - rect.top  ) / rect.height ) * 100, 0, 100 );
            }
            return clamp( ( ( clientX - rect.left ) / rect.width  ) * 100, 0, 100 );
        }

        function onPointerDown( e ) {
            if ( e.target.closest( '.lpc-editor-panel' ) || e.target.closest( '.lpc-edit-toggle' ) ) {
                return;
            }
            // When the editor panel is open, allow slider drag only while Shift is held
            // (live preview mode). Without Shift, panning/zoom owns the pointer events.
            if ( el.classList.contains( 'lpc-compare--editing' ) && ! e.shiftKey ) {
                return;
            }
            dragging = true;
            el.classList.add( 'lpc-compare--dragging' );
            el.setPointerCapture( e.pointerId );
            position = eventToPercent( e );
            applyPosition();
            e.preventDefault();
        }

        function onPointerMove( e ) {
            if ( ! dragging ) {
                return;
            }
            position = eventToPercent( e );
            applyPosition();
        }

        function onPointerUp() {
            if ( ! dragging ) {
                return;
            }
            dragging = false;
            el.classList.remove( 'lpc-compare--dragging' );
        }

        el.addEventListener( 'pointerdown',   onPointerDown );
        el.addEventListener( 'pointermove',   onPointerMove );
        el.addEventListener( 'pointerup',     onPointerUp );
        el.addEventListener( 'pointercancel', onPointerUp );

        // Keyboard accessibility.
        if ( handle ) {
            handle.setAttribute( 'role', 'slider' );
            handle.setAttribute( 'tabindex', '0' );
            handle.setAttribute( 'aria-label', 'Comparison slider' );
            handle.setAttribute( 'aria-valuemin', '0' );
            handle.setAttribute( 'aria-valuemax', '100' );

            handle.addEventListener( 'keydown', function ( e ) {
                var step = 2;
                if      ( e.key === 'ArrowLeft'  || e.key === 'ArrowUp'   ) { position = clamp( position - step, 0, 100 ); }
                else if ( e.key === 'ArrowRight' || e.key === 'ArrowDown' ) { position = clamp( position + step, 0, 100 ); }
                else { return; }
                e.preventDefault();
                applyPosition();
            } );
        }

        /**
         * lpc:setposition – editor snaps the handle to reveal a specific side.
         * Expects e.detail.position  (number 0–100).
         */
        el.addEventListener( 'lpc:setposition', function ( e ) {
            position = clamp( e.detail.position, 0, 100 );
            applyPosition();
        } );

        /**
         * lpc:refresh – re-applies current position after a direction change.
         */
        el.addEventListener( 'lpc:refresh', function () {
            applyPosition();
        } );

        /**
         * lpc:setratio – editor applies a new aspect ratio to slider and parent.
         * Expects e.detail.ratio (e.g. "16/9").
         */
        el.addEventListener( 'lpc:setratio', function ( e ) {
            el.dataset.lpcRatio = e.detail.ratio;
            applyRatioToParent();
        } );

        applyRatioToParent();
        applyPosition();
    }

    /**
     * Initialise all sliders on the page once DOM is ready.
     */
    function init() {
        document.querySelectorAll( '.lpc-compare' ).forEach( initSlider );
    }

    if ( document.readyState === 'loading' ) {
        document.addEventListener( 'DOMContentLoaded', init );
    } else {
        init();
    }
} )();
