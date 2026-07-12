/**
 * Site analytics tags — fill in the two IDs below and both trackers load on
 * every page. Leave an ID empty to disable that tracker. See
 * ANALYTICS-SETUP.md at the repository root for where to find each value.
 */
(function () {
  // From Google Analytics: Admin → Data streams → your web stream, e.g. 'G-XXXXXXXXXX'
  var GA4_MEASUREMENT_ID = '';

  // From Cloudflare: Web Analytics → your site → JS snippet "token" value.
  // Leave empty if you enabled Web Analytics directly on the Pages project —
  // Cloudflare injects its beacon automatically in that case.
  var CF_BEACON_TOKEN = '';

  if (GA4_MEASUREMENT_ID) {
    var gtagScript = document.createElement('script');
    gtagScript.async = true;
    gtagScript.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA4_MEASUREMENT_ID;
    document.head.appendChild(gtagScript);

    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', GA4_MEASUREMENT_ID);
  }

  if (CF_BEACON_TOKEN) {
    var beacon = document.createElement('script');
    beacon.defer = true;
    beacon.src = 'https://static.cloudflareinsights.com/beacon.min.js';
    beacon.setAttribute('data-cf-beacon', JSON.stringify({ token: CF_BEACON_TOKEN }));
    document.head.appendChild(beacon);
  }
})();
