import { useEffect, useState } from "react";
import { api } from "../api/client";

export default function FraudMonitor({ refreshKey = 0 }) {
  const [flags, setFlags] = useState([]);
  useEffect(() => {
    api.get("/fraud/flags").then((r) => setFlags(r.data.flags || []));
  }, [refreshKey]);
  return (
    <section>
      <h2>Fraud flags</h2>
      <ul style={{ listStyle: "none", padding: 0, maxHeight: 280, overflow: "auto" }}>
        {flags.map((f) => (
          <li
            key={`${f.attempted_by}-${f.timestamp}`}
            style={{ padding: "0.4rem 0", borderBottom: "1px solid #30363d", fontSize: 13 }}
          >
            <strong>{f.reason}</strong> — {f.attempted_by} → {f.attempted_ref}
            <div style={{ opacity: 0.6 }}>{f.timestamp}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}
