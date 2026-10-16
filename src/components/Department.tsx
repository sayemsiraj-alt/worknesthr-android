import { useState, useEffect } from 'react';
import { useData, Department as Dept } from '../context/DataContext';
import {
  COLOR_KEYS,
  THEME_PALETTES,
  ThemeColorKey,
  getDepartmentTheme,
} from '../utils/themeColors';

export function Department() {
  const { departments, employees, addDepartment, updateDepartment, deleteDepartment, addNotification } = useData();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Dept | null>(null);
  const [search, setSearch] = useState(() => {
    try {
      const q = sessionStorage.getItem('worknest_global_search_query');
      if (q) {
        sessionStorage.removeItem('worknest_global_search_query');
        return q;
      }
    } catch {}
    return '';
  });

  useEffect(() => {
    const handleGlobalSearch = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      if (detail?.query !== undefined) {
        setSearch(String(detail.query));
      }
    };
    window.addEventListener('worknest-global-search', handleGlobalSearch);
    return () => window.removeEventListener('worknest-global-search', handleGlobalSearch);
  }, []);
  const [formData, setFormData] = useState<{
    name: string;
    code: string;
    head: string;
    employeeCount: number;
    description: string;
    status: 'active' | 'inactive';
    color: ThemeColorKey;
  }>({
    name: '',
    code: '',
    head: '',
    employeeCount: 0,
    description: '',
    status: 'active',
    color: 'indigo',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editing) {
      await updateDepartment(editing.id, formData);
      addNotification({
        title: 'Department Updated & Synced',
        message: `${formData.name} saved to Firestore collection "departments"`,
        read: false,
        type: 'system',
        targetPage: 'department',
      });
    } else {
      await addDepartment(formData);
      addNotification({
        title: 'New Department Created in Firestore',
        message: `${formData.name} saved directly to Firestore collection "departments"`,
        read: false,
        type: 'system',
        targetPage: 'department',
      });
    }
    setShowForm(false);
    setEditing(null);
    setFormData({
      name: '',
      code: '',
      head: '',
      employeeCount: 0,
      description: '',
      status: 'active',
      color: 'indigo',
    });
  };

  const handleEdit = (d: Dept, index: number) => {
    setEditing(d);
    const existingTheme = (d.color && d.color in THEME_PALETTES)
      ? (d.color as ThemeColorKey)
      : getDepartmentTheme(d, index).key;

    setFormData({
      name: d.name,
      code: d.code,
      head: d.head,
      employeeCount: d.employeeCount,
      description: d.description,
      status: d.status,
      color: existingTheme,
    });
    setShowForm(true);
  };

  const handleDelete = async (id: string, name: string) => {
    if (confirm(`Delete department "${name}" from Software and Firestore?`)) {
      await deleteDepartment(id);
      addNotification({
        title: 'Department Deleted',
        message: `${name} removed from Firestore.`,
        read: false,
        type: 'system',
        targetPage: 'department',
      });
    }
  };

  const filtered = departments.filter(
    d =>
      d.name.toLowerCase().includes(search.toLowerCase()) ||
      d.code.toLowerCase().includes(search.toLowerCase()) ||
      (d.head && d.head.toLowerCase().includes(search.toLowerCase()))
  );

  const getDeptEmployeeCount = (d: Dept) => {
    const dName = (d.name || '').trim().toLowerCase();
    const dCode = (d.code || '').trim().toLowerCase();
    const prefix = dName.slice(0, 8);
    return employees.filter(e => {
      const eDept = (e.department || '').trim().toLowerCase();
      if (!eDept) return false;
      return (
        eDept === dName ||
        (dCode && eDept === dCode) ||
        (prefix.length >= 5 && eDept.startsWith(prefix))
      );
    }).length;
  };

  const totalEmployees = employees.length;
  const activeCount = departments.filter(d => d.status === 'active').length;

  const currentModalTheme = THEME_PALETTES[formData.color] || THEME_PALETTES.indigo;

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Header section with Stats Summary */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="text-2xl">🏢</span>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-800">Department Management</h2>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Create, color-code and organize company departments with custom visual themes
          </p>
        </div>
        <button
          onClick={() => {
            setShowForm(true);
            setEditing(null);
            // Default next color based on total count
            const nextKey = COLOR_KEYS[departments.length % COLOR_KEYS.length];
            setFormData({
              name: '',
              code: '',
              head: '',
              employeeCount: 0,
              description: '',
              status: 'active',
              color: nextKey,
            });
          }}
          className="self-start sm:self-auto px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-xl hover:from-indigo-700 hover:to-violet-700 flex items-center space-x-2 text-xs sm:text-sm font-semibold cursor-pointer shadow-md shadow-indigo-500/20 active:scale-95 transition-all"
        >
          <span>➕</span>
          <span>Add Department</span>
        </button>
      </div>

      {/* Mini KPI banner */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl p-3.5 border border-slate-200/80 shadow-2xs">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Total Departments</p>
          <p className="text-xl font-bold text-slate-800 mt-0.5">{departments.length}</p>
        </div>
        <div className="bg-white rounded-xl p-3.5 border border-slate-200/80 shadow-2xs">
          <p className="text-[11px] font-semibold text-emerald-600 uppercase tracking-wider">Active Units</p>
          <p className="text-xl font-bold text-emerald-700 mt-0.5">{activeCount}</p>
        </div>
        <div className="bg-white rounded-xl p-3.5 border border-slate-200/80 shadow-2xs">
          <p className="text-[11px] font-semibold text-indigo-600 uppercase tracking-wider">Total Assigned Staff</p>
          <p className="text-xl font-bold text-indigo-700 mt-0.5">{totalEmployees}</p>
        </div>
        <div className="bg-white rounded-xl p-3.5 border border-slate-200/80 shadow-2xs">
          <p className="text-[11px] font-semibold text-purple-600 uppercase tracking-wider">Palette Themes</p>
          <div className="flex items-center space-x-1 mt-1.5">
            {COLOR_KEYS.slice(0, 7).map(k => (
              <span
                key={k}
                className="w-3 h-3 rounded-full border border-white shadow-2xs"
                style={{ backgroundColor: THEME_PALETTES[k].dotColor }}
                title={THEME_PALETTES[k].label}
              />
            ))}
            <span className="text-[10px] text-slate-400 font-bold ml-1">+{COLOR_KEYS.length - 7}</span>
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div className="bg-white rounded-2xl p-3.5 shadow-2xs border border-slate-200 flex items-center space-x-3">
        <span className="text-slate-400 text-sm pl-1">🔍</span>
        <input
          type="text"
          placeholder="Search by department name, code, or department head..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full bg-transparent text-sm text-slate-800 placeholder-slate-400 focus:outline-none font-medium"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="text-slate-400 hover:text-slate-600 text-xs px-2 py-1 cursor-pointer font-bold"
          >
            ✕
          </button>
        )}
      </div>

      {/* Department Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filtered.map((d, index) => {
          const theme = getDepartmentTheme(d, index);

          return (
            <div
              key={d.id}
              className={`relative bg-white rounded-2xl p-5 shadow-xs border ${theme.borderColor} ${theme.borderHover} ${theme.bgCard} hover:shadow-xl transition-all duration-200 flex flex-col justify-between overflow-hidden group`}
            >
              {/* Top Accent Gradient Bar */}
              <div className={`absolute top-0 left-0 right-0 h-1.5 ${theme.accentBar}`} />

              <div>
                {/* Header row: Avatar Badge + Title + Status */}
                <div className="flex items-start justify-between mb-3.5 pt-1">
                  <div className="flex items-center space-x-3.5 min-w-0">
                    <div
                      className={`w-13 h-13 rounded-2xl bg-gradient-to-br ${theme.gradient} flex items-center justify-center text-white font-black text-sm tracking-wider shadow-md ${theme.shadow} shrink-0 group-hover:scale-105 transition-transform`}
                    >
                      {d.code}
                    </div>
                    <div className="min-w-0">
                      <h3 className={`font-bold text-[15px] sm:text-base ${theme.textTitle} truncate tracking-tight`} title={d.name}>
                        {d.name}
                      </h3>
                      <p className={`text-xs font-semibold ${theme.textAccent} mt-0.5`}>
                        Code: <span className="font-bold uppercase tracking-wider">{d.code}</span>
                      </p>
                    </div>
                  </div>

                  {/* Status Pill */}
                  <span
                    className={`text-[11px] font-bold px-2.5 py-1 rounded-full border flex items-center space-x-1.5 shrink-0 ${
                      d.status === 'active'
                        ? `${theme.badgeBg} ${theme.badgeText} ${theme.badgeBorder}`
                        : 'bg-slate-100 text-slate-500 border-slate-200'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        d.status === 'active' ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'
                      }`}
                    />
                    <span className="capitalize">{d.status}</span>
                  </span>
                </div>

                {/* Description */}
                {d.description ? (
                  <p className="text-xs text-slate-600 mb-3.5 line-clamp-2 leading-relaxed font-normal">
                    {d.description}
                  </p>
                ) : (
                  <p className="text-xs text-slate-400 italic mb-3.5">No department description provided.</p>
                )}

                {/* Themed Stat Boxes */}
                <div className="grid grid-cols-2 gap-2.5 mb-4">
                  <div className={`p-2.5 rounded-xl border ${theme.statBoxBg} ${theme.statBoxBorder}`}>
                    <p className={`text-[10px] font-bold uppercase tracking-wider ${theme.statBoxLabel}`}>
                      Department Head
                    </p>
                    <p className={`text-xs font-bold ${theme.statBoxValue} truncate mt-0.5`} title={d.head || 'Not Assigned'}>
                      👤 {d.head || 'Not Assigned'}
                    </p>
                  </div>
                  <div className={`p-2.5 rounded-xl border ${theme.statBoxBg} ${theme.statBoxBorder}`}>
                    <p className={`text-[10px] font-bold uppercase tracking-wider ${theme.statBoxLabel}`}>
                      Employees
                    </p>
                    <p className={`text-xs font-bold ${theme.statBoxValue} truncate mt-0.5`}>
                      {(() => {
                        const liveCount = getDeptEmployeeCount(d);
                        return `👥 ${liveCount} ${liveCount === 1 ? 'Person' : 'People'}`;
                      })()}
                    </p>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center space-x-2 pt-3 border-t border-slate-200/60 mt-auto">
                <button
                  onClick={() => handleEdit(d, index)}
                  className="flex-1 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-xl transition-all flex items-center justify-center space-x-1.5 shadow-2xs hover:shadow-xs cursor-pointer"
                >
                  <span>✏️</span>
                  <span>Edit</span>
                </button>
                <button
                  onClick={() => handleDelete(d.id, d.name)}
                  className="px-3 py-2 text-xs font-semibold text-rose-600 bg-white hover:bg-rose-50 border border-rose-200 hover:border-rose-300 rounded-xl transition-all shadow-2xs hover:shadow-xs cursor-pointer"
                  title="Delete department"
                >
                  <span>🗑️</span>
                </button>
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="col-span-full bg-white rounded-2xl p-12 text-center border border-slate-200 text-slate-500">
            <span className="text-4xl block mb-2">🏢</span>
            <p className="font-semibold text-slate-700">No departments found</p>
            <p className="text-xs text-slate-400 mt-1">Try adjusting your search criteria or add a new department.</p>
          </div>
        )}
      </div>

      {/* Add / Edit Modal with Interactive Color Swatches and Live Preview */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl w-full max-w-lg p-6 shadow-2xl border border-slate-100 animate-slide-down my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center space-x-2.5">
                <div className={`w-8 h-8 rounded-xl bg-gradient-to-br ${currentModalTheme.gradient} flex items-center justify-center text-white text-xs font-bold shadow-xs`}>
                  {formData.code || 'DP'}
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">{editing ? 'Edit' : 'Add New'} Department</h3>
                  <p className="text-xs text-slate-500">Assign a distinctive color theme and team head</p>
                </div>
              </div>
              <button
                onClick={() => setShowForm(false)}
                className="w-8 h-8 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 flex items-center justify-center text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 mt-4">
              {/* Color Theme Selector Swatches */}
              <div>
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5">
                  🎨 Select Card Color Theme
                </label>
                <div className="grid grid-cols-5 gap-2 p-3 bg-slate-50/80 rounded-2xl border border-slate-200">
                  {COLOR_KEYS.map(k => {
                    const theme = THEME_PALETTES[k];
                    const isSelected = formData.color === k;
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setFormData({ ...formData, color: k })}
                        className={`flex flex-col items-center justify-center p-2 rounded-xl border transition-all cursor-pointer ${
                          isSelected
                            ? `bg-white ${theme.borderColor} shadow-sm ring-2 ${theme.ringColor}`
                            : 'border-transparent hover:bg-white/60'
                        }`}
                        title={theme.label}
                      >
                        <span
                          className="w-6 h-6 rounded-full border border-white shadow-xs flex items-center justify-center text-white text-[10px] font-bold"
                          style={{ backgroundColor: theme.dotColor }}
                        >
                          {isSelected ? '✓' : ''}
                        </span>
                        <span className="text-[10px] font-semibold text-slate-600 mt-1 truncate max-w-full">
                          {theme.label.split(' ')[0]}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Live Preview Bar */}
              <div
                className={`p-3 rounded-2xl border ${currentModalTheme.borderColor} ${currentModalTheme.bgCard} flex items-center justify-between`}
              >
                <div className="flex items-center space-x-3">
                  <div
                    className={`w-9 h-9 rounded-xl bg-gradient-to-br ${currentModalTheme.gradient} flex items-center justify-center text-white font-bold text-xs shadow-xs`}
                  >
                    {formData.code || 'CD'}
                  </div>
                  <div>
                    <p className={`text-xs font-bold ${currentModalTheme.textTitle}`}>
                      {formData.name || 'Sample Department Name'}
                    </p>
                    <p className={`text-[10px] font-medium ${currentModalTheme.textAccent}`}>
                      Head: {formData.head || 'Department Lead'}
                    </p>
                  </div>
                </div>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${currentModalTheme.badgeBg} ${currentModalTheme.badgeText} ${currentModalTheme.badgeBorder}`}
                >
                  Live Theme Preview
                </span>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700">Department Name *</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                  placeholder="e.g. Content Department, Digital Marketing"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700">Code *</label>
                  <input
                    type="text"
                    required
                    value={formData.code}
                    onChange={e => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                    className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-bold uppercase tracking-wider"
                    placeholder="e.g. CD, DM, HRD"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700">Employee Count</label>
                  <input
                    type="number"
                    min="0"
                    value={formData.employeeCount}
                    onChange={e => setFormData({ ...formData, employeeCount: parseInt(e.target.value) || 0 })}
                    className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700">Department Head</label>
                <input
                  type="text"
                  value={formData.head}
                  onChange={e => setFormData({ ...formData, head: e.target.value })}
                  className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                  placeholder="e.g. MD. Sirajul Islam"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700">Description</label>
                <textarea
                  value={formData.description}
                  onChange={e => setFormData({ ...formData, description: e.target.value })}
                  rows={2}
                  className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                  placeholder="Responsibilities, mandate or notes..."
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700">Status</label>
                <select
                  value={formData.status}
                  onChange={e => setFormData({ ...formData, status: e.target.value as 'active' | 'inactive' })}
                  className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium cursor-pointer"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>

              <div className="flex space-x-2.5 pt-3">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 text-sm font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`flex-1 px-4 py-2.5 bg-gradient-to-r ${currentModalTheme.gradient} text-white rounded-xl font-semibold text-sm shadow-md cursor-pointer hover:opacity-95 transition-opacity`}
                >
                  {editing ? 'Update Department' : 'Create Department'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
