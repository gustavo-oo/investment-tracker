import { useState } from "react";
import { ImportView } from "./views/ImportView.tsx";

type View = "importar" | "dashboard";

export function App() {
  const [view, setView] = useState<View>("importar");
  return (
    <div className="app">
      <header>
        <h1>investment-tracker</h1>
        <nav>
          <button className={view === "importar" ? "active" : ""} onClick={() => setView("importar")}>Importar</button>
          <button className={view === "dashboard" ? "active" : ""} onClick={() => setView("dashboard")}>Dashboard</button>
        </nav>
      </header>
      <main>
        {view === "importar" ? <ImportView /> : <p>Dashboard chega na S6.</p>}
      </main>
    </div>
  );
}
