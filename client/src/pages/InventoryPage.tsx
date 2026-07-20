import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { DominoColor } from '../types';
import ColorPicker from '../components/ColorPicker';
import { swatchStyle } from '../utils/swatchStyle';

const HEX_RE = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;

interface FormState {
  id?: string;
  name: string;
  hex: string;
  quantity: number;
  notes: string;
}

const emptyForm: FormState = { name: '', hex: '#3457d5', quantity: 0, notes: '' };

export default function InventoryPage() {
  const [colors, setColors] = useState<DominoColor[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
    const res = await api.get<{ colors: DominoColor[] }>('/colors');
    setColors(res.colors);
    setLoading(false);
  }

  function openCreate() {
    setForm(emptyForm);
    setError(null);
    setModalOpen(true);
  }

  function openEdit(color: DominoColor) {
    setForm({ id: color.id, name: color.name, hex: color.hex, quantity: color.quantity, notes: color.notes ?? '' });
    setError(null);
    setModalOpen(true);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!HEX_RE.test(form.hex)) {
      setError('Color must be a valid hex value');
      return;
    }
    setSaving(true);
    try {
      const payload = { name: form.name.trim(), hex: form.hex, quantity: form.quantity, notes: form.notes || null };
      if (form.id) {
        await api.put(`/colors/${form.id}`, payload);
      } else {
        await api.post('/colors', payload);
      }
      setModalOpen(false);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save color');
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(color: DominoColor) {
    if (!confirm(`Delete "${color.name}"? This cannot be undone.`)) return;
    try {
      await api.del(`/colors/${color.id}`);
      await refresh();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to delete color');
    }
  }

  return (
    <div>
      <div className="toolbar">
        <h1 style={{ marginRight: 'auto' }}>Inventory</h1>
        <button onClick={openCreate}>Add color</button>
      </div>

      {loading ? (
        <p>Loading...</p>
      ) : colors.length === 0 ? (
        <p>No dominoes in your inventory yet. Add your first color to get started.</p>
      ) : (
        <div className="color-grid">
          {colors.map((c) => (
            <div key={c.id} className="card color-card">
              <div className="color-swatch" style={swatchStyle(c.hex)} />
              <strong>{c.name}</strong>
              <span>{c.hex}</span>
              <span>Qty: {c.quantity}</span>
              {c.notes && <p style={{ fontSize: '0.85rem', color: '#556' }}>{c.notes}</p>}
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="secondary" onClick={() => openEdit(c)}>
                  Edit
                </button>
                <button className="secondary" onClick={() => onDelete(c)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modalOpen && (
        <div className="modal-backdrop">
          <form className="modal" onSubmit={onSubmit}>
            <button
              type="button"
              className="modal-close"
              aria-label="Close"
              onClick={() => setModalOpen(false)}
            >
              ×
            </button>
            <h2 style={{ paddingRight: '2rem' }}>{form.id ? 'Edit color' : 'Add color'}</h2>
            <label>
              Name
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
                maxLength={64}
              />
            </label>
            <label>
              Color
              <ColorPicker hex={form.hex} onChange={(hex) => setForm((f) => ({ ...f, hex }))} />
            </label>
            <label>
              Quantity
              <input
                type="number"
                min={0}
                value={form.quantity}
                onChange={(e) => setForm((f) => ({ ...f, quantity: Number(e.target.value) }))}
                required
              />
            </label>
            <label>
              Notes
              <textarea
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                rows={3}
                maxLength={2000}
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => setModalOpen(false)}>
                Cancel
              </button>
              <button type="submit" disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
