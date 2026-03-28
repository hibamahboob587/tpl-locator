import React, { useState, useEffect } from "react";
import tplLogo from "../assets/tpl.png";
import { useCityTag } from "../hooks/useCityTag.js";
import { useUserCache } from "../context/Usercachecontext.jsx";
import { useDeviceCache } from "../context/DeviceCacheContext.jsx";
import "./DevicesTable.css";

const TPLLoader = ({ label = "Loading users…" }) => (
  <div style={{
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', padding: '60px 20px', gap: 20,
  }}>
    <style>{`
      @keyframes tpl-pulse {
        0%   { opacity: 0.15; transform: scale(0.95); }
        50%  { opacity: 0.7;  transform: scale(1.02); }
        100% { opacity: 0.15; transform: scale(0.95); }
      }
    `}</style>
    <img src={tplLogo} alt="Loading" style={{ width: 110, height: 'auto', filter: 'brightness(0) invert(1)', animation: 'tpl-pulse 1.6s ease-in-out infinite' }} />
    <span style={{ color: '#52525b', fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</span>
  </div>
);

export default function UsersTable() {
  const { adminUnassignDeviceFromUser, adminDeleteUser, adminAssignDeviceToUser, adminUpdateUser } = useCityTag();
  const { users, loading, refresh: refreshUsers } = useUserCache();
  const { devices, refresh: refreshDevices } = useDeviceCache();

  const [selectedUser, setSelectedUser]   = useState(null);
  const [deleteTarget, setDeleteTarget]   = useState(null);
  const [editTarget, setEditTarget]       = useState(null);
  const [actionError, setActionError]     = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [editLoading, setEditLoading]     = useState(false);
  const [editError, setEditError]         = useState("");
  const [editName, setEditName]           = useState("");
  const [editPassword, setEditPassword]   = useState("");

  // Search/assign state
  const [searchSN, setSearchSN]           = useState("");
  const [assignName, setAssignName]       = useState("");
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignError, setAssignError]     = useState("");
  const [assignSuccess, setAssignSuccess] = useState("");

  const unboundDevices = devices.filter((d) => !d.assigned_user_name && !d.user_id);

  // Keep selectedUser in sync when cache refreshes
  useEffect(() => {
    if (selectedUser) {
      const updated = users.find(u => u.id === selectedUser.id);
      if (updated) setSelectedUser(updated);
      else setSelectedUser(null);
    }
  }, [users]);

  // Reset search state when modal opens/closes
  useEffect(() => {
    if (!selectedUser) {
      setSearchSN("");
      setAssignName("");
      setAssignError("");
      setAssignSuccess("");
    }
  }, [selectedUser]);

  // Reset edit form when edit modal opens/closes
  useEffect(() => {
    if (editTarget) {
      setEditName(editTarget.name || "");
      setEditPassword("");
      setEditError("");
    } else {
      setEditName("");
      setEditPassword("");
      setEditError("");
    }
  }, [editTarget]);

  const formatDateTimeWithOffset = (value, offsetHours = 0) => {
    if (!value) return "—";
    try {
      const d = new Date(value);
      if (isNaN(d.getTime())) return "—";
      const shifted = new Date(d.getTime() + offsetHours * 60 * 60 * 1000);
      return shifted.toLocaleString();
    } catch {
      return "—";
    }
  };

  const handleUnassign = async (userId, sn) => {
    if (!window.confirm(`Unassign device ${sn} from this user?`)) return;
    setActionError("");
    setActionLoading(true);
    try {
      await adminUnassignDeviceFromUser(userId, sn);
      if (selectedUser?.id === userId) {
        setSelectedUser((prev) => ({
          ...prev,
          devices: (prev.devices || []).filter((d) => d.sn !== sn),
        }));
      }
      refreshUsers();
      refreshDevices();
    } catch (err) {
      setActionError(err.message || "Failed to unassign device");
    } finally {
      setActionLoading(false);
    }
  };

  const handleAssignDevice = async () => {
    const sn   = searchSN.trim();
    const name = assignName.trim();
    if (!sn || !selectedUser) return;

    // Prevent assigning already-assigned device
    const alreadyAssigned = (selectedUser.devices || []).some(
      d => (d?.sn ?? d) === sn
    );
    if (alreadyAssigned) {
      setAssignError("This device is already assigned to this user.");
      return;
    }

    setAssignLoading(true);
    setAssignError("");
    setAssignSuccess("");
    try {
      await adminAssignDeviceToUser(selectedUser.id, sn, { name: name || undefined });
      setAssignSuccess(`Device ${sn} assigned successfully.`);
      setSearchSN("");
      setAssignName("");
      refreshUsers();
      refreshDevices();
    } catch (err) {
      setAssignError(err.message || "Failed to assign device.");
    } finally {
      setAssignLoading(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    setActionError("");
    try {
      await adminDeleteUser(deleteTarget.id);
      setDeleteTarget(null);
      refreshUsers();
      refreshDevices();
    } catch (err) {
      setActionError(err.message || "Failed to delete user");
      setDeleteTarget(null);
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleEditUser = async () => {
    if (!editTarget) return;
    const name = editName.trim();
    const password = editPassword;
    if (!name) {
      setEditError("Name is required.");
      return;
    }

    setEditLoading(true);
    setEditError("");
    setActionError("");
    try {
      await adminUpdateUser(editTarget.id, { name, password: password?.trim() ? password : undefined });
      setEditTarget(null);
      refreshUsers();
      refreshDevices();
    } catch (err) {
      setEditError(err.message || "Failed to update user");
    } finally {
      setEditLoading(false);
    }
  };

  if (loading) return <TPLLoader label="Loading users…" />;

  return (
    <div className="devices-table-container">
      <style>{`
        .devices-table thead tr {
          background: linear-gradient(135deg, rgba(128,0,0,0.25), rgba(80,0,0,0.15)) !important;
          border-bottom: 1px solid rgba(128,0,0,0.35) !important;
        }
        .devices-table thead th { color: #e2a0a0 !important; border-bottom: none !important; }
        .devices-table tbody tr:hover { background: rgba(128,0,0,0.08) !important; }
      `}</style>

      {actionError && (
        <div style={{ padding:'8px 16px', marginBottom:12, background:'rgba(127,29,29,0.2)', border:'1px solid rgba(127,29,29,0.4)', borderRadius:8, color:'#fca5a5', fontSize:12 }}>
          {actionError}
          <button onClick={() => setActionError('')} style={{ background:'none', border:'none', color:'#fca5a5', cursor:'pointer', marginLeft:8 }}>✕</button>
        </div>
      )}

      <table className="devices-table">
        <thead>
          <tr>
            <th style={{ width:40, textAlign:'center', color:'rgba(226,160,160,0.5)', fontWeight:500, fontSize:11 }}>#</th>
            <th>Email</th>
            <th>Name</th>
            <th>Devices Assigned</th>
            <th>Created</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u, index) => {
            const deviceCount = Array.isArray(u.devices) ? u.devices.length : 0;
            return (
              <tr key={u._id || u.id}>
                <td style={{ textAlign:'center', color:'#52525b', fontSize:11, fontWeight:500, userSelect:'none' }}>{index + 1}.</td>
                <td><span className="cell-client">{u.email ?? "—"}</span></td>
                <td><span className="cell-serial">{u.name || "—"}</span></td>
                <td>
                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                    <span className="cell-serial">{deviceCount}</span>
                    <button
                      onClick={() => setSelectedUser(u)}
                      style={btnStyle("#52525b", "#a1a1aa")}
                      onMouseEnter={e => applyHover(e, "#800000", "#fff")}
                      onMouseLeave={e => applyHover(e, "#52525b", "#a1a1aa")}
                    >
                      <svg viewBox="0 0 20 20" fill="currentColor" width={11} height={11}>
                        <path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/>
                        <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd"/>
                      </svg>
                      Manage
                    </button>
                  </div>
                </td>
                <td>
                  <span className="cell-datetime">
                    {formatDateTimeWithOffset(u.created_at, 5)}
                  </span>
                </td>
                <td>
                  <button
                    onClick={() => setEditTarget(u)}
                    style={{ ...btnStyle("#52525b", "#a1a1aa"), marginRight: 8 }}
                    onMouseEnter={e => applyHover(e, "#800000", "#fff")}
                    onMouseLeave={e => applyHover(e, "#52525b", "#a1a1aa")}
                    title="Edit user"
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" width={11} height={11}>
                      <path d="M13.586 3.586a2 2 0 112.828 2.828l-8.5 8.5a1 1 0 01-.39.243l-3 1a1 1 0 01-1.266-1.266l1-3a1 1 0 01.243-.39l8.5-8.5z" />
                      <path d="M12 5l3 3" />
                    </svg>
                    Edit
                  </button>
                  <button
                    onClick={() => setDeleteTarget(u)}
                    style={btnStyle("#52525b", "#a1a1aa")}
                    onMouseEnter={e => applyHover(e, "#7f1d1d", "#fca5a5")}
                    onMouseLeave={e => applyHover(e, "#52525b", "#a1a1aa")}
                    title="Delete user"
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" width={11} height={11}>
                      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd"/>
                    </svg>
                    Delete
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {users.length === 0 && (
        <div className="empty-state"><p>No users found</p></div>
      )}

      <div className="table-footer">
        <span>{users.length} user{users.length !== 1 ? "s" : ""} shown</span>
      </div>

      {/* ── Delete Confirmation Modal ─────────────────────────────── */}
      {deleteTarget && (
        <ModalOverlay onClose={() => !deleteLoading && setDeleteTarget(null)}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
            <div style={{ display:"flex", alignItems:"center", gap:12 }}>
              <div style={{ width:36, height:36, borderRadius:8, background:"rgba(127,29,29,0.3)", border:"1px solid rgba(127,29,29,0.5)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                <svg viewBox="0 0 20 20" fill="#fca5a5" width={16} height={16}>
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
                </svg>
              </div>
              <div>
                <h3 style={{ margin:0, color:"#f4f4f5", fontSize:15, fontWeight:600 }}>Delete User</h3>
                <p style={{ margin:"2px 0 0", color:"#71717a", fontSize:12 }}>This action cannot be undone</p>
              </div>
            </div>
            {!deleteLoading && <CloseBtn onClick={() => setDeleteTarget(null)} />}
          </div>

          <div style={{ background:"#27272a", border:"1px solid #3f3f46", borderRadius:8, padding:"12px 14px" }}>
            <p style={{ margin:0, color:"#a1a1aa", fontSize:12, lineHeight:1.6 }}>
              You are about to delete <strong style={{ color:"#f4f4f5" }}>{deleteTarget.email}</strong>.
              {(deleteTarget.devices?.length ?? 0) > 0 && (
                <> Their <strong style={{ color:"#fca5a5" }}>{deleteTarget.devices.length} assigned device{deleteTarget.devices.length !== 1 ? "s" : ""}</strong> will be unassigned automatically.</>
              )}
            </p>
          </div>

          <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
            <button onClick={() => setDeleteTarget(null)} disabled={deleteLoading} style={{ padding:"8px 16px", background:"transparent", border:"1px solid #3f3f46", borderRadius:8, color:"#a1a1aa", fontSize:13, cursor:"pointer" }}>
              Cancel
            </button>
            <button onClick={handleDeleteUser} disabled={deleteLoading} style={{ padding:"8px 16px", background:"#7f1d1d", border:"1px solid rgba(127,29,29,0.6)", borderRadius:8, color:"#fca5a5", fontSize:13, fontWeight:600, cursor:deleteLoading?"not-allowed":"pointer", display:"flex", alignItems:"center", gap:6, opacity:deleteLoading?0.7:1 }}>
              {deleteLoading ? (
                <><span style={{ width:12, height:12, border:"2px solid #fca5a5", borderTopColor:"transparent", borderRadius:"50%", display:"inline-block", animation:"spin 0.7s linear infinite" }} />Deleting…</>
              ) : (
                <><svg viewBox="0 0 20 20" fill="currentColor" width={13} height={13}><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd"/></svg>Delete User</>
              )}
            </button>
          </div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </ModalOverlay>
      )}

      {/* ── Edit User Modal ───────────────────────────────────────── */}
      {editTarget && (
        <ModalOverlay onClose={() => !editLoading && setEditTarget(null)}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
            <div>
              <h3 style={{ margin:0, color:"#f4f4f5", fontSize:15, fontWeight:600 }}>Edit User</h3>
              <p style={{ margin:"4px 0 0", color:"#71717a", fontSize:12 }}>{editTarget.email}</p>
            </div>
            {!editLoading && <CloseBtn onClick={() => setEditTarget(null)} />}
          </div>

          {editError && (
            <div style={{ padding:"8px 12px", background:"rgba(127,29,29,0.25)", border:"1px solid rgba(127,29,29,0.5)", borderRadius:8, color:"#fca5a5", fontSize:12 }}>
              {editError}
            </div>
          )}

          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            <div>
              <label style={{ color:"#a1a1aa", fontSize:11, textTransform:"uppercase", letterSpacing:"0.06em" }}>
                Email (read-only)
              </label>
              <input
                type="text"
                value={editTarget.email}
                readOnly
                style={{
                  width:"100%", padding:"8px 12px", background:"#27272a",
                  border:"1px solid #3f3f46", borderRadius:8, color:"#71717a", fontSize:13, outline:"none",
                }}
              />
            </div>

            <div>
              <label style={{ color:"#a1a1aa", fontSize:11, textTransform:"uppercase", letterSpacing:"0.06em" }}>
                Name <span style={{ color:"#ef4444" }}>*</span>
              </label>
              <input
                type="text"
                value={editName}
                onChange={(e) => { setEditName(e.target.value); setEditError(""); }}
                style={{
                  width:"100%", padding:"8px 12px", background:"#27272a",
                  border:`1px solid ${editError ? "#7f1d1d" : "#3f3f46"}`,
                  borderRadius:8, color:"#f4f4f5", fontSize:13, outline:"none",
                }}
              />
            </div>

            <div>
              <label style={{ color:"#a1a1aa", fontSize:11, textTransform:"uppercase", letterSpacing:"0.06em" }}>
                New Password (leave blank to keep)
              </label>
              <input
                type="password"
                value={editPassword}
                onChange={(e) => setEditPassword(e.target.value)}
                style={{
                  width:"100%", padding:"8px 12px", background:"#27272a",
                  border:"1px solid #3f3f46", borderRadius:8, color:"#f4f4f5", fontSize:13, outline:"none",
                }}
              />
            </div>
          </div>

          <div style={{ display:"flex", justifyContent:"flex-end", gap:10 }}>
            <button
              onClick={() => setEditTarget(null)}
              disabled={editLoading}
              style={{ padding:"8px 16px", background:"transparent", border:"1px solid #3f3f46", borderRadius:8, color:"#a1a1aa", fontSize:13, cursor:"pointer" }}
            >
              Cancel
            </button>
            <button
              onClick={handleEditUser}
              disabled={editLoading || !editName.trim()}
              style={{ padding:"8px 16px", background:"#800000", border:"1px solid rgba(128,0,0,0.6)", borderRadius:8, color:"#fff", fontSize:13, fontWeight:600, cursor: editLoading ? "not-allowed" : "pointer", opacity: editLoading ? 0.7 : 1 }}
            >
              {editLoading ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </ModalOverlay>
      )}

      {/* ── Devices Manage Modal ──────────────────────────────────── */}
      {selectedUser && (
        <ModalOverlay onClose={() => setSelectedUser(null)}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
            <div>
              <h3 style={{ margin:0, color:"#f4f4f5", fontSize:15, fontWeight:600 }}>Manage Devices</h3>
              <p style={{ margin:"4px 0 0", color:"#71717a", fontSize:12 }}>{selectedUser.name || selectedUser.email}</p>
            </div>
            <CloseBtn onClick={() => setSelectedUser(null)} />
          </div>

          {/* ── Assign Device (unbound only) ── */}
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            <label style={{ color:"#a1a1aa", fontSize:11, textTransform:"uppercase", letterSpacing:"0.06em" }}>
              Assign Unbound Device
            </label>
            {unboundDevices.length === 0 ? (
              <p style={{ color:"#71717a", fontSize:12, margin:"2px 0 0" }}>
                No unbound devices available. Bind a device first from the Devices tab.
              </p>
            ) : (
              <select
                value={searchSN}
                onChange={e => { setSearchSN(e.target.value); setAssignError(""); setAssignSuccess(""); }}
                style={{
                  width: "100%",
                  background: "#18181b",
                  border: `1px solid ${assignError ? "#7f1d1d" : "#3f3f46"}`,
                  borderRadius: 8,
                  padding: "8px 12px",
                  color: "#f4f4f5",
                  fontSize: 13,
                  outline: "none",
                  cursor: "pointer",
                  appearance: "none",
                  WebkitAppearance: "none",
                }}
              >
                <option value="" style={{ background:"#27272a", color:"#a1a1aa" }}>
                  Select a device…
                </option>
                {unboundDevices.map((d) => (
                  <option
                    key={d.sn}
                    value={d.sn}
                    style={{ background:"#27272a", color:"#f4f4f5" }}
                  >
                    {d.sn}{d.client ? ` — ${d.client}` : ""}
                  </option>
                ))}
              </select>
            )}
            <input
              type="text"
              value={assignName}
              onChange={e => { setAssignName(e.target.value); setAssignError(""); setAssignSuccess(""); }}
              onKeyDown={e => e.key === "Enter" && handleAssignDevice()}
              placeholder="Display name (optional mask)"
              style={{
                padding:"8px 12px", background:"#27272a",
                border:"1px solid #3f3f46",
                borderRadius:8, color:"#f4f4f5", fontSize:13, outline:"none",
              }}
            />
            <button
              onClick={handleAssignDevice}
              disabled={assignLoading || !searchSN.trim() || unboundDevices.length === 0}
              style={{
                padding:"8px 14px", background: searchSN.trim() && unboundDevices.length > 0 ? "#800000" : "#27272a",
                border:"1px solid #3f3f46", borderRadius:8, color: searchSN.trim() ? "#fff" : "#52525b",
                fontSize:13, fontWeight:600, cursor: searchSN.trim() ? "pointer" : "not-allowed",
                display:"flex", alignItems:"center", justifyContent:"center", gap:6, transition:"all 0.15s",
                opacity: assignLoading ? 0.7 : 1,
              }}
            >
              {assignLoading
                ? <span style={{ width:12, height:12, border:"2px solid #fff", borderTopColor:"transparent", borderRadius:"50%", display:"inline-block", animation:"spin 0.7s linear infinite" }} />
                : <svg viewBox="0 0 20 20" fill="currentColor" width={13} height={13}><path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd"/></svg>
              }
              Assign
            </button>

            {/* Feedback messages */}
            {assignError && (
              <p style={{ margin:0, color:"#fca5a5", fontSize:11 }}>⚠ {assignError}</p>
            )}
            {assignSuccess && (
              <p style={{ margin:0, color:"#86efac", fontSize:11 }}>✓ {assignSuccess}</p>
            )}
          </div>

          {/* ── Divider ── */}
          <div style={{ borderTop:"1px solid #3f3f46" }} />

          {/* ── Assigned Devices List ── */}
          <div style={{ overflowY:"auto", display:"flex", flexDirection:"column", gap:8 }}>
            {(selectedUser.devices || []).length === 0 ? (
              <p style={{ color:"#52525b", fontSize:12, textAlign:"center", padding:"12px 0", margin:0 }}>
                No devices assigned yet — use the search above to add one.
              </p>
            ) : (
              (selectedUser.devices || []).map((device, i) => {
                const sn   = device?.sn ?? (typeof device === "string" ? device : null);
                const name = device?.name ?? null;
                return (
                  <div key={i} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 14px", background:"#27272a", border:"1px solid #3f3f46", borderRadius:8 }}>
                    <div style={{ width:32, height:32, borderRadius:8, background:"#800000", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                      <svg viewBox="0 0 20 20" fill="white" width={16} height={16}>
                        <path d="M8 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM15 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z"/>
                        <path d="M3 4a1 1 0 00-.8 1.6L3.75 8H2a1 1 0 000 2h.25l-.04.2A2 2 0 004 12.5V14a1 1 0 001 1h.17a3 3 0 015.66 0H13a1 1 0 001-1v-1.5a2 2 0 001.79-1.3L15.75 10H16a1 1 0 000-2h-1.75l1.55-2.4A1 1 0 0015 4H3z"/>
                      </svg>
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ color:"#f4f4f5", fontSize:13, fontWeight:500, fontFamily:"monospace" }}>{sn ?? `Device ${i + 1}`}</div>
                      {name && <div style={{ color:"#71717a", fontSize:11, marginTop:2 }}>{name}</div>}
                    </div>
                    {sn && (
                      <button
                        onClick={() => handleUnassign(selectedUser.id, sn)}
                        disabled={actionLoading}
                        title="Unassign this device"
                        style={{ ...btnStyle("#52525b", "#a1a1aa"), flexShrink:0 }}
                        onMouseEnter={e => applyHover(e, "#7f1d1d", "#fca5a5")}
                        onMouseLeave={e => applyHover(e, "#52525b", "#a1a1aa")}
                      >
                        <svg viewBox="0 0 20 20" fill="currentColor" width={10} height={10}>
                          <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd"/>
                        </svg>
                        Unassign
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <div style={{ borderTop:"1px solid #3f3f46", paddingTop:12, color:"#52525b", fontSize:11 }}>
            {selectedUser.devices?.length ?? 0} device{(selectedUser.devices?.length ?? 0) !== 1 ? "s" : ""} assigned
          </div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </ModalOverlay>
      )}
    </div>
  );
}

function btnStyle(borderColor, color) {
  return { display:"flex", alignItems:"center", gap:4, padding:"4px 10px", background:"transparent", border:`1px solid ${borderColor}`, borderRadius:6, color, fontSize:11, cursor:"pointer", whiteSpace:"nowrap", transition:"all 0.15s" };
}
function applyHover(e, borderColor, color) {
  e.currentTarget.style.borderColor = borderColor;
  e.currentTarget.style.color = color;
}
function ModalOverlay({ children, onClose }) {
  return (
    <div style={{ position:"fixed", inset:0, zIndex:1000, background:"rgba(0,0,0,0.7)", display:"flex", alignItems:"center", justifyContent:"center" }} onClick={onClose}>
      <div style={{ background:"#18181b", border:"1px solid #3f3f46", borderRadius:12, padding:24, minWidth:340, maxWidth:480, width:"90%", maxHeight:"70vh", display:"flex", flexDirection:"column", gap:16 }} onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
function CloseBtn({ onClick }) {
  return <button onClick={onClick} style={{ background:"none", border:"none", color:"#71717a", cursor:"pointer", fontSize:18, lineHeight:1 }}>✕</button>;
}