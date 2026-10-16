
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { LanguageProvider } from "./LanguageContext.jsx";
import "./index.css";
import "./App.css";
import "./extras.css";
import "./premium.css";
import "./design.css";
import "./system.css";
import "./ui.css";
import "./pages.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <LanguageProvider>
      <App />
    </LanguageProvider>
  </React.StrictMode>
);
