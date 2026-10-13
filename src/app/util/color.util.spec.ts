import {
  hexToHsv,
  hslToHex,
  hsvToHex,
  isValidHexColor,
  normalizeHexColor,
} from './color.util';

describe('isValidHexColor / normalizeHexColor', () => {
  it('should accept 3- and 6-digit hex regardless of case', () => {
    expect(isValidHexColor('#abc')).toBe(true);
    expect(isValidHexColor('#AABBCC')).toBe(true);
    expect(isValidHexColor(' #aabbcc ')).toBe(true);
    expect(isValidHexColor('aabbcc')).toBe(false);
    expect(isValidHexColor('#aabbc')).toBe(false);
  });

  it('should expand 3-digit and lowercase', () => {
    expect(normalizeHexColor('#ABC')).toBe('#aabbcc');
    expect(normalizeHexColor('  #A1B2C3 ')).toBe('#a1b2c3');
  });
});

describe('hexToHsv', () => {
  it('should map the fully saturated primaries', () => {
    expect(hexToHsv('#ff0000')).toEqual({ h: 0, s: 100, v: 100 });
    expect(hexToHsv('#00ff00')).toEqual({ h: 120, s: 100, v: 100 });
    expect(hexToHsv('#0000ff')).toEqual({ h: 240, s: 100, v: 100 });
  });

  it('should report zero saturation for greys, white and black', () => {
    expect(hexToHsv('#ffffff')).toEqual({ h: 0, s: 0, v: 100 });
    expect(hexToHsv('#000000')).toEqual({ h: 0, s: 0, v: 0 });

    const grey = hexToHsv('#808080')!;
    expect(grey.s).toBe(0);
    expect(grey.v).toBeCloseTo(50.2, 1);
  });

  it('should return null for anything that is not a hex color', () => {
    expect(hexToHsv('red')).toBeNull();
    expect(hexToHsv('#12345')).toBeNull();
    expect(hexToHsv('')).toBeNull();
  });
});

describe('hsvToHex', () => {
  it('should produce the primaries and the achromatic ends', () => {
    expect(hsvToHex({ h: 0, s: 100, v: 100 })).toBe('#ff0000');
    expect(hsvToHex({ h: 120, s: 100, v: 100 })).toBe('#00ff00');
    expect(hsvToHex({ h: 240, s: 100, v: 100 })).toBe('#0000ff');
    expect(hsvToHex({ h: 0, s: 0, v: 100 })).toBe('#ffffff');
    expect(hsvToHex({ h: 0, s: 0, v: 0 })).toBe('#000000');
  });

  it('should wrap the hue and clamp saturation/value', () => {
    expect(hsvToHex({ h: 360, s: 100, v: 100 })).toBe('#ff0000');
    expect(hsvToHex({ h: -120, s: 100, v: 100 })).toBe('#0000ff');
    expect(hsvToHex({ h: 0, s: 200, v: 200 })).toBe('#ff0000');
    expect(hsvToHex({ h: 0, s: -50, v: 100 })).toBe('#ffffff');
  });

  // The picker stores HSV while the app stores hex, so a color handed back and
  // forth has to survive unchanged — including greys, where hue is lost.
  it('should round-trip hex through hsv without drifting', () => {
    const colors = [
      '#000000',
      '#ffffff',
      '#808080',
      '#d74242',
      '#123456',
      '#a05db1',
      '#ffee58',
    ];

    for (const color of colors) {
      expect(hsvToHex(hexToHsv(color)!)).toBe(color);
    }
  });
});

describe('hslToHex', () => {
  it('should convert the known anchors', () => {
    expect(hslToHex(0, 100, 50)).toBe('#ff0000');
    expect(hslToHex(120, 100, 50)).toBe('#00ff00');
    expect(hslToHex(240, 100, 50)).toBe('#0000ff');
    expect(hslToHex(0, 0, 100)).toBe('#ffffff');
    expect(hslToHex(0, 0, 0)).toBe('#000000');
  });
});
