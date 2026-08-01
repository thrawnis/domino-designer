import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useNavigate, useParams } from 'react-router-dom';
import { api, describeApiError } from '../api/client';
import { Design, DominoColor, DominoPlacement } from '../types';
import { swatchStyle } from '../utils/swatchStyle';
import ColorBreakdownModal from '../components/ColorBreakdownModal';
import { PITCH_X_RATIO, PITCH_Y_RATIO } from '../utils/dominoSpec';

// A domino's own rendered footprint (width x length, ~24mm x 48mm at this scale).
const TILE_W = 16;
const TILE_H = 32;
// Grid pitch: distance between adjacent placement slots, wider than the tile
// itself so dominoes never render touching (see dominoSpec.ts for why).
const PITCH_X = TILE_W * PITCH_X_RATIO;
const PITCH_Y = TILE_H * PITCH_Y_RATIO;
const TILE_OFFSET_X = (PITCH_X - TILE_W) / 2;
const TILE_OFFSET_Y = (PITCH_Y - TILE_H) / 2;

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
  const [dirty, setDirty] = useState(false);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const dragRef = useRef<{ localId: string; offsetX: number; offsetY: number; moved: boolean } | null>(
    null
  );
  // Set when a pointer interaction started on a tile, so the trailing click
  // event doesn't also drop a new domino on the canvas underneath.
  const suppressNextCanvasClick = useRef(false);
  const canvasRef = useRef<HTMLDivElement>(null);

  const currentHexById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of colors) map.set(c.id, c.hex);
    return map;
  }, [colors]);

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
      return Math.max(0, color.quantity - (usedByColor.get(colorId) ?? 0));
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
    setDirty(true);
    setError(null);
  }

  function onCanvasClick(e: React.MouseEvent) {
    // A click that originated on a tile (select/drag) shouldn't also place one.
    if (suppressNextCanvasClick.current) {
      suppressNextCanvasClick.current = false;
      return;
    }
    if (!design || !canvasRef.current || !selectedColorId) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const gx = (e.clientX - rect.left + canvasRef.current.scrollLeft) / PITCH_X;
    const gy = (e.clientY - rect.top + canvasRef.current.scrollTop) / PITCH_Y;
    addTileAt(gx, gy);
  }

  function onTilePointerDown(e: React.PointerEvent, p: LocalPlacement) {
    e.stopPropagation();
    suppressNextCanvasClick.current = true;
    (e.target as Element).setPointerCapture(e.pointerId);
    setSelectedPlacementId(p.localId);
    const rect = canvasRef.current!.getBoundingClientRect();
    const pointerGx = (e.clientX - rect.left + canvasRef.current!.scrollLeft) / PITCH_X;
    const pointerGy = (e.clientY - rect.top + canvasRef.current!.scrollTop) / PITCH_Y;
    dragRef.current = { localId: p.localId, offsetX: pointerGx - p.x, offsetY: pointerGy - p.y, moved: false };
  }

  function onTilePointerMove(e: React.PointerEvent) {
    if (!dragRef.current || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const gx = (e.clientX - rect.left + canvasRef.current.scrollLeft) / PITCH_X - dragRef.current.offsetX;
    const gy = (e.clientY - rect.top + canvasRef.current.scrollTop) / PITCH_Y - dragRef.current.offsetY;
    const { localId } = dragRef.current;
    dragRef.current.moved = true;
    setPlacements((prev) =>
      prev.map((p) => (p.localId === localId ? { ...p, x: snapValue(gx), y: snapValue(gy) } : p))
    );
    setDirty(true);
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
    setDirty(true);
  }

  function deleteSelected() {
    if (!selectedPlacementId) return;
    setPlacements((prev) => prev.filter((p) => p.localId !== selectedPlacementId));
    setSelectedPlacementId(null);
    setDirty(true);
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!selectedPlacementId) return;
      // Don't hijack Backspace/Delete/R while typing in a form field.
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if (e.key === 'r' || e.key === 'R') rotateSelected();
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelected();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  useEffect(() => {
    if (!breakdownOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setBreakdownOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [breakdownOpen]);

  // Warn on browser-level navigation (refresh, tab close) with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // Warn on in-app navigation (nav bar, Back button) with unsaved changes.
  const blocker = useBlocker(dirty && !saving);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm('You have unsaved changes. Leave this design without saving?')) {
      blocker.proceed();
    } else {
      blocker.reset();
    }
  }, [blocker]);

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
      setDirty(false);
    } catch (err) {
      setError(describeApiError(err, 'Failed to save design'));
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
        <button className="secondary" onClick={() => setBreakdownOpen(true)}>
          Color counts
        </button>
        <button className="secondary" onClick={() => navigate('/designs')}>
          Back
        </button>
        <button onClick={onSave} disabled={saving || !dirty}>
          {saving ? 'Saving...' : dirty ? 'Save changes' : 'Saved'}
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
      {breakdownOpen && (
        <ColorBreakdownModal placements={placements} colors={colors} onClose={() => setBreakdownOpen(false)} />
      )}

      <div className="editor-layout">
        <div className="palette-panel card">
          <strong>Palette</strong>
          <p className="hint">
            Select a color, then click the canvas to place a domino. Dominoes are spaced automatically
            so they don't touch, for stacking/toppling clearance.
          </p>
          {colors.map((c) => (
            <div
              key={c.id}
              className={`palette-item ${selectedColorId === c.id ? 'selected' : ''}`}
              onClick={() => setSelectedColorId(c.id === selectedColorId ? null : c.id)}
            >
              <div className="palette-swatch" style={swatchStyle(c.hex)} />
              <div>
                <div>{c.name}</div>
                <div style={{ fontSize: '0.8rem', color: '#667' }}>
                  {usedByColor.get(c.id) ?? 0} used &middot; {remaining(c.id)} remaining
                </div>
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
              width: design.gridWidth * PITCH_X,
              height: design.gridHeight * PITCH_Y,
            }}
          >
            {placements.map((p) => (
              <div
                key={p.localId}
                className={`domino-tile ${p.localId === selectedPlacementId ? 'draft' : ''}`}
                onPointerDown={(e) => onTilePointerDown(e, p)}
                style={{
                  left: p.x * PITCH_X + TILE_OFFSET_X,
                  top: p.y * PITCH_Y + TILE_OFFSET_Y,
                  width: TILE_W,
                  height: TILE_H,
                  ...swatchStyle(currentHexById.get(p.colorId) ?? p.hex),
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
