import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Configuracion from "./pages/Configuracion";
import Activar from "./pages/Activar";
import Consultorio from "./pages/Consultorio";
import Monitor from "./pages/Monitor";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/config" replace />} />
        <Route path="/config" element={<Configuracion />} />
        <Route path="/activar" element={<Activar />} />
        <Route path="/consultorio" element={<Consultorio />} />
        <Route path="/monitor" element={<Monitor />} />
        <Route path="*" element={<Navigate to="/config" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
