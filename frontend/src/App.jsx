import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";

import AdminLayout from "./layouts/AdminLayout";
import IPRESS from "./pages/IPRESS";
import BibliotecaVideos from "./pages/BibliotecaVideos";
import ConsultoriosAdmin from "./pages/ConsultoriosAdmin";
import MonitoresAdmin from "./pages/MonitoresAdmin";
import Configuracion from "./pages/Configuracion";
import Consultorio from "./pages/Consultorio";
import Monitor from "./pages/Monitor";

function ModuloEnDesarrollo({ titulo }) {
  return (
    <div style={{ padding: 32 }}>
      <h1>{titulo}</h1>
      <p style={{ color: "#64748b" }}>
        Este módulo está pendiente de implementación.
      </p>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={<Navigate to="/ipress" replace />}
        />

        <Route element={<AdminLayout />}>
          <Route
            path="/ipress"
            element={<IPRESS />}
          />

          <Route
            path="/videos"
            element={<BibliotecaVideos />}
          />

          <Route
            path="/ipress/:id/consultorios"
            element={<ConsultoriosAdmin />}
          />

          <Route path="/ipress/:id/monitores" element={<MonitoresAdmin />} />
          
        </Route>

        {/* Se conserva temporalmente la configuración anterior. */}
        <Route
          path="/config"
          element={<Configuracion />}
        />

        {/* La activación se integrará en cada pantalla operativa. */}
        <Route
          path="/consultorio"
          element={<Consultorio />}
        />

        <Route
          path="/monitor"
          element={<Monitor />}
        />

        <Route
          path="*"
          element={<Navigate to="/ipress" replace />}
        />
      </Routes>
    </BrowserRouter>
  );
}