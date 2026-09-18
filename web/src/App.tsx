import { useState } from "react";

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
        {view === "importar" ? <p>Tela de import em construção.</p> : <p>Dashboard chega na S6.</p>}
      </main>
    </div>
  );
}
