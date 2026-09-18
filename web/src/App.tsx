import { useState } from "react";
import { ImportView } from "./views/ImportView.tsx";
import { DashboardView } from "./views/DashboardView.tsx";

type View = "importar" | "dashboard";

export function App() {
  const [view, setView] = useState<View>("importar");
  return (
    <div className="app">
      <header className="topbar">
        <div className="shell topbar-inner">
          <p className="brand">investment-tracker</p>
          <nav className="tabs" aria-label="Seções">
            <button
              type="button"
              className={view === "importar" ? "tab active" : "tab"}
              aria-current={view === "importar" ? "page" : undefined}
              onClick={() => setView("importar")}
            >
              Importar
            </button>
            <button
              type="button"
              className={view === "dashboard" ? "tab active" : "tab"}
              aria-current={view === "dashboard" ? "page" : undefined}
              onClick={() => setView("dashboard")}
            >
              Dashboard
            </button>
          </nav>
        </div>
      </header>
      <main className="shell">
        {view === "importar" ? <ImportView /> : <DashboardView />}
      </main>
    </div>
  );
}
