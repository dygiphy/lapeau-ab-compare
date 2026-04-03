<?php
/**
 * Plugin Name: Lapeau A/B Compare
 * Description: Lightweight before/after image comparison slider with inline WYSIWYG positioning editor for logged-in users.
 * Version:     1.7.1
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
    const VERSION = '1.7.1';

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
            'width'        => '',   // Optional container width override, e.g. '80%' or '400px'.
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
        $transforms = $this->get_transforms( $id );

        // Privacy blur mask data (stored at slider level).
        $blur = $transforms['blur'] ?? [];

        // Apply saved URL overrides from meta — these take precedence over shortcode attributes.
        if ( ! empty( $transforms['before']['url'] ) ) {
            $atts['before'] = $transforms['before']['url'];
        }
        if ( ! empty( $transforms['after']['url'] ) ) {
            $atts['after'] = $transforms['after']['url'];
        }

        // A saved ratio overrides the shortcode ratio attribute.
        if ( ! empty( $transforms['ratio'] ) && preg_match( '#^\d+/\d+$#', $transforms['ratio'] ) ) {
            $ratio = $transforms['ratio'];
        }

        // A saved width overrides the shortcode width attribute.
        $width = '';
        if ( ! empty( $transforms['width'] ) && preg_match( '#^\d+(\.\d+)?(px|%)$#', $transforms['width'] ) ) {
            $width = $transforms['width'];
        } elseif ( ! empty( $atts['width'] ) && preg_match( '#^\d+(\.\d+)?(px|%)$#', $atts['width'] ) ) {
            $width = $atts['width'];
        }

        // Pre-resolved attachment IDs speed up srcset generation on render.
        $before_attachment_id = ! empty( $transforms['before']['attachment_id'] ) ? (int) $transforms['before']['attachment_id'] : 0;
        $after_attachment_id  = ! empty( $transforms['after']['attachment_id']  ) ? (int) $transforms['after']['attachment_id']  : 0;

        $before_style = $this->build_img_style( $transforms['before'] ?? [] );
        $after_style  = $this->build_img_style( $transforms['after']  ?? [] );

        $before_url = $atts['before'];
        $after_url  = $atts['after'];
        $before_alt = $atts['before_alt'];
        $after_alt  = $atts['after_alt'];
        $before_lbl = esc_html( $atts['before_label'] );
        $after_lbl  = esc_html( $atts['after_label'] );

        $is_editor = is_user_logged_in() && current_user_can( 'edit_posts' );
        if ( $is_editor ) {
            $this->enqueue_editor();
        }

        $editor_attr      = $is_editor ? ' data-lpc-editable="1"' : '';
        $composite_class  = $is_composite ? ' lpc-compare--composite' : '';
        $composite_attr   = $is_composite ? ' data-composite="1"' : '';

        // Build container style with aspect ratio and optional width override.
        $container_style = 'aspect-ratio: ' . $ratio . ';';
        if ( $width ) {
            $container_style .= ' width: ' . $width . '; margin-left: auto; margin-right: auto;';
        }

        // Compute srcset sizes hint based on container width and composite mode.
        $sizes = $this->compute_sizes( $width, $is_composite );

        // Build the markup — minimal nesting.
        $html  = '<div class="lpc-compare lpc-compare--' . $direction . $composite_class . '"';
        $html .= ' id="' . $id . '"';
        $html .= ' data-direction="' . $direction . '"';
        $html .= ' data-start="' . $start . '"';
        $html .= ' style="' . esc_attr( $container_style ) . '"';
        $html .= ' data-lpc-ratio="' . esc_attr( $ratio ) . '"';
        if ( $width ) {
            $html .= ' data-lpc-width="' . esc_attr( $width ) . '"';
        }
        $html .= $editor_attr;
        $html .= $composite_attr;
        $html .= ' data-before-url="' . esc_url( $before_url ) . '"';
        $html .= ' data-after-url="' . esc_url( $after_url ) . '"';
        if ( $is_editor && ! empty( $blur ) ) {
            $html .= ' data-lpc-blur="' . esc_attr( wp_json_encode( $blur ) ) . '"';
        }
        $html .= '>';

        // After layer (bottom) — responsive image with srcset when attachment ID is resolvable.
        $html .= $this->render_img( $after_url, $after_alt, 'lpc-img lpc-img--after', $after_style, $sizes, $after_attachment_id );

        // Before layer (top, clipped).
        $html .= '<div class="lpc-before" style="' . $this->clip_style( $direction, $start ) . '">';
        $html .= $this->render_img( $before_url, $before_alt, 'lpc-img lpc-img--before', $before_style, $sizes, $before_attachment_id );
        $html .= '</div>';

        // Privacy blur mask (above images, behind divider).
        if ( ! empty( $blur['enabled'] ) ) {
            $html .= $this->render_blur_mask( $blur );
        }

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
     * Uses a two-component pan model matching the JS editor:
     *  1. object-position: (50-X)% (50-Y)% — shifts the visible crop within the
     *     element (zero coverage risk; image always fills the element).
     *  2. transform: translate(X*(scale-1)%, Y*(scale-1)%) scale(s) [rotate] —
     *     translate uses ONLY scale-induced overhang, so at scale=1 translate=0
     *     and no background is ever exposed.
     *
     * @param array $t Transform data: scale, offsetX, offsetY, rotate.
     * @return string  CSS declarations string (without surrounding quotes).
     */
    private function build_img_style( array $t ): string {
        if ( empty( $t ) ) {
            return '';
        }
        $scale   = isset( $t['scale'] )   ? (float) $t['scale']   : 1;
        $offsetX = isset( $t['offsetX'] ) ? (float) $t['offsetX'] : 0;
        $offsetY = isset( $t['offsetY'] ) ? (float) $t['offsetY'] : 0;
        $rotate  = isset( $t['rotate'] )  ? (float) $t['rotate']  : 0;

        if ( 1.0 === $scale && 0.0 === $offsetX && 0.0 === $offsetY && 0.0 === $rotate ) {
            return '';
        }

        $parts = [];

        // 1. object-position: (50-X)% (50-Y)% — intrinsic overflow, no coverage risk.
        if ( 0.0 !== $offsetX || 0.0 !== $offsetY ) {
            $parts[] = 'object-position: ' . ( 50.0 - $offsetX ) . '% ' . ( 50.0 - $offsetY ) . '%';
        }

        // 2. transform: translate adds extra pan range at scale > 1.
        //    At 90°/270° the translate axis is visually perpendicular to its intended
        //    direction, so it is skipped — object-position handles all pan at those angles.
        $transforms  = [];
        $norm_rotate = fmod( fmod( $rotate, 360.0 ) + 360.0, 360.0 );
        $is_rot90    = ( abs( $norm_rotate - 90.0 ) < 0.5 || abs( $norm_rotate - 270.0 ) < 0.5 );
        if ( ! $is_rot90 ) {
            $tx_pct = round( $offsetX * ( $scale - 1.0 ), 3 );
            $ty_pct = round( $offsetY * ( $scale - 1.0 ), 3 );
            if ( abs( $tx_pct ) > 0.001 || abs( $ty_pct ) > 0.001 ) {
                $transforms[] = 'translate(' . $tx_pct . '%, ' . $ty_pct . '%)';
            }
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

        // Optional attachment ID — stored per side to speed up srcset resolution on render.
        $image_id = absint( $_POST['image_id'] ?? 0 );
        if ( $image_id ) {
            $all[ $slider_id ][ $side ]['attachment_id'] = $image_id;
        }

        // Optional aspect ratio — stored at slider level (not per-side).
        $ratio = sanitize_text_field( $_POST['ratio'] ?? '' );
        if ( $ratio && preg_match( '#^\d+/\d+$#', $ratio ) ) {
            $all[ $slider_id ]['ratio'] = $ratio;
        }

        // Optional container width — stored at slider level. Empty string clears the saved override.
        if ( isset( $_POST['width'] ) ) {
            $width_val = sanitize_text_field( $_POST['width'] );
            if ( '' === $width_val ) {
                unset( $all[ $slider_id ]['width'] );
            } elseif ( preg_match( '#^\d+(\.\d+)?(px|%)$#', $width_val ) ) {
                $all[ $slider_id ]['width'] = $width_val;
            }
        }

        // Optional privacy blur mask — stored at slider level (not per-side).
        if ( isset( $_POST['blur_enabled'] ) ) {
            $all[ $slider_id ]['blur'] = [
                'enabled'   => ! empty( $_POST['blur_enabled'] ) && '0' !== $_POST['blur_enabled'],
                'x'         => round( (float) ( $_POST['blur_x'] ?? 15 ), 2 ),
                'y'         => round( (float) ( $_POST['blur_y'] ?? 25 ), 2 ),
                'w'         => round( (float) ( $_POST['blur_w'] ?? 70 ), 2 ),
                'h'         => round( (float) ( $_POST['blur_h'] ?? 12 ), 2 ),
                'rotate'    => round( (float) ( $_POST['blur_rotate'] ?? 0 ), 2 ),
                'intensity' => round( (float) ( $_POST['blur_intensity'] ?? 20 ), 1 ),
                'feather'   => round( (float) ( $_POST['blur_feather'] ?? 8 ), 1 ),
            ];
        }

        update_post_meta( $post_id, self::META_KEY, $all );
        wp_send_json_success( [ 'saved' => $all[ $slider_id ][ $side ] ] );
    }

    /**
     * Render the privacy blur mask overlay element.
     *
     * All dimensions are percentages of the container so the mask scales
     * responsively. The backdrop-filter blur intensity and border-radius
     * (feather) are set via inline styles.
     *
     * @param array $blur Blur settings: enabled, x, y, w, h, rotate, intensity, feather.
     * @return string      HTML for the blur mask div.
     */
    private function render_blur_mask( array $blur ): string {
        $x         = isset( $blur['x'] )         ? (float) $blur['x']         : 15;
        $y         = isset( $blur['y'] )         ? (float) $blur['y']         : 25;
        $w         = isset( $blur['w'] )         ? (float) $blur['w']         : 70;
        $h         = isset( $blur['h'] )         ? (float) $blur['h']         : 12;
        $rotate    = isset( $blur['rotate'] )    ? (float) $blur['rotate']    : 0;
        $intensity = isset( $blur['intensity'] ) ? (float) $blur['intensity'] : 20;
        $feather   = isset( $blur['feather'] )   ? (float) $blur['feather']   : 8;

        $style = sprintf(
            'left:%s%%;top:%s%%;width:%s%%;height:%s%%;--lpc-blur:%spx;border-radius:%spx',
            round( $x, 2 ), round( $y, 2 ), round( $w, 2 ), round( $h, 2 ),
            round( $intensity, 1 ), round( $feather, 1 )
        );
        if ( abs( $rotate ) > 0.01 ) {
            $style .= sprintf( ';transform:rotate(%sdeg)', round( $rotate, 2 ) );
        }

        return '<div class="lpc-blur-mask" style="' . esc_attr( $style ) . '"></div>';
    }

    /**
     * Render a responsive <img> element for a slider layer.
     *
     * Resolves the attachment ID from the URL (or uses the pre-supplied ID)
     * so WordPress srcset and sizes attributes can be generated natively.
     * Falls back to a plain src-only img when no attachment ID can be resolved.
     *
     * Uses a per-request static cache for the URL → ID lookup to avoid
     * redundant database queries (e.g. composite mode, repeated shortcodes).
     *
     * @param string $url             Source URL for the image.
     * @param string $alt             Alt text (unescaped).
     * @param string $css_class       Space-separated CSS class names.
     * @param string $transform_style Inline CSS for transform overrides (unescaped).
     * @param string $sizes           CSS sizes attribute value.
     * @param int    $attachment_id   Pre-resolved attachment ID; 0 triggers URL lookup.
     * @return string                 Complete <img> HTML.
     */
    private function render_img( string $url, string $alt, string $css_class, string $transform_style, string $sizes, int $attachment_id = 0 ): string {
        static $id_cache = [];

        if ( ! $attachment_id ) {
            if ( ! array_key_exists( $url, $id_cache ) ) {
                // attachment_url_to_postid() requires a fully-qualified URL.
                // Content often uses root-relative paths (/wp-content/...) — resolve them.
                $lookup_url = preg_match( '#^https?://#', $url ) ? $url : home_url( $url );
                $id_cache[ $url ] = attachment_url_to_postid( $lookup_url );
            }
            $attachment_id = $id_cache[ $url ];
        }

        $srcset = '';
        $src    = esc_url( $url );

        if ( $attachment_id ) {
            // Use 'large' (≤1024 px) as the default src — avoids loading full-res on non-srcset browsers.
            $large = wp_get_attachment_image_src( $attachment_id, 'large' );
            if ( $large ) {
                $src = esc_url( $large[0] );
            }
            $srcset_str = wp_get_attachment_image_srcset( $attachment_id, 'full' );
            if ( $srcset_str ) {
                $srcset = $srcset_str;
            }
        }

        $img  = '<img class="' . esc_attr( $css_class ) . '"';
        $img .= ' src="' . $src . '"';
        if ( $srcset ) {
            $img .= ' srcset="' . esc_attr( $srcset ) . '"';
            $img .= ' sizes="' . esc_attr( $sizes ) . '"';
        }
        $img .= ' alt="' . esc_attr( $alt ) . '"';
        $img .= ' loading="lazy" decoding="async"';
        if ( $transform_style ) {
            $img .= ' style="' . esc_attr( $transform_style ) . '"';
        }
        $img .= '>';

        return $img;
    }

    /**
     * Compute the CSS sizes attribute for a slider image.
     *
     * Returns a sizes string matching the slider's rendered dimensions,
     * factoring in an explicit width override and whether composite mode
     * applies a 200% image stretch.
     *
     * @param string $container_width Saved container width ('' = 100%; e.g. '80%', '400px').
     * @param bool   $is_composite    True when the image is stretched to 200% container width.
     * @return string                 CSS sizes attribute value.
     */
    private function compute_sizes( string $container_width, bool $is_composite ): string {
        $multiplier = $is_composite ? 2 : 1;

        if ( empty( $container_width ) ) {
            return 2 === $multiplier ? '200vw' : '100vw';
        }

        if ( '%' === substr( $container_width, -1 ) ) {
            $pct = (float) $container_width;
            return round( $pct * $multiplier ) . 'vw';
        }

        // px value.
        $px           = (int) $container_width;
        $effective_px = $px * $multiplier;
        return '(max-width: ' . $effective_px . 'px) 100vw, ' . $effective_px . 'px';
    }
}

Lapeau_AB_Compare::instance();
