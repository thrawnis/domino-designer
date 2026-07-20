import { useState } from 'react';
import Wheel from '@uiw/react-color-wheel';
import { hexToHsva, hsvaToHex, hsvaToHexa, HsvaColor } from '@uiw/color-convert';
import { SWATCH_PALETTE, TRANSPARENT_HEX } from '../utils/colorPalette';
import { swatchStyle } from '../utils/swatchStyle';

interface Props {
  hex: string;
  onChange: (hex: string) => void;
}

function hexFromHsva(hsva: HsvaColor): string {
  return hsva.a < 1 ? hsvaToHexa(hsva) : hsvaToHex(hsva);
}

function samePreview(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export default function ColorPicker({ hex, onChange }: Props) {
  const [mode, setMode] = useState<'grid' | 'wheel'>('grid');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <div style={{ display: 'flex', gap: '0.25rem' }}>
        <button
          type="button"
          className={mode === 'grid' ? '' : 'secondary'}
          onClick={() => setMode('grid')}
        >
          Swatches
        </button>
        <button
          type="button"
          className={mode === 'wheel' ? '' : 'secondary'}
          onClick={() => setMode('wheel')}
        >
          Color wheel
        </button>
      </div>

      {mode === 'grid' ? (
        <SwatchGrid hex={hex} onChange={onChange} />
      ) : (
        <WheelPicker hex={hex} onChange={onChange} />
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <div className="swatch-preview" style={swatchStyle(hex)} />
        <input
          value={hex}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v.startsWith('#') ? v : `#${v}`);
          }}
          maxLength={9}
          style={{ width: 110 }}
        />
      </div>
    </div>
  );
}

function SwatchGrid({ hex, onChange }: Props) {
  return (
    <div className="swatch-grid">
      <button
        type="button"
        className={`swatch-cell ${samePreview(hex, TRANSPARENT_HEX) ? 'selected' : ''}`}
        style={swatchStyle(TRANSPARENT_HEX)}
        title="Transparent"
        aria-label="Transparent"
        onClick={() => onChange(TRANSPARENT_HEX)}
      />
      {SWATCH_PALETTE.map((swatchHex) => (
        <button
          key={swatchHex}
          type="button"
          className={`swatch-cell ${samePreview(hex, swatchHex) ? 'selected' : ''}`}
          style={swatchStyle(swatchHex)}
          title={swatchHex}
          aria-label={swatchHex}
          onClick={() => onChange(swatchHex)}
        />
      ))}
    </div>
  );
}

function WheelPicker({ hex, onChange }: Props) {
  const hsva = hexToHsva(hex);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
      <Wheel
        color={hsva}
        onChange={(color: { hsva: HsvaColor }) => onChange(hexFromHsva(color.hsva))}
        width={200}
        height={200}
      />
      <label className="slider-row">
        Lightness
        <input
          type="range"
          min={0}
          max={100}
          value={hsva.v}
          onChange={(e) => onChange(hexFromHsva({ ...hsva, v: Number(e.target.value) }))}
        />
      </label>
      <label className="slider-row">
        Opacity
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(hsva.a * 100)}
          onChange={(e) => onChange(hexFromHsva({ ...hsva, a: Number(e.target.value) / 100 }))}
        />
      </label>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button type="button" className="secondary" onClick={() => onChange('#000000')}>
          Black
        </button>
        <button type="button" className="secondary" onClick={() => onChange('#ffffff')}>
          White
        </button>
        <button type="button" className="secondary" onClick={() => onChange(TRANSPARENT_HEX)}>
          Transparent
        </button>
      </div>
    </div>
  );
}
