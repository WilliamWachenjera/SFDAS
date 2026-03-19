import { StatusCard } from '../components/StatusCard';
import { AlertBanner } from '../components/AlertBanner';
import {
  Flame,
  Thermometer,
  Droplets,
  Shield,
  Activity,
  MapPin
} from 'lucide-react';
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';

const temperatureData = [
  { time: '00:00', temp: 22 },
  { time: '04:00', temp: 21 },
  { time: '08:00', temp: 23 },
  { time: '12:00', temp: 26 },
  { time: '16:00', temp: 28 },
  { time: '20:00', temp: 24 },
  { time: '23:59', temp: 22 },
];

const smokeData = [
  { time: '00:00', level: 12 },
  { time: '04:00', level: 10 },
  { time: '08:00', level: 15 },
  { time: '12:00', level: 18 },
  { time: '16:00', level: 45 },
  { time: '20:00', level: 20 },
  { time: '23:59', level: 14 },
];

const deviceStatusData = [
  { name: 'Online', count: 24, fill: '#10b981' },
  { name: 'Offline', count: 2, fill: '#ef4444' },
  { name: 'Maintenance', count: 1, fill: '#f59e0b' },
];

export function Dashboard() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl mb-2">Real-Time Monitoring Dashboard</h1>
        <p className="text-gray-600">Live overview of fire detection and safety systems</p>
      </div>

      {/* Active Alerts */}
      <div className="mb-6 space-y-3">
        <AlertBanner
          severity="high"
          message="High temperature detected in Sector A-3"
          location="Building A, Floor 3, Room 305"
          time="2 minutes ago"
        />
        <AlertBanner
          severity="medium"
          message="Smoke level increasing in Warehouse B"
          location="Building B, Loading Bay"
          time="15 minutes ago"
        />
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatusCard
          title="Active Alerts"
          value="2"
          icon={Flame}
          trend="Requires attention"
          color="red"
        />
        <StatusCard
          title="Devices Online"
          value="24/27"
          icon={Activity}
          trend="89% operational"
          color="green"
        />
        <StatusCard
          title="Avg. Temperature"
          value="24°C"
          icon={Thermometer}
          trend="Normal range"
          color="blue"
        />
        <StatusCard
          title="Sprinkler Status"
          value="Ready"
          icon={Droplets}
          trend="All systems armed"
          color="green"
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Temperature Chart */}
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Temperature Monitoring</h3>
            <span className="text-xs text-gray-500">Last 24 hours</span>
          </div>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={temperatureData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="time" style={{ fontSize: '12px' }} />
              <YAxis style={{ fontSize: '12px' }} />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="temp"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={{ fill: '#3b82f6' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Smoke Level Chart */}
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Smoke Detection Levels</h3>
            <span className="text-xs text-gray-500">Last 24 hours</span>
          </div>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={smokeData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="time" style={{ fontSize: '12px' }} />
              <YAxis style={{ fontSize: '12px' }} />
              <Tooltip />
              <Area
                type="monotone"
                dataKey="level"
                stroke="#f59e0b"
                fill="#fef3c7"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Map Placeholder */}
        <div className="lg:col-span-2 bg-white rounded-lg border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Live Location Map</h3>
            <MapPin className="w-5 h-5 text-gray-400" />
          </div>
          <div className="bg-gray-100 rounded-lg h-64 flex items-center justify-center relative overflow-hidden">
            {/* Map Grid Background */}
            <div className="absolute inset-0" style={{
              backgroundImage: 'linear-gradient(#ddd 1px, transparent 1px), linear-gradient(90deg, #ddd 1px, transparent 1px)',
              backgroundSize: '20px 20px'
            }}></div>

            {/* Device Markers */}
            <div className="absolute top-1/4 left-1/3 w-4 h-4 bg-green-500 rounded-full animate-pulse shadow-lg"></div>
            <div className="absolute top-1/2 left-1/2 w-4 h-4 bg-red-500 rounded-full animate-pulse shadow-lg"></div>
            <div className="absolute bottom-1/3 right-1/3 w-4 h-4 bg-green-500 rounded-full animate-pulse shadow-lg"></div>

            <div className="relative z-10 text-center">
              <MapPin className="w-12 h-12 text-gray-400 mx-auto mb-2" />
              <p className="text-sm text-gray-600">Interactive Map with Geofence</p>
              <p className="text-xs text-gray-500 mt-1">Device locations and boundaries</p>
            </div>
          </div>
        </div>

        {/* Device Status */}
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Device Status</h3>
            <Shield className="w-5 h-5 text-gray-400" />
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={deviceStatusData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="name" style={{ fontSize: '12px' }} />
              <YAxis style={{ fontSize: '12px' }} />
              <Tooltip />
              <Bar dataKey="count" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
