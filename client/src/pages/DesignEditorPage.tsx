import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { Design, DominoColor, DominoPlacement } from '../types';

const CELL_W = 16;
const CELL_H = 32;

interface LocalPlacement {
  localId: string;
  id?: string;
  colorId: string;
  hex: string;
  x: number;
  y: number;
  rotation: number;
  zIndex: number;
}

function uid() {
  return Math.random().toString(36).slice(2);
}

export default function DesignEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [design, setDesign] = useState<Design | null>(null);
  const [colors, setColors] = useState<DominoColor[]>([]);
  const [placements, setPlacements] = useState<LocalPlacement[]>([]);
  const [selectedColorId, setSelectedColorId] = useState<string | null>(null);
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(null);
  const [snap, setSnap] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragRef = useRef<{ localId: string; offsetX: number; offsetY: number } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      api.get<{ design: Design; placements: DominoPlacement[] }>(`/designs/${id}`),
      api.get<{ colors: DominoColor[] }>('/colors'),
    ]).then(([designRes, colorsRes]) => {
      setDesign(designRes.design);
      setColors(colorsRes.colors);
      setPlacements(
        designRes.placements.map((p) => ({
          localId: uid(),
          id: p.id,
          colorId: p.colorId,
          hex: p.color.hex,
          x: p.x,
          y: p.y,
          rotation: p.rotation,
          zIndex: p.zIndex,
        }))
      );
    });
  }, [id]);

  const usedByColor = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of placements) {
      map.set(p.colorId, (map.get(p.colorId) ?? 0) + 1);
    }
    return map;
  }, [placements]);

  const remaining = useCallback(
    (colorId: string) => {
      const color = colors.find((c) => c.id === colorId);
      if (!color) return 0;
      return color.quantity - (usedByColor.get(colorId) ?? 0);
    },
    [colors, usedByColor]
  );

  function snapValue(v: number) {
    return snap ? Math.round(v) : Math.round(v * 100) / 100;
  }

  function addTileAt(gridX: number, gridY: number) {
    if (!selectedColorId) return;
    if (remaining(selectedColorId) <= 0) {
      setError('No remaining inventory for that color');
      return;
    }
    const color = colors.find((c) => c.id === selectedColorId);
    if (!color) return;
    setPlacements((prev) => [
      ...prev,
      {
        localId: uid(),
        colorId: color.id,
        hex: color.hex,
        x: snapValue(gridX),
        y: snapValue(gridY),
        rotation: 0,
        zIndex: prev.length,
      },
    ]);
    setError(null);
  }

  function onCanvasClick(e: React.MouseEvent) {
    if (!design || !canvasRef.current || !selectedColorId) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const gx = (e.clientX - rect.left + canvasRef.current.scrollLeft) / CELL_W;
    const gy = (e.clientY - rect.top + canvasRef.current.scrollTop) / CELL_H;
    addTileAt(gx, gy);
  }

  function onTilePointerDown(e: React.PointerEvent, p: LocalPlacement) {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    setSelectedPlacementId(p.localId);
    const rect = canvasRef.current!.getBoundingClientRect();
    const pointerGx = (e.clientX - rect.left + canvasRef.current!.scrollLeft) / CELL_W;
    const pointerGy = (e.clientY - rect.top + canvasRef.current!.scrollTop) / CELL_H;
    dragRef.current = { localId: p.localId, offsetX: pointerGx - p.x, offsetY: pointerGy - p.y };
  }

  function onTilePointerMove(e: React.PointerEvent) {
    if (!dragRef.current || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const gx = (e.clientX - rect.left + canvasRef.current.scrollLeft) / CELL_W - dragRef.current.offsetX;
    const gy = (e.clientY - rect.top + canvasRef.current.scrollTop) / CELL_H - dragRef.current.offsetY;
    const { localId } = dragRef.current;
    setPlacements((prev) =>
      prev.map((p) => (p.localId === localId ? { ...p, x: snapValue(gx), y: snapValue(gy) } : p))
    );
  }

  function onTilePointerUp() {
    dragRef.current = null;
  }

  function rotateSelected() {
    if (!selectedPlacementId) return;
    setPlacements((prev) =>
      prev.map((p) =>
        p.localId === selectedPlacementId ? { ...p, rotation: (p.rotation + 90) % 360 } : p
      )
    );
  }

  function deleteSelected() {
    if (!selectedPlacementId) return;
    setPlacements((prev) => prev.filter((p) => p.localId !== selectedPlacementId));
    setSelectedPlacementId(null);
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!selectedPlacementId) return;
      if (e.key === 'r' || e.key === 'R') rotateSelected();
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelected();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  async function onSave() {
    if (!design) return;
    setSaving(true);
    setError(null);
    try {
      await api.put(`/designs/${design.id}/placements`, {
        placements: placements.map((p) => ({
          colorId: p.colorId,
          x: p.x,
          y: p.y,
          rotation: p.rotation,
          zIndex: p.zIndex,
        })),
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save design');
    } finally {
      setSaving(false);
    }
  }

  if (!design) return <p>Loading...</p>;

  return (
    <div>
      <div className="toolbar">
        <h1 style={{ marginRight: 'auto' }}>{design.name}</h1>
        <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
          Snap to grid
        </label>
        <button className="secondary" onClick={rotateSelected} disabled={!selectedPlacementId}>
          Rotate (R)
        </button>
        <button className="secondary" onClick={deleteSelected} disabled={!selectedPlacementId}>
          Delete (Del)
        </button>
        <button className="secondary" onClick={() => navigate('/designs')}>
          Back
        </button>
        <button onClick={onSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}

      <div className="editor-layout">
        <div className="palette-panel card">
          <strong>Palette</strong>
          <p className="hint">Select a color, then click the canvas to place a domino.</p>
          {colors.map((c) => (
            <div
              key={c.id}
              className={`palette-item ${selectedColorId === c.id ? 'selected' : ''}`}
              onClick={() => setSelectedColorId(c.id === selectedColorId ? null : c.id)}
            >
              <div className="palette-swatch" style={{ background: c.hex }} />
              <div>
                <div>{c.name}</div>
                <div style={{ fontSize: '0.8rem', color: '#667' }}>{remaining(c.id)} remaining</div>
              </div>
            </div>
          ))}
        </div>

        <div
          className="canvas-wrap"
          ref={canvasRef}
          onClick={onCanvasClick}
          onPointerMove={onTilePointerMove}
          onPointerUp={onTilePointerUp}
          style={{
            width: '100%',
            height: '100%',
          }}
        >
          <div
            style={{
              position: 'relative',
              width: design.gridWidth * CELL_W,
              height: design.gridHeight * CELL_H,
            }}
          >
            {placements.map((p) => (
              <div
                key={p.localId}
                className={`domino-tile ${p.localId === selectedPlacementId ? 'draft' : ''}`}
                onPointerDown={(e) => onTilePointerDown(e, p)}
                style={{
                  left: p.x * CELL_W,
                  top: p.y * CELL_H,
                  width: CELL_W,
                  height: CELL_H,
                  background: p.hex,
                  transform: `rotate(${p.rotation}deg)`,
                  transformOrigin: 'center',
                  zIndex: p.zIndex,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
