import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";

const btnBase = {
  padding: "0.45rem 0.9rem",
  borderRadius: 6,
  border: "none",
  cursor: "pointer",
  fontWeight: 600,
  fontSize: 13,
};

const panel = {
  background: "#161b22",
  borderRadius: 8,
  padding: "1rem",
  border: "1px solid #30363d",
};

const label = { display: "block", fontSize: 12, opacity: 0.85, marginBottom: 4 };
const input = {
  width: "100%",
  padding: "0.45rem 0.5rem",
  borderRadius: 6,
  border: "1px solid #30363d",
  background: "#0d1117",
  color: "#e6edf3",
  marginBottom: 10,
};

const card = {
  background: "#0d1117",
  border: "1px solid #30363d",
  borderRadius: 8,
  padding: "0.9rem",
};

export default function OperationsPanel({ refreshKey, onDataChanged }) {
  const [users, setUsers] = useState([]);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [childId, setChildId] = useState("");
  const [referrerId, setReferrerId] = useState("");
  const [rewardUserId, setRewardUserId] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedUser, setSelectedUser] = useState(null);
  const [editForm, setEditForm] = useState({ username: "", email: "", status: "root" });
  const [rewards, setRewards] = useState(null);
  const [busyAction, setBusyAction] = useState("");
  const [msg, setMsg] = useState(null);
  const flashTimerRef = useRef(0);

  const flash = (type, text) => {
    setMsg({ type, text });
    window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => setMsg(null), 8000);
  };

  const loadUsers = async (preferredId) => {
    const { data } = await api.get("/users");
    setUsers(data);
    const ids = data.map((u) => u.user_id);
    const fallbackId = preferredId && ids.includes(preferredId) ? preferredId : ids[0] || "";
    setChildId((current) => (current && ids.includes(current) ? current : fallbackId));
    setReferrerId((current) => (current && ids.includes(current) ? current : fallbackId));
    setRewardUserId((current) => (current && ids.includes(current) ? current : fallbackId));
    setSelectedUserId((current) => (current && ids.includes(current) ? current : fallbackId));
    return { data, fallbackId };
  };

  const loadSelectedUser = async (userId) => {
    if (!userId) {
      setSelectedUser(null);
      setEditForm({ username: "", email: "", status: "root" });
      return;
    }
    const { data } = await api.get(`/users/${userId}`);
    setSelectedUser(data);
    setEditForm({
      username: data.username || "",
      email: data.email || "",
      status: data.status || "root",
    });
  };

  useEffect(() => {
    loadUsers()
      .then(({ fallbackId }) => loadSelectedUser(fallbackId))
      .catch((e) => flash("err", e.message));
  }, [refreshKey]);

  useEffect(() => {
    loadSelectedUser(selectedUserId).catch((e) => {
      setSelectedUser(null);
      flash("err", e.response?.data?.detail || e.message);
    });
  }, [selectedUserId]);

  const runAction = async (action, fn) => {
    setBusyAction(action);
    try {
      await fn();
    } finally {
      setBusyAction("");
    }
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    if (!username.trim() || !email.trim()) return;

    await runAction("create", async () => {
      const { data } = await api.post("/users", { username: username.trim(), email: email.trim() });
      flash("ok", `User created: ${data.username} (${data.user_id})`);
      setUsername("");
      setEmail("");
      await loadUsers(data.user_id);
      await loadSelectedUser(data.user_id);
      onDataChanged?.();
    }).catch((err) => {
      const detail = err.response?.data?.detail || err.response?.data || err.message;
      flash("err", typeof detail === "string" ? detail : JSON.stringify(detail));
    });
  };

  const handleClaim = async (e) => {
    e.preventDefault();
    if (!childId || !referrerId) return;

    await runAction("claim", async () => {
      const { data } = await api.post("/referral/claim", {
        new_user_id: childId,
        referrer_id: referrerId,
      });
      flash("ok", data?.status === "committed" ? "Referral committed." : JSON.stringify(data));
      await loadUsers(childId);
      await loadSelectedUser(selectedUserId || childId);
      onDataChanged?.();
    }).catch((err) => {
      const data = err.response?.data;
      const text = data?.error
        ? `${data.error}${data.action ? ` (${data.action})` : ""}`
        : err.response?.data?.detail || err.message;
      flash("err", String(text));
      loadUsers(selectedUserId).catch(() => {});
      loadSelectedUser(selectedUserId).catch(() => {});
      onDataChanged?.();
    });
  };

  const handleRewards = async (e) => {
    e.preventDefault();
    if (!rewardUserId) return;

    await runAction("rewards", async () => {
      const { data } = await api.get(`/user/${rewardUserId}/rewards`);
      setRewards(data);
      flash("ok", "Rewards loaded.");
    }).catch((err) => {
      flash("err", err.response?.data?.detail || err.message);
    });
  };

  const handleLoadUser = async (e) => {
    e.preventDefault();
    if (!selectedUserId) return;

    await runAction("read", async () => {
      await loadSelectedUser(selectedUserId);
      flash("ok", "User details loaded.");
    }).catch((err) => {
      flash("err", err.response?.data?.detail || err.message);
    });
  };

  const handleUpdateUser = async (e) => {
    e.preventDefault();
    if (!selectedUserId) return;

    await runAction("update", async () => {
      const payload = {
        username: editForm.username.trim(),
        email: editForm.email.trim(),
        status: editForm.status,
      };
      const { data } = await api.patch(`/users/${selectedUserId}`, payload);
      setSelectedUser(data);
      setEditForm({
        username: data.username,
        email: data.email,
        status: data.status,
      });
      flash("ok", "User updated.");
      await loadUsers(selectedUserId);
      onDataChanged?.();
    }).catch((err) => {
      flash("err", err.response?.data?.detail || err.message);
    });
  };

  const handleDeleteUser = async () => {
    if (!selectedUserId) return;
    const confirmed = window.confirm("Delete this user? This only succeeds if the user has no related referral, reward, or fraud history.");
    if (!confirmed) return;

    await runAction("delete", async () => {
      await api.delete(`/users/${selectedUserId}`);
      flash("ok", "User deleted.");
      setRewards(null);
      const { fallbackId } = await loadUsers();
      await loadSelectedUser(fallbackId);
      onDataChanged?.();
    }).catch((err) => {
      flash("err", err.response?.data?.detail || err.message);
    });
  };

  return (
    <section style={panel}>
      <h2 style={{ margin: "0 0 0.75rem", fontSize: "1.05rem" }}>Operations</h2>

      {msg && (
        <div
          style={{
            padding: "0.5rem 0.65rem",
            borderRadius: 6,
            marginBottom: 12,
            fontSize: 13,
            background: msg.type === "ok" ? "rgba(29,158,117,0.15)" : "rgba(201,76,76,0.2)",
            border: `1px solid ${msg.type === "ok" ? "#1D9E75" : "#c94c4c"}`,
          }}
        >
          {msg.text}
        </div>
      )}

      <div style={{ display: "grid", gap: "1rem", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
        <form onSubmit={handleCreateUser} style={card}>
          <h3 style={{ margin: "0 0 0.5rem", fontSize: 14, opacity: 0.9 }}>Create user</h3>
          <label style={label}>Username</label>
          <input style={input} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Alice" />
          <label style={label}>Email</label>
          <input style={input} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="alice@x.com" type="email" />
          <button
            type="submit"
            disabled={Boolean(busyAction)}
            style={{ ...btnBase, background: "#378ADD", color: "#fff", opacity: busyAction ? 0.65 : 1 }}
          >
            POST /users
          </button>
        </form>

        <form onSubmit={handleLoadUser} style={card}>
          <h3 style={{ margin: "0 0 0.5rem", fontSize: 14, opacity: 0.9 }}>Read user</h3>
          <label style={label}>Selected user</label>
          <select style={input} value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)}>
            {users.map((u) => (
              <option key={u.user_id} value={u.user_id}>
                {u.username} - {u.user_id.slice(0, 8)}...
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={!selectedUserId || Boolean(busyAction)}
            style={{ ...btnBase, background: "#6b7280", color: "#fff", opacity: busyAction ? 0.65 : 1 }}
          >
            GET /users/:id
          </button>
          {selectedUser && (
            <div style={{ marginTop: 10, fontSize: 12, lineHeight: 1.5 }}>
              <div><strong>Email:</strong> {selectedUser.email}</div>
              <div><strong>Status:</strong> {selectedUser.status}</div>
              <div><strong>Balance:</strong> ${Number(selectedUser.balance || 0).toFixed(2)}</div>
              <div><strong>Referrer:</strong> {selectedUser.referrer_id || "None"}</div>
            </div>
          )}
        </form>

        <form onSubmit={handleUpdateUser} style={card}>
          <h3 style={{ margin: "0 0 0.5rem", fontSize: 14, opacity: 0.9 }}>Update user</h3>
          <label style={label}>Username</label>
          <input
            style={input}
            value={editForm.username}
            onChange={(e) => setEditForm((current) => ({ ...current, username: e.target.value }))}
            placeholder="Updated username"
          />
          <label style={label}>Email</label>
          <input
            style={input}
            value={editForm.email}
            onChange={(e) => setEditForm((current) => ({ ...current, email: e.target.value }))}
            placeholder="updated@example.com"
            type="email"
          />
          <label style={label}>Status</label>
          <select
            style={input}
            value={editForm.status}
            onChange={(e) => setEditForm((current) => ({ ...current, status: e.target.value }))}
          >
            <option value="root">root</option>
            <option value="active">active</option>
            <option value="flagged">flagged</option>
          </select>
          <button
            type="submit"
            disabled={!selectedUserId || Boolean(busyAction)}
            style={{ ...btnBase, background: "#1D9E75", color: "#fff", opacity: busyAction ? 0.65 : 1 }}
          >
            PATCH /users/:id
          </button>
        </form>

        <div style={card}>
          <h3 style={{ margin: "0 0 0.5rem", fontSize: 14, opacity: 0.9 }}>Delete user</h3>
          <p style={{ margin: "0 0 0.75rem", fontSize: 12, opacity: 0.8 }}>
            Deletes only users with no referral, reward, or fraud references.
          </p>
          <button
            type="button"
            disabled={!selectedUserId || Boolean(busyAction)}
            onClick={handleDeleteUser}
            style={{ ...btnBase, background: "#c94c4c", color: "#fff", opacity: busyAction ? 0.65 : 1 }}
          >
            DELETE /users/:id
          </button>
        </div>

        <form onSubmit={handleClaim} style={card}>
          <h3 style={{ margin: "0 0 0.5rem", fontSize: 14, opacity: 0.9 }}>Claim referral</h3>
          <label style={label}>New user (child)</label>
          <select style={input} value={childId} onChange={(e) => setChildId(e.target.value)}>
            {users.map((u) => (
              <option key={u.user_id} value={u.user_id}>
                {u.username} - {u.user_id.slice(0, 8)}...
              </option>
            ))}
          </select>
          <label style={label}>Referrer (parent)</label>
          <select style={input} value={referrerId} onChange={(e) => setReferrerId(e.target.value)}>
            {users.map((u) => (
              <option key={u.user_id} value={u.user_id}>
                {u.username} - {u.user_id.slice(0, 8)}...
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={Boolean(busyAction)}
            style={{ ...btnBase, background: "#8b5cf6", color: "#fff", opacity: busyAction ? 0.65 : 1 }}
          >
            POST /referral/claim
          </button>
        </form>

        <form onSubmit={handleRewards} style={card}>
          <h3 style={{ margin: "0 0 0.5rem", fontSize: 14, opacity: 0.9 }}>User rewards</h3>
          <label style={label}>User</label>
          <select style={input} value={rewardUserId} onChange={(e) => setRewardUserId(e.target.value)}>
            {users.map((u) => (
              <option key={u.user_id} value={u.user_id}>
                {u.username}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={Boolean(busyAction)}
            style={{ ...btnBase, background: "#BA7517", color: "#fff", opacity: busyAction ? 0.65 : 1 }}
          >
            GET /user/.../rewards
          </button>
          {rewards && (
            <div style={{ marginTop: 10, fontSize: 12, opacity: 0.9 }}>
              <strong>Balance:</strong> ${rewards.balance?.toFixed?.(2) ?? rewards.balance}
              <ul style={{ margin: "6px 0 0", paddingLeft: 18, maxHeight: 120, overflow: "auto" }}>
                {(rewards.transactions || []).slice(0, 8).map((t, i) => (
                  <li key={i}>
                    L{t.level} +${t.amount} from {String(t.from).slice(0, 8)}...
                  </li>
                ))}
              </ul>
            </div>
          )}
        </form>
      </div>

      <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #30363d" }}>
        <button
          type="button"
          disabled={Boolean(busyAction)}
          onClick={() => onDataChanged?.()}
          style={{ ...btnBase, background: "#30363d", color: "#e6edf3", opacity: busyAction ? 0.65 : 1 }}
        >
          Refresh dashboard and lists
        </button>
      </div>
    </section>
  );
}
