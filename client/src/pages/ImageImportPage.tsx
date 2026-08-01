import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, describeApiError } from '../api/client';
import { AlgorithmInfo, Design, GridCell, ImportGridResult } from '../types';
import { PITCH_ASPECT, PITCH_X_RATIO, PITCH_Y_RATIO } from '../utils/dominoSpec';

// Dominoes stand ~1 wide : 2 tall, so preview tiles are drawn tall to match how
// the design will actually look (and how the editor renders them).
const CELL_ASPECT = 2;
const MAX_CELLS = 12000;
const MAX_DIM = 200;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
// Bounds how many previews get computed/rendered per request, for server load
// and screen clutter — the algorithm list itself can have more than this.
const MAX_SELECTED_ALGORITHMS = 6;
const DEFAULT_ALGORITHM_IDS = ['nearest', 'floyd-steinberg'];

interface PreviewResponse {
  gridWidth: number;
  gridHeight: number;
  results: Record<string, ImportGridResult>;
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
  const [algorithms, setAlgorithms] = useState<AlgorithmInfo[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>(DEFAULT_ALGORITHM_IDS);
  const [distanceMode, setDistanceMode] = useState<'rgb' | 'perceptual'>('rgb');
  const [file, setFile] = useState<File | null>(null);
  const [imgAspect, setImgAspect] = useState<number | null>(null);
  // Browsers other than Safari can't render HEIC in an <img> tag, so aspect
  // auto-detection silently can't work for it — track that so the UI can
  // explain why and point at the manual height field instead of looking broken.
  const [aspectUnavailable, setAspectUnavailable] = useState(false);
  const [dominoesWide, setDominoesWide] = useState(40);
  const [keepAspect, setKeepAspect] = useState(true);
  const [manualHeight, setManualHeight] = useState(40);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [designName, setDesignName] = useState('');
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api
      .get<{ algorithms: AlgorithmInfo[] }>('/designs/import-algorithms')
      .then((res) => setAlgorithms(res.algorithms))
      .catch(() => setAlgorithms([]));
  }, []);

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

  function toggleAlgorithm(id: string) {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((a) => a !== id);
      if (prev.length >= MAX_SELECTED_ALGORITHMS) return prev;
      return [...prev, id];
    });
  }

  function onFileChange(f: File | null) {
    setFile(f);
    setImgAspect(null);
    setAspectUnavailable(false);
    setPreview(null);
    setChoice(null);
    setError(null);
    if (!f) return;
    if (f.size > MAX_UPLOAD_BYTES) {
      setFile(null);
      setError(`That file is ${(f.size / 1024 / 1024).toFixed(1)}MB; the limit is 10MB.`);
      return;
    }
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth && img.naturalHeight) {
        setImgAspect(img.naturalWidth / img.naturalHeight);
      }
      URL.revokeObjectURL(url);
    };
    img.onerror = async () => {
      URL.revokeObjectURL(url);
      // The browser couldn't render this for preview (e.g. HEIC outside
      // Safari) — ask the server, which can decode anything sharp/heic-convert
      // supports, independent of what this browser can render.
      try {
        const form = new FormData();
        form.append('image', f);
        const dims = await api.postForm<{ width: number; height: number }>('/designs/image-dimensions', form);
        setImgAspect(dims.width / dims.height);
      } catch {
        setAspectUnavailable(true);
      }
    };
    img.src = url;
  }

  async function onGeneratePreview(e: FormEvent) {
    e.preventDefault();
    if (!file || tooManyCells || selectedIds.length === 0) return;
    setError(null);
    setLoading(true);
    setPreview(null);
    setChoice(null);
    try {
      const form = new FormData();
      form.append('image', file);
      form.append('gridWidth', String(dominoesWide));
      form.append('gridHeight', String(gridHeight));
      form.append('algorithms', JSON.stringify(selectedIds));
      form.append('distanceMode', distanceMode);
      const res = await api.postForm<PreviewResponse>('/designs/import-preview', form);
      setPreview(res);
    } catch (err) {
      setError(describeApiError(err, 'Failed to process image'));
    } finally {
      setLoading(false);
    }
  }

  async function onCreateDesign() {
    if (!preview || !choice || !designName.trim()) return;
    const result = preview.results[choice];
    if (!result) return;
    setCreating(true);
    setError(null);
    try {
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
      setError(describeApiError(err, 'Failed to create design'));
    } finally {
      setCreating(false);
    }
  }

  // Preserve the algorithm list's canonical order rather than object-key order.
  const orderedResultIds = preview ? algorithms.map((a) => a.id).filter((id) => preview.results[id]) : [];

  return (
    <div>
      <h1>Import image</h1>
      <p>
        Upload an image and it will be converted into a domino mosaic using the colors currently in your
        inventory (only colors with quantity greater than zero are used).
      </p>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <strong>Algorithms to preview</strong>
        <p className="hint">
          Pick up to {MAX_SELECTED_ALGORITHMS} to compare side by side ({selectedIds.length}/
          {MAX_SELECTED_ALGORITHMS} selected).
        </p>
        <div className="algorithm-grid">
          {algorithms.map((a) => (
            <label key={a.id} className="algorithm-option">
              <input
                type="checkbox"
                checked={selectedIds.includes(a.id)}
                disabled={!selectedIds.includes(a.id) && selectedIds.length >= MAX_SELECTED_ALGORITHMS}
                onChange={() => toggleAlgorithm(a.id)}
              />
              <div>
                <div>{a.label}</div>
                <div className="hint" style={{ margin: 0 }}>
                  {a.description}
                </div>
              </div>
            </label>
          ))}
        </div>

        <div style={{ marginTop: '0.75rem' }}>
          <strong>Color matching</strong>
          <div style={{ display: 'flex', gap: '1rem', marginTop: '0.25rem' }}>
            <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              <input
                type="radio"
                name="distanceMode"
                checked={distanceMode === 'rgb'}
                onChange={() => setDistanceMode('rgb')}
              />
              RGB (faster, simpler)
            </label>
            <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              <input
                type="radio"
                name="distanceMode"
                checked={distanceMode === 'perceptual'}
                onChange={() => setDistanceMode('perceptual')}
              />
              Perceptual (matches human color perception more closely)
            </label>
          </div>
        </div>
      </div>

      <form className="card" onSubmit={onGeneratePreview} style={{ display: 'flex', gap: '1rem', alignItems: 'end', flexWrap: 'wrap' }}>
        <label>
          Image
          <input
            type="file"
            accept="image/*,.heic,.heif"
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
        <button type="submit" disabled={!file || loading || tooManyCells || selectedIds.length === 0}>
          {loading ? 'Processing...' : 'Generate preview'}
        </button>
      </form>

      <p className="hint" style={{ marginTop: '0.5rem' }}>
        Result: {dominoesWide} × {gridHeight} = {totalCells.toLocaleString()} dominoes.
        {keepAspect && !imgAspect && !aspectUnavailable && ' Choose an image to auto-fit the height to its proportions.'}
        {aspectUnavailable &&
          ' Couldn\'t determine this image\'s proportions, so the height couldn\'t be auto-fit — set "Dominoes tall" manually.'}
      </p>
      {tooManyCells && (
        <p className="form-error">
          That's more than {MAX_CELLS.toLocaleString()} dominoes. Reduce the width or height.
        </p>
      )}
      {selectedIds.length === 0 && <p className="form-error">Select at least one algorithm to preview.</p>}

      {error && <p className="form-error">{error}</p>}

      {preview && (
        <div style={{ marginTop: '1.5rem' }}>
          <div className="import-grid">
            {orderedResultIds.map((id) => {
              const result = preview.results[id];
              const info = algorithms.find((a) => a.id === id);
              return (
                <div key={id}>
                  <h3>{info?.label ?? id}</h3>
                  {result.ranOutOfInventory && (
                    <p className="warning-banner">
                      Ran out of some colors&apos; inventory partway through; substitute colors were used.
                    </p>
                  )}
                  <PreviewCanvas cells={result.cells} gridWidth={preview.gridWidth} gridHeight={preview.gridHeight} />
                  <label style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem' }}>
                    <input type="radio" name="choice" checked={choice === id} onChange={() => setChoice(id)} />
                    Use this version
                  </label>
                </div>
              );
            })}
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
