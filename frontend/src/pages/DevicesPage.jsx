import React, { useState } from "react";
import tplLogo from "../assets/tpl.png";
import DevicesTable from "../components/DevicesTable.jsx";
import UsersTable from "../components/UsersTable.jsx";
import { useCityTag } from "../hooks/useCityTag.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useDeviceCache } from "../context/DeviceCacheContext.jsx";
import { useUserCache } from "../context/Usercachecontext.jsx";
import "./DevicesPage.css";

const SELECT_STYLE = {
  width: "100%",
  background: "#18181b",
  border: "1px solid #3f3f46",
  borderRadius: 8,
  padding: "10px 12px",
  color: "#f4f4f5",
  fontSize: 13,
  outline: "none",
  cursor: "pointer",
  appearance: "none",
  WebkitAppearance: "none",
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 20 20' fill='%2371717a'%3E%3Cpath fill-rule='evenodd' d='M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z' clip-rule='evenodd'/%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 12px center",
  paddingRight: 36,
};

const SELECT_OPTION_STYLE = { background: "#27272a", color: "#f4f4f5" };

const HomePage = () => {
  const { isAdmin } = useAuth();
  const {
    bindDevice, unbindDevice, adminUnbindDevice,
    adminCreateUser, adminAssignDeviceToUser, adminUpdateDevice,
  } = useCityTag();

  const { devices, loading: devicesLoading, error: devicesError, refresh: refreshDevices } = useDeviceCache();
  const { users, loading: usersLoading, refresh: refreshUsers } = useUserCache();

  const [error, setError]               = useState("");
  const [searchTerm, setSearchTerm]     = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [viewMode, setViewMode]         = useState('devices');

  // ── Bind modal state ───────────────────────────────────────────────────────
  const [showBindModal, setShowBindModal] = useState(false);
  const [bindSn, setBindSn]               = useState('');
  const [bindName, setBindName]           = useState('');
  const [bindClient, setBindClient]       = useState('');
  const [bindUserId, setBindUserId]       = useState('');
  const [bindLoading, setBindLoading]     = useState(false);
  const [bindError, setBindError]         = useState('');

  // ── Create user modal state ────────────────────────────────────────────────
  const [showCreateUserModal, setShowCreateUserModal] = useState(false);
  const [createUserEmail, setCreateUserEmail]         = useState('');
  const [createUserPassword, setCreateUserPassword]   = useState('');
  const [createUserName, setCreateUserName]           = useState('');
  const [createUserLoading, setCreateUserLoading]     = useState(false);
  const [createUserError, setCreateUserError]         = useState('');

  // ── Edit device modal state ────────────────────────────────────────────────
  const [editDevice, setEditDevice]               = useState(null);
  const [editDeviceName, setEditDeviceName]       = useState('');
  const [editDeviceClient, setEditDeviceClient]   = useState('');
  const [editDeviceRegion, setEditDeviceRegion]   = useState('');
  const [editDeviceLoading, setEditDeviceLoading] = useState(false);
  const [editDeviceError, setEditDeviceError]     = useState('');

  const loading = viewMode === 'users' ? usersLoading : devicesLoading;

  const openBindModal = (sn = '') => {
    setBindError(''); setBindClient(''); setBindName('');

    if (isAdmin) {
      const unbound   = devices.filter((d) => !d.assigned_user_name && !d.user_id);
      const defaultSn = sn || (unbound.length > 0 ? unbound[0].sn : '');
      setBindSn(defaultSn);
      const defaultUserId = users.length > 0 ? users[0].id : '';
      setBindUserId(defaultUserId);
    } else {
      setBindSn(sn || '');
    }

    setShowBindModal(true);
  };

  const closeBindModal = () => {
    setShowBindModal(false);
    setBindSn(''); setBindName(''); setBindClient(''); setBindUserId(''); setBindError('');
  };

  const handleBind = async () => {
    if (isAdmin) {
      if (!bindSn || !bindUserId) { setBindError('Please select a device and a user'); return; }
      setBindError(''); setBindLoading(true);
      try {
        await adminAssignDeviceToUser(bindUserId, bindSn, { name: bindName.trim(), client: bindClient.trim() });
        refreshDevices(); refreshUsers(); closeBindModal();
      } catch (err) {
        setBindError(err.message || 'Failed to bind device');
      } finally {
        setBindLoading(false);
      }
    } else {
      if (!bindSn.trim()) { setBindError('Please enter a device serial number'); return; }
      setBindError(''); setBindLoading(true);
      try {
        await bindDevice({ sn: bindSn.trim(), label: bindName.trim() || undefined });
        refreshDevices(); closeBindModal();
      } catch (err) {
        setBindError(err.message || 'Failed to bind device');
      } finally {
        setBindLoading(false);
      }
    }
  };

  // ── Unbind ─────────────────────────────────────────────────────────────────
  const handleUnbind = async (sn) => {
    if (!window.confirm(`Remove binding for ${sn}?`)) return;
    try { await adminUnbindDevice(sn); refreshDevices(); refreshUsers(); }
    catch (err) { setError(err.message || "Failed to unbind"); }
  };

  const handleUserUnbind = async (sn) => {
    if (!window.confirm(`Remove binding for ${sn}?`)) return;
    try { await unbindDevice(sn); refreshDevices(); }
    catch (err) { setError(err.message || "Failed to unbind"); }
  };

  // ── Edit device ────────────────────────────────────────────────────────────
  const openEditDevice = (device) => {
    setEditDeviceName(device.name || '');
    setEditDeviceClient(device.client || '');
    setEditDeviceRegion(device.region || '');
    setEditDeviceError('');
    setEditDevice(device);
  };

  const closeEditDevice = () => {
    setEditDevice(null);
    setEditDeviceName(''); setEditDeviceClient(''); setEditDeviceRegion(''); setEditDeviceError('');
  };

  const handleEditDevice = async () => {
    if (!editDevice) return;
    setEditDeviceLoading(true); setEditDeviceError('');
    try {
      await adminUpdateDevice(editDevice.sn, {
        name:   editDeviceName.trim()   || undefined,
        client: editDeviceClient.trim() || undefined,
        region: editDeviceRegion.trim() || undefined,
      });
      closeEditDevice(); refreshDevices();
    } catch (err) {
      setEditDeviceError(err.message || 'Failed to update device');
    } finally {
      setEditDeviceLoading(false);
    }
  };

  // ── Create user ────────────────────────────────────────────────────────────
  const openCreateUserModal = () => {
    setCreateUserEmail(''); setCreateUserPassword('');
    setCreateUserName(''); setCreateUserError('');
    setShowCreateUserModal(true);
  };

  const closeCreateUserModal = () => {
    setShowCreateUserModal(false);
    setCreateUserEmail(''); setCreateUserPassword('');
    setCreateUserName(''); setCreateUserError('');
  };

  const handleCreateUser = async () => {
    if (!createUserEmail.trim() || !createUserPassword.trim()) return;
    setCreateUserLoading(true); setCreateUserError('');
    try {
      await adminCreateUser({ email: createUserEmail.trim(), password: createUserPassword.trim(), name: createUserName.trim() });
      closeCreateUserModal(); refreshUsers();
    } catch (err) {
      setCreateUserError(err.message || "Failed to create user");
    } finally {
      setCreateUserLoading(false);
    }
  };

  const unboundDevices = devices.filter((d) => !d.assigned_user_name && !d.user_id);
  const displayError   = error || devicesError;

  return (
    <div className="home-page">
      <div className="hp-watermark" aria-hidden="true"><img src={tplLogo} alt="" /></div>

      <div className="hp-content">
        <div className="devices-section">

          {/* ── Header ── */}
          <div className="section-header">
            <div className="section-header-left">
              {isAdmin && (
                <div className="view-toggle">
                  <button className={`toggle-btn ${viewMode === 'devices' ? 'active' : ''}`} onClick={() => setViewMode('devices')}>Devices</button>
                  <button className={`toggle-btn ${viewMode === 'users' ? 'active' : ''}`} onClick={() => setViewMode('users')}>Users</button>
                </div>
              )}
            </div>

            <div className="section-header-right">
              {(viewMode === 'devices' || !isAdmin) && (
                <div className="search-filters">
                  <div className="search-box">
                    <svg viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd"/>
                    </svg>
                    <input
                      type="text"
                      placeholder={isAdmin ? "Search by serial, client or user..." : "Search by serial or name..."}
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                  </div>
                  <select className="filter-select" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                    <option value="all">All Status</option>
                    <option value="online">Online</option>
                    <option value="offline">Offline</option>
                  </select>
                </div>
              )}

              {viewMode === 'devices' || !isAdmin ? (
                <button className="btn-bind" onClick={() => openBindModal()}>
                  <svg viewBox="0 0 20 20" fill="currentColor">
                    <path d="M11 3a1 1 0 10-2 0v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-5V3z"/>
                    <path fillRule="evenodd" d="M10 8a1 1 0 011 1v1h1a1 1 0 110 2h-1v1a1 1 0 11-2 0v-1H8a1 1 0 110-2h1V9a1 1 0 011-1z" clipRule="evenodd"/>
                  </svg>
                  Bind Device
                </button>
              ) : (
                <button className="btn-bind" onClick={openCreateUserModal}>
                  <svg viewBox="0 0 20 20" fill="currentColor">
                    <path d="M11 3a1 1 0 10-2 0v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-5V3z"/>
                    <path fillRule="evenodd" d="M10 8a1 1 0 011 1v1h1a1 1 0 110 2h-1v1a1 1 0 11-2 0v-1H8a1 1 0 110-2h1V9a1 1 0 011-1z" clipRule="evenodd"/>
                  </svg>
                  Create User
                </button>
              )}

              <button
                onClick={() => viewMode === 'devices' ? refreshDevices() : refreshUsers()}
                style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 14px', background:'transparent', border:'1px solid #3f3f46', borderRadius:8, color:'#a1a1aa', fontSize:12, cursor:'pointer' }}
              >
                <svg viewBox="0 0 20 20" fill="currentColor" width={14} height={14}>
                  <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd"/>
                </svg>
                Refresh
              </button>
            </div>
          </div>

          {displayError && (
            <div style={{ padding:'10px 16px', marginBottom:12, background:'rgba(127,29,29,0.2)', border:'1px solid rgba(127,29,29,0.4)', borderRadius:8, color:'#fca5a5', fontSize:13, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              {displayError}
              <button onClick={() => setError('')} style={{ background:'none', border:'none', color:'#fca5a5', cursor:'pointer', fontSize:16 }}>✕</button>
            </div>
          )}

          {isAdmin && viewMode === 'users' ? (
            <UsersTable />
          ) : (
            <DevicesTable
              devices={devices}
              searchTerm={searchTerm}
              filterStatus={filterStatus}
              isAdmin={isAdmin}
              onBind={(sn) => openBindModal(sn)}
              onUnbind={isAdmin ? handleUnbind : handleUserUnbind}
              onEdit={isAdmin ? openEditDevice : undefined}
              loading={loading}
            />
          )}
        </div>
      </div>

      {/* ── Bind Modal ────────────────────────────────────────────── */}
      {showBindModal && (
        <div className="hp-modal-overlay" onClick={closeBindModal}>
          <div className="hp-modal" onClick={(e) => e.stopPropagation()}>
            <div className="hp-modal-header">
              <div className="hp-modal-title-wrap">
                <div className="hp-modal-icon">
                  <svg viewBox="0 0 20 20" fill="currentColor">
                    <path d="M11 3a1 1 0 10-2 0v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-5V3z"/>
                    <path fillRule="evenodd" d="M10 8a1 1 0 011 1v1h1a1 1 0 110 2h-1v1a1 1 0 11-2 0v-1H8a1 1 0 110-2h1V9a1 1 0 011-1z" clipRule="evenodd"/>
                  </svg>
                </div>
                <h3>Bind Device</h3>
              </div>
              <button className="hp-modal-close" onClick={closeBindModal}>✕</button>
            </div>

            <div className="hp-modal-body">
              {bindError && (
                <div style={{ padding:'8px 12px', marginBottom:12, background:'rgba(127,29,29,0.2)', border:'1px solid rgba(127,29,29,0.4)', borderRadius:6, color:'#fca5a5', fontSize:12 }}>
                  {bindError}
                </div>
              )}

              {isAdmin ? (
                <>
                  <div className="hp-modal-field">
                    <label>Serial Number <span className="required">*</span></label>
                    {unboundDevices.length === 0 ? (
                      <p style={{ color:'#71717a', fontSize:12, margin:'4px 0 0' }}>No unbound devices available</p>
                    ) : (
                      <select value={bindSn} onChange={(e) => setBindSn(e.target.value)} style={SELECT_STYLE}>
                        {unboundDevices.map((d) => (
                          <option key={d.sn} value={d.sn} style={SELECT_OPTION_STYLE}>
                            {d.sn}{d.client ? ` — ${d.client}` : ' — No client'}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div className="hp-modal-field">
                    <label>Assign to User <span className="required">*</span></label>
                    {users.length === 0 ? (
                      <p style={{ color:'#71717a', fontSize:12, margin:'4px 0 0' }}>No users available</p>
                    ) : (
                      <select value={bindUserId} onChange={(e) => setBindUserId(e.target.value)} style={SELECT_STYLE}>
                        {users.map((u) => (
                          <option key={u.id} value={u.id} style={SELECT_OPTION_STYLE}>
                            {u.email}{u.name ? ` (${u.name})` : ''}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div className="hp-modal-field">
                    <label>Device Name <span style={{ fontWeight:400, color:'#71717a' }}>(optional)</span></label>
                    <input type="text" placeholder="e.g. My Car, Office Van…" value={bindName} onChange={(e) => setBindName(e.target.value)} />
                  </div>
                  <div className="hp-modal-field">
                    <label>Client <span style={{ fontWeight:400, color:'#71717a' }}>(optional)</span></label>
                    <input type="text" placeholder="e.g. TPL Trakker" value={bindClient} onChange={(e) => setBindClient(e.target.value)} />
                  </div>
                </>
              ) : (
                <>
                  <div className="hp-modal-field">
                    <label>Device Serial Number <span className="required">*</span></label>
                    <input
                      type="text"
                      placeholder="e.g. 201404628953"
                      value={bindSn}
                      onChange={(e) => setBindSn(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleBind()}
                      autoFocus
                      style={{
                        width: '100%', padding: '10px 12px', background: '#27272a',
                        border: `1px solid ${bindError ? '#7f1d1d' : '#3f3f46'}`,
                        borderRadius: 8, color: '#f4f4f5', fontSize: 13,
                        outline: 'none', boxSizing: 'border-box',
                      }}
                    />
                    {devices.length > 0 && (
                      <p style={{ margin: '6px 0 0', fontSize: 11, color: '#52525b' }}>
                        You have {devices.length} device{devices.length !== 1 ? 's' : ''} already bound. Enter a serial number to add another.
                      </p>
                    )}
                  </div>
                  <div className="hp-modal-field">
                    <label>Device Name <span style={{ fontWeight:400, color:'#71717a' }}>(optional)</span></label>
                    <input
                      type="text"
                      placeholder="e.g. My Car, Office Van…"
                      value={bindName}
                      onChange={(e) => setBindName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleBind()}
                      style={{
                        width: '100%', padding: '10px 12px', background: '#27272a',
                        border: '1px solid #3f3f46',
                        borderRadius: 8, color: '#f4f4f5', fontSize: 13,
                        outline: 'none', boxSizing: 'border-box',
                      }}
                    />
                  </div>
                </>
              )}
            </div>

            <div className="hp-modal-footer">
              <button className="hp-modal-cancel" onClick={closeBindModal}>Cancel</button>
              <button
                className="hp-modal-confirm"
                onClick={handleBind}
                disabled={bindLoading || (isAdmin ? (!bindSn || !bindUserId) : !bindSn.trim())}
              >
                {bindLoading ? "Saving…" : "Bind Device"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Device Modal ─────────────────────────────────────── */}
      {editDevice && (
        <div className="hp-modal-overlay" onClick={closeEditDevice}>
          <div className="hp-modal" onClick={(e) => e.stopPropagation()}>
            <div className="hp-modal-header">
              <div className="hp-modal-title-wrap">
                <div className="hp-modal-icon">
                  <svg viewBox="0 0 20 20" fill="currentColor">
                    <path d="M13.586 3.586a2 2 0 112.828 2.828l-8.5 8.5a1 1 0 01-.39.243l-3 1a1 1 0 01-1.266-1.266l1-3a1 1 0 01.243-.39l8.5-8.5z"/>
                  </svg>
                </div>
                <h3>Edit Device</h3>
              </div>
              <button className="hp-modal-close" onClick={closeEditDevice}>✕</button>
            </div>
            <div className="hp-modal-body">
              {editDeviceError && (
                <div style={{ padding:'8px 12px', marginBottom:12, background:'rgba(127,29,29,0.2)', border:'1px solid rgba(127,29,29,0.4)', borderRadius:6, color:'#fca5a5', fontSize:12 }}>
                  {editDeviceError}
                </div>
              )}
              <div className="hp-modal-field">
                <label>Serial Number (read-only)</label>
                <input type="text" value={editDevice.sn} readOnly style={{ opacity: 0.5, cursor: 'not-allowed' }} />
              </div>
              <div className="hp-modal-field">
                <label>Device Name</label>
                <input
                  type="text"
                  placeholder="e.g. Office Van"
                  value={editDeviceName}
                  onChange={(e) => setEditDeviceName(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="hp-modal-field">
                <label>Client</label>
                <input
                  type="text"
                  placeholder="e.g. TPL Trakker"
                  value={editDeviceClient}
                  onChange={(e) => setEditDeviceClient(e.target.value)}
                />
              </div>
              <div className="hp-modal-field">
                <label>Region</label>
                <input
                  type="text"
                  placeholder="e.g. Wagha Town"
                  value={editDeviceRegion}
                  onChange={(e) => setEditDeviceRegion(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleEditDevice()}
                />
              </div>
            </div>
            <div className="hp-modal-footer">
              <button className="hp-modal-cancel" onClick={closeEditDevice} disabled={editDeviceLoading}>Cancel</button>
              <button className="hp-modal-confirm" onClick={handleEditDevice} disabled={editDeviceLoading}>
                {editDeviceLoading ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Create User Modal ─────────────────────────────────────── */}
      {showCreateUserModal && (
        <div className="hp-modal-overlay" onClick={closeCreateUserModal}>
          <div className="hp-modal" onClick={(e) => e.stopPropagation()}>
            <div className="hp-modal-header">
              <div className="hp-modal-title-wrap">
                <div className="hp-modal-icon">
                  <svg viewBox="0 0 20 20" fill="currentColor">
                    <path d="M11 3a1 1 0 10-2 0v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-5V3z"/>
                    <path fillRule="evenodd" d="M10 8a1 1 0 011 1v1h1a1 1 0 110 2h-1v1a1 1 0 11-2 0v-1H8a1 1 0 110-2h1V9a1 1 0 011-1z" clipRule="evenodd"/>
                  </svg>
                </div>
                <h3>Create User</h3>
              </div>
              <button className="hp-modal-close" onClick={closeCreateUserModal}>✕</button>
            </div>
            <div className="hp-modal-body">
              {createUserError && (
                <div style={{ padding:'8px 12px', marginBottom:12, background:'rgba(127,29,29,0.2)', border:'1px solid rgba(127,29,29,0.4)', borderRadius:6, color:'#fca5a5', fontSize:12 }}>
                  {createUserError}
                </div>
              )}
              <div className="hp-modal-field">
                <label>Email <span className="required">*</span></label>
                <input type="email" placeholder="e.g. user@example.com" value={createUserEmail} onChange={(e) => setCreateUserEmail(e.target.value)} autoFocus />
              </div>
              <div className="hp-modal-field">
                <label>Password <span className="required">*</span></label>
                <input type="password" placeholder="Enter password" value={createUserPassword} onChange={(e) => setCreateUserPassword(e.target.value)} />
              </div>
              <div className="hp-modal-field">
                <label>Name <span style={{ fontWeight:400, color:'#71717a' }}>(optional)</span></label>
                <input type="text" placeholder="e.g. John Doe" value={createUserName} onChange={(e) => setCreateUserName(e.target.value)} />
              </div>
            </div>
            <div className="hp-modal-footer">
              <button className="hp-modal-cancel" onClick={closeCreateUserModal}>Cancel</button>
              <button className="hp-modal-confirm" onClick={handleCreateUser} disabled={!createUserEmail.trim() || !createUserPassword.trim() || createUserLoading}>
                {createUserLoading ? "Creating…" : "Create User"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HomePage;