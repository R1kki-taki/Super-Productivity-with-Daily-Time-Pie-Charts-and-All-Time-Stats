import { clamp } from './clamp';

/** Hue in degrees `0–360`, saturation and value in percent `0–100`. */
export interface Hsv {
  h: number;
  s: number;
  v: number;
}

const HEX_COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const HEX_COLOR_SHORT_RE = /^#[0-9a-f]{3}$/;

/** True for the 3- or 6-digit hex forms the color fields accept. */
export const isValidHexColor = (value: string): boolean =>
  HEX_COLOR_RE.test(value.trim());

/** Lower-cases an accepted color and expands `#rgb` to `#rrggbb`. */
export const normalizeHexColor = (value: string): string => {
  const color = value.trim().toLowerCase();
  if (HEX_COLOR_SHORT_RE.test(color)) {
    return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`;
  }
  return color;
};

const toHexByte = (channel: number): string =>
  Math.round(clamp(channel, 255)).toString(16).padStart(2, '0');

const channelsToHex = (r: number, g: number, b: number): string =>
  `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;

/**
 * Hue/chroma helper shared by the HSV and HSL conversions: `hue` is the sector
 * index in `0–6`, and the result is the RGB triple of the fully saturated,
 * fully bright color of that sector.
 */
const hueChannels = (hue: number, chroma: number): [number, number, number] => {
  const x = chroma * (1 - Math.abs((hue % 2) - 1));
  if (hue < 1) {
    return [chroma, x, 0];
  }
  if (hue < 2) {
    return [x, chroma, 0];
  }
  if (hue < 3) {
    return [0, chroma, x];
  }
  if (hue < 4) {
    return [0, x, chroma];
  }
  if (hue < 5) {
    return [x, 0, chroma];
  }
  return [chroma, 0, x];
};

const toHueSector = (h: number): number => (((h % 360) + 360) % 360) / 60;

/** `null` for anything that is not a 3- or 6-digit hex color. */
export const hexToHsv = (hex: string): Hsv | null => {
  const color = normalizeHexColor(hex);
  if (!isValidHexColor(color)) {
    return null;
  }

  const r = parseInt(color.slice(1, 3), 16) / 255;
  const g = parseInt(color.slice(3, 5), 16) / 255;
  const b = parseInt(color.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta > 0) {
    if (max === r) {
      h = 60 * (((g - b) / delta) % 6);
    } else if (max === g) {
      const sector = (b - r) / delta;
      h = 60 * (sector + 2);
    } else {
      const sector = (r - g) / delta;
      h = 60 * (sector + 4);
    }
  }

  return {
    h: h < 0 ? h + 360 : h,
    s: max === 0 ? 0 : (delta / max) * 100,
    v: max * 100,
  };
};

/**
 * Round-trips through 8-bit channels, so `hsvToHex(hexToHsv(c))` returns `c`
 * again for greys and black, where the hue is not recoverable.
 */
export const hsvToHex = ({ h, s, v }: Hsv): string => {
  const saturation = clamp(s, 100) / 100;
  const value = clamp(v, 100) / 100;
  const chroma = value * saturation;
  const [r, g, b] = hueChannels(toHueSector(h), chroma);
  const m = value - chroma;

  return channelsToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
};

export const hslToHex = (h: number, s: number, l: number): string => {
  const saturation = clamp(s, 100) / 100;
  const lightness = clamp(l, 100) / 100;
  const scaledLightness = 2 * lightness;
  const chroma = (1 - Math.abs(scaledLightness - 1)) * saturation;
  const [r, g, b] = hueChannels(toHueSector(h), chroma);
  const halfChroma = chroma / 2;
  const m = lightness - halfChroma;

  return channelsToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
};
