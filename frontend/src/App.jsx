import { useCallback, useState } from "react";
import ActivityFeed from "./components/ActivityFeed.jsx";
import FraudMonitor from "./components/FraudMonitor.jsx";
import GraphView from "./components/GraphView.jsx";
import MetricsPanel from "./components/MetricsPanel.jsx";
import OperationsPanel from "./components/OperationsPanel.jsx";

export default function App() {
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);

  return (
    <main>
      <h1>Referral engine</h1>
      <div style={{ marginBottom: "1rem" }}>
        <OperationsPanel refreshKey={refreshKey} onDataChanged={bump} />
      </div>
      <div className="grid grid-2">
        <MetricsPanel refreshKey={refreshKey} />
        <GraphView refreshKey={refreshKey} />
      </div>
      <div className="grid grid-2" style={{ marginTop: "1rem" }}>
        <FraudMonitor refreshKey={refreshKey} />
        <ActivityFeed refreshKey={refreshKey} />
      </div>
    </main>
  );
}
