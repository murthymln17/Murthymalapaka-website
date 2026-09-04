/**
 * Site analytics tags — fill in the two IDs below and both trackers load on
 * every page. Leave an ID empty to disable that tracker. See
 * ANALYTICS-SETUP.md at the repository root for where to find each value.
 */
(function () {
  // From Google Analytics: Admin → Data streams → your web stream
  var GA4_MEASUREMENT_ID = 'G-L7RYE8J4QC';

  // From Cloudflare: Web Analytics → your site → JS snippet "token" value
  // (the Web Analytics site tag). Loaded explicitly because the "automatic
  // setup" injection never produced data for this site. If Cloudflare's
  // snippet screen shows a different token, replace this value.
  var CF_BEACON_TOKEN = '077479bae8114ace81c2daabd3162d15';

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
