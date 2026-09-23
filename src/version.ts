/**
 * Which build this is.
 *
 * Shown beside the app's name so a phone that has quietly kept an old copy
 * is obvious: if the date is not today's deploy, the app is out of date.
 * The values are baked in when the bundle is built (see vite.config.ts);
 * in the dev server they fall back to something honest rather than empty.
 */

export const VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
export const BUILT_ON: string = typeof __APP_BUILT__ === 'string' ? __APP_BUILT__ : 'dev';
export const COMMIT: string = typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : 'dev';

/** "v0.2.0 · 23 Sep" — short enough to sit next to the title on a phone. */
export function shortVersion(): string {
  if (BUILT_ON === 'dev') return `v${VERSION} · dev`;
  const [year, month, day] = BUILT_ON.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  const shown = date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `v${VERSION} · ${shown}`;
}

/** The whole story, for the tooltip. */
export function fullVersion(): string {
  return `clefcraft ${VERSION}, built ${BUILT_ON} from commit ${COMMIT}`;
}
