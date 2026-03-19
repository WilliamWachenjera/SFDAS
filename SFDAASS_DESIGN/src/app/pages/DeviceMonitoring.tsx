import { useState } from 'react';
import { Search, Filter, Activity, AlertCircle, MapPin } from 'lucide-react';

interface Device {
  id: string;
  name: string;
  location: string;
  gps: string;
  geofence: 'inside' | 'outside';
  temperature: number;
  smoke: number;
  status: 'online' | 'offline' | 'warning';
  lastSeen: string;
}

const devices: Device[] = [
  {
    id: 'DEV-001',
    name: 'Sensor Node Alpha',
    location: 'Building A - Floor 3',
    gps: '40.7128° N, 74.0060° W',
    geofence: 'inside',
    temperature: 28,
    smoke: 45,
    status: 'warning',
    lastSeen: '2 min ago'
  },
  {
    id: 'DEV-002',
    name: 'Sensor Node Beta',
    location: 'Building A - Floor 2',
    gps: '40.7129° N, 74.0061° W',
    geofence: 'inside',
    temperature: 22,
    smoke: 12,
    status: 'online',
    lastSeen: '1 min ago'
  },
  {
    id: 'DEV-003',
    name: 'Sensor Node Gamma',
    location: 'Building B - Warehouse',
    gps: '40.7130° N, 74.0062° W',
    geofence: 'inside',
    temperature: 24,
    smoke: 18,
    status: 'online',
    lastSeen: '30 sec ago'
  },
  {
    id: 'DEV-004',
    name: 'Sensor Node Delta',
    location: 'Building C - Lobby',
    gps: '40.7131° N, 74.0063° W',
    geofence: 'outside',
    temperature: 21,
    smoke: 8,
    status: 'offline',
    lastSeen: '2 hours ago'
  },
  {
    id: 'DEV-005',
    name: 'Sensor Node Epsilon',
    location: 'Building A - Floor 1',
    gps: '40.7132° N, 74.0064° W',
    geofence: 'inside',
    temperature: 23,
    smoke: 10,
    status: 'online',
    lastSeen: '45 sec ago'
  },
];

export function DeviceMonitoring() {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const filteredDevices = devices.filter(device => {
    const matchesSearch = device.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         device.id.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || device.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const getStatusBadge = (status: Device['status']) => {
    const styles = {
      online: 'bg-green-100 text-green-800 border-green-200',
      offline: 'bg-gray-100 text-gray-800 border-gray-200',
      warning: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    };

    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium border ${styles[status]}`}>
        {status.toUpperCase()}
      </span>
    );
  };

  const getGeofenceBadge = (geofence: Device['geofence']) => {
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium border ${
        geofence === 'inside'
          ? 'bg-blue-100 text-blue-800 border-blue-200'
          : 'bg-red-100 text-red-800 border-red-200'
      }`}>
        {geofence.toUpperCase()}
      </span>
    );
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl mb-2">Device Monitoring</h1>
        <p className="text-gray-600">Real-time device status and sensor readings</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search by device ID or name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                statusFilter === 'all'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setStatusFilter('online')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                statusFilter === 'online'
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Online
            </button>
            <button
              onClick={() => setStatusFilter('offline')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                statusFilter === 'offline'
                  ? 'bg-gray-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Offline
            </button>
            <button
              onClick={() => setStatusFilter('warning')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                statusFilter === 'warning'
                  ? 'bg-yellow-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Warning
            </button>
          </div>
        </div>
      </div>

      {/* Device Cards */}
      <div className="grid grid-cols-1 gap-4">
        {filteredDevices.map((device) => (
          <div key={device.id} className="bg-white rounded-lg border border-gray-200 p-5 hover:shadow-md transition-shadow">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              {/* Device Info */}
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <Activity className={`w-5 h-5 ${
                    device.status === 'online' ? 'text-green-600' :
                    device.status === 'warning' ? 'text-yellow-600' :
                    'text-gray-400'
                  }`} />
                  <h3 className="font-semibold">{device.name}</h3>
                  {getStatusBadge(device.status)}
                  {getGeofenceBadge(device.geofence)}
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-3">
                  <div>
                    <p className="text-xs text-gray-500">Device ID</p>
                    <p className="text-sm font-medium">{device.id}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Location</p>
                    <p className="text-sm font-medium">{device.location}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">GPS Coordinates</p>
                    <p className="text-sm font-medium">{device.gps}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Last Seen</p>
                    <p className="text-sm font-medium">{device.lastSeen}</p>
                  </div>
                </div>
              </div>

              {/* Sensor Readings */}
              <div className="flex gap-4 md:border-l md:pl-6">
                <div className="text-center">
                  <p className="text-xs text-gray-500 mb-1">Temperature</p>
                  <p className={`text-2xl font-semibold ${
                    device.temperature > 25 ? 'text-red-600' : 'text-blue-600'
                  }`}>
                    {device.temperature}°C
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-gray-500 mb-1">Smoke Level</p>
                  <p className={`text-2xl font-semibold ${
                    device.smoke > 30 ? 'text-red-600' : 'text-green-600'
                  }`}>
                    {device.smoke}
                  </p>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {filteredDevices.length === 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-3" />
          <p className="text-gray-600">No devices found matching your filters</p>
        </div>
      )}
    </div>
  );
}
