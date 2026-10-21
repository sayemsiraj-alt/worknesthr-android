import { useData } from '../context/DataContext';
import { Avatar } from './Avatar';

export function MyProfile() {
  const { currentUser } = useData();

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold text-slate-800">My Profile</h2>
        <p className="text-sm text-slate-500 mt-1">Admin user profile and security credentials</p>
      </div>

      <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-200 space-y-6">
        <div className="flex items-center space-x-4">
          <Avatar
            avatar={currentUser?.avatar}
            name={currentUser?.name}
            sizeClass="w-16 h-16"
            textClass="text-2xl font-bold"
            roundedClass="rounded-2xl"
          />
          <div>
            <h3 className="text-xl font-bold text-slate-900">{currentUser?.name || 'Administrator'}</h3>
            <p className="text-xs text-slate-500">{currentUser?.email} • Role: {currentUser?.role}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm border-t border-slate-100 pt-6">
          <div className="p-4 bg-slate-50 rounded-2xl">
            <span className="text-xs text-slate-400 block font-bold uppercase">System Role</span>
            <span className="text-slate-800 font-semibold">{currentUser?.role || 'Super Admin'}</span>
          </div>
          <div className="p-4 bg-slate-50 rounded-2xl">
            <span className="text-xs text-slate-400 block font-bold uppercase">Auth Provider</span>
            <span className="text-emerald-700 font-semibold">Firebase Authentication</span>
          </div>
          <div className="p-4 bg-slate-50 rounded-2xl">
            <span className="text-xs text-slate-400 block font-bold uppercase">Default Login Email</span>
            <span className="font-mono text-slate-800">sayemsiraj@gmail.com</span>
          </div>
          <div className="p-4 bg-slate-50 rounded-2xl">
            <span className="text-xs text-slate-400 block font-bold uppercase">Access Status</span>
            <span className="text-emerald-600 font-bold">Full Database &amp; Config Access</span>
          </div>
        </div>
      </div>
    </div>
  );
}
