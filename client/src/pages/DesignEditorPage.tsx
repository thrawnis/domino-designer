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

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.25;

// Cap on undo history depth so the stack can't grow unbounded during a long editing session.
const HISTORY_LIMIT = 100;

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

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [snap, setSnap] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  // Collapsed by default on narrow (phone-width) screens so the canvas isn't
  // squeezed into a sliver; always overridable via the toggle button.
  const [paletteCollapsed, setPaletteCollapsed] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 640
  );
  const [zoom, setZoom] = useState(1);
  const [marqueeRect, setMarqueeRect] = useState<Rect | null>(null);
  // Undo/redo stacks of full placement snapshots, captured just before each mutation.
  const [history, setHistory] = useState<LocalPlacement[][]>([]);
  const [future, setFuture] = useState<LocalPlacement[][]>([]);

  const dragRef = useRef<{
    ids: string[];
    startGx: number;
    startGy: number;
    origins: Map<string, { x: number; y: number }>;
    moved: boolean;
  } | null>(null);
  const marqueeRef = useRef<{ startX: number; startY: number; additive: boolean; moved: boolean } | null>(null);
  // Set when a pointer interaction started on a tile (or ended a marquee drag), so the
  // trailing click event doesn't also drop a new domino or clear the selection.
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

  // Colors used more than are currently owned (e.g. inventory quantity was lowered
  // after tiles using it were placed). Surfaced as a warning, not a hard block, since
  // the design is still valid to look at/edit even if the physical set is short.
  const overInventory = useMemo(
    () =>
      colors
        .map((c) => ({ color: c, used: usedByColor.get(c.id) ?? 0 }))
        .filter(({ color, used }) => used > color.quantity),
    [colors, usedByColor]
  );

  function snapValue(v: number) {
    return snap ? Math.round(v) : Math.round(v * 100) / 100;
  }

  function pushHistory(snapshot: LocalPlacement[]) {
    setHistory((h) => {
      const next = [...h, snapshot];
      return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next;
    });
    setFuture([]);
  }

  function undo() {
    if (history.length === 0) return;
    const prevState = history[history.length - 1];
    setFuture((f) => [...f, placements]);
    setHistory((h) => h.slice(0, -1));
    setPlacements(prevState);
    setSelectedIds(new Set());
    setDirty(true);
  }

  function redo() {
    if (future.length === 0) return;
    const nextState = future[future.length - 1];
    setHistory((h) => [...h, placements]);
    setFuture((f) => f.slice(0, -1));
    setPlacements(nextState);
    setSelectedIds(new Set());
    setDirty(true);
  }

  function addTileAt(gridX: number, gridY: number) {
    if (!selectedColorId) return;
    if (remaining(selectedColorId) <= 0) {
      setError('No remaining inventory for that color');
      return;
    }
    const color = colors.find((c) => c.id === selectedColorId);
    if (!color) return;
    pushHistory(placements);
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

  function toCanvasPoint(e: { clientX: number; clientY: number }) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: e.clientX - rect.left + canvasRef.current!.scrollLeft,
      y: e.clientY - rect.top + canvasRef.current!.scrollTop,
    };
  }

  function onCanvasPointerDown(e: React.PointerEvent) {
    // A color is selected: clicking the canvas places a tile there, so a drag in that
    // mode shouldn't also start a marquee selection.
    if (selectedColorId) return;
    if (!canvasRef.current) return;
    const { x, y } = toCanvasPoint(e);
    marqueeRef.current = { startX: x, startY: y, additive: e.shiftKey, moved: false };
    setMarqueeRect({ x, y, w: 0, h: 0 });
    canvasRef.current.focus();
  }

  function onCanvasClick(e: React.MouseEvent) {
    // A click that originated on a tile (select/drag) or ended a marquee drag
    // shouldn't also place a tile or clear the selection.
    if (suppressNextCanvasClick.current) {
      suppressNextCanvasClick.current = false;
      return;
    }
    if (!design || !canvasRef.current) return;
    if (selectedColorId) {
      const rect = canvasRef.current.getBoundingClientRect();
      const gx = (e.clientX - rect.left + canvasRef.current.scrollLeft) / (PITCH_X * zoom);
      const gy = (e.clientY - rect.top + canvasRef.current.scrollTop) / (PITCH_Y * zoom);
      addTileAt(gx, gy);
      return;
    }
    if (!e.shiftKey) setSelectedIds(new Set());
  }

  function onTilePointerDown(e: React.PointerEvent, p: LocalPlacement) {
    e.stopPropagation();
    suppressNextCanvasClick.current = true;
    (e.target as Element).setPointerCapture(e.pointerId);
    canvasRef.current?.focus();

    if (e.shiftKey) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(p.localId)) next.delete(p.localId);
        else next.add(p.localId);
        return next;
      });
      return; // shift-click only toggles selection membership, it doesn't start a drag
    }

    const activeIds = selectedIds.has(p.localId) && selectedIds.size > 1 ? [...selectedIds] : [p.localId];
    if (activeIds.length === 1) setSelectedIds(new Set(activeIds));

    const rect = canvasRef.current!.getBoundingClientRect();
    const pointerGx = (e.clientX - rect.left + canvasRef.current!.scrollLeft) / (PITCH_X * zoom);
    const pointerGy = (e.clientY - rect.top + canvasRef.current!.scrollTop) / (PITCH_Y * zoom);
    const origins = new Map(
      placements.filter((pl) => activeIds.includes(pl.localId)).map((pl) => [pl.localId, { x: pl.x, y: pl.y }])
    );
    dragRef.current = { ids: activeIds, startGx: pointerGx, startGy: pointerGy, origins, moved: false };
  }

  function onCanvasPointerMove(e: React.PointerEvent) {
    if (dragRef.current && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const gx = (e.clientX - rect.left + canvasRef.current.scrollLeft) / (PITCH_X * zoom);
      const gy = (e.clientY - rect.top + canvasRef.current.scrollTop) / (PITCH_Y * zoom);
      const { startGx, startGy, origins, ids } = dragRef.current;
      if (!dragRef.current.moved) pushHistory(placements);
      dragRef.current.moved = true;
      const dx = gx - startGx;
      const dy = gy - startGy;
      setPlacements((prev) =>
        prev.map((pl) => {
          const origin = origins.get(pl.localId);
          if (!origin || !ids.includes(pl.localId)) return pl;
          return { ...pl, x: snapValue(origin.x + dx), y: snapValue(origin.y + dy) };
        })
      );
      setDirty(true);
    } else if (marqueeRef.current && canvasRef.current) {
      const { x, y } = toCanvasPoint(e);
      const { startX, startY } = marqueeRef.current;
      marqueeRef.current.moved = true;
      setMarqueeRect({ x: Math.min(x, startX), y: Math.min(y, startY), w: Math.abs(x - startX), h: Math.abs(y - startY) });
    }
  }

  function onCanvasPointerUp() {
    if (marqueeRef.current) {
      if (marqueeRef.current.moved && marqueeRect) {
        suppressNextCanvasClick.current = true;
        const gx0 = marqueeRect.x / (PITCH_X * zoom);
        const gy0 = marqueeRect.y / (PITCH_Y * zoom);
        const gx1 = (marqueeRect.x + marqueeRect.w) / (PITCH_X * zoom);
        const gy1 = (marqueeRect.y + marqueeRect.h) / (PITCH_Y * zoom);
        const hitIds = placements
          .filter((p) => p.x + 1 >= gx0 && p.x <= gx1 && p.y + 1 >= gy0 && p.y <= gy1)
          .map((p) => p.localId);
        const additive = marqueeRef.current.additive;
        setSelectedIds((prev) => {
          if (additive) {
            const next = new Set(prev);
            hitIds.forEach((idVal) => next.add(idVal));
            return next;
          }
          return new Set(hitIds);
        });
      }
      marqueeRef.current = null;
      setMarqueeRect(null);
    }
    dragRef.current = null;
  }

  function rotateSelected() {
    if (selectedIds.size === 0) return;
    pushHistory(placements);
    setPlacements((prev) => prev.map((p) => (selectedIds.has(p.localId) ? { ...p, rotation: (p.rotation + 90) % 360 } : p)));
    setDirty(true);
  }

  function deleteSelected() {
    if (selectedIds.size === 0) return;
    pushHistory(placements);
    setPlacements((prev) => prev.filter((p) => !selectedIds.has(p.localId)));
    setSelectedIds(new Set());
    setDirty(true);
  }

  function recolorSelected() {
    if (selectedIds.size === 0 || !selectedColorId) return;
    const color = colors.find((c) => c.id === selectedColorId);
    if (!color) return;
    const newUsage =
      placements.filter((p) => !selectedIds.has(p.localId) && p.colorId === selectedColorId).length + selectedIds.size;
    if (newUsage > color.quantity) {
      setError(`Not enough ${color.name} in inventory to recolor that many tiles`);
      return;
    }
    pushHistory(placements);
    setPlacements((prev) =>
      prev.map((p) => (selectedIds.has(p.localId) ? { ...p, colorId: color.id, hex: color.hex } : p))
    );
    setDirty(true);
    setError(null);
  }

  function zoomIn() {
    setZoom((z) => Math.min(ZOOM_MAX, Math.round((z + ZOOM_STEP) * 100) / 100));
  }

  function zoomOut() {
    setZoom((z) => Math.max(ZOOM_MIN, Math.round((z - ZOOM_STEP) * 100) / 100));
  }

  function zoomReset() {
    setZoom(1);
  }

  // Scoped to the canvas element's own focus (via onKeyDown below), not a window-level
  // listener — otherwise Delete/Backspace pressed anywhere on the page (e.g. after
  // focus moves to an unrelated button) would delete whatever tile was last selected.
  function onCanvasKeyDown(e: React.KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault();
      setSelectedIds(new Set(placements.map((p) => p.localId)));
      return;
    }
    if (e.key === 'Escape') {
      setSelectedIds(new Set());
      return;
    }
    if (selectedIds.size === 0) return;
    if (e.key === 'r' || e.key === 'R') rotateSelected();
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      deleteSelected();
    }
  }

  // Undo/redo work from anywhere on the page (not just canvas focus) since they only
  // ever revert state rather than act on an implicit "last selected" tile.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault();
        redo();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [history, future, placements]);

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
        <div className="zoom-controls">
          <button
            type="button"
            className="secondary"
            onClick={zoomOut}
            disabled={zoom <= ZOOM_MIN}
            aria-label="Zoom out"
          >
            −
          </button>
          <button type="button" className="secondary zoom-level" onClick={zoomReset} title="Reset zoom">
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            className="secondary"
            onClick={zoomIn}
            disabled={zoom >= ZOOM_MAX}
            aria-label="Zoom in"
          >
            +
          </button>
        </div>
        <button className="secondary" onClick={undo} disabled={history.length === 0} title="Undo (Ctrl+Z)">
          Undo
        </button>
        <button className="secondary" onClick={redo} disabled={future.length === 0} title="Redo (Ctrl+Shift+Z)">
          Redo
        </button>
        <button className="secondary" onClick={rotateSelected} disabled={selectedIds.size === 0}>
          Rotate (R){selectedIds.size > 1 ? ` ×${selectedIds.size}` : ''}
        </button>
        <button
          className="secondary"
          onClick={recolorSelected}
          disabled={selectedIds.size === 0 || !selectedColorId}
          title="Apply the selected palette color to the selected tiles"
        >
          Recolor selection
        </button>
        <button className="secondary" onClick={deleteSelected} disabled={selectedIds.size === 0}>
          Delete (Del){selectedIds.size > 1 ? ` ×${selectedIds.size}` : ''}
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
      {overInventory.length > 0 && (
        <p className="warning-banner">
          Short on inventory: {overInventory.map(({ color, used }) => `${color.name} (${used}/${color.quantity})`).join(', ')}
        </p>
      )}
      {breakdownOpen && (
        <ColorBreakdownModal placements={placements} colors={colors} onClose={() => setBreakdownOpen(false)} />
      )}

      <div className={`editor-layout ${paletteCollapsed ? 'palette-collapsed' : ''}`}>
        <div className="palette-panel card">
          <div className="palette-panel-header">
            {!paletteCollapsed && <strong>Palette</strong>}
            <button
              type="button"
              className="secondary palette-toggle"
              onClick={() => setPaletteCollapsed((v) => !v)}
              aria-label={paletteCollapsed ? 'Expand palette' : 'Collapse palette'}
              title={paletteCollapsed ? 'Expand palette' : 'Collapse palette'}
            >
              {paletteCollapsed ? '»' : '«'}
            </button>
          </div>
          {!paletteCollapsed && (
            <p className="hint">
              Select a color, then click the canvas to place a domino, or drag on empty canvas to
              marquee-select tiles (shift-click/drag to add to selection). Dominoes are spaced
              automatically so they don't touch, for stacking/toppling clearance.
            </p>
          )}
          {colors.map((c) => {
            const used = usedByColor.get(c.id) ?? 0;
            const over = used > c.quantity;
            return (
              <div
                key={c.id}
                className={`palette-item ${selectedColorId === c.id ? 'selected' : ''} ${over ? 'over-inventory' : ''}`}
                onClick={() => setSelectedColorId(c.id === selectedColorId ? null : c.id)}
                title={`${c.name}: ${used} used, ${remaining(c.id)} remaining${over ? ` (short ${used - c.quantity})` : ''}`}
              >
                <div className="palette-swatch" style={swatchStyle(c.hex)} />
                {paletteCollapsed ? (
                  <div className="palette-remaining">{remaining(c.id)}</div>
                ) : (
                  <div>
                    <div>{c.name}</div>
                    <div style={{ fontSize: '0.8rem', color: over ? '#c02626' : '#667' }}>
                      {used} used &middot; {over ? `short ${used - c.quantity}` : `${remaining(c.id)} remaining`}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div
          className="canvas-wrap"
          ref={canvasRef}
          tabIndex={0}
          onClick={onCanvasClick}
          onPointerDown={onCanvasPointerDown}
          onPointerMove={onCanvasPointerMove}
          onPointerUp={onCanvasPointerUp}
          onKeyDown={onCanvasKeyDown}
          style={{
            width: '100%',
            height: '100%',
            outline: 'none',
          }}
        >
          <div
            style={{
              position: 'relative',
              width: design.gridWidth * PITCH_X * zoom,
              height: design.gridHeight * PITCH_Y * zoom,
            }}
          >
            <div
              style={{
                position: 'relative',
                width: design.gridWidth * PITCH_X,
                height: design.gridHeight * PITCH_Y,
                transform: `scale(${zoom})`,
                transformOrigin: '0 0',
              }}
            >
              {placements.map((p) => (
                <div
                  key={p.localId}
                  className={`domino-tile ${selectedIds.has(p.localId) ? 'draft' : ''}`}
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
            {marqueeRect && (
              <div
                className="marquee-rect"
                style={{
                  left: marqueeRect.x,
                  top: marqueeRect.y,
                  width: marqueeRect.w,
                  height: marqueeRect.h,
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
