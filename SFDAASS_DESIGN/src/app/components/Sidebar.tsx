import { Link, useLocation } from 'react-router';
import {
  LayoutDashboard,
  Radio,
  AlertTriangle,
  MapPin,
  Info,
  Users,
  Mail,
  Flame
} from 'lucide-react';

const menuItems = [
  { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { path: '/devices', icon: Radio, label: 'Device Monitoring' },
  { path: '/incidents', icon: AlertTriangle, label: 'Incident History' },
  { path: '/geofence', icon: MapPin, label: 'Geofence' },
  { path: '/about', icon: Info, label: 'About' },
  { path: '/team', icon: Users, label: 'Our Team' },
  { path: '/contact', icon: Mail, label: 'Contact' },
];

export function Sidebar() {
  const location = useLocation();

  return (
    <aside className="w-64 bg-[#1a1d29] text-white h-screen fixed left-0 top-0 flex flex-col">
      <div className="p-6 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-red-600 rounded-lg flex items-center justify-center">
            <Flame className="w-6 h-6" />
          </div>
          <div>
            <div className="font-semibold">Fire Safety</div>
            <div className="text-xs text-gray-400">Monitoring System</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-4">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;

          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg mb-1 transition-colors ${
                isActive
                  ? 'bg-red-600 text-white'
                  : 'text-gray-300 hover:bg-gray-800'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-gray-700">
        <div className="text-xs text-gray-500">Version 1.0.0</div>
      </div>
    </aside>
  );
}
