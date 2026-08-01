import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, describeApiError } from '../api/client';
import { Design } from '../types';

export default function DesignsListPage() {
  const [designs, setDesigns] = useState<Design[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [gridWidth, setGridWidth] = useState(20);
  const [gridHeight, setGridHeight] = useState(20);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (!modalOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setModalOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modalOpen]);

  async function refresh() {
    setLoading(true);
    const res = await api.get<{ designs: Design[] }>('/designs');
    setDesigns(res.designs);
    setLoading(false);
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await api.post<{ design: Design }>('/designs', { name, gridWidth, gridHeight });
      navigate(`/designs/${res.design.id}`);
    } catch (err) {
      setError(describeApiError(err, 'Failed to create design'));
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(design: Design, ev: React.MouseEvent) {
    ev.preventDefault();
    if (!confirm(`Delete "${design.name}"?`)) return;
    await api.del(`/designs/${design.id}`);
    await refresh();
  }

  return (
    <div>
      <div className="toolbar">
        <h1 style={{ marginRight: 'auto' }}>Designs</h1>
        <button onClick={() => setModalOpen(true)}>New design</button>
      </div>

      {loading ? (
        <p>Loading...</p>
      ) : designs.length === 0 ? (
        <p>No designs yet. Create one, or import an image to generate one automatically.</p>
      ) : (
        <div className="design-list">
          {designs.map((d) => (
            <Link key={d.id} to={`/designs/${d.id}`} className="card design-card">
              <strong>{d.name}</strong>
              <p>
                {d.gridWidth} x {d.gridHeight} dominoes
              </p>
              <button className="secondary" onClick={(e) => onDelete(d, e)}>
                Delete
              </button>
            </Link>
          ))}
        </div>
      )}

      {modalOpen && (
        <div className="modal-backdrop">
          <form className="modal" onSubmit={onCreate}>
            <button
              type="button"
              className="modal-close"
              aria-label="Close"
              onClick={() => setModalOpen(false)}
            >
              ×
            </button>
            <h2 style={{ paddingRight: '2rem' }}>New design</h2>
            <label>
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={128} />
            </label>
            <label>
              Grid width
              <input
                type="number"
                min={1}
                max={500}
                value={gridWidth}
                onChange={(e) => setGridWidth(Number(e.target.value))}
              />
            </label>
            <label>
              Grid height
              <input
                type="number"
                min={1}
                max={500}
                value={gridHeight}
                onChange={(e) => setGridHeight(Number(e.target.value))}
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => setModalOpen(false)}>
                Cancel
              </button>
              <button type="submit" disabled={saving}>
                {saving ? 'Creating...' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
