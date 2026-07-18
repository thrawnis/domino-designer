import Wheel from '@uiw/react-color-wheel';
import { hexToHsva, hsvaToHex, HsvaColor } from '@uiw/color-convert';

interface Props {
  hex: string;
  onChange: (hex: string) => void;
}

export default function ColorWheelPicker({ hex, onChange }: Props) {
  const hsva = hexToHsva(hex);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
      <Wheel
        color={hsva}
        onChange={(color: { hsva: HsvaColor }) => onChange(hsvaToHex(color.hsva))}
        width={200}
        height={200}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 4,
            border: '1px solid #d8dce3',
            background: hex,
          }}
        />
        <input
          value={hex}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v.startsWith('#') ? v : `#${v}`);
          }}
          maxLength={7}
          style={{ width: 100 }}
        />
      </div>
    </div>
  );
}
