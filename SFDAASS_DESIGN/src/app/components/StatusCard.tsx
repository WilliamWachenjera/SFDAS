import { LucideIcon } from 'lucide-react';

interface StatusCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: string;
  color: 'red' | 'green' | 'blue' | 'yellow';
}

const colorClasses = {
  red: 'bg-red-50 text-red-600 border-red-200',
  green: 'bg-green-50 text-green-600 border-green-200',
  blue: 'bg-blue-50 text-blue-600 border-blue-200',
  yellow: 'bg-yellow-50 text-yellow-600 border-yellow-200',
};

const iconBgClasses = {
  red: 'bg-red-600',
  green: 'bg-green-600',
  blue: 'bg-blue-600',
  yellow: 'bg-yellow-600',
};

export function StatusCard({ title, value, icon: Icon, trend, color }: StatusCardProps) {
  return (
    <div className={`rounded-lg border ${colorClasses[color]} p-5`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-600 mb-1">{title}</p>
          <p className="text-3xl font-semibold mb-1">{value}</p>
          {trend && <p className="text-xs text-gray-500">{trend}</p>}
        </div>
        <div className={`w-12 h-12 ${iconBgClasses[color]} rounded-lg flex items-center justify-center`}>
          <Icon className="w-6 h-6 text-white" />
        </div>
      </div>
    </div>
  );
}
