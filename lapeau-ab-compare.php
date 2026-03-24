<?php
/**
 * Plugin Name: Lapeau A/B Compare
 * Description: Lightweight before/after image comparison slider with inline WYSIWYG positioning editor for logged-in users.
 * Version:     1.2.0
 * Author:      Dygiphy
 * Text Domain: lapeau-ab-compare
 *
 * Provides the [lpc_compare] shortcode for horizontal or vertical A/B image sliders.
 * Logged-in editors see an inline positioning tool that adjusts the same CSS properties
 * used in the public-facing slider — ensuring true WYSIWYG positioning.
 *
 * @package Lapeau_AB_Compare
 */

defined( 'ABSPATH' ) || exit;

/**
 * Main plugin class — singleton.
 *
 * Registers the [lpc_compare] shortcode, enqueues front-end assets,
 * conditionally loads the editor overlay for logged-in users, and
 * provides AJAX endpoints for persisting image transforms.
 */
final class Lapeau_AB_Compare {

    /** @var string Plugin version. */
    const VERSION = '1.2.0';

    /** @var string Shortcode tag. */
    const SHORTCODE = 'lpc_compare';

    /** @var string Post-meta key storing per-slider transform overrides. */
    const META_KEY = '_lpc_transforms';

    /** @var string Nonce action for AJAX saves. */
    const NONCE_ACTION = 'lpc_save';

    /** @var self|null Singleton instance. */
    private static $instance = null;

    /** @var bool Whether assets have been enqueued this request. */
    private $assets_enqueued = false;

    /** @var bool Whether editor assets have been enqueued this request. */
    private $editor_enqueued = false;

    /**
     * Return the singleton instance, creating it on first call.
     *
     * @return self
     */
    public static function instance(): self {
        if ( null === self::$instance ) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    /**
     * Wire up hooks on construction.
     */
    private function __construct() {
        add_shortcode( self::SHORTCODE, [ $this, 'render' ] );
        add_action( 'wp_ajax_lpc_save_transform', [ $this, 'ajax_save_transform' ] );
    }

    /**
     * Enqueue front-end slider CSS and JS (once per page load).
     *
     * @return void
     */
    private function enqueue_assets(): void {
        if ( $this->assets_enqueued ) {
            return;
        }
        $base = plugin_dir_url( __FILE__ );
        $path = plugin_dir_path( __FILE__ );

        wp_enqueue_style(
            'lpc-slider',
            $base . 'assets/css/lpc-slider.css',
            [],
            @filemtime( $path . 'assets/css/lpc-slider.css' ) ?: self::VERSION
        );
        wp_enqueue_script(
            'lpc-slider',
            $base . 'assets/js/lpc-slider.js',
            [],
            @filemtime( $path . 'assets/js/lpc-slider.js' ) ?: self::VERSION,
            true
        );
        $this->assets_enqueued = true;
    }

    /**
     * Enqueue editor CSS and JS for logged-in users (once per page load).
     *
     * Also adds the WP media library scripts and passes config via wp_localize_script.
     *
     * @return void
     */
    private function enqueue_editor(): void {
        if ( $this->editor_enqueued ) {
            return;
        }
        if ( ! is_user_logged_in() || ! current_user_can( 'edit_posts' ) ) {
            return;
        }

        wp_enqueue_media();

        $base = plugin_dir_url( __FILE__ );
        $path = plugin_dir_path( __FILE__ );

        wp_enqueue_style(
            'lpc-editor',
            $base . 'assets/css/lpc-editor.css',
            [ 'lpc-slider' ],
            @filemtime( $path . 'assets/css/lpc-editor.css' ) ?: self::VERSION
        );
        wp_enqueue_script(
            'lpc-editor',
            $base . 'assets/js/lpc-editor.js',
            [ 'lpc-slider' ],
            @filemtime( $path . 'assets/js/lpc-editor.js' ) ?: self::VERSION,
            true
        );
        wp_localize_script( 'lpc-editor', 'lpcEditor', [
            'ajaxUrl' => admin_url( 'admin-ajax.php' ),
            'nonce'   => wp_create_nonce( self::NONCE_ACTION ),
            'postId'  => get_the_ID(),
        ] );
        $this->editor_enqueued = true;
    }

    /**
     * Render the [lpc_compare] shortcode.
     *
     * Shortcode attributes:
     *   id            – Unique slider identifier (required for editor persistence).
     *   before        – URL of the "before" image.
     *   after         – URL of the "after" image.
     *   before_alt    – Alt text for the before image.
     *   after_alt     – Alt text for the after image.
     *   before_label  – Badge label for before side (default "Before").
     *   after_label   – Badge label for after side (default "After").
     *   direction     – "horizontal" or "vertical" (default "horizontal").
     *   ratio         – Aspect ratio for the container (e.g. "4/3", "16/9", "1/1"; default "4/3").
     *   start         – Initial divider position 0–100 (default 50).
     *
     * @param array|string $atts Shortcode attributes.
     * @return string           HTML output.
     */
    public function render( $atts ): string {
        $atts = shortcode_atts( [
            'id'           => 'lpc-' . wp_unique_id(),
            'before'       => '',
            'after'        => '',
            'composite'    => '',
            'before_alt'   => 'Before treatment',
            'after_alt'    => 'After treatment',
            'before_label' => 'Before',
            'after_label'  => 'After',
            'direction'    => 'horizontal',
            'ratio'        => '4/3',
            'start'        => '50',
        ], $atts, self::SHORTCODE );

        // Composite mode: a single side-by-side image (left = before, right = after).
        $is_composite = ! empty( $atts['composite'] );
        if ( $is_composite ) {
            $atts['before'] = $atts['composite'];
            $atts['after']  = $atts['composite'];
        }

        if ( empty( $atts['before'] ) || empty( $atts['after'] ) ) {
            return '<!-- lpc_compare: missing before/after or composite image -->';
        }

        $this->enqueue_assets();

        $id        = sanitize_html_class( $atts['id'] );
        $direction = in_array( $atts['direction'], [ 'horizontal', 'vertical' ], true ) ? $atts['direction'] : 'horizontal';
        $start     = max( 0, min( 100, (int) $atts['start'] ) );
        $ratio     = preg_match( '#^\d+/\d+$#', $atts['ratio'] ) ? $atts['ratio'] : '4/3';

        // Resolve saved transforms from post meta.
        // A saved ratio overrides the shortcode ratio attribute.
        $transforms = $this->get_transforms( $id );
        if ( ! empty( $transforms['ratio'] ) && preg_match( '#^\d+/\d+$#', $transforms['ratio'] ) ) {
            $ratio = $transforms['ratio'];
        }
        $before_style = $this->build_img_style( $transforms['before'] ?? [] );
        $after_style  = $this->build_img_style( $transforms['after'] ?? [] );

        $before_url = esc_url( $atts['before'] );
        $after_url  = esc_url( $atts['after'] );
        $before_alt = esc_attr( $atts['before_alt'] );
        $after_alt  = esc_attr( $atts['after_alt'] );
        $before_lbl = esc_html( $atts['before_label'] );
        $after_lbl  = esc_html( $atts['after_label'] );

        $is_editor = is_user_logged_in() && current_user_can( 'edit_posts' );
        if ( $is_editor ) {
            $this->enqueue_editor();
        }

        $editor_attr      = $is_editor ? ' data-lpc-editable="1"' : '';
        $composite_class  = $is_composite ? ' lpc-compare--composite' : '';
        $composite_attr   = $is_composite ? ' data-composite="1"' : '';

        // Build the markup — minimal nesting.
        $html  = '<div class="lpc-compare lpc-compare--' . $direction . $composite_class . '"';
        $html .= ' id="' . $id . '"';
        $html .= ' data-direction="' . $direction . '"';
        $html .= ' data-start="' . $start . '"';
        $html .= ' style="aspect-ratio: ' . $ratio . ';"';
        $html .= ' data-lpc-ratio="' . esc_attr( $ratio ) . '"';
        $html .= $editor_attr;
        $html .= $composite_attr;
        $html .= ' data-before-url="' . $before_url . '"';
        $html .= ' data-after-url="' . $after_url . '"';
        $html .= '>';

        // After layer (bottom).
        $html .= '<img class="lpc-img lpc-img--after" src="' . $after_url . '" alt="' . $after_alt . '"';
        $html .= ' loading="lazy" decoding="async"';
        if ( $after_style ) {
            $html .= ' style="' . esc_attr( $after_style ) . '"';
        }
        $html .= '>';

        // Before layer (top, clipped).
        $html .= '<div class="lpc-before" style="' . $this->clip_style( $direction, $start ) . '">';
        $html .= '<img class="lpc-img lpc-img--before" src="' . $before_url . '" alt="' . $before_alt . '"';
        $html .= ' loading="lazy" decoding="async"';
        if ( $before_style ) {
            $html .= ' style="' . esc_attr( $before_style ) . '"';
        }
        $html .= '>';
        $html .= '</div>';

        // Divider handle.
        $html .= '<div class="lpc-divider">';
        $html .= '<div class="lpc-handle"><span class="lpc-arrow lpc-arrow--left"></span><span class="lpc-arrow lpc-arrow--right"></span></div>';
        $html .= '</div>';

        // Badges.
        $html .= '<span class="lpc-badge lpc-badge--before">' . $before_lbl . '</span>';
        $html .= '<span class="lpc-badge lpc-badge--after">' . $after_lbl . '</span>';

        $html .= '</div>';

        return $html;
    }

    /**
     * Build the clip-path / inset style for the before layer.
     *
     * @param string $direction "horizontal" or "vertical".
     * @param int    $percent   Position 0–100.
     * @return string           Inline CSS for clip-path.
     */
    private function clip_style( string $direction, int $percent ): string {
        if ( 'vertical' === $direction ) {
            return 'clip-path: inset(0 0 ' . ( 100 - $percent ) . '% 0);';
        }
        return 'clip-path: inset(0 ' . ( 100 - $percent ) . '% 0 0);';
    }

    /**
     * Build inline style string from a transform array.
     *
     * @param array $t Transform data: scale, offsetX, offsetY, rotate.
     * @return string  CSS declarations string (without surrounding quotes).
     */
    private function build_img_style( array $t ): string {
        if ( empty( $t ) ) {
            return '';
        }
        $parts = [];
        $scale   = isset( $t['scale'] ) ? (float) $t['scale'] : 1;
        $offsetX = isset( $t['offsetX'] ) ? (float) $t['offsetX'] : 0;
        $offsetY = isset( $t['offsetY'] ) ? (float) $t['offsetY'] : 0;
        $rotate  = isset( $t['rotate'] ) ? (float) $t['rotate'] : 0;

        // Only emit styles when changed from defaults.
        if ( 1.0 !== $scale || 0.0 !== $offsetX || 0.0 !== $offsetY || 0.0 !== $rotate ) {
            $transforms = [];
            if ( 0.0 !== $offsetX || 0.0 !== $offsetY ) {
                $transforms[] = 'translate(' . $offsetX . '%, ' . $offsetY . '%)';
            }
            if ( 1.0 !== $scale ) {
                $transforms[] = 'scale(' . $scale . ')';
            }
            if ( 0.0 !== $rotate ) {
                $transforms[] = 'rotate(' . $rotate . 'deg)';
            }
            if ( ! empty( $transforms ) ) {
                $parts[] = 'transform: ' . implode( ' ', $transforms );
            }
        }

        return implode( '; ', $parts );
    }

    /**
     * Retrieve saved transforms for a slider ID from post meta.
     *
     * @param string $slider_id The slider ID attribute.
     * @return array             Keyed by "before"/"after", each an assoc array of transform values.
     */
    private function get_transforms( string $slider_id ): array {
        $post_id = get_the_ID();
        if ( ! $post_id ) {
            return [];
        }
        $all = get_post_meta( $post_id, self::META_KEY, true );
        if ( ! is_array( $all ) || ! isset( $all[ $slider_id ] ) ) {
            return [];
        }
        return $all[ $slider_id ];
    }

    /**
     * AJAX handler — save image transform data for a slider.
     *
     * Expects POST parameters:
     *   post_id   – The post ID.
     *   slider_id – The slider's id attribute.
     *   side      – "before" or "after".
     *   scale     – Float zoom level (1 = default).
     *   offsetX   – Float horizontal offset in %.
     *   offsetY   – Float vertical offset in %.
     *   rotate    – Float rotation in degrees.
     *   image_url – (Optional) replacement image URL.
     *
     * @return void Sends JSON response and dies.
     */
    public function ajax_save_transform(): void {
        check_ajax_referer( self::NONCE_ACTION, 'nonce' );

        if ( ! current_user_can( 'edit_posts' ) ) {
            wp_send_json_error( 'Insufficient permissions.', 403 );
        }

        $post_id   = absint( $_POST['post_id'] ?? 0 );
        $slider_id = sanitize_text_field( $_POST['slider_id'] ?? '' );
        $side      = sanitize_text_field( $_POST['side'] ?? '' );

        if ( ! $post_id || ! $slider_id || ! in_array( $side, [ 'before', 'after' ], true ) ) {
            wp_send_json_error( 'Invalid parameters.', 400 );
        }

        $all = get_post_meta( $post_id, self::META_KEY, true );
        if ( ! is_array( $all ) ) {
            $all = [];
        }

        $all[ $slider_id ][ $side ] = [
            'scale'   => round( (float) ( $_POST['scale'] ?? 1 ), 4 ),
            'offsetX' => round( (float) ( $_POST['offsetX'] ?? 0 ), 4 ),
            'offsetY' => round( (float) ( $_POST['offsetY'] ?? 0 ), 4 ),
            'rotate'  => round( (float) ( $_POST['rotate'] ?? 0 ), 4 ),
        ];

        // Optional image URL replacement.
        $image_url = esc_url_raw( $_POST['image_url'] ?? '' );
        if ( $image_url ) {
            $all[ $slider_id ][ $side ]['url'] = $image_url;
        }

        // Optional aspect ratio — stored at slider level (not per-side).
        $ratio = sanitize_text_field( $_POST['ratio'] ?? '' );
        if ( $ratio && preg_match( '#^\d+/\d+$#', $ratio ) ) {
            $all[ $slider_id ]['ratio'] = $ratio;
        }

        update_post_meta( $post_id, self::META_KEY, $all );
        wp_send_json_success( [ 'saved' => $all[ $slider_id ][ $side ] ] );
    }
}

Lapeau_AB_Compare::instance();
