import { CSSProperties } from 'react';

/** Renders a hex color (6 or 8 digit) over a checkerboard so partial/full
 * transparency is visible instead of just showing whatever's behind it. */
export function swatchStyle(hex: string): CSSProperties {
  return {
    backgroundImage: `linear-gradient(${hex}, ${hex}), repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%)`,
    backgroundSize: '100% 100%, 10px 10px',
  };
}
