import { useState } from 'react';
import { FileText, Download, MapPin, Flame, Clock, Droplets } from 'lucide-react';

interface Incident {
  id: string;
  title: string;
  location: string;
  gps: string;
  severity: 'low' | 'medium' | 'high';
  date: string;
  time: string;
  temperature: number;
  smoke: number;
  sprinklerActivated: boolean;
  responseTime: string;
  status: 'resolved' | 'investigating' | 'active';
}

const incidents: Incident[] = [
  {
    id: 'INC-2026-031',
    title: 'High Temperature Alert',
    location: 'Building A, Floor 3, Room 305',
    gps: '40.7128° N, 74.0060° W',
    severity: 'high',
    date: '2026-03-26',
    time: '14:32',
    temperature: 85,
    smoke: 78,
    sprinklerActivated: true,
    responseTime: '2m 15s',
    status: 'investigating'
  },
  {
    id: 'INC-2026-030',
    title: 'Smoke Detection',
    location: 'Building B, Loading Bay',
    gps: '40.7130° N, 74.0062° W',
    severity: 'medium',
    date: '2026-03-26',
    time: '12:18',
    temperature: 42,
    smoke: 55,
    sprinklerActivated: false,
    responseTime: '3m 45s',
    status: 'resolved'
  },
  {
    id: 'INC-2026-029',
    title: 'Minor Smoke Alert',
    location: 'Building A, Floor 1, Kitchen',
    gps: '40.7132° N, 74.0064° W',
    severity: 'low',
    date: '2026-03-25',
    time: '18:45',
    temperature: 35,
    smoke: 32,
    sprinklerActivated: false,
    responseTime: '1m 30s',
    status: 'resolved'
  },
  {
    id: 'INC-2026-028',
    title: 'Critical Fire Event',
    location: 'Building C, Storage Room',
    gps: '40.7131° N, 74.0063° W',
    severity: 'high',
    date: '2026-03-24',
    time: '09:12',
    temperature: 120,
    smoke: 95,
    sprinklerActivated: true,
    responseTime: '1m 05s',
    status: 'resolved'
  },
];

export function IncidentHistory() {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const getSeverityColor = (severity: Incident['severity']) => {
    const colors = {
      low: 'bg-yellow-100 text-yellow-800 border-yellow-300',
      medium: 'bg-orange-100 text-orange-800 border-orange-300',
      high: 'bg-red-100 text-red-800 border-red-300',
    };
    return colors[severity];
  };

  const getStatusColor = (status: Incident['status']) => {
    const colors = {
      active: 'bg-red-100 text-red-800 border-red-300',
      investigating: 'bg-blue-100 text-blue-800 border-blue-300',
      resolved: 'bg-green-100 text-green-800 border-green-300',
    };
    return colors[status];
  };

  const handleExportPDF = () => {
    alert('Export PDF functionality would be implemented here');
  };

  const handleExportCSV = () => {
    alert('Export CSV functionality would be implemented here');
  };

  return (
    <div>
      <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl mb-2">Fire Incident History</h1>
          <p className="text-gray-600">Historical data and analytics of fire incidents</p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleExportPDF}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
          >
            <Download className="w-4 h-4" />
            Export PDF
          </button>
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <FileText className="w-4 h-4" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-sm text-gray-600 mb-1">Total Incidents</p>
          <p className="text-3xl font-semibold">{incidents.length}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-sm text-gray-600 mb-1">Active</p>
          <p className="text-3xl font-semibold text-red-600">
            {incidents.filter(i => i.status === 'active').length}
          </p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-sm text-gray-600 mb-1">Investigating</p>
          <p className="text-3xl font-semibold text-blue-600">
            {incidents.filter(i => i.status === 'investigating').length}
          </p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-sm text-gray-600 mb-1">Resolved</p>
          <p className="text-3xl font-semibold text-green-600">
            {incidents.filter(i => i.status === 'resolved').length}
          </p>
        </div>
      </div>

      {/* Incident List */}
      <div className="space-y-4">
        {incidents.map((incident) => (
          <div key={incident.id} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div
              className="p-5 cursor-pointer hover:bg-gray-50 transition-colors"
              onClick={() => setExpandedId(expandedId === incident.id ? null : incident.id)}
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <Flame className="w-5 h-5 text-red-600" />
                    <h3 className="font-semibold">{incident.title}</h3>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium border ${getSeverityColor(incident.severity)}`}>
                      {incident.severity.toUpperCase()}
                    </span>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(incident.status)}`}>
                      {incident.status.toUpperCase()}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <p className="text-xs text-gray-500">Incident ID</p>
                      <p className="font-medium">{incident.id}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Date & Time</p>
                      <p className="font-medium">{incident.date} {incident.time}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Location</p>
                      <p className="font-medium">{incident.location}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Response Time</p>
                      <p className="font-medium">{incident.responseTime}</p>
                    </div>
                  </div>
                </div>

                <button className="text-blue-600 hover:text-blue-700 text-sm font-medium">
                  {expandedId === incident.id ? 'Hide Details' : 'View Details'}
                </button>
              </div>
            </div>

            {/* Expanded Details */}
            {expandedId === incident.id && (
              <div className="border-t border-gray-200 p-5 bg-gray-50">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Sensor Readings */}
                  <div>
                    <h4 className="font-semibold mb-3">Sensor Readings</h4>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between p-3 bg-white rounded-lg">
                        <div className="flex items-center gap-2">
                          <Flame className="w-5 h-5 text-red-600" />
                          <span>Temperature</span>
                        </div>
                        <span className="font-semibold text-red-600">{incident.temperature}°C</span>
                      </div>
                      <div className="flex items-center justify-between p-3 bg-white rounded-lg">
                        <div className="flex items-center gap-2">
                          <Clock className="w-5 h-5 text-gray-600" />
                          <span>Smoke Level</span>
                        </div>
                        <span className="font-semibold">{incident.smoke}%</span>
                      </div>
                      <div className="flex items-center justify-between p-3 bg-white rounded-lg">
                        <div className="flex items-center gap-2">
                          <Droplets className="w-5 h-5 text-blue-600" />
                          <span>Sprinkler</span>
                        </div>
                        <span className={`font-semibold ${incident.sprinklerActivated ? 'text-green-600' : 'text-gray-600'}`}>
                          {incident.sprinklerActivated ? 'ACTIVATED' : 'Not Activated'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Location Map */}
                  <div>
                    <h4 className="font-semibold mb-3">Location</h4>
                    <div className="bg-gray-200 rounded-lg h-48 flex items-center justify-center relative overflow-hidden">
                      <div className="absolute inset-0" style={{
                        backgroundImage: 'linear-gradient(#bbb 1px, transparent 1px), linear-gradient(90deg, #bbb 1px, transparent 1px)',
                        backgroundSize: '20px 20px'
                      }}></div>
                      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 bg-red-500 rounded-full animate-pulse shadow-lg"></div>
                      <div className="relative z-10 text-center">
                        <MapPin className="w-8 h-8 text-red-600 mx-auto mb-2" />
                        <p className="text-sm font-medium">{incident.gps}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Timeline */}
                <div className="mt-6">
                  <h4 className="font-semibold mb-3">Response Timeline</h4>
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 bg-red-600 rounded-full"></div>
                      <span className="text-sm">Alert triggered - {incident.time}</span>
                    </div>
                    <div className="flex items-center gap-3 ml-1">
                      <div className="w-0.5 h-4 bg-gray-300"></div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 bg-blue-600 rounded-full"></div>
                      <span className="text-sm">System notification sent</span>
                    </div>
                    {incident.sprinklerActivated && (
                      <>
                        <div className="flex items-center gap-3 ml-1">
                          <div className="w-0.5 h-4 bg-gray-300"></div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="w-2 h-2 bg-green-600 rounded-full"></div>
                          <span className="text-sm">Sprinkler system activated</span>
                        </div>
                      </>
                    )}
                    <div className="flex items-center gap-3 ml-1">
                      <div className="w-0.5 h-4 bg-gray-300"></div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 bg-gray-400 rounded-full"></div>
                      <span className="text-sm">Response completed - {incident.responseTime}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
