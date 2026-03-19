import { Shield, Wifi, Droplets, Bell, Smartphone, Cloud, Flame, MapPin } from 'lucide-react';

export function About() {
  const features = [
    {
      icon: Flame,
      title: 'Real-time Fire Detection',
      description: 'Advanced IoT sensors continuously monitor temperature and smoke levels'
    },
    {
      icon: Bell,
      title: 'Instant Alerts',
      description: 'Immediate notifications sent to all stakeholders via multiple channels'
    },
    {
      icon: Droplets,
      title: 'Auto Suppression',
      description: 'Automated sprinkler system activation based on threshold levels'
    },
    {
      icon: MapPin,
      title: 'GPS Tracking',
      description: 'Precise location tracking with geofence boundary monitoring'
    },
    {
      icon: Smartphone,
      title: 'Mobile Access',
      description: 'Monitor and control the system from anywhere via mobile app'
    },
    {
      icon: Cloud,
      title: 'Cloud Integration',
      description: 'Secure cloud storage for data analytics and historical records'
    },
  ];

  const technologies = [
    { category: 'Hardware', items: ['IoT Sensors', 'Temperature Sensors', 'Smoke Detectors', 'GPS Modules', 'Sprinkler Controllers'] },
    { category: 'Software', items: ['React', 'Node.js', 'MongoDB', 'Firebase', 'Tailwind CSS'] },
    { category: 'Connectivity', items: ['WiFi', 'MQTT Protocol', 'REST APIs', 'WebSocket', 'Cloud Services'] },
  ];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl mb-2">About the Project</h1>
        <p className="text-gray-600">Smart Fire Detection, Alerting and Automated Suppression System</p>
      </div>

      {/* Project Overview */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 bg-red-600 rounded-lg flex items-center justify-center flex-shrink-0">
            <Shield className="w-8 h-8 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-semibold mb-3">Project Overview</h2>
            <p className="text-gray-700 leading-relaxed mb-3">
              Our Smart Fire Detection, Alerting and Automated Suppression System is an innovative IoT-based safety solution
              designed to protect lives and property through intelligent monitoring and rapid response capabilities.
            </p>
            <p className="text-gray-700 leading-relaxed mb-3">
              The system combines advanced sensor technology with cloud-based analytics to provide real-time fire detection,
              instant alerting, and automated suppression mechanisms. By leveraging GPS tracking and geofence management,
              the system ensures comprehensive coverage and precise incident localization.
            </p>
            <p className="text-gray-700 leading-relaxed">
              This project represents a significant advancement in fire safety technology, offering a scalable, reliable,
              and intelligent solution for residential, commercial, and industrial applications.
            </p>
          </div>
        </div>
      </div>

      {/* System Capabilities */}
      <div className="mb-6">
        <h2 className="text-xl font-semibold mb-4">System Capabilities</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <div key={index} className="bg-white rounded-lg border border-gray-200 p-5 hover:shadow-md transition-shadow">
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-3">
                  <Icon className="w-6 h-6 text-blue-600" />
                </div>
                <h3 className="font-semibold mb-2">{feature.title}</h3>
                <p className="text-sm text-gray-600">{feature.description}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Technologies Used */}
      <div className="mb-6">
        <h2 className="text-xl font-semibold mb-4">Technologies Used</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {technologies.map((tech, index) => (
            <div key={index} className="bg-white rounded-lg border border-gray-200 p-5">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                {tech.category === 'Hardware' && <Wifi className="w-5 h-5 text-red-600" />}
                {tech.category === 'Software' && <Cloud className="w-5 h-5 text-blue-600" />}
                {tech.category === 'Connectivity' && <Smartphone className="w-5 h-5 text-green-600" />}
                {tech.category}
              </h3>
              <ul className="space-y-2">
                {tech.items.map((item, idx) => (
                  <li key={idx} className="text-sm text-gray-700 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full"></span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* Project Goals */}
      <div className="bg-gradient-to-r from-red-50 to-orange-50 rounded-lg border border-red-200 p-6">
        <h2 className="text-xl font-semibold mb-4">Project Goals</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <h3 className="font-semibold mb-2 text-red-900">Primary Objectives</h3>
            <ul className="space-y-2 text-sm text-red-800">
              <li className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 bg-red-600 rounded-full mt-1.5"></span>
                <span>Minimize response time to fire incidents</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 bg-red-600 rounded-full mt-1.5"></span>
                <span>Reduce property damage and loss of life</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 bg-red-600 rounded-full mt-1.5"></span>
                <span>Provide comprehensive monitoring coverage</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 bg-red-600 rounded-full mt-1.5"></span>
                <span>Enable remote monitoring and control</span>
              </li>
            </ul>
          </div>
          <div>
            <h3 className="font-semibold mb-2 text-red-900">Technical Achievements</h3>
            <ul className="space-y-2 text-sm text-red-800">
              <li className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 bg-red-600 rounded-full mt-1.5"></span>
                <span>Real-time data processing and analytics</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 bg-red-600 rounded-full mt-1.5"></span>
                <span>Scalable cloud-based architecture</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 bg-red-600 rounded-full mt-1.5"></span>
                <span>Automated suppression system integration</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 bg-red-600 rounded-full mt-1.5"></span>
                <span>Advanced geofencing capabilities</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
