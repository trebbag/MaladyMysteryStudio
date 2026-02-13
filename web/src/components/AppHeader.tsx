import { Link } from "react-router-dom";
import { HealthResponse } from "../api";

type AppHeaderProps = {
  health: HealthResponse | null;
  healthErr: string | null;
};

export default function AppHeader({ health, healthErr }: AppHeaderProps) {
  const ready = Boolean(health?.ok && health?.hasKey && health?.hasVectorStoreId);

  return (
    <header className="appHeader">
      <div className="container headerWrap">
        <div>
          <div className="brand">
            <Link to="/" className="brandLink">
              Malady Mystery Studio
            </Link>
          </div>
          <div className="subtle">Local multi-agent episode builder (KB0 to O) with live tracing + artifacts</div>
        </div>

        <div className="headerBadges">
          {health && (
            <span className={`badge ${ready ? "badgeOk" : "badgeErr"}`}>
              health: {health.ok ? "ok" : "bad"} | key: {health.hasKey ? "yes" : "no"} | vs: {health.hasVectorStoreId ? "yes" : "no"}
            </span>
          )}
          {healthErr && <span className="badge badgeErr">health error: {healthErr}</span>}
        </div>
      </div>
    </header>
  );
}
