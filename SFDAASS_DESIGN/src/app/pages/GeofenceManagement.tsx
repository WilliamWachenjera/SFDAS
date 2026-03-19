import { useState } from 'react';
import { MapPin, Square, Circle, Save, Edit2, Trash2 } from 'lucide-react';

interface Geofence {
  id: string;
  name: string;
  type: 'polygon' | 'radius';
  area: string;
  devices: number;
  status: 'active' | 'inactive';
}

const geofences: Geofence[] = [
  {
    id: 'GEO-001',
    name: 'Building A Perimeter',
    type: 'polygon',
    area: '5,000 sq m',
    devices: 12,
    status: 'active'
  },
  {
    id: 'GEO-002',
    name: 'Warehouse Zone',
    type: 'radius',
    area: '500m radius',
    devices: 8,
    status: 'active'
  },
  {
    id: 'GEO-003',
    name: 'Parking Lot',
    type: 'polygon',
    area: '2,500 sq m',
    devices: 5,
    status: 'inactive'
  },
];

export function GeofenceManagement() {
  const [drawMode, setDrawMode] = useState<'polygon' | 'radius' | null>(null);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl mb-2">Geofence Management</h1>
        <p className="text-gray-600">Define and manage geographical boundaries for monitoring</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Map Area */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-lg border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">Interactive Map</h3>
              <div className="flex gap-2">
                <button
                  onClick={() => setDrawMode('polygon')}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
                    drawMode === 'polygon'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  <Square className="w-4 h-4" />
                  Polygon
                </button>
                <button
                  onClick={() => setDrawMode('radius')}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
                    drawMode === 'radius'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  <Circle className="w-4 h-4" />
                  Radius
                </button>
              </div>
            </div>

            {/* Map Canvas */}
            <div className="bg-gray-100 rounded-lg h-96 relative overflow-hidden">
              {/* Grid Background */}
              <div className="absolute inset-0" style={{
                backgroundImage: 'linear-gradient(#ddd 1px, transparent 1px), linear-gradient(90deg, #ddd 1px, transparent 1px)',
                backgroundSize: '20px 20px'
              }}></div>

              {/* Polygon Geofence */}
              <svg className="absolute inset-0 w-full h-full">
                <polygon
                  points="100,100 300,80 320,250 150,280"
                  fill="rgba(59, 130, 246, 0.2)"
                  stroke="#3b82f6"
                  strokeWidth="2"
                />
                <circle cx="100" cy="100" r="4" fill="#3b82f6" />
                <circle cx="300" cy="80" r="4" fill="#3b82f6" />
                <circle cx="320" cy="250" r="4" fill="#3b82f6" />
                <circle cx="150" cy="280" r="4" fill="#3b82f6" />

                {/* Radius Geofence */}
                <circle
                  cx="500"
                  cy="200"
                  r="80"
                  fill="rgba(16, 185, 129, 0.2)"
                  stroke="#10b981"
                  strokeWidth="2"
                />
                <circle cx="500" cy="200" r="4" fill="#10b981" />
              </svg>

              {/* Device Markers */}
              <div className="absolute top-[120px] left-[150px] w-3 h-3 bg-red-500 rounded-full shadow-lg"></div>
              <div className="absolute top-[180px] left-[250px] w-3 h-3 bg-green-500 rounded-full shadow-lg"></div>
              <div className="absolute top-[200px] left-[500px] w-3 h-3 bg-green-500 rounded-full shadow-lg"></div>

              <div className="relative z-10 flex items-center justify-center h-full">
                {drawMode && (
                  <div className="bg-white rounded-lg shadow-lg p-4 text-center">
                    <p className="text-sm font-medium mb-2">
                      {drawMode === 'polygon' ? 'Click to add polygon points' : 'Click to set center and drag to define radius'}
                    </p>
                    <button
                      onClick={() => setDrawMode(null)}
                      className="text-xs text-blue-600 hover:text-blue-700"
                    >
                      Cancel Drawing
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Controls */}
            <div className="mt-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 text-sm">
                  <div className="w-4 h-4 rounded-full bg-green-500"></div>
                  <span>Devices Inside</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <div className="w-4 h-4 rounded-full bg-red-500"></div>
                  <span>Devices Outside</span>
                </div>
              </div>

              <button className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors">
                <Save className="w-4 h-4" />
                Save Changes
              </button>
            </div>
          </div>
        </div>

        {/* Geofence List */}
        <div>
          <div className="bg-white rounded-lg border border-gray-200 p-5">
            <h3 className="font-semibold mb-4">Existing Geofences</h3>

            <div className="space-y-3">
              {geofences.map((fence) => (
                <div key={fence.id} className="p-4 border border-gray-200 rounded-lg hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {fence.type === 'polygon' ? (
                        <Square className="w-4 h-4 text-blue-600" />
                      ) : (
                        <Circle className="w-4 h-4 text-green-600" />
                      )}
                      <h4 className="font-medium text-sm">{fence.name}</h4>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      fence.status === 'active'
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-800'
                    }`}>
                      {fence.status}
                    </span>
                  </div>

                  <div className="space-y-1 text-xs text-gray-600 mb-3">
                    <p>ID: {fence.id}</p>
                    <p>Area: {fence.area}</p>
                    <p>Devices: {fence.devices}</p>
                  </div>

                  <div className="flex gap-2">
                    <button className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 bg-blue-50 text-blue-700 rounded hover:bg-blue-100 transition-colors text-xs">
                      <Edit2 className="w-3 h-3" />
                      Edit
                    </button>
                    <button className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 bg-red-50 text-red-700 rounded hover:bg-red-100 transition-colors text-xs">
                      <Trash2 className="w-3 h-3" />
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Instructions */}
          <div className="bg-blue-50 rounded-lg border border-blue-200 p-4 mt-4">
            <h4 className="font-semibold text-sm text-blue-900 mb-2">How to use</h4>
            <ul className="space-y-1 text-xs text-blue-800">
              <li>• Click Polygon to draw multi-point boundaries</li>
              <li>• Click Radius to create circular zones</li>
              <li>• Drag points to adjust boundaries</li>
              <li>• Click Save to apply changes</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
