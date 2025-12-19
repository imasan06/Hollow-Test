// IMPORTANTE: Importar bootstrap de BLE primero para pre-inicializar lo antes posible
import './ble/bleBootstrap';

import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
