import React, { useState, useMemo, useRef, useEffect } from 'react';
import './AreaSelector.css';

/**
 * Searchable area/zone dropdown.
 *
 * Props:
 *   value      – selected area id (string) or null for "All Areas"
 *   onChange   – called with area id (string) or null
 *   areas      – array of { id, name, tehsil, ucNo } from useKmlAreas / parseKMLText
 *   loading    – bool, shows loading state while KML is being fetched
 *   placeholder – override default "All Areas" label
 */
export default function AreaSelector({ value, onChange, areas = [], loading = false, placeholder = 'All Areas' }) {
  const [open, setOpen]           = useState(false);
  const [search, setSearch]       = useState('');
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 });
  const wrapRef                   = useRef(null);
  const triggerRef                = useRef(null);
  const dropdownRef               = useRef(null);
  const inputRef                  = useRef(null);

  const selected = areas.find(a => a.id === value) ?? null;

  const filtered = useMemo(() =>
    areas
      .filter(a => a.name.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [areas, search]
  );

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      const inTrigger  = wrapRef.current && wrapRef.current.contains(e.target);
      const inDropdown = dropdownRef.current && dropdownRef.current.contains(e.target);
      if (!inTrigger && !inDropdown) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Auto-focus search input when opened; compute fixed position
  useEffect(() => {
    if (open) {
      if (inputRef.current) inputRef.current.focus();
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        setDropdownPos({
          top: rect.bottom + 6,
          right: window.innerWidth - rect.right,
        });
      }
    }
  }, [open]);

  function select(id) {
    onChange(id);
    setOpen(false);
    setSearch('');
  }

  return (
    <div className="area-sel" ref={wrapRef}>
      <div className="area-sel-group">
        <label className="area-sel-label">Area / Zone</label>
        <button
          ref={triggerRef}
          type="button"
          className={`area-sel-trigger${open ? ' open' : ''}`}
          onClick={() => setOpen(v => !v)}
          disabled={loading}
        >
          <span className="area-sel-value">
            {loading ? 'Loading…' : (selected?.name ?? placeholder)}
          </span>
          <svg className="area-sel-chevron" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
          </svg>
        </button>
      </div>

      {open && (
        <div
          ref={dropdownRef}
          className="area-sel-dropdown"
          style={{ top: dropdownPos.top, right: dropdownPos.right }}
        >
          {/* Search */}
          <div className="area-sel-search-wrap">
            <svg viewBox="0 0 20 20" fill="currentColor" className="area-sel-search-icon">
              <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd"/>
            </svg>
            <input
              ref={inputRef}
              className="area-sel-search"
              placeholder="Search areas…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button className="area-sel-clear" onClick={() => setSearch('')} type="button">×</button>
            )}
          </div>

          {/* List */}
          <div className="area-sel-list">
            {/* "All Areas" option */}
            <div
              className={`area-sel-item area-sel-item-all${!value ? ' selected' : ''}`}
              onClick={() => select(null)}
            >
              {placeholder}
            </div>

            {filtered.length === 0 ? (
              <div className="area-sel-empty">No areas match "{search}"</div>
            ) : (
              filtered.map(area => (
                <div
                  key={area.id}
                  className={`area-sel-item${area.id === value ? ' selected' : ''}`}
                  onClick={() => select(area.id)}
                >
                  <span className="area-sel-item-name">{area.name}</span>
                  {area.tehsil && area.tehsil !== 'Areas' && (
                    <span className="area-sel-item-meta">{area.tehsil}</span>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="area-sel-footer">
            {areas.length} areas loaded
          </div>
        </div>
      )}
    </div>
  );
}
