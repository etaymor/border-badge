import { colors, withAlpha } from '@constants/colors';

describe('withAlpha', () => {
  it('converts hex color to rgba with alpha', () => {
    const result = withAlpha('#FF0000', 0.5);
    expect(result).toBe('rgba(255, 0, 0, 0.5)');
  });

  it('works with hex color without hash', () => {
    const result = withAlpha('00FF00', 0.8);
    expect(result).toBe('rgba(0, 255, 0, 0.8)');
  });

  it('handles full opacity', () => {
    const result = withAlpha('#0000FF', 1);
    expect(result).toBe('rgba(0, 0, 255, 1)');
  });

  it('handles zero opacity', () => {
    const result = withAlpha('#FFFFFF', 0);
    expect(result).toBe('rgba(255, 255, 255, 0)');
  });

  it('works with sunsetGold color', () => {
    const result = withAlpha(colors.sunsetGold, 0.1);
    expect(result).toBe('rgba(244, 194, 78, 0.1)');
  });

  it('works with midnightNavy color', () => {
    const result = withAlpha(colors.midnightNavy, 0.5);
    expect(result).toBe('rgba(23, 42, 58, 0.5)');
  });

  it('works with adobeBrick color', () => {
    const result = withAlpha(colors.adobeBrick, 0.3);
    expect(result).toBe('rgba(193, 84, 62, 0.3)');
  });

  it('handles lowercase hex', () => {
    const result = withAlpha('#abcdef', 0.5);
    expect(result).toBe('rgba(171, 205, 239, 0.5)');
  });

  it('handles mixed case hex', () => {
    const result = withAlpha('#AbCdEf', 0.5);
    expect(result).toBe('rgba(171, 205, 239, 0.5)');
  });
});

describe('colors', () => {
  it('exports all brand colors', () => {
    expect(colors.midnightNavy).toBe('#172A3A');
    expect(colors.warmCream).toBe('#FDF6ED');
    expect(colors.sunsetGold).toBe('#F4C24E');
    expect(colors.adobeBrick).toBe('#C1543E');
    expect(colors.lakeBlue).toBe('#A0CDEB');
    expect(colors.mossGreen).toBe('#547A5F');
  });

  it('exports secondary brand colors', () => {
    expect(colors.paperBeige).toBe('#F5ECE0');
    expect(colors.dustyCoral).toBe('#F39B8B');
    expect(colors.stormGray).toBe('#666D7A');
    expect(colors.cloudWhite).toBe('#FFFFFF');
  });

  it('exports semantic colors', () => {
    expect(colors.success).toBe('#547A5F');
    expect(colors.warning).toBe('#F4C24E');
    expect(colors.error).toBe('#C1543E');
  });
});
