import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppStoreProvider } from "./state/store";
import "./theme.css";
import "./appearance.css";
import "./agenda-refinements.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root não encontrado");
createRoot(rootEl).render(
  <React.StrictMode>
    <AppStoreProvider>
      <App />
    </AppStoreProvider>
  </React.StrictMode>
);
