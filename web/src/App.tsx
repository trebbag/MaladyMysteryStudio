import { Route, Routes, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import ChatStart from "./components/ChatStart";
import RunViewer from "./components/RunViewer";
import { getHealth, HealthResponse } from "./api";
import AppHeader from "./components/AppHeader";

export default function App() {
  const location = useLocation();
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthErr, setHealthErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const h = await getHealth();
        if (!cancelled) setHealth(h);
      } catch (err) {
        if (!cancelled) setHealthErr(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [location.key]);

  return (
    <div className="appShell">
      <AppHeader health={health} healthErr={healthErr} />

      <div className="container">
        <Routes>
          <Route path="/" element={<ChatStart health={health} />} />
          <Route path="/runs/:runId" element={<RunViewer />} />
        </Routes>
      </div>
    </div>
  );
}
