// Gently fades share-page sections in as they scroll into view. Progressive
// enhancement: without JS (or with reduced-motion) everything is already
// visible, because the .reveal hidden state is gated on .reveal-ready, which
// this script is the only thing that adds.
(function () {
  'use strict';

  var reduceMotion =
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var targets = document.querySelectorAll('.reveal');
  if (!targets.length) return;

  // No IntersectionObserver or reduced motion: leave everything visible.
  if (reduceMotion || !('IntersectionObserver' in window)) return;

  document.documentElement.classList.add('reveal-ready');

  var observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-revealed');
          observer.unobserve(entry.target);
        }
      });
    },
    { rootMargin: '0px 0px -10% 0px', threshold: 0.1 }
  );

  targets.forEach(function (el) {
    observer.observe(el);
  });
})();
