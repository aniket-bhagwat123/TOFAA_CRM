export const BANNER_WIDTH = 2156;
export const BANNER_HEIGHT = 198;

/**
 * The part of a picture (in its own pixels) that becomes the banner: the largest banner-shaped area at zoom 1, smaller
 * as the zoom grows, centred where asked (0 to 1) but never outside the picture.
 */
export function cropArea(width: number, height: number, zoom: number, centre: { x: number; y: number }) {
  const ratio = BANNER_WIDTH / BANNER_HEIGHT;
  const w = Math.min(width, height * ratio) / Math.max(1, zoom);
  const h = w / ratio;
  const clamp = (value: number, max: number) => Math.min(Math.max(0, value), Math.max(0, max));
  return { x: clamp(centre.x * width - w / 2, width - w), y: clamp(centre.y * height - h / 2, height - h), width: w, height: h };
}
