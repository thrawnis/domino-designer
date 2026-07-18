import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { Design, GridCell, ImportGridResult } from '../types';

const PREVIEW_CELL = 6;

interface PreviewResponse {
  gridWidth: number;
  gridHeight: number;
  nearest: ImportGridResult;
  dithered: ImportGridResult;
}

function GridPreview({ cells, gridWidth, gridHeight }: { cells: GridCell[]; gridWidth: number; gridHeight: number }) {
  return (
    <div
      className="import-preview"
      style={{ width: gridWidth * PREVIEW_CELL, height: gridHeight * PREVIEW_CELL, position: 'relative' }}
    >
      {cells.map((c) => (
        <div
          key={`${c.x}-${c.y}`}
          style={{
            position: 'absolute',
            left: c.x * PREVIEW_CELL,
            top: c.y * PREVIEW_CELL,
            width: PREVIEW_CELL,
            height: PREVIEW_CELL,
            background: c.hex,
          }}
        />
      ))}
    </div>
  );
}

export default function ImageImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [gridWidth, setGridWidth] = useState(40);
  const [gridHeight, setGridHeight] = useState(40);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [choice, setChoice] = useState<'nearest' | 'dithered' | null>(null);
  const [designName, setDesignName] = useState('');
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function onGeneratePreview(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setError(null);
    setLoading(true);
    setPreview(null);
    setChoice(null);
    try {
      const form = new FormData();
      form.append('image', file);
      form.append('gridWidth', String(gridWidth));
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
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            required
          />
        </label>
        <label>
          Grid width
          <input type="number" min={1} max={200} value={gridWidth} onChange={(e) => setGridWidth(Number(e.target.value))} />
        </label>
        <label>
          Grid height
          <input type="number" min={1} max={200} value={gridHeight} onChange={(e) => setGridHeight(Number(e.target.value))} />
        </label>
        <button type="submit" disabled={!file || loading}>
          {loading ? 'Processing...' : 'Generate preview'}
        </button>
      </form>

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
              <GridPreview cells={preview.nearest.cells} gridWidth={preview.gridWidth} gridHeight={preview.gridHeight} />
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
              <GridPreview cells={preview.dithered.cells} gridWidth={preview.gridWidth} gridHeight={preview.gridHeight} />
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
