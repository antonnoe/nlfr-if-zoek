<?php
/**
 * WP Code Snippet: [nlfr_if_zoek]
 *
 * Genereert een HMAC-gesigneerde SSO-link naar de NLFR/IF AI-zoekassistent
 * voor ingelogde IF-abonnees. Zelfde token-formaat als DossierFrankrijk, CC en FK.
 *
 * Gebruik op IF-pagina's:
 *   [nlfr_if_zoek]                              → knop "Zoek in NLFR & Infofrankrijk →"
 *   [nlfr_if_zoek label="AI-zoekassistent"]     → aangepaste knoptekst
 *   [nlfr_if_zoek q="carte vitale"]             → vooringevulde zoekvraag
 *
 * Niet-ingelogde bezoekers zien een melding om eerst in te loggen,
 * met een link naar de gratis-versie (3 zoekopdrachten/dag per IP).
 *
 * Vereist: INFOFRANKRIJK_SSO_SECRET in wp-config.php
 *   define('INFOFRANKRIJK_SSO_SECRET', 'jouw-geheime-sleutel');
 */

function ifr_nlfr_if_zoek_shortcode($atts) {
    $atts = shortcode_atts(array(
        'label' => 'Zoek in NLFR & Infofrankrijk →',
        'q'     => '',
    ), $atts, 'nlfr_if_zoek');

    $base_url = 'https://nlfr-if-zoek.vercel.app/';

    // Niet ingelogd → melding + link naar gratis versie
    if ( ! is_user_logged_in() || ! current_user_can('read') ) {
        $free_url = $base_url;
        if ( ! empty($atts['q']) ) {
            $free_url = add_query_arg('q', $atts['q'], $free_url);
        }
        return '<div style="background:#faf8f6;border:1px solid #e0ddd8;border-radius:8px;padding:20px;font-family:Mulish,sans-serif;max-width:480px;">'
             . '<p style="color:#555;font-size:14px;margin:0 0 12px 0;line-height:1.7;">'
             . '🔍 <strong>AI-zoekassistent</strong> — doorzoek 20+ jaar forumkennis van Nederlanders.fr en Infofrankrijk.com.'
             . '</p>'
             . '<p style="color:#888;font-size:13px;margin:0 0 12px 0;">'
             . '<a href="/mijn-account/" style="color:#800000;font-weight:600;">Log in</a> als abonnee voor 10 zoekopdrachten per dag, '
             . 'of <a href="' . esc_url($free_url) . '" target="_blank" rel="noopener" style="color:#800000;">probeer gratis</a> (3 per dag).'
             . '</p>'
             . '</div>';
    }

    // Ingelogde abonnee → genereer HMAC-token
    $secret = defined('INFOFRANKRIJK_SSO_SECRET') ? INFOFRANKRIJK_SSO_SECRET : '';
    if ( empty($secret) ) {
        return '<!-- nlfr_if_zoek: SSO secret niet geconfigureerd -->';
    }

    $user      = wp_get_current_user();
    $email     = $user->user_email;
    $timestamp = time();
    $message   = $email . ':' . $timestamp;
    $signature = hash_hmac('sha256', $message, $secret);

    $payload = json_encode(array(
        'email'     => $email,
        'timestamp' => $timestamp,
        'signature' => $signature,
    ));
    $token = base64_encode($payload);

    $url = add_query_arg('token', $token, $base_url);
    if ( ! empty($atts['q']) ) {
        $url = add_query_arg('q', $atts['q'], $url);
    }

    return '<div style="max-width:480px;">'
         . '<a href="' . esc_url($url) . '" target="_blank" rel="noopener noreferrer" '
         . 'style="display:inline-block;background:#800000;color:#fff;padding:12px 28px;'
         . 'border-radius:8px;text-decoration:none;font-family:Poppins,sans-serif;'
         . 'font-weight:600;font-size:14px;transition:opacity 0.2s;" '
         . 'onmouseover="this.style.opacity=\'0.9\'" onmouseout="this.style.opacity=\'1\'">'
         . esc_html($atts['label'])
         . '</a>'
         . '</div>';
}
add_shortcode('nlfr_if_zoek', 'ifr_nlfr_if_zoek_shortcode');
