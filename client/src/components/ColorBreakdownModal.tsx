import { useMemo, useState } from 'react';
import { swatchStyle } from '../utils/swatchStyle';

interface PlacementLike {
  colorId: string;
  x: number;
  y: number;
}

interface ColorLike {
  id: string;
  name: string;
  hex: string;
  quantity?: number;
}

interface Props {
  placements: PlacementLike[];
  colors: ColorLike[];
  onClose: () => void;
}

function buildAxisBreakdown(placements: PlacementLike[], axis: 'x' | 'y') {
  const byIndex = new Map<number, Map<string, number>>();
  for (const p of placements) {
    const idx = Math.round(axis === 'x' ? p.x : p.y);
    let bucket = byIndex.get(idx);
    if (!bucket) {
      bucket = new Map();
      byIndex.set(idx, bucket);
    }
    bucket.set(p.colorId, (bucket.get(p.colorId) ?? 0) + 1);
  }
  return [...byIndex.entries()].sort((a, b) => a[0] - b[0]);
}

export default function ColorBreakdownModal({ placements, colors, onClose }: Props) {
  const [tab, setTab] = useState<'row' | 'column'>('row');
  const colorById = useMemo(() => new Map(colors.map((c) => [c.id, c])), [colors]);

  const totals = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of placements) map.set(p.colorId, (map.get(p.colorId) ?? 0) + 1);
    return [...map.entries()]
      .map(([colorId, count]) => ({ colorId, count, color: colorById.get(colorId) }))
      .sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
  }, [placements, colorById]);

  const usedColorIds = useMemo(() => totals.map((t) => t.colorId), [totals]);

  const rows = useMemo(() => buildAxisBreakdown(placements, 'y'), [placements]);
  const cols = useMemo(() => buildAxisBreakdown(placements, 'x'), [placements]);
  const current = tab === 'row' ? rows : cols;

  return (
    <div className="modal-backdrop">
      <div className="modal modal-wide">
        <button type="button" className="modal-close print-hide" aria-label="Close" onClick={onClose}>
          ×
        </button>
        <div className="modal-header print-hide">
          <h2>Color counts</h2>
          <button type="button" className="secondary" onClick={() => window.print()}>
            Print build sheet
          </button>
        </div>

        {placements.length === 0 ? (
          <p className="hint">No dominoes placed yet.</p>
        ) : (
          <>
            <div>
              <strong>Total by color</strong>
              <table className="counts-table">
                <thead>
                  <tr>
                    <th />
                    <th>Color</th>
                    <th>Used</th>
                  </tr>
                </thead>
                <tbody>
                  {totals.map(({ colorId, count, color }) => {
                    const over = color?.quantity != null && count > color.quantity;
                    return (
                      <tr key={colorId} className={over ? 'over' : ''}>
                        <td>
                          <div className="palette-swatch" style={swatchStyle(color?.hex ?? '#cccccc')} />
                        </td>
                        <td>{color?.name ?? 'Unknown color'}</td>
                        <td>
                          {count}
                          {over && ` (short ${count - (color!.quantity as number)})`}
                        </td>
                      </tr>
                    );
                  })}
                  <tr>
                    <td />
                    <td>
                      <strong>Total</strong>
                    </td>
                    <td>
                      <strong>{placements.length}</strong>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div>
              <div className="print-hide" style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.5rem' }}>
                <button type="button" className={tab === 'row' ? '' : 'secondary'} onClick={() => setTab('row')}>
                  By row
                </button>
                <button
                  type="button"
                  className={tab === 'column' ? '' : 'secondary'}
                  onClick={() => setTab('column')}
                >
                  By column
                </button>
              </div>
              <p className="hint">
                Counts per {tab} so you can check off dominoes as you build in either direction.
              </p>
              <div className="counts-table-scroll">
                <table className="counts-table">
                  <thead>
                    <tr>
                      <th>{tab === 'row' ? 'Row' : 'Column'}</th>
                      {usedColorIds.map((colorId) => (
                        <th key={colorId}>
                          <div className="palette-swatch" style={swatchStyle(colorById.get(colorId)?.hex ?? '#ccc')} />
                        </th>
                      ))}
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {current.map(([index, counts]) => {
                      const rowTotal = [...counts.values()].reduce((a, b) => a + b, 0);
                      return (
                        <tr key={index}>
                          <td>{index + 1}</td>
                          {usedColorIds.map((colorId) => (
                            <td key={colorId}>{counts.get(colorId) || ''}</td>
                          ))}
                          <td>
                            <strong>{rowTotal}</strong>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
