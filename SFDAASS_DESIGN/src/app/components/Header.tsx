import { Bell, User, Activity } from 'lucide-react';
import { useState } from 'react';

export function Header() {
  const [hasAlerts] = useState(true);

  return (
    <header className="h-16 bg-white border-b border-gray-200 fixed top-0 right-0 left-64 z-10 flex items-center justify-between px-6">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-green-600" />
          <span className="text-sm font-medium">System Online</span>
          <span className="inline-flex items-center justify-center w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <button className="relative p-2 rounded-lg hover:bg-gray-100 transition-colors">
          <Bell className="w-5 h-5 text-gray-600" />
          {hasAlerts && (
            <span className="absolute top-1 right-1 w-2 h-2 bg-red-600 rounded-full"></span>
          )}
        </button>

        <div className="flex items-center gap-3 pl-4 border-l border-gray-200">
          <div className="text-right">
            <div className="text-sm font-medium">Admin User</div>
            <div className="text-xs text-gray-500">Administrator</div>
          </div>
          <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center">
            <User className="w-5 h-5 text-white" />
          </div>
        </div>
      </div>
    </header>
  );
}
