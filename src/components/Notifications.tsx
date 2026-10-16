import { useData } from '../context/DataContext';

export function Notifications() {
  const { notifications, markNotificationRead, markAllNotificationsRead } = useData();

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Notifications</h2>
          <p className="text-sm text-slate-500 mt-1">Audit log of system alerts and punch activities</p>
        </div>
        <button
          onClick={markAllNotificationsRead}
          className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl"
        >
          Mark all as read
        </button>
      </div>

      <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
        {notifications.length === 0 ? (
          <div className="p-12 text-center text-slate-400">No notifications</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {notifications.map(n => (
              <div
                key={n.id}
                onClick={() => markNotificationRead(n.id)}
                className={`p-4 flex items-start justify-between cursor-pointer transition-colors ${
                  !n.read ? 'bg-indigo-50/50 hover:bg-indigo-50' : 'hover:bg-slate-50'
                }`}
              >
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-slate-900 text-sm">{n.title}</span>
                    {!n.read && <span className="w-2 h-2 rounded-full bg-indigo-600"></span>}
                  </div>
                  <p className="text-xs text-slate-600 mt-1">{n.message}</p>
                </div>
                <span className="text-[10px] text-slate-400 font-mono">{n.time}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
