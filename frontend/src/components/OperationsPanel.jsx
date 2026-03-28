import { useEffect, useState } from "react";
import { api } from "../api/client";

export default function OperationsPanel({ refreshKey, onDataChanged }) {
  const [users, setUsers] = useState([]);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [childId, setChildId] = useState("");
  const [referrerId, setReferrerId] = useState("");
  const [rewardUserId, setRewardUserId] = useState("");
  const [rewards, setRewards] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const loadUsers = () =>
    api.get("/users").then((r) => {
      setUsers(r.data);
      const ids = r.data.map((u) => u.user_id);
      setChildId((c) => (c && ids.includes(c) ? c : ids[0] || ""));
      setReferrerId((ref) => (ref && ids.includes(ref) ? ref : ids[0] || ""));
      setRewardUserId((x) => (x && ids.includes(x) ? x : ids[0] || ""));
    });

  useEffect(() => {
    loadUsers().catch((e) => setMsg({ type: "err", text: e.message }));
  }, [refreshKey]);

  const flash = (type, text) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 8000);
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    if (!username.trim() || !email.trim()) return;
    setBusy(true);
    try {
      const { data } = await api.post("/users", { username: username.trim(), email: email.trim() });
      flash("ok", `User created: ${data.username} (${data.user_id})`);
      setUsername("");
      setEmail("");
      await loadUsers();
      onDataChanged?.();
    } catch (err) {
      const t = err.response?.data?.detail || err.response?.data || err.message;
      flash("err", typeof t === "string" ? t : JSON.stringify(t));
    } finally {
      setBusy(false);
    }
  };

  const handleClaim = async (e) => {
    e.preventDefault();
    if (!childId || !referrerId) return;
    setBusy(true);
    try {
      const { data } = await api.post("/referral/claim", {
        new_user_id: childId,
        referrer_id: referrerId,
      });
      flash("ok", data?.status === "committed" ? "Referral committed." : JSON.stringify(data));
      onDataChanged?.();
      await loadUsers();
    } catch (err) {
      const d = err.response?.data;
      const text = d?.error
        ? `${d.error}${d.action ? ` (${d.action})` : ""}`
        : err.response?.data?.detail || err.message;
      flash("err", String(text));
      onDataChanged?.();
      await loadUsers();
    } finally {
      setBusy(false);
    }
  };

  const handleRewards = async (e) => {
    e.preventDefault();
    if (!rewardUserId) return;
    setBusy(true);
    try {
      const { data } = await api.get(`/user/${rewardUserId}/rewards`);
      setRewards(data);
      flash("ok", "Rewards loaded.");
    } catch (err) {
      flash("err", err.response?.data?.detail || err.message);
    } finally {
      setBusy(false);
    }
  };

  const btn = {
    padding: "0.45rem 0.9rem",
    borderRadius: 6,
    border: "none",
    cursor: busy ? "wait" : "pointer",
    fontWeight: 600,
    fontSize: 13,
    opacity: busy ? 0.65 : 1,
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

      <div style={{ display: "grid", gap: "1.25rem", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        <form onSubmit={handleCreateUser}>
          <h3 style={{ margin: "0 0 0.5rem", fontSize: 14, opacity: 0.9 }}>Create user</h3>
          <label style={label}>Username</label>
          <input style={input} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Alice" />
          <label style={label}>Email</label>
          <input style={input} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="alice@x.com" type="email" />
          <button type="submit" disabled={busy} style={{ ...btn, background: "#378ADD", color: "#fff" }}>
            POST /users
          </button>
        </form>

        <form onSubmit={handleClaim}>
          <h3 style={{ margin: "0 0 0.5rem", fontSize: 14, opacity: 0.9 }}>Claim referral</h3>
          <label style={label}>New user (child)</label>
          <select style={input} value={childId} onChange={(e) => setChildId(e.target.value)}>
            {users.map((u) => (
              <option key={u.user_id} value={u.user_id}>
                {u.username} — {u.user_id.slice(0, 8)}…
              </option>
            ))}
          </select>
          <label style={label}>Referrer (parent)</label>
          <select style={input} value={referrerId} onChange={(e) => setReferrerId(e.target.value)}>
            {users.map((u) => (
              <option key={u.user_id} value={u.user_id}>
                {u.username} — {u.user_id.slice(0, 8)}…
              </option>
            ))}
          </select>
          <button type="submit" disabled={busy} style={{ ...btn, background: "#1D9E75", color: "#fff" }}>
            POST /referral/claim
          </button>
        </form>

        <form onSubmit={handleRewards}>
          <h3 style={{ margin: "0 0 0.5rem", fontSize: 14, opacity: 0.9 }}>User rewards</h3>
          <label style={label}>User</label>
          <select style={input} value={rewardUserId} onChange={(e) => setRewardUserId(e.target.value)}>
            {users.map((u) => (
              <option key={u.user_id} value={u.user_id}>
                {u.username}
              </option>
            ))}
          </select>
          <button type="submit" disabled={busy} style={{ ...btn, background: "#BA7517", color: "#fff" }}>
            GET /user/…/rewards
          </button>
          {rewards && (
            <div style={{ marginTop: 10, fontSize: 12, opacity: 0.9 }}>
              <strong>Balance:</strong> ${rewards.balance?.toFixed?.(2) ?? rewards.balance}
              <ul style={{ margin: "6px 0 0", paddingLeft: 18, maxHeight: 120, overflow: "auto" }}>
                {(rewards.transactions || []).slice(0, 8).map((t, i) => (
                  <li key={i}>
                    L{t.level} +${t.amount} from {String(t.from).slice(0, 8)}…
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
          disabled={busy}
          onClick={() => onDataChanged?.()}
          style={{ ...btn, background: "#30363d", color: "#e6edf3" }}
        >
          Refresh dashboard &amp; lists
        </button>
      </div>
    </section>
  );
}
