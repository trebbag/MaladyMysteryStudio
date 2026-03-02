import { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { HealthResponse } from "../api";

type AppHeaderProps = {
  health: HealthResponse | null;
  healthErr: string | null;
};

export default function AppHeader({ health, healthErr }: AppHeaderProps) {
  const ready = Boolean(health?.ok && health?.hasKey && health?.hasVectorStoreId);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="appHeader">
      <div className="container headerWrap">
        <div className="headerLeft">
          <div className="headerBrandBlock">
            <Link to="/" className="brandLink" aria-label="Malady Mystery Studio">
              <span className="headerLogo" aria-hidden="true">
                <span className="headerLogoGlyph">⌕</span>
                <span className="headerLogoDot" />
              </span>
              <span className="headerTitleBlock">
                <span className="brand">Malady Mystery Studio</span>
                <span className="subtle">Every diagnosis tells a story.</span>
              </span>
            </Link>
          </div>
          <nav className="headerNav">
            <NavLink to="/" className={({ isActive }) => `headerNavLink${isActive ? " headerNavLinkActive" : ""}`} aria-label="Home">
              Case Board
            </NavLink>
            <NavLink
              to="/runs"
              className={({ isActive }) => `headerNavLink${isActive ? " headerNavLinkActive" : ""}`}
              aria-label="Runs"
            >
              Archive
            </NavLink>
          </nav>
        </div>

        <div className="headerBadges">
          <span className="headerOnlinePill">
            <span className="headerOnlineDot" />
            Agents Online
          </span>
          {health && (
            <span className={`badge ${ready ? "badgeOk" : "badgeErr"}`}>
              health: {health.ok ? "ok" : "bad"} | key: {health.hasKey ? "yes" : "no"} | vs: {health.hasVectorStoreId ? "yes" : "no"}
            </span>
          )}
          {healthErr && <span className="badge badgeErr">health error: {healthErr}</span>}
          <button
            type="button"
            className="headerMenuButton"
            aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
            onClick={() => setMobileOpen((prev) => !prev)}
          >
            {mobileOpen ? "✕" : "☰"}
          </button>
        </div>
      </div>
      <div className={`headerMobileNav${mobileOpen ? " headerMobileNavOpen" : ""}`}>
        <NavLink
          to="/"
          className={({ isActive }) => `headerMobileNavLink${isActive ? " headerMobileNavLinkActive" : ""}`}
          onClick={() => setMobileOpen(false)}
        >
          Case Board
        </NavLink>
        <NavLink
          to="/runs"
          className={({ isActive }) => `headerMobileNavLink${isActive ? " headerMobileNavLinkActive" : ""}`}
          onClick={() => setMobileOpen(false)}
        >
          Archive
        </NavLink>
      </div>
    </header>
  );
}
