import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useEffect, useState } from "react";
import { api } from "../api/client";

export default function MetricsPanel({ refreshKey = 0 }) {
  const [m, setM] = useState(null);
  useEffect(() => {
    api.get("/dashboard/metrics").then((r) => setM(r.data));
  }, [refreshKey]);
  if (!m) return <p>Loading metrics…</p>;
  const pie = [
    { name: "valid", value: m.valid_referrals, fill: "#1D9E75" },
    { name: "rejected", value: m.rejected_referrals, fill: "#c94c4c" },
  ];
  const bar = Object.entries(m.rewards_by_depth || {}).map(([k, v]) => ({ depth: k, amt: v }));
  return (
    <section>
      <h2>Dashboard</h2>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3,1fr)",
          gap: "0.75rem",
          marginBottom: "1rem",
        }}
      >
        {[
          ["Users", m.total_users],
          ["Valid refs", m.valid_referrals],
          ["Fraud", m.fraud_attempts],
        ].map(([l, v]) => (
          <div key={l} style={{ background: "#161b22", padding: "0.75rem", borderRadius: 8 }}>
            <div style={{ fontSize: 12, opacity: 0.7 }}>{l}</div>
            <div style={{ fontSize: 22, fontWeight: 600 }}>{v}</div>
          </div>
        ))}
      </div>
      <div style={{ height: 220, marginBottom: 16 }}>
        <ResponsiveContainer>
          <LineChart data={m.referrals_over_time}>
            <CartesianGrid stroke="#333" />
            <XAxis dataKey="date" tick={{ fill: "#8b949e", fontSize: 10 }} />
            <YAxis tick={{ fill: "#8b949e", fontSize: 10 }} />
            <Tooltip contentStyle={{ background: "#161b22" }} />
            <Legend />
            <Line type="monotone" dataKey="valid" stroke="#1D9E75" dot={false} />
            <Line type="monotone" dataKey="rejected" stroke="#c94c4c" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ height: 200 }}>
          <ResponsiveContainer>
            <PieChart>
              <Pie data={pie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label>
                {pie.map((_, i) => (
                  <Cell key={i} fill={pie[i].fill} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div style={{ height: 200 }}>
          <ResponsiveContainer>
            <BarChart data={bar}>
              <CartesianGrid stroke="#333" />
              <XAxis dataKey="depth" tick={{ fill: "#8b949e" }} />
              <YAxis tick={{ fill: "#8b949e" }} />
              <Tooltip contentStyle={{ background: "#161b22" }} />
              <Bar dataKey="amt" fill="#378ADD" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}
