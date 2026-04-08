import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import TPLLoader from './TPLLoader.jsx';
import './DevicesTable.css';

function formatDateTime(value) {
  if (!value) return '—';
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });
  } catch {
    return '—';
  }
}

function formatDateTimeWithOffset(value, offsetHours = 0) {
  if (!value) return '—';
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return '—';
    const shifted = new Date(d.getTime() + offsetHours * 60 * 60 * 1000);
    return shifted.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });
  } catch {
    return '—';
  }
}

const DevicesTable = ({
  devices = [],
  searchTerm = '',
  filterStatus = 'all',
  onUnbind,
  onEdit,
  loading = false,
  isAdmin = false,
}) => {
  const navigate = useNavigate();
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });

  if (loading) return <TPLLoader label="Loading locators…" />;

  const COLUMNS = [
    { key: 'sn',                label: 'Serial Number' },
    { key: 'name',              label: 'Locator Name' },
    ...(isAdmin ? [
      { key: 'client',              label: 'Client' },
      { key: 'assigned_user_name',  label: 'Assigned User' },
    ] : []),
    { key: 'dataRetrievalTime', label: 'Data Retrieval Time' },
    { key: 'bindTime',          label: 'Bind Time' },
  ];

  const filtered = devices.filter((d) => {
    const term = searchTerm.toLowerCase();
    const matchSearch =
      (d.sn || "").toLowerCase().includes(term) ||
      (d.client || d.assigned_name || "").toLowerCase().includes(term) ||
      (d.assigned_user_name || d.assignedUser || "").toLowerCase().includes(term) ||
      (d.name || "").toLowerCase().includes(term);
    const matchStatus = filterStatus === 'all' || d.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (!sortConfig.key) return 0;
    const av = a[sortConfig.key] ?? '';
    const bv = b[sortConfig.key] ?? '';
    if (av < bv) return sortConfig.direction === 'asc' ? -1 : 1;
    if (av > bv) return sortConfig.direction === 'asc' ? 1 : -1;
    return 0;
  });

  const handleSort = (key) => {
    setSortConfig((prev) =>
      prev.key === key
        ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'asc' }
    );
  };

  const SortIcon = ({ colKey }) => {
    if (sortConfig.key !== colKey) return <span className="sort-icon inactive">↕</span>;
    return <span className="sort-icon active" style={{ color: '#cc4444' }}>{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>;
  };

  return (
    <div className="devices-table-container">
      <style>{`
        .devices-table thead tr {
          background: linear-gradient(135deg, rgba(128,0,0,0.25), rgba(80,0,0,0.15)) !important;
          border-bottom: 1px solid rgba(128,0,0,0.35) !important;
        }
        .devices-table thead th {
          color: #e2a0a0 !important;
          border-bottom: none !important;
        }
        .devices-table tbody tr:hover {
          background: rgba(128,0,0,0.08) !important;
        }
        .devices-table tbody tr:hover .device-icon {
          background: rgba(128,0,0,0.5) !important;
        }
        .devices-table .action-btn:hover {
          background: rgba(128,0,0,0.25) !important;
          border-color: rgba(128,0,0,0.6) !important;
          color: #fca5a5 !important;
        }
        .devices-table .action-btn.unbind-btn:hover {
          background: rgba(127,29,29,0.3) !important;
          border-color: #7f1d1d !important;
          color: #fca5a5 !important;
        }
        .devices-table .status-dot-inline.status-online {
          color: #86efac !important;
        }
        .devices-table .status-dot-inline.status-offline {
          color: #71717a !important;
        }
        .devices-table .cell-client {
          color: #fca5a5 !important;
        }
        .table-footer {
          border-top: 1px solid rgba(128,0,0,0.2) !important;
        }
      `}</style>

      <table className="devices-table">
        <thead>
          <tr>
            <th style={{ width: 40, textAlign: 'center', color: 'rgba(226,160,160,0.5)', fontWeight: 500, fontSize: 11 }}>#</th>
            {COLUMNS.map((col) => (
              <th key={col.key} onClick={() => handleSort(col.key)}>
                <span className="th-inner">{col.label}<SortIcon colKey={col.key} /></span>
              </th>
            ))}
            <th>Actions</th>
          </tr>
        </thead>

        <tbody>
          {sorted.map((device, index) => (
            <tr key={device.sn || `row-${index}`}>

              {/* Row number */}
              <td style={{ textAlign: 'center', color: '#52525b', fontSize: 11, fontWeight: 500, userSelect: 'none' }}>
                {index + 1}.
              </td>

              {/* Serial Number */}
              <td>
                <div className="cell-serial">
                  <div className="device-icon" style={{ background: 'rgba(128,0,0,0.35)', transition: 'background 0.15s' }}>
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/>
                    </svg>
                  </div>
                  <div>
                    <div className="serial-number">{device.sn}</div>
                    <span className={`status-dot-inline status-${device.status}`}>
                      {device.status || 'offline'}
                    </span>
                  </div>
                </div>
              </td>

              {/* Device Name */}
              <td>
                {(() => {
                  const n = device.name || (device.assigned_name !== device.sn ? device.assigned_name : '') || '';
                  return (
                    <span className="cell-serial" style={{ color: n ? '#e4e4e7' : '#52525b', fontStyle: n ? 'normal' : 'italic' }}>
                      {n || '—'}
                    </span>
                  );
                })()}
              </td>

              {/* Client — admin only */}
              {isAdmin && (
                <td><span className="cell-client">{device.client || device.assigned_name || '—'}</span></td>
              )}

              {/* Assigned User — admin only */}
              {isAdmin && (
                <td><span className="cell-assigned-user">{device.assigned_user_name || '—'}</span></td>
              )}

              {/* Data Retrieval Time */}
              <td><span className="cell-datetime">{formatDateTime(device.dataRetrievalTime)}</span></td>

              {/* Bind Time (+5 offset) */}
              <td><span className="cell-datetime">{formatDateTimeWithOffset(device.bindTime, 5)}</span></td>

              {/* Actions */}
              <td>
                <div className="action-buttons">
                  <button className="action-btn" title="Map View" onClick={() => navigate(`/mapview?device=${device.sn}`)}>
                    <svg viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M12 1.586l-4 4v12.828l4-4V1.586zM3.707 3.293A1 1 0 002 4v10a1 1 0 00.293.707L6 18.414V5.586L3.707 3.293zM17.707 5.293L14 1.586v12.828l2.293 2.293A1 1 0 0018 16V6a1 1 0 00-.293-.707z" clipRule="evenodd"/>
                    </svg>
                  </button>
                  <button className="action-btn" title="Trajectory" onClick={() => navigate(`/trajectory?device=${device.sn}`)}>
                    <svg viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd"/>
                    </svg>
                  </button>
                  <button className="action-btn" title="Playback" onClick={() => navigate(`/playback?device=${device.sn}`)}>
                    <svg viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd"/>
                    </svg>
                  </button>
                  <button className="action-btn" title="Report" onClick={() => navigate(`/report?device=${device.sn}`)}>
                    <svg viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M6 2a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V7.414A2 2 0 0015.414 6L12 2.586A2 2 0 0010.586 2H6zm2 10a1 1 0 10-2 0v3a1 1 0 102 0v-3zm2-3a1 1 0 011 1v5a1 1 0 11-2 0v-5a1 1 0 011-1zm4-1a1 1 0 10-2 0v7a1 1 0 102 0V8z" clipRule="evenodd"/>
                    </svg>
                  </button>
                  {onEdit && (
                    <button className="action-btn" title="Edit Device" onClick={() => onEdit(device)}>
                      <svg viewBox="0 0 20 20" fill="currentColor">
                        <path d="M13.586 3.586a2 2 0 112.828 2.828l-8.5 8.5a1 1 0 01-.39.243l-3 1a1 1 0 01-1.266-1.266l1-3a1 1 0 01.243-.39l8.5-8.5z"/>
                      </svg>
                    </button>
                  )}
                  {onUnbind && (
                    <button className="action-btn unbind-btn" title="Unbind Device" onClick={() => onUnbind(device.sn)}>
                      <svg viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd"/>
                      </svg>
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {sorted.length === 0 && (
        <div className="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <circle cx="11" cy="11" r="8" strokeWidth="1.5"/>
            <path d="m21 21-4.35-4.35" strokeWidth="1.5"/>
          </svg>
          <p>No locators found</p>
        </div>
      )}

      <div className="table-footer">
        <span>{sorted.length} locator{sorted.length !== 1 ? 's' : ''} shown</span>
      </div>
    </div>
  );
};

export default DevicesTable;