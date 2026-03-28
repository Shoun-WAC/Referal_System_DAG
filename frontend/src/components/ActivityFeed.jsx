import { useEffect, useState } from "react";
import { api } from "../api/client";
import { usePolling } from "../hooks/usePolling";

const dot = { valid: "#1D9E75", blocked: "#c94c4c", reward: "#d4a017" };

export default function ActivityFeed({ refreshKey = 0 }) {
  const [items, setItems] = useState([]);
  const pull = () => api.get("/referral/feed").then((r) => setItems(r.data));
  useEffect(() => {
    pull();
  }, [refreshKey]);
  usePolling(pull, 5000, []);
  return (
    <section>
      <h2>Activity</h2>
      <ul style={{ listStyle: "none", padding: 0, maxHeight: 320, overflow: "auto" }}>
        {items.map((it, i) => (
          <li key={i} style={{ display: "flex", gap: 8, padding: "0.35rem 0", fontSize: 13 }}>
            <span style={{ color: dot[it.type] || "#888" }}>●</span>
            <div>
              <div>{it.message}</div>
              <div style={{ opacity: 0.55, fontSize: 11 }}>{it.timestamp}</div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
