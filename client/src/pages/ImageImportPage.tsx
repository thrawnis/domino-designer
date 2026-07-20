import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { Design, GridCell, ImportGridResult } from '../types';
import { PITCH_ASPECT, PITCH_X_RATIO, PITCH_Y_RATIO } from '../utils/dominoSpec';

// Dominoes stand ~1 wide : 2 tall, so preview tiles are drawn tall to match how
// the design will actually look (and how the editor renders them).
const CELL_ASPECT = 2;
const MAX_CELLS = 12000;
const MAX_DIM = 200;

interface PreviewResponse {
  gridWidth: number;
  gridHeight: number;
  nearest: ImportGridResult;
  dithered: ImportGridResult;
}

/** Draws the mosaic to a single canvas (one element, not one div per cell) so
 * large grids don't create tens of thousands of DOM nodes. Tiles are drawn
 * smaller than their grid pitch, matching the editor's spacing, so the
 * preview shows the same not-touching layout the created design will have. */
function PreviewCanvas({ cells, gridWidth, gridHeight }: { cells: GridCell[]; gridWidth: number; gridHeight: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const cw = Math.max(1, Math.min(6, Math.floor(260 / (gridWidth * PITCH_X_RATIO))));
  const ch = cw * CELL_ASPECT;
  const pitchX = cw * PITCH_X_RATIO;
  const pitchY = ch * PITCH_Y_RATIO;
  const offsetX = (pitchX - cw) / 2;
  const offsetY = (pitchY - ch) / 2;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Checkerboard so transparent/translucent dominoes read as transparent.
    const check = 8;
    for (let y = 0; y < canvas.height; y += check) {
      for (let x = 0; x < canvas.width; x += check) {
        ctx.fillStyle = ((x / check + y / check) % 2 === 0) ? '#ffffff' : '#cccccc';
        ctx.fillRect(x, y, check, check);
      }
    }
    for (const c of cells) {
      ctx.fillStyle = c.hex;
      ctx.fillRect(c.x * pitchX + offsetX, c.y * pitchY + offsetY, cw, ch);
    }
  }, [cells, cw, ch, pitchX, pitchY, offsetX, offsetY]);

  return (
    <canvas
      ref={ref}
      className="import-preview"
      width={gridWidth * pitchX}
      height={gridHeight * pitchY}
    />
  );
}

export default function ImageImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [imgAspect, setImgAspect] = useState<number | null>(null);
  const [dominoesWide, setDominoesWide] = useState(40);
  const [keepAspect, setKeepAspect] = useState(true);
  const [manualHeight, setManualHeight] = useState(40);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [choice, setChoice] = useState<'nearest' | 'dithered' | null>(null);
  const [designName, setDesignName] = useState('');
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  // Derive height from the image's aspect ratio and the physical grid pitch
  // (tile shape + required gap) so the built result isn't stretched.
  // imgAspect is width/height of the source.
  const gridHeight = useMemo(() => {
    if (keepAspect && imgAspect) {
      return Math.max(1, Math.min(MAX_DIM, Math.round((dominoesWide * PITCH_ASPECT) / imgAspect)));
    }
    return manualHeight;
  }, [keepAspect, imgAspect, dominoesWide, manualHeight]);

  const totalCells = dominoesWide * gridHeight;
  const tooManyCells = totalCells > MAX_CELLS;

  function onFileChange(f: File | null) {
    setFile(f);
    setImgAspect(null);
    setPreview(null);
    setChoice(null);
    if (!f) return;
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth && img.naturalHeight) {
        setImgAspect(img.naturalWidth / img.naturalHeight);
      }
      URL.revokeObjectURL(url);
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  }

  async function onGeneratePreview(e: FormEvent) {
    e.preventDefault();
    if (!file || tooManyCells) return;
    setError(null);
    setLoading(true);
    setPreview(null);
    setChoice(null);
    try {
      const form = new FormData();
      form.append('image', file);
      form.append('gridWidth', String(dominoesWide));
      form.append('gridHeight', String(gridHeight));
      const res = await api.postForm<PreviewResponse>('/designs/import-preview', form);
      setPreview(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to process image');
    } finally {
      setLoading(false);
    }
  }

  async function onCreateDesign() {
    if (!preview || !choice || !designName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const result = choice === 'nearest' ? preview.nearest : preview.dithered;
      const designRes = await api.post<{ design: Design }>('/designs', {
        name: designName.trim(),
        gridWidth: preview.gridWidth,
        gridHeight: preview.gridHeight,
      });
      await api.put(`/designs/${designRes.design.id}/placements`, {
        placements: result.cells.map((c, i) => ({
          colorId: c.colorId,
          x: c.x,
          y: c.y,
          rotation: 0,
          zIndex: i,
        })),
      });
      navigate(`/designs/${designRes.design.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create design');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <h1>Import image</h1>
      <p>
        Upload an image and it will be converted into a domino mosaic using the colors currently in your
        inventory (only colors with quantity greater than zero are used).
      </p>

      <form className="card" onSubmit={onGeneratePreview} style={{ display: 'flex', gap: '1rem', alignItems: 'end', flexWrap: 'wrap' }}>
        <label>
          Image
          <input
            type="file"
            accept="image/*"
            onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
            required
          />
        </label>
        <label>
          Dominoes wide
          <input
            type="number"
            min={1}
            max={MAX_DIM}
            value={dominoesWide}
            onChange={(e) => setDominoesWide(Number(e.target.value))}
          />
        </label>
        <label>
          Dominoes tall
          <input
            type="number"
            min={1}
            max={MAX_DIM}
            value={gridHeight}
            disabled={keepAspect && !!imgAspect}
            onChange={(e) => setManualHeight(Number(e.target.value))}
          />
        </label>
        <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <input type="checkbox" checked={keepAspect} onChange={(e) => setKeepAspect(e.target.checked)} />
          Keep image proportions
        </label>
        <button type="submit" disabled={!file || loading || tooManyCells}>
          {loading ? 'Processing...' : 'Generate preview'}
        </button>
      </form>

      <p className="hint" style={{ marginTop: '0.5rem' }}>
        Result: {dominoesWide} × {gridHeight} = {totalCells.toLocaleString()} dominoes.
        {keepAspect && !imgAspect && ' Choose an image to auto-fit the height to its proportions.'}
      </p>
      {tooManyCells && (
        <p className="form-error">
          That's more than {MAX_CELLS.toLocaleString()} dominoes. Reduce the width or height.
        </p>
      )}

      {error && <p className="form-error">{error}</p>}

      {preview && (
        <div style={{ marginTop: '1.5rem' }}>
          <div className="import-grid">
            <div>
              <h3>Nearest color (no dithering)</h3>
              {preview.nearest.ranOutOfInventory && (
                <p className="warning-banner">
                  Ran out of some colors&apos; inventory partway through; substitute colors were used.
                </p>
              )}
              <PreviewCanvas cells={preview.nearest.cells} gridWidth={preview.gridWidth} gridHeight={preview.gridHeight} />
              <label style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem' }}>
                <input type="radio" name="choice" checked={choice === 'nearest'} onChange={() => setChoice('nearest')} />
                Use this version
              </label>
            </div>
            <div>
              <h3>Dithered (smoother gradients)</h3>
              {preview.dithered.ranOutOfInventory && (
                <p className="warning-banner">
                  Ran out of some colors&apos; inventory partway through; substitute colors were used.
                </p>
              )}
              <PreviewCanvas cells={preview.dithered.cells} gridWidth={preview.gridWidth} gridHeight={preview.gridHeight} />
              <label style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem' }}>
                <input type="radio" name="choice" checked={choice === 'dithered'} onChange={() => setChoice('dithered')} />
                Use this version
              </label>
            </div>
          </div>

          {choice && (
            <div className="card" style={{ marginTop: '1rem', display: 'flex', gap: '1rem', alignItems: 'end' }}>
              <label>
                Design name
                <input value={designName} onChange={(e) => setDesignName(e.target.value)} maxLength={128} required />
              </label>
              <button onClick={onCreateDesign} disabled={!designName.trim() || creating}>
                {creating ? 'Creating...' : 'Create design from this'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
