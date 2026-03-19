import { AlertTriangle, X } from 'lucide-react';
import { useState } from 'react';

interface AlertBannerProps {
  severity: 'low' | 'medium' | 'high';
  message: string;
  location: string;
  time: string;
}

export function AlertBanner({ severity, message, location, time }: AlertBannerProps) {
  const [visible, setVisible] = useState(true);

  if (!visible) return null;

  const severityColors = {
    low: 'bg-yellow-50 border-yellow-300 text-yellow-900',
    medium: 'bg-orange-50 border-orange-300 text-orange-900',
    high: 'bg-red-50 border-red-300 text-red-900',
  };

  const severityLabels = {
    low: 'Low Priority',
    medium: 'Medium Priority',
    high: 'HIGH PRIORITY',
  };

  return (
    <div className={`rounded-lg border-2 p-4 ${severityColors[severity]} flex items-start gap-4`}>
      <AlertTriangle className={`w-6 h-6 flex-shrink-0 mt-1 ${severity === 'high' ? 'animate-pulse' : ''}`} />
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-semibold">{severityLabels[severity]}</span>
          <span className="text-xs opacity-75">{time}</span>
        </div>
        <p className="font-medium mb-1">{message}</p>
        <p className="text-sm opacity-75">{location}</p>
      </div>
      <button
        onClick={() => setVisible(false)}
        className="p-1 hover:bg-black/5 rounded transition-colors"
      >
        <X className="w-5 h-5" />
      </button>
    </div>
  );
}
