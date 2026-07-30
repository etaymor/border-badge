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
 *   3. The InfoWindow's chrome arrives in a <style> element the API injects at
 *      runtime, and it is nonced only if the page already has a `style[nonce]`.
 *      base.html carries that donor; without it the popup renders naked.
 *   4. The map div hosts the InfoWindow overlay and precedes the place list in
 *      the document, so a card is *earlier* in the tab order than the row that
 *      opens it. Tab therefore walks a keyboard user away from the thing they
 *      just opened. Invisible to anyone reading this code or using a mouse,
 *      which is why focus is moved and restored explicitly below.
 */
(function () {
  'use strict';

  var dataEl = document.getElementById('share-map-data');
  var mapEl = document.getElementById('share-map');

  // Populated by render(): ordinal -> { marker, entry, position }. The ordinal
  // is the join key between the pins, the numbered feed rows, and the map's
  // place list, and the server assigns it once (see ShareView.map_payload).
  var pins = {};
  var infoWindow = null;
  var mapInstance = null;

  // Focus handoff between a place-list row and the card it opens. `cardToFocus`
  // is a one-shot set by selectEntry and consumed by the InfoWindow's `domready`
  // (which fires on every setContent, including ones we don't want to steal
  // focus for); `focusReturn` is the row to hand focus back to on close.
  var cardToFocus = null;
  var focusReturn = null;

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

    // Same class of silent failure as the Map ID above. Maps copies the nonce
    // off the first `style[nonce]` onto every <style> it injects; with no donor
    // in base.html our nonce-only style-src refuses them and the info card
    // renders as unstyled text with a broken close button.
    if (!document.querySelector('style[nonce]')) {
      console.error(
        '[share-map] No style[nonce] in the document: the Maps API cannot nonce' +
          ' its injected stylesheets, so the CSP will refuse them and info cards' +
          ' will render unstyled. Restore the donor in base.html.'
      );
    }

    mapInstance = map;

    // One shared InfoWindow, not one per pin: opening a second would leave the
    // first on screen. The header row is left enabled because that is where the
    // close button lives -- `headerDisabled` would take the X away with it.
    infoWindow = new mapsLib.InfoWindow({ maxWidth: 288 });
    infoWindow.addListener('closeclick', function () {
      setActiveRow(null);
      returnFocus();
    });

    // render() runs at most once per page, so this listener cannot stack --
    // which matters, because `domready` fires on every setContent. The one-shot
    // is cleared before it is used, so a stray extra fire (a resize, a future
    // Maps release re-attaching content) can never yank focus a second time.
    infoWindow.addListener('domready', function () {
      var card = cardToFocus;
      cardToFocus = null;
      if (!card || !card.isConnected) return;
      // preventScroll: activateRow may still be running a smooth scroll to the
      // map, and focus()'s own scrolling would fight it.
      card.focus({ preventScroll: true });
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

      var marker = new markerLib.AdvancedMarkerElement({
        map: map,
        position: position,
        title: entry.title,
        content: pin.element,
        // Required for `gmp-click`. It also makes the marker tab-focusable and
        // arrow-key navigable, which is accessibility we would otherwise have
        // to build by hand.
        gmpClickable: true,
      });

      // `gmp-click` via addEventListener, not the legacy `click` via
      // addListener -- the legacy event is not delivered to addEventListener at
      // all, so mixing the two fails silently.
      marker.addEventListener('gmp-click', function () {
        selectEntry(entry.ordinal, { pan: false });
      });

      pins[entry.ordinal] = { marker: marker, entry: entry, position: position };
      bounds.extend(position);
    });

    if (entries.length > 1) {
      map.fitBounds(bounds, 48);
    }

    // Only now are the place-list rows wired up. Doing it here rather than in
    // the template is deliberate: a row that looks tappable before the map
    // exists (no Map ID, no key, JS still loading) is a control that does
    // nothing.
    upgradeMapList();
  }

  // --- The info card -------------------------------------------------------
  // Built as DOM rather than an HTML string so entry titles and notes cannot
  // inject markup, and styled by the page's own stylesheet so it matches the
  // feed below rather than Google's defaults.
  function buildInfoContent(entry) {
    var card = document.createElement('div');
    card.className = 'share-iw';
    // Not in the tab order, but focusable programmatically. The map div hosts
    // the InfoWindow overlay and precedes the place list in the document, so
    // the card that just opened sits *behind* the row that opened it: Tab walks
    // away from the card, never into it.
    //
    // No role here: Google's own `.gm-style-iw-c` wrapper is already
    // `role="dialog"`, and a second one nested inside it makes screen readers
    // announce two dialog boundaries for one card. Its name comes from the
    // InfoWindow's `ariaLabel` option instead (set in selectEntry) -- without
    // that it is labelled by an empty header div and announces as unnamed.
    // Deliberately no aria-modal either: the map stays interactive and there is
    // no focus trap, so claiming one would only hide the rest of the page.
    card.setAttribute('tabindex', '-1');

    // Google closes the InfoWindow on Escape in some versions and not others,
    // and never restores focus. Own it: a card is built fresh per selection, so
    // this listener cannot accumulate, and a double close is harmless because
    // returnFocus() clears its own state first.
    card.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape' && event.key !== 'Esc') return;
      event.stopPropagation();
      infoWindow.close();
      setActiveRow(null);
      returnFocus();
    });

    var eyebrow = document.createElement('p');
    eyebrow.className = 'share-iw-eyebrow';

    var ordinal = document.createElement('span');
    ordinal.className = 'share-iw-ordinal';
    ordinal.textContent = entry.ordinal < 10 ? '0' + entry.ordinal : String(entry.ordinal);
    eyebrow.appendChild(ordinal);

    if (entry.category) {
      var chip = document.createElement('span');
      chip.className = 'share-iw-chip is-' + entry.type;
      chip.textContent = entry.category;
      eyebrow.appendChild(chip);
    }
    card.appendChild(eyebrow);

    var title = document.createElement('h3');
    title.className = 'share-iw-title';
    title.textContent = entry.title;
    card.appendChild(title);

    if (entry.place) {
      var place = document.createElement('p');
      place.className = 'share-iw-place';
      place.textContent = entry.place;
      card.appendChild(place);
    }

    if (entry.note) {
      var note = document.createElement('p');
      note.className = 'share-iw-note';
      note.textContent = entry.note;
      card.appendChild(note);
    }

    if (entry.mapsUrl) {
      var link = document.createElement('a');
      link.className = 'share-iw-link';
      link.href = entry.mapsUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Open in Google Maps';
      // base.html's [data-track-location] wiring binds at DOMContentLoaded and
      // will never see this element, so report the click directly.
      link.addEventListener('click', function () {
        if (typeof window.gtag === 'function') {
          window.gtag('event', 'click_map_place', { location: 'share_map' });
        }
      });
      card.appendChild(link);
    }

    return card;
  }

  // --- Selection: the one path both pins and list rows go through ----------
  function selectEntry(ordinal, options) {
    var pin = pins[ordinal];
    if (!pin || !infoWindow || !mapInstance) return;

    if (options && options.pan) {
      mapInstance.panTo(pin.position);
    }

    // Focus moves only when a place-list row opened the card. A marker click
    // leaves `trigger` unset: markers are Google's own focus surface, already
    // tab-focusable and arrow-navigable, and there is nowhere sensible to hand
    // focus back to.
    var card = buildInfoContent(pin.entry);
    focusReturn = (options && options.trigger) || null;
    cardToFocus = focusReturn ? card : null;

    infoWindow.close();
    infoWindow.setContent(card);
    // Names Google's own dialog wrapper, which is otherwise labelled by an
    // empty header element and announces as an unnamed dialog.
    infoWindow.setOptions({ ariaLabel: pin.entry.title });
    infoWindow.open({ map: mapInstance, anchor: pin.marker });
    setActiveRow(ordinal);
  }

  // Hands focus back to the row that opened the card. Only reclaims it if the
  // card (or the map chrome around it) was actually holding it -- a visitor who
  // tabbed out to the rest of the page and left the card open behind them stays
  // where they are.
  function returnFocus() {
    var target = focusReturn;
    focusReturn = null;
    cardToFocus = null;
    if (!target || !target.isConnected) return;

    var active = document.activeElement;
    if (active && active !== document.body && !mapEl.contains(active)) return;
    target.focus({ preventScroll: true });
  }

  function setActiveRow(ordinal) {
    var rows = document.querySelectorAll('.share-map-list-item[data-ordinal]');
    rows.forEach(function (row) {
      var isActive = ordinal !== null && Number(row.dataset.ordinal) === ordinal;
      row.classList.toggle('is-active', isActive);
      if (isActive) {
        row.setAttribute('aria-current', 'true');
      } else {
        row.removeAttribute('aria-current');
      }
    });
  }

  // --- The place list under the map ---------------------------------------
  function upgradeMapList() {
    var rows = document.querySelectorAll('.share-map-list-item[data-ordinal]');

    rows.forEach(function (row) {
      var ordinal = Number(row.dataset.ordinal);
      if (!pins[ordinal]) return;

      row.classList.add('is-interactive');
      row.setAttribute('role', 'button');
      row.setAttribute('tabindex', '0');

      // The row is passed through as the focus-return target. Both handlers
      // pass it, including the click one: a screen reader in browse mode turns
      // Enter into a click with no keydown at all, so gating focus on the
      // keyboard path would miss exactly the visitor this is for.
      row.addEventListener('click', function () {
        activateRow(ordinal, row);
      });

      // role="button" buys the semantics but none of the behavior: a real
      // button responds to both keys, so this has to as well.
      row.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        activateRow(ordinal, row);
      });
    });
  }

  function activateRow(ordinal, row) {
    // On narrow screens the list sits below the map, so the card would open
    // off-screen. Bring the map into view first.
    if (!isMapInView()) {
      mapEl.scrollIntoView({
        block: 'center',
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      });
    }
    selectEntry(ordinal, { pan: true, trigger: row });
  }

  function isMapInView() {
    var box = mapEl.getBoundingClientRect();
    var viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    // `.share-map` is a fixed 420px tall. On anything shorter -- a phone held
    // sideways -- full containment is unreachable, so demanding it would make
    // every single tap re-run scrollIntoView. There, "in view" means the map
    // covers the screen, not that it fits inside it.
    if (box.height >= viewportHeight) {
      return box.top <= 0 && box.bottom >= viewportHeight;
    }
    return box.top >= 0 && box.bottom <= viewportHeight;
  }

  function prefersReducedMotion() {
    return (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  initFilters();
  initMap();
})();
