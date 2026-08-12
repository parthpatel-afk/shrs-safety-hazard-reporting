import { Routes, Route, Navigate } from 'react-router-dom'
import Home from './pages/Home.jsx'
import LocationContext from './pages/LocationContext.jsx'
import HazardCapture from './pages/HazardCapture.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Register from './pages/Register.jsx'
import Onboard from './pages/Onboard.jsx'

export default function App() {
  return (
    <Routes>
      {/* Home page */}
      <Route path="/:companySlug" element={<Home />} />

      {/* Employee report flow */}
      <Route path="/report/:companySlug"        element={<LocationContext />} />
      <Route path="/report/:companySlug/submit" element={<HazardCapture />} />

      {/* Safety team */}
      <Route path="/admin/:companySlug"    element={<Dashboard />} />
      <Route path="/register/:companySlug" element={<Register />} />
      <Route path="/onboard"               element={<Onboard />} />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/autorise" replace />} />
    </Routes>
  )
}
