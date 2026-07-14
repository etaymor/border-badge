/*
 * Public share page: the map, and the category filter.
 *
 * The page is fully server-rendered -- every entry's title, note, place name,
 * and photo is in the initial HTML. Nothing here creates content; it only
 * enhances what is already there. With JS off, the whole feed still reads and
 * still indexes; the map section is simply inert.
 *
 * Two things about the map are easy to get wrong and fail *silently*:
 *
 *   1. AdvancedMarkerElement requires a Map ID. Without one the map still
 *      loads, the tiles look fine, and not a single pin renders -- with no
 *      console error. The capability check below is what turns that silence
 *      into a signal.
 *   2. The map's palette lives in the Google Cloud Console, bound to that Map
 *      ID. Passing a `styles` array alongside a `mapId` is silently ignored, so
 *      we deliberately pass none.
 */
(function () {
  'use strict';

  var dataEl = document.getElementById('share-map-data');
  var mapEl = document.getElementById('share-map');

  // --- Category filter (R6) ------------------------------------------------
  // Purely a view filter over server-rendered rows: it hides, never fetches.
  // The map pins are deliberately left alone -- the map always shows the whole
  // collection, so filtering the feed doesn't make places vanish from it.
  function initFilters() {
    var chips = document.querySelectorAll('.share-chip');
    var rows = document.querySelectorAll('.share-row');
    var readout = document.querySelector('.share-filter-count');
    if (!chips.length || !rows.length) return;

    var total = readout ? Number(readout.dataset.total) : rows.length;

    chips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        var filter = chip.dataset.filter;
        var shown = 0;

        rows.forEach(function (row) {
          var match = filter === 'all' || row.dataset.type === filter;
          row.hidden = !match;
          if (match) shown++;
        });

        chips.forEach(function (other) {
          other.classList.toggle('is-active', other === chip);
        });

        if (readout) {
          readout.textContent =
            shown + ' of ' + total + (total === 1 ? ' place' : ' places');
        }
      });
    });
  }

  // --- Map -----------------------------------------------------------------
  function initMap() {
    if (!dataEl || !mapEl) return;

    var config;
    try {
      config = JSON.parse(dataEl.textContent);
    } catch (err) {
      console.error('[share-map] could not parse map data', err);
      return;
    }

    var entries = (config && config.entries) || [];
    if (!config.apiKey || !config.mapId || !entries.length) return;

    // Billing is per map *load*, not per pin, so a 50-pin map costs exactly
    // what a 1-pin map costs -- but a map that boots for every crawler hit and
    // every bounce burns the free tier for nothing. The map sits below the
    // entire feed, so defer it until someone actually scrolls to it.
    var started = false;
    var observer = new IntersectionObserver(
      function (observations) {
        observations.forEach(function (observation) {
          if (!observation.isIntersecting || started) return;
          started = true;
          observer.disconnect();
          bootstrapMaps(config, entries);
        });
      },
      { rootMargin: '200px' }
    );
    observer.observe(mapEl);
  }

  // Google's inline bootstrap loader. Preferred over the legacy
  // `<script src="...&callback=initMap">` tag for two reasons: its promise
  // *rejects* on load failure (the callback form fails silently), and it copies
  // this page's nonce onto the script element it injects, which is what lets
  // the strict CSP keep its nonce and stay free of 'unsafe-inline'.
  function bootstrapMaps(config, entries) {
    /* eslint-disable */
    (g => { var h, a, k, p = "The Google Maps JavaScript API", c = "google", l = "importLibrary", q = "__ib__", m = document, b = window; b = b[c] || (b[c] = {}); var d = b.maps || (b.maps = {}), r = new Set, e = new URLSearchParams, u = () => h || (h = new Promise(async (f, n) => { await (a = m.createElement("script")); e.set("libraries", [...r] + ""); for (k in g) e.set(k.replace(/[A-Z]/g, t => "_" + t[0].toLowerCase()), g[k]); e.set("callback", c + ".maps." + q); a.src = `https://maps.${c}apis.com/maps/api/js?` + e; d[q] = f; a.onerror = () => h = n(Error(p + " could not load.")); a.nonce = m.querySelector("script[nonce]")?.nonce || ""; m.head.append(a) })); d[l] ? console.warn(p + " only loads once. Ignoring:", g) : d[l] = (f, ...n) => r.add(f) && u().then(() => d[l](f, ...n)) })({
      key: config.apiKey,
      v: 'weekly',
    });
    /* eslint-enable */

    render(config, entries).catch(function (err) {
      console.error('[share-map] map failed to load', err);
    });
  }

  async function render(config, entries) {
    var mapsLib = await google.maps.importLibrary('maps');
    var markerLib = await google.maps.importLibrary('marker');

    var map = new mapsLib.Map(mapEl, {
      // Mandatory. Without it, every AdvancedMarkerElement below silently fails
      // to render and the map just looks empty.
      mapId: config.mapId,
      center: { lat: entries[0].lat, lng: entries[0].lng },
      zoom: 12,
      disableDefaultUI: false,
      mapTypeControl: false,
      streetViewControl: false,
      // No `styles` array: with a mapId present it is ignored. The palette is
      // the Cloud Console Map Style bound to that ID.
    });

    // The signature failure mode is a map that loads perfectly and shows zero
    // pins, with nothing in the console. Say so out loud instead.
    map.addListener('mapcapabilities_changed', function () {
      var capabilities = map.getMapCapabilities();
      if (!capabilities.isAdvancedMarkersAvailable) {
        console.error(
          '[share-map] Advanced markers are unavailable: the Map ID is missing,' +
            ' misconfigured, or its style is unpublished. Pins will not render.'
        );
      }
    });

    var bounds = new google.maps.LatLngBounds();

    entries.forEach(function (entry) {
      var position = { lat: entry.lat, lng: entry.lng };

      // The glyph is the entry's ordinal, so a pin cross-references the
      // numbered feed row it belongs to. This is what makes the map genuinely
      // useful rather than decorative, and it is nearly free.
      var pin = new markerLib.PinElement({
        background: entry.color,
        borderColor: entry.color,
        glyph: String(entry.ordinal),
        glyphColor: '#FFFFFF',
        scale: 1.1,
      });

      new markerLib.AdvancedMarkerElement({
        map: map,
        position: position,
        title: entry.title,
        content: pin.element,
      });

      bounds.extend(position);
    });

    if (entries.length > 1) {
      map.fitBounds(bounds, 48);
    }
  }

  initFilters();
  initMap();
})();
