import { useState, useMemo } from 'react';
import { useData, Branch } from '../context/DataContext';
import { Page } from '../App';
import { BiometricDeviceModal } from './BiometricDeviceModal';
import { BranchQRModal } from './BranchQRModal';
import {
  IconBuilding,
  IconServer,
  IconUsers,
  IconFingerprint,
  IconPlus,
  IconEdit,
  IconTrash,
  IconCheck,
  IconCloud,
  IconActivity,
  IconQrCode,
  IconMapPin,
} from './Icons';

type Props = {
  onNavigate?: (page: Page) => void;
};

const QUICK_BRANCH_PRESETS: Array<{
  name: string;
  code: string;
  city: string;
  address: string;
  type: Branch['type'];
}> = [
  { name: 'Chattogram Branch', code: 'BR-CTG', city: 'Chattogram', address: 'Agrabad Commercial Area, Chattogram', type: 'branch' },
  { name: 'Uttara Branch (Dhaka)', code: 'BR-UTT', city: 'Dhaka', address: 'Sector 7, Uttara, Dhaka', type: 'branch' },
  { name: 'Sylhet Branch', code: 'BR-SYL', city: 'Sylhet', address: 'Zindabazar, Sylhet', type: 'branch' },
  { name: 'Gazipur Factory Branch', code: 'BR-GZP', city: 'Gazipur', address: 'Tongi Industrial Area, Gazipur', type: 'factory' },
  { name: 'Khulna Branch', code: 'BR-KHL', city: 'Khulna', address: 'KDA Avenue, Khulna', type: 'branch' },
  { name: 'Rajshahi Branch', code: 'BR-RAJ', city: 'Rajshahi', address: 'Shaheb Bazar, Rajshahi', type: 'branch' },
];

export const BANGLADESH_LOCATION_PRESETS: Array<{
  label: string;
  lat: number;
  lng: number;
}> = [
  { label: '🏛️ Dhaka - Motijheel / Dilkusha (Commercial Hub)', lat: 23.7333, lng: 90.4178 },
  { label: '🏢 Dhaka - Gulshan 1 & 2 / Banani (Corporate Hub)', lat: 23.7925, lng: 90.4078 },
  { label: '✈️ Dhaka - Uttara (North Hub)', lat: 23.8759, lng: 90.3795 },
  { label: '🌳 Dhaka - Dhanmondi', lat: 23.7461, lng: 90.3742 },
  { label: '🏬 Dhaka - Mirpur 10 / 11', lat: 23.8041, lng: 90.3667 },
  { label: '🏭 Dhaka - Tejgaon Industrial Area', lat: 23.7686, lng: 90.3986 },
  { label: '🏭 Gazipur - Tongi / Boardbazar / Joydebpur', lat: 23.9999, lng: 90.4203 },
  { label: '🏭 Savar / Ashulia (DEPZ & Garments)', lat: 23.8583, lng: 90.2667 },
  { label: '🚢 Narayanganj - River Port & City', lat: 23.6238, lng: 90.5000 },
  { label: '🚢 Chattogram - Agrabad Commercial Area / Port', lat: 22.3275, lng: 91.8123 },
  { label: '🌿 Sylhet - Zindabazar / Chowhatta', lat: 24.8949, lng: 91.8687 },
  { label: '🎓 Rajshahi - Shaheb Bazar', lat: 24.3745, lng: 88.6042 },
  { label: '⚓ Khulna - KDA Avenue / Shibbari', lat: 22.8456, lng: 89.5403 },
  { label: '🌊 Barishal - Sadar Road', lat: 22.7010, lng: 90.3535 },
  { label: '🌾 Bogura - Satmatha', lat: 24.8465, lng: 89.3777 },
  { label: '🕌 Cumilla - Kandirpar', lat: 23.4682, lng: 91.1788 },
  { label: '🏖️ Cox\'s Bazar - Kolatoli', lat: 21.4272, lng: 92.0058 },
];

export function BranchManagement({ onNavigate }: Props) {
  const {
    branches,
    activeBranch,
    setActiveBranch,
    addBranch,
    updateBranch,
    deleteBranch,
    allEmployees,
    allDevices,
    getEmployeeBranch,
    getDeviceBranch,
    addNotification,
  } = useData();

  const [showBranchModal, setShowBranchModal] = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [branchToDelete, setBranchToDelete] = useState<Branch | null>(null);
  const [deleteWarningStep, setDeleteWarningStep] = useState<1 | 2>(1);
  const [isDeletingBranch, setIsDeletingBranch] = useState(false);
  const [search, setSearch] = useState('');
  const [isDeviceModalOpen, setIsDeviceModalOpen] = useState(false);
  const [preselectedBranchForDevice, setPreselectedBranchForDevice] = useState<string>('');
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [selectedBranchForQR, setSelectedBranchForQR] = useState<Branch | null>(null);
  const [isFetchingGps, setIsFetchingGps] = useState(false);
  const [gpsDetectStatus, setGpsDetectStatus] = useState<{
    type: 'success' | 'error';
    message: string;
    isPermissionPolicy?: boolean;
  } | null>(null);

  const isAllBranchesSelected = !activeBranch || activeBranch.trim().toLowerCase() === 'all';
  const isInsideIframe = typeof window !== 'undefined' && window.self !== window.top;

  const [formData, setFormData] = useState<{
    name: string;
    code: string;
    type: Branch['type'];
    city: string;
    address: string;
    managerName: string;
    phone: string;
    status: 'active' | 'inactive';
    latitude?: number;
    longitude?: number;
    radiusMeters?: number;
  }>({
    name: '',
    code: '',
    type: 'branch',
    city: 'Dhaka',
    address: '',
    managerName: '',
    phone: '',
    status: 'active',
    latitude: 23.8103,
    longitude: 90.4125,
    radiusMeters: 100,
  });

  const webhookUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/.netlify/functions/iclock`;

  const handleFetchCurrentGps = () => {
    if (!navigator.geolocation) {
      setGpsDetectStatus({
        type: 'error',
        message: 'Geolocation is not supported by your browser or device.',
      });
      return;
    }
    setIsFetchingGps(true);
    setGpsDetectStatus(null);
    navigator.geolocation.getCurrentPosition(
      pos => {
        setFormData(prev => ({
          ...prev,
          latitude: parseFloat(pos.coords.latitude.toFixed(6)),
          longitude: parseFloat(pos.coords.longitude.toFixed(6)),
        }));
        setGpsDetectStatus({
          type: 'success',
          message: `📍 Office GPS location detected (Lat: ${pos.coords.latitude.toFixed(4)}, Lng: ${pos.coords.longitude.toFixed(4)} • Accuracy ±${Math.round(pos.coords.accuracy)}m)`,
        });
        setIsFetchingGps(false);
      },
      err => {
        const isPolicy =
          err.message?.toLowerCase().includes('permissions policy') ||
          err.message?.toLowerCase().includes('disabled') ||
          err.code === 1;

        setGpsDetectStatus({
          type: 'error',
          isPermissionPolicy: isPolicy,
          message: isPolicy
            ? 'Browser permissions policy blocked live GPS detection inside the iframe preview.'
            : `GPS Location error: ${err.message}`,
        });
        setIsFetchingGps(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const openCreateBranchModal = () => {
    setEditingBranch(null);
    setGpsDetectStatus(null);
    setFormData({
      name: '',
      code: `BR-0${branches.length + 1}`,
      type: 'branch',
      city: '',
      address: '',
      managerName: '',
      phone: '',
      status: 'active',
      latitude: 23.8103,
      longitude: 90.4125,
      radiusMeters: 100,
    });
    setShowBranchModal(true);
  };

  const openEditBranchModal = (branch: Branch) => {
    setEditingBranch(branch);
    setGpsDetectStatus(null);
    setFormData({
      name: branch.name || '',
      code: branch.code || 'BR-01',
      type: branch.type || (branch.isHeadOffice ? 'head_office' : 'branch'),
      city: branch.city || 'Dhaka',
      address: branch.address || '',
      managerName: branch.managerName || '',
      phone: branch.phone || '',
      status: branch.status || 'active',
      latitude: branch.latitude ?? 23.8103,
      longitude: branch.longitude ?? 90.4125,
      radiusMeters: branch.radiusMeters ?? 100,
    });
    setShowBranchModal(true);
  };

  const handleSaveBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;

    if (editingBranch) {
      await updateBranch(editingBranch.id, {
        ...formData,
        name: formData.name.trim(),
        code: formData.code.trim().toUpperCase(),
        isHeadOffice: formData.type === 'head_office' || editingBranch.isHeadOffice,
        latitude: formData.latitude !== undefined ? Number(formData.latitude) : undefined,
        longitude: formData.longitude !== undefined ? Number(formData.longitude) : undefined,
        radiusMeters: formData.radiusMeters ? Number(formData.radiusMeters) : 100,
      });
      addNotification({
        title: 'Branch Office Updated',
        message: `${formData.name} (${formData.code}) updated successfully.`,
        read: false,
        type: 'system',
        targetPage: 'branches',
      });
    } else {
      await addBranch({
        ...formData,
        name: formData.name.trim(),
        code: formData.code.trim().toUpperCase(),
        isHeadOffice: formData.type === 'head_office',
        latitude: formData.latitude !== undefined ? Number(formData.latitude) : undefined,
        longitude: formData.longitude !== undefined ? Number(formData.longitude) : undefined,
        radiusMeters: formData.radiusMeters ? Number(formData.radiusMeters) : 100,
      });
      addNotification({
        title: 'New Branch Office Added',
        message: `${formData.name} (${formData.code}) is now connected to your central HR & Biometric workspace.`,
        read: false,
        type: 'system',
        targetPage: 'branches',
      });
    }
    setShowBranchModal(false);
    setEditingBranch(null);
  };

  const handleDeleteBranch = (branch: Branch) => {
    if (branch.isHeadOffice || branch.type === 'head_office') {
      addNotification({
        title: 'Main Head Office Protected',
        message: 'Main Head Office cannot be deleted. You can edit its name or address.',
        read: false,
        type: 'system',
      });
      return;
    }
    setBranchToDelete(branch);
    setDeleteWarningStep(1);
  };

  const handleConfirmPermanentDelete = async () => {
    if (!branchToDelete) return;
    setIsDeletingBranch(true);
    try {
      const targetName = branchToDelete.name;
      await deleteBranch(branchToDelete.id);
      addNotification({
        title: 'Branch Office Permanently Deleted',
        message: `"${targetName}" has been permanently deleted from the database.`,
        read: false,
        type: 'system',
        targetPage: 'branches',
      });
      setBranchToDelete(null);
      setDeleteWarningStep(1);
    } finally {
      setIsDeletingBranch(false);
    }
  };

  const handleCopyWebhook = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopiedWebhook(true);
    setTimeout(() => setCopiedWebhook(false), 2000);
  };

  const filteredBranches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return branches;
    return branches.filter(
      b =>
        b.name.toLowerCase().includes(q) ||
        b.code.toLowerCase().includes(q) ||
        (b.city || '').toLowerCase().includes(q) ||
        (b.managerName || '').toLowerCase().includes(q)
    );
  }, [branches, search]);

  const getTypeBadge = (branch: Branch) => {
    if (branch.isHeadOffice || branch.type === 'head_office') {
      return { label: '🏛️ MAIN HEAD OFFICE', cls: 'bg-indigo-100 text-indigo-800 border-indigo-200' };
    }
    if (branch.type === 'factory') {
      return { label: '🏭 FACTORY / PLANT', cls: 'bg-amber-100 text-amber-800 border-amber-200' };
    }
    if (branch.type === 'warehouse') {
      return { label: '📦 WAREHOUSE / DEPOT', cls: 'bg-teal-100 text-teal-800 border-teal-200' };
    }
    return { label: '🏢 BRANCH OFFICE', cls: 'bg-violet-100 text-violet-800 border-violet-200' };
  };

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto animate-fade-in pb-12">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 animate-pulse"></span>
            <span className="text-[11px] font-bold text-indigo-700 uppercase tracking-wider">
              Centralized Multi-Branch HR &amp; Biometric Cloud
            </span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight mt-0.5">
            Head Office &amp; Branch Offices Management
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Manage biometric attendance machines, employees, shifts, leave policies, and payroll for Head Office and all branch offices together.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full lg:w-auto">
          <button
            onClick={() => {
              setPreselectedBranchForDevice(!isAllBranchesSelected ? activeBranch : (branches[0]?.name || 'Main Head Office (Dhaka)'));
              setIsDeviceModalOpen(true);
            }}
            className="w-full sm:w-auto px-4 py-2.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-xl text-xs font-bold shadow-2xs flex items-center justify-center space-x-1.5 transition-all cursor-pointer"
          >
            <IconFingerprint size={16} className="text-indigo-600" />
            <span>Register Branch Attendance Machine</span>
          </button>

          <button
            onClick={openCreateBranchModal}
            className="w-full sm:w-auto px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-500/20 flex items-center justify-center space-x-1.5 transition-all cursor-pointer"
          >
            <IconPlus size={16} />
            <span>Add New Branch Office</span>
          </button>
        </div>
      </div>

      {/* Global Active Branch Switcher Banner */}
      <div className="p-4 sm:p-5 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 rounded-3xl text-white shadow-lg border border-indigo-500/20">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-indigo-500 text-white">
                Global Workspace Switcher
              </span>
              <span className="text-xs text-indigo-200 font-medium">
                Currently Viewing:{' '}
                <strong className="text-white">
                  {isAllBranchesSelected ? '🌐 All Offices (Head Office + All Branches Together)' : `🏢 ${activeBranch}`}
                </strong>
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-1">
              Select any branch below to filter Attendance, Staff, Payroll, and Reports for that location, or choose &ldquo;All Branches&rdquo; for consolidated views.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setActiveBranch('All')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center space-x-1.5 ${
                isAllBranchesSelected
                  ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/25'
                  : 'bg-white/10 hover:bg-white/20 text-white border border-white/15'
              }`}
            >
              <span>🌐 All Offices ({allEmployees.length} Staff)</span>
            </button>
            {branches.map(b => {
              const isSelected = activeBranch.toLowerCase() === b.name.toLowerCase();
              const count = allEmployees.filter(e => getEmployeeBranch(e).toLowerCase() === b.name.toLowerCase()).length;
              return (
                <button
                  key={b.id}
                  onClick={() => setActiveBranch(b.name)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center space-x-1.5 ${
                    isSelected
                      ? 'bg-indigo-500 text-white ring-2 ring-white/50 shadow-md'
                      : 'bg-white/10 hover:bg-white/20 text-slate-200 border border-white/10'
                  }`}
                >
                  <span>{b.isHeadOffice || b.type === 'head_office' ? '🏛️' : '🏢'}</span>
                  <span>{b.name}</span>
                  <span className="px-1.5 py-0.2 rounded-full bg-black/30 text-[10px]">{count}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="p-4 sm:p-5 bg-white rounded-2xl border border-slate-200/80 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Total Offices</span>
            <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <IconBuilding size={18} />
            </div>
          </div>
          <p className="text-2xl sm:text-3xl font-black text-slate-900 mt-2">{branches.length}</p>
          <p className="text-xs text-slate-500 mt-0.5">
            1 Head Office + {Math.max(0, branches.length - 1)} Branch {branches.length - 1 === 1 ? 'Office' : 'Offices'}
          </p>
        </div>

        <div className="p-4 sm:p-5 bg-white rounded-2xl border border-slate-200/80 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-emerald-600 uppercase tracking-wider">Total Staff (All Branches)</span>
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <IconUsers size={18} />
            </div>
          </div>
          <p className="text-2xl sm:text-3xl font-black text-emerald-600 mt-2">{allEmployees.length}</p>
          <p className="text-xs text-slate-500 mt-0.5">
            {allEmployees.filter(e => e.status === 'active').length} active employees across all locations
          </p>
        </div>

        <div className="p-4 sm:p-5 bg-white rounded-2xl border border-slate-200/80 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-violet-600 uppercase tracking-wider">Branch Biometric Machines</span>
            <div className="w-9 h-9 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center">
              <IconFingerprint size={18} />
            </div>
          </div>
          <p className="text-2xl sm:text-3xl font-black text-violet-700 mt-2">{allDevices.length}</p>
          <p className="text-xs text-slate-500 mt-0.5">
            {allDevices.filter(d => d.enabled !== false).length} active ZKTeco terminals connected
          </p>
        </div>

        <div className="p-4 sm:p-5 bg-white rounded-2xl border border-slate-200/80 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-teal-600 uppercase tracking-wider">Cloud ADMS Sync</span>
            <div className="w-9 h-9 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center">
              <IconCloud size={18} />
            </div>
          </div>
          <p className="text-lg sm:text-xl font-black text-teal-700 mt-2">Real-Time Push</p>
          <p className="text-xs text-slate-500 mt-0.5">
            All branch machines sync to 1 central DB
          </p>
        </div>
      </div>

      {/* Search & Quick Actions Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs">
        <div className="flex-1 max-w-md">
          <input
            type="text"
            placeholder="🔍 Search branch office by name, code, city, or manager..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {onNavigate && (
            <>
              <button
                onClick={() => onNavigate('attendance')}
                className="px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-xl font-bold transition-all cursor-pointer"
              >
                ⏱️ View Attendance Sheet
              </button>
              <button
                onClick={() => onNavigate('zkteco')}
                className="px-3 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 rounded-xl font-bold transition-all cursor-pointer"
              >
                📟 All Biometric Machines ({allDevices.length})
              </button>
              <button
                onClick={() => onNavigate('payroll')}
                className="px-3 py-2 bg-violet-50 hover:bg-violet-100 text-violet-800 border border-violet-200 rounded-xl font-bold transition-all cursor-pointer"
              >
                💵 Branch Payroll
              </button>
            </>
          )}
        </div>
      </div>

      {/* Branch Office Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {filteredBranches.map(branch => {
          const badge = getTypeBadge(branch);
          const branchEmployees = allEmployees.filter(
            e => getEmployeeBranch(e).toLowerCase() === branch.name.toLowerCase()
          );
          const branchDevices = allDevices.filter(
            d => getDeviceBranch(d).toLowerCase() === branch.name.toLowerCase()
          );
          const isCurrentFilter = activeBranch.toLowerCase() === branch.name.toLowerCase();

          return (
            <div
              key={branch.id}
              className={`rounded-3xl border transition-all p-5 sm:p-6 flex flex-col justify-between bg-white shadow-sm ${
                isCurrentFilter
                  ? 'border-indigo-500 ring-2 ring-indigo-500/20'
                  : 'border-slate-200/90 hover:border-indigo-300'
              }`}
            >
              <div>
                {/* Top Badges */}
                <div className="flex items-center justify-between gap-2 mb-3">
                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border ${badge.cls}`}>
                    {badge.label}
                  </span>
                  <div className="flex items-center space-x-1.5">
                    <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-mono text-[11px] font-bold border border-slate-200">
                      {branch.code}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        branch.status === 'active'
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {branch.status === 'active' ? '● Active' : 'Inactive'}
                    </span>
                  </div>
                </div>

                {/* Branch Name & Location */}
                <h3 className="text-lg font-black text-slate-900 tracking-tight">{branch.name}</h3>
                <p className="text-xs text-slate-500 mt-0.5 flex items-center space-x-1">
                  <span>📍</span>
                  <span>{branch.address || branch.city || 'Bangladesh'}</span>
                </p>

                {(branch.managerName || branch.phone) && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-3 text-[11px] text-slate-600 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-100">
                    {branch.managerName && (
                      <span>
                        👤 Manager: <strong className="text-slate-800">{branch.managerName}</strong>
                      </span>
                    )}
                    {branch.phone && (
                      <span className="font-mono">📞 {branch.phone}</span>
                    )}
                  </div>
                )}

                {/* Branch Metrics Row */}
                <div className="grid grid-cols-2 gap-2.5 my-4">
                  <div className="p-3 rounded-2xl bg-indigo-50/60 border border-indigo-100">
                    <span className="text-[10px] font-bold text-indigo-600 uppercase block">Assigned Staff</span>
                    <div className="flex items-baseline justify-between mt-0.5">
                      <span className="text-xl font-black text-indigo-950">{branchEmployees.length}</span>
                      {onNavigate && (
                        <button
                          onClick={() => {
                            setActiveBranch(branch.name);
                            onNavigate('employee');
                          }}
                          className="text-[11px] font-bold text-indigo-600 hover:underline cursor-pointer"
                        >
                          View Staff →
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="p-3 rounded-2xl bg-emerald-50/60 border border-emerald-100">
                    <span className="text-[10px] font-bold text-emerald-700 uppercase block">Attendance Machines</span>
                    <div className="flex items-baseline justify-between mt-0.5">
                      <span className="text-xl font-black text-emerald-950">{branchDevices.length}</span>
                      <button
                        onClick={() => {
                          setPreselectedBranchForDevice(branch.name);
                          setIsDeviceModalOpen(true);
                        }}
                        className="text-[11px] font-bold text-emerald-700 hover:underline cursor-pointer"
                      >
                        + Add Machine
                      </button>
                    </div>
                  </div>
                </div>

                {/* Installed Biometric Machines in this Branch */}
                <div className="space-y-2 mb-4">
                  <div className="flex items-center justify-between text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                    <span>Installed Biometric Terminals</span>
                    <span>{branchDevices.length} Connected</span>
                  </div>

                  {branchDevices.length === 0 ? (
                    <div className="p-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 text-center">
                      <p className="text-[11px] text-slate-500">No biometric machine registered for {branch.name} yet.</p>
                      <button
                        onClick={() => {
                          setPreselectedBranchForDevice(branch.name);
                          setIsDeviceModalOpen(true);
                        }}
                        className="mt-1.5 px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[11px] font-bold transition-all cursor-pointer"
                      >
                        + Register ZKTeco Machine for {branch.code}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1 thin-scroll">
                      {branchDevices.map(dev => (
                        <div
                          key={dev.id}
                          className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between text-xs"
                        >
                          <div className="min-w-0">
                            <p className="font-bold text-slate-800 truncate flex items-center space-x-1.5">
                              <span>📟</span>
                              <span>{dev.name}</span>
                            </p>
                            <p className="text-[10px] font-mono text-slate-500 truncate">
                              SN: {dev.serialNumber || dev.serial} • {dev.model || 'ZKTeco'}
                            </p>
                          </div>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                              dev.enabled !== false
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-slate-200 text-slate-600'
                            }`}
                          >
                            {dev.enabled !== false ? 'Active' : 'Disabled'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {/* Office Attendance QR Code Station (GPS Protected) */}
                <div className="p-3 rounded-2xl bg-gradient-to-r from-indigo-50/80 to-violet-50/80 border border-indigo-200/80 mb-4 flex items-center justify-between text-xs">
                  <div className="flex items-center space-x-2.5">
                    <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-2xs">
                      <IconQrCode size={16} />
                    </div>
                    <div>
                      <p className="font-bold text-slate-900">Office Attendance QR Station</p>
                      <p className="text-[10px] text-slate-500">
                        {branch.latitude && branch.longitude
                          ? `GPS Geofenced (${branch.radiusMeters || 100}m radius)`
                          : 'For staff without biometric machines'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedBranchForQR(branch)}
                    className="px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[11px] shadow-xs flex items-center space-x-1 cursor-pointer transition-all"
                  >
                    <IconQrCode size={13} />
                    <span>Print QR Poster</span>
                  </button>
                </div>
              </div>

              {/* Card Footer Actions */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                <button
                  onClick={() => setActiveBranch(isCurrentFilter ? 'All' : branch.name)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center space-x-1.5 ${
                    isCurrentFilter
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'bg-slate-100 hover:bg-indigo-50 text-slate-700 hover:text-indigo-700'
                  }`}
                >
                  <IconActivity size={13} />
                  <span>{isCurrentFilter ? '✓ Active Branch Filter (Reset)' : 'Filter App by Branch'}</span>
                </button>

                <div className="flex items-center space-x-1">
                  <button
                    onClick={() => setSelectedBranchForQR(branch)}
                    className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                    title="View & Print Attendance QR Code"
                  >
                    <IconQrCode size={15} />
                  </button>
                  <button
                    onClick={() => openEditBranchModal(branch)}
                    className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                    title="Edit Branch Office"
                  >
                    <IconEdit size={15} />
                  </button>
                  {!branch.isHeadOffice && branch.type !== 'head_office' && (
                    <button
                      onClick={() => handleDeleteBranch(branch)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                      title="Delete Branch Office"
                    >
                      <IconTrash size={15} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Multi-Branch Biometric Hardware Connection Guide */}
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-sm p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <IconServer size={20} />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                How to connect Head Office and all Branch Office Attendance Machines to WorkNest?
              </h3>
              <p className="text-xs text-slate-500">
                Central ADMS Cloud Push Protocol — Connect devices directly from anywhere without local servers or port forwarding
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <input
              type="text"
              readOnly
              value={webhookUrl}
              className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-700 w-64 sm:w-80"
            />
            <button
              onClick={handleCopyWebhook}
              className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shrink-0"
            >
              {copiedWebhook ? '✓ Copied' : 'Copy Server URL'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-1.5">
            <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-800 font-black text-[10px] uppercase">
              Step 1 • Register Branch &amp; Machine
            </span>
            <h4 className="font-bold text-slate-900 text-sm">1. Create Branch &amp; Register Serial Number</h4>
            <p className="text-slate-600 leading-relaxed">
              Create your branch offices (e.g. Dhaka Head Office, Chattogram Branch). Then register your ZKTeco machine <strong>Serial Number (SN)</strong> under that branch.
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-1.5">
            <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-black text-[10px] uppercase">
              Step 2 • Branch Machine ADMS Setup
            </span>
            <h4 className="font-bold text-slate-900 text-sm">2. Enter Cloud Server URL in Machine</h4>
            <p className="text-slate-600 leading-relaxed">
              Connect your ZKTeco device to internet (Wi-Fi or LAN), go to <strong>Menu &gt; Comm. &gt; Cloud Server Setting (ADMS)</strong>, and enter the Server Address above with Port <strong>443</strong>.
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-1.5">
            <span className="px-2 py-0.5 rounded bg-violet-100 text-violet-800 font-black text-[10px] uppercase">
              Step 3 • Unified HR &amp; Payroll Control
            </span>
            <h4 className="font-bold text-slate-900 text-sm">3. Manage Everything Centralized</h4>
            <p className="text-slate-600 leading-relaxed">
              Whenever an employee punches at any machine, attendance, late calculation, overtime, and payroll update in real-time. Use the <strong>Branch Switcher</strong> anytime!
            </p>
          </div>
        </div>
      </div>

      {/* Add / Edit Branch Modal */}
      {showBranchModal && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4"
          onClick={() => setShowBranchModal(false)}
        >
          <div
            className="bg-white rounded-3xl max-w-xl w-full p-6 sm:p-7 shadow-2xl border border-slate-100 max-h-[92vh] overflow-y-auto animate-scale-in"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white flex items-center justify-center shadow-md">
                  <IconBuilding size={20} />
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900">
                    {editingBranch ? `Edit ${editingBranch.name}` : 'Add New Branch Office'}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Configure branch office details for centralized HR &amp; biometric attendance
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowBranchModal(false)}
                className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-700 font-bold"
              >
                ✕
              </button>
            </div>

            {!editingBranch && (
              <div className="mt-4">
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                  Quick Fill Common Branch Presets:
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_BRANCH_PRESETS.map(preset => (
                    <button
                      key={preset.code}
                      type="button"
                      onClick={() =>
                        setFormData({
                          ...formData,
                          name: preset.name,
                          code: preset.code,
                          city: preset.city,
                          address: preset.address,
                          type: preset.type,
                        })
                      }
                      className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200/80 rounded-lg text-[11px] font-semibold transition-all cursor-pointer"
                    >
                      + {preset.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <form onSubmit={handleSaveBranch} className="mt-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                    Branch / Office Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Chattogram Branch or Banani Branch"
                    value={formData.name}
                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                    Branch Code <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. BR-CTG"
                    value={formData.code}
                    onChange={e => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                    Office Type
                  </label>
                  <select
                    value={formData.type}
                    onChange={e => setFormData({ ...formData, type: e.target.value as Branch['type'] })}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="head_office">🏛️ Main Head Office</option>
                    <option value="branch">🏢 Branch Office</option>
                    <option value="factory">🏭 Factory / Production Plant</option>
                    <option value="warehouse">📦 Warehouse / Regional Depot</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                    City / District
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Dhaka, Chattogram, Sylhet"
                    value={formData.city}
                    onChange={e => setFormData({ ...formData, city: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Full Branch Address
                </label>
                <input
                  type="text"
                  placeholder="e.g. House 12, Road 5, Dhanmondi, Dhaka"
                  value={formData.address}
                  onChange={e => setFormData({ ...formData, address: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                    Branch Manager / In-Charge
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Kamrul Hasan"
                    value={formData.managerName}
                    onChange={e => setFormData({ ...formData, managerName: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                    Branch Contact Phone
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. +880 1711-000000"
                    value={formData.phone}
                    onChange={e => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {/* GPS Geofencing & Office QR Attendance Configuration */}
              <div className="bg-indigo-50/60 border border-indigo-200/80 rounded-2xl p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center space-x-2">
                    <IconMapPin size={16} className="text-indigo-600 shrink-0" />
                    <div>
                      <span className="text-xs font-bold text-slate-800">
                        GPS Geofence Perimeter &amp; Office QR
                      </span>
                      <p className="text-[10px] text-slate-500">
                        Physical office coordinate boundary for General Shift staff.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2 shrink-0">
                    <button
                      type="button"
                      onClick={handleFetchCurrentGps}
                      disabled={isFetchingGps}
                      className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[11px] font-bold transition-all shadow-xs flex items-center space-x-1 cursor-pointer"
                    >
                      <IconMapPin size={13} />
                      <span>{isFetchingGps ? 'Locating...' : '📍 Use My Current GPS'}</span>
                    </button>
                    {isInsideIframe && (
                      <button
                        type="button"
                        onClick={() => window.open(window.location.href, '_blank')}
                        className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-[11px] font-bold shadow-xs cursor-pointer flex items-center space-x-1"
                        title="Open in new browser tab"
                      >
                        <span>🌐 New Tab</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Quick Area Preset Selector */}
                <div className="bg-white/90 p-2.5 rounded-xl border border-indigo-100/90 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
                  <div className="flex items-center space-x-1.5 text-xs font-bold text-slate-700 shrink-0">
                    <span className="text-indigo-600">⚡</span>
                    <span>Quick Area Presets:</span>
                  </div>
                  <select
                    className="w-full sm:w-auto text-xs px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                    onChange={e => {
                      const idx = parseInt(e.target.value);
                      if (!isNaN(idx) && BANGLADESH_LOCATION_PRESETS[idx]) {
                        const sel = BANGLADESH_LOCATION_PRESETS[idx];
                        setFormData(prev => ({
                          ...prev,
                          latitude: sel.lat,
                          longitude: sel.lng,
                        }));
                        setGpsDetectStatus({
                          type: 'success',
                          message: `📍 Preset selected: "${sel.label}" (Lat: ${sel.lat}, Lng: ${sel.lng})`,
                        });
                      }
                    }}
                    defaultValue=""
                  >
                    <option value="" disabled>-- Select Popular Office Area --</option>
                    {BANGLADESH_LOCATION_PRESETS.map((p, idx) => (
                      <option key={p.label} value={idx}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Status Message / Detailed Guidance */}
                {gpsDetectStatus && (
                  gpsDetectStatus.type === 'success' ? (
                    <div className="text-[11px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-300 rounded-xl p-2.5 flex items-center space-x-2 animate-fade-in">
                      <IconCheck size={16} className="text-emerald-600 shrink-0" />
                      <span>{gpsDetectStatus.message}</span>
                    </div>
                  ) : (
                    <div className="text-xs text-amber-950 bg-amber-50/95 border border-amber-300 rounded-xl p-3 space-y-2 animate-fade-in">
                      <div className="flex items-start space-x-2">
                        <span className="text-base shrink-0">ℹ️</span>
                        <div>
                          <p className="font-bold text-amber-900">
                            {gpsDetectStatus.isPermissionPolicy ? 'Iframe Permissions Policy Restriction' : 'GPS Location Notice'}
                          </p>
                          <p className="text-[11px] text-amber-800 leading-relaxed mt-0.5">
                            {gpsDetectStatus.message}
                          </p>
                        </div>
                      </div>

                      <div className="pt-1 flex flex-wrap items-center gap-2">
                        {isInsideIframe && (
                          <button
                            type="button"
                            onClick={() => window.open(window.location.href, '_blank')}
                            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[11px] font-bold shadow-xs cursor-pointer flex items-center space-x-1"
                          >
                            <span>🌐 Open in New Tab</span>
                          </button>
                        )}
                        <a
                          href="https://www.google.com/maps"
                          target="_blank"
                          rel="noreferrer"
                          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-[11px] font-bold shadow-xs cursor-pointer flex items-center space-x-1"
                        >
                          <span>🗺️ View Coordinates on Google Maps</span>
                        </a>
                      </div>
                      <p className="text-[10px] text-slate-500 font-medium pt-0.5">
                        💡 You can select an area from the <strong>&ldquo;Quick Presets&rdquo;</strong> dropdown or enter latitude and longitude directly.
                      </p>
                    </div>
                  )
                )}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                      Latitude
                    </label>
                    <input
                      type="number"
                      step="any"
                      placeholder="e.g. 23.8103"
                      value={formData.latitude ?? ''}
                      onChange={e => setFormData({ ...formData, latitude: e.target.value ? parseFloat(e.target.value) : undefined })}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-mono font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                      Longitude
                    </label>
                    <input
                      type="number"
                      step="any"
                      placeholder="e.g. 90.4125"
                      value={formData.longitude ?? ''}
                      onChange={e => setFormData({ ...formData, longitude: e.target.value ? parseFloat(e.target.value) : undefined })}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-mono font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                      Allowed Radius (Meters)
                    </label>
                    <input
                      type="number"
                      min={20}
                      max={2000}
                      placeholder="100"
                      value={formData.radiusMeters ?? 100}
                      onChange={e => setFormData({ ...formData, radiusMeters: parseInt(e.target.value) || 100 })}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowBranchModal(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white rounded-xl text-xs font-bold shadow-md flex items-center space-x-1.5 cursor-pointer"
                >
                  <IconCheck size={16} />
                  <span>{editingBranch ? 'Save Branch Changes' : 'Create Branch Office'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 2-Step Warning Modal Before Deleting a Branch Office */}
      {branchToDelete && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-3 sm:p-4"
          onClick={() => {
            if (!isDeletingBranch) {
              setBranchToDelete(null);
              setDeleteWarningStep(1);
            }
          }}
        >
          <div
            className="bg-white rounded-3xl max-w-md w-full p-5 sm:p-7 max-h-[88dvh] overflow-y-auto shadow-2xl border border-slate-200 animate-scale-in"
            onClick={e => e.stopPropagation()}
          >
            {/* Step Progress Indicator */}
            <div className="flex items-center justify-between mb-4">
              <span
                className={`px-3 py-1 rounded-full text-[11px] font-black uppercase tracking-wider ${
                  deleteWarningStep === 1
                    ? 'bg-amber-100 text-amber-800 border border-amber-300'
                    : 'bg-rose-100 text-rose-800 border border-rose-300 animate-pulse'
                }`}
              >
                {deleteWarningStep === 1
                  ? '⚠️ Warning 1 of 2 • First Warning'
                  : '🚨 Final Warning 2 of 2 • Destructive Action'}
              </span>
              <button
                type="button"
                disabled={isDeletingBranch}
                onClick={() => {
                  setBranchToDelete(null);
                  setDeleteWarningStep(1);
                }}
                className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-700 font-bold"
              >
                ✕
              </button>
            </div>

            {deleteWarningStep === 1 ? (
              <div className="space-y-4">
                <div className="flex items-start space-x-3.5">
                  <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-600 flex items-center justify-center text-2xl shrink-0">
                    ⚠️
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-slate-900">
                      Are you sure you want to delete this branch office?
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      First Confirmation — Please verify the branch details before proceeding
                    </p>
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-amber-50/90 border border-amber-200 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 font-semibold">Branch Name:</span>
                    <span className="font-black text-slate-900 text-sm">{branchToDelete.name}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 font-semibold">Branch Code:</span>
                    <span className="font-mono font-bold text-indigo-700">{branchToDelete.code}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 font-semibold">Location:</span>
                    <span className="font-semibold text-slate-700">{branchToDelete.address || branchToDelete.city}</span>
                  </div>
                </div>

                <p className="text-xs text-slate-600 leading-relaxed">
                  You are about to delete <strong>{branchToDelete.name}</strong>. You will receive 2 confirmation warnings before permanent removal. This is Warning 1. Do you want to proceed?
                </p>

                <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-end gap-2 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => {
                      setBranchToDelete(null);
                      setDeleteWarningStep(1);
                    }}
                    className="w-full sm:w-auto px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer text-center"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteWarningStep(2)}
                    className="w-full sm:w-auto px-4 py-2.5 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-600 text-slate-950 shadow-md transition-all cursor-pointer text-center"
                  >
                    Proceed to Final Confirmation →
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-start space-x-3.5">
                  <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center text-2xl shrink-0">
                    🚨
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-rose-700">
                      Final Confirmation (2/2): Irreversible Deletion!
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Confirm permanent removal from the database
                    </p>
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-rose-50 border-2 border-rose-200 space-y-2 text-xs text-rose-900">
                  <p className="font-bold text-sm">
                    🗑️ &ldquo;{branchToDelete.name}&rdquo; ({branchToDelete.code})
                  </p>
                  <p className="leading-relaxed">
                    Clicking <strong>Confirm Permanent Delete</strong> will permanently erase this branch office from the database. Any active employees or devices will remain safely mapped to the Main Head Office.
                  </p>
                </div>

                <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-2 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    disabled={isDeletingBranch}
                    onClick={() => setDeleteWarningStep(1)}
                    className="w-full sm:w-auto px-3.5 py-2.5 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer text-center"
                  >
                    ← Back
                  </button>
                  <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
                    <button
                      type="button"
                      disabled={isDeletingBranch}
                      onClick={() => {
                        setBranchToDelete(null);
                        setDeleteWarningStep(1);
                      }}
                      className="w-full sm:w-auto px-3.5 py-2.5 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer text-center"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={isDeletingBranch}
                      onClick={handleConfirmPermanentDelete}
                      className="w-full sm:w-auto px-4 py-2.5 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-lg shadow-rose-500/25 flex items-center justify-center space-x-1.5 transition-all cursor-pointer disabled:opacity-50"
                    >
                      <IconTrash size={15} />
                      <span>
                        {isDeletingBranch ? 'Deleting from DB...' : 'Confirm Permanent Delete'}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Register Biometric Device Modal (pre-assigned to selected Branch) */}
      <BiometricDeviceModal
        isOpen={isDeviceModalOpen}
        defaultBranch={preselectedBranchForDevice}
        onClose={() => {
          setIsDeviceModalOpen(false);
          setPreselectedBranchForDevice('');
        }}
      />

      {/* Office Attendance QR Code Poster Modal */}
      {selectedBranchForQR && (
        <BranchQRModal
          branch={selectedBranchForQR}
          companyName="WorkNest HR"
          onClose={() => setSelectedBranchForQR(null)}
        />
      )}
    </div>
  );
}
