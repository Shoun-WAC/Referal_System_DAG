import { useCallback, useEffect, useState } from "react";
import ReactFlow, { Background, Controls, useEdgesState, useNodesState } from "reactflow";
import "reactflow/dist/style.css";
import { api } from "../api/client";

const colors = { root: "#378ADD", active: "#1D9E75", flagged: "#BA7517" };

export default function GraphView({ refreshKey = 0 }) {
  const [users, setUsers] = useState([]);
  const [sel, setSel] = useState("");
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  useEffect(() => {
    api.get("/users").then((r) => {
      const list = r.data;
      setUsers(list);
      setSel((prev) => {
        if (prev && list.some((u) => u.user_id === prev)) return prev;
        return list[0]?.user_id || "";
      });
    });
  }, [refreshKey]);

  const load = useCallback(async (id) => {
    if (!id) return;
    const { data } = await api.get(`/user/${id}/graph`);
    setNodes(
      data.nodes.map((n) => ({
        id: n.id,
        position: { x: Math.random() * 400, y: Math.random() * 300 },
        data: { label: `${n.label}\n${n.id.slice(0, 8)}…\n$${n.balance}` },
        style: {
          background: colors[n.status] || colors.active,
          color: "#fff",
          fontSize: 11,
          padding: 8,
          borderRadius: 6,
          border: "1px solid #333",
        },
      }))
    );
    setEdges(
      data.edges.map((e) => ({
        id: `${e.source}-${e.target}`,
        source: e.source,
        target: e.target,
        style: {
          stroke: e.valid ? "#1D9E75" : "#c94c4c",
          strokeDasharray: e.valid ? undefined : "6 4",
        },
      }))
    );
  }, []);

  useEffect(() => {
    load(sel);
  }, [sel, load, refreshKey]);

  return (
    <section>
      <h2>Graph</h2>
      <select value={sel} onChange={(e) => setSel(e.target.value)} style={{ marginBottom: 8 }}>
        {users.map((u) => (
          <option key={u.user_id} value={u.user_id}>
            {u.username}
          </option>
        ))}
      </select>
      <div style={{ height: 420, background: "#161b22", borderRadius: 8 }}>
        <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} fitView>
          <Background />
          <Controls />
        </ReactFlow>
      </div>
    </section>
  );
}
