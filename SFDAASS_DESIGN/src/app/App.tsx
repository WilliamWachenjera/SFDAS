import { BrowserRouter, Routes, Route } from 'react-router';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { Dashboard } from './pages/Dashboard';
import { DeviceMonitoring } from './pages/DeviceMonitoring';
import { IncidentHistory } from './pages/IncidentHistory';
import { GeofenceManagement } from './pages/GeofenceManagement';
import { About } from './pages/About';
import { Team } from './pages/Team';
import { Contact } from './pages/Contact';

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-50">
        <Sidebar />
        <Header />
        <main className="ml-64 mt-16 p-6">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/devices" element={<DeviceMonitoring />} />
            <Route path="/incidents" element={<IncidentHistory />} />
            <Route path="/geofence" element={<GeofenceManagement />} />
            <Route path="/about" element={<About />} />
            <Route path="/team" element={<Team />} />
            <Route path="/contact" element={<Contact />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
