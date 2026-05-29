import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import LeftSidebar from '../components/layout/LeftSidebar';

const STYLES = `
  .app-shell {
    min-height: 100vh;
    background: #0f0d0a;
    color: #d4cfc8;
    font-family: 'Lora', Georgia, serif;
  }
  .app-shell__main {
    min-height: 100vh;
    margin-left: 280px;
    transition: margin-left 0.2s ease;
  }
  .app-shell.is-collapsed .app-shell__main { margin-left: 92px; }
  .app-shell__mobile-toggle {
    display: none;
    position: fixed;
    top: 14px;
    left: 14px;
    z-index: 80;
    width: 42px;
    height: 42px;
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,0.1);
    background: rgba(20,18,14,0.92);
    color: #e8e0d0;
    box-shadow: 0 12px 40px rgba(0,0,0,0.35);
  }
  .app-shell__scrim { display: none; }
  @media (max-width: 900px) {
    .app-shell__main, .app-shell.is-collapsed .app-shell__main { margin-left: 0; }
    .app-shell__mobile-toggle { display: inline-flex; align-items: center; justify-content: center; }
    .app-shell__scrim.is-open {
      display: block;
      position: fixed;
      inset: 0;
      z-index: 55;
      background: rgba(0,0,0,0.58);
      backdrop-filter: blur(4px);
    }
  }
`;

export default function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className={`app-shell ${collapsed ? 'is-collapsed' : ''}`}>
      <style>{STYLES}</style>
      <button
        type="button"
        className="app-shell__mobile-toggle"
        onClick={() => setMobileOpen(true)}
        aria-label="Mở menu điều hướng"
      >
        ☰
      </button>
      <div className={`app-shell__scrim ${mobileOpen ? 'is-open' : ''}`} onClick={() => setMobileOpen(false)} />
      <LeftSidebar
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onToggleCollapsed={() => setCollapsed((value) => !value)}
        onCloseMobile={() => setMobileOpen(false)}
      />
      <main className="app-shell__main">
        <Outlet />
      </main>
    </div>
  );
}
