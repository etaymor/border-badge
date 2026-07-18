/**
 * Lazy accessor for @rapideditor/country-coder's iso1A2Code.
 *
 * PERF (U10): The country-coder package ships a ~2.2 MB boundary dataset that is
 * parsed the moment the module is evaluated. Several photo-import modules used to
 * `import { iso1A2Code } from '@rapideditor/country-coder'` at the top level, which
 * pulled that cost onto the app-boot path: App.tsx -> useAppStateTracking ->
 * @services/photoImport barrel -> photoClustering / photoScanService /
 * photoClusteringCache -> country-coder. Those geocoding functions never run at
 * module-eval time (only after the user actually imports photos), so the dataset
 * was being parsed for nothing during the first frame.
 *
 * This helper defers the `require()` until the first actual geocode call and then
 * memoizes the resolved function. The call remains synchronous (matching the
 * existing geocoding call sites), and metro still bundles the dependency — it is
 * only the *evaluation* that is deferred off the boot path.
 */

/** country-coder's iso1A2Code signature (the subset we use). */
type Iso1A2Code = (coordinate: [number, number], options?: { level?: string }) => string | null;

let _iso1A2Code: Iso1A2Code | undefined;

/**
 * Resolve (once) and return country-coder's iso1A2Code function.
 *
 * The dynamic `require()` is only evaluated the first time this runs, keeping the
 * ~2.2 MB country-coder dataset off the app-boot path. Subsequent calls return the
 * memoized reference.
 */
export function getIso1A2Code(): Iso1A2Code {
  if (!_iso1A2Code) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@rapideditor/country-coder');
    _iso1A2Code = mod.iso1A2Code as Iso1A2Code;
  }
  return _iso1A2Code;
}

/**
 * Convenience wrapper mirroring the original `iso1A2Code([lon, lat], { level })`
 * call shape used across the photo-import modules.
 */
export function iso1A2Code(
  coordinate: [number, number],
  options?: { level?: string }
): string | null {
  return getIso1A2Code()(coordinate, options);
}
