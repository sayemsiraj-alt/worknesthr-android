import { useState, useMemo, useEffect, useRef } from 'react';
import { useData, Employee } from '../context/DataContext';
import { getBangladeshTodayStr } from '../utils/attendanceScheduleEngine';
import { Avatar, isImageAvatar } from './Avatar';

function compressProfileImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const resultStr = String(reader.result || '');
      const img = new Image();
      img.onload = () => {
        try {
          const maxDim = 320;
          let w = img.width || 320;
          let h = img.height || 320;
          if (w > h && w > maxDim) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else if (h >= w && h > maxDim) {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL('image/jpeg', 0.85));
          } else {
            resolve(resultStr);
          }
        } catch {
          resolve(resultStr);
        }
      };
      img.onerror = () => resolve(resultStr);
      img.src = resultStr;
    };
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });
}

interface PayrollPercentages {
  basicPercent: number;
  houseRentPercent: number;
  medicalPercent: number;
  conveyancePercent: number;
}

function getPayrollPercentages(): PayrollPercentages {
  try {
    const saved = localStorage.getItem('worknest_settings_payroll');
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        basicPercent: Number(parsed.basicPercent) || 50,
        houseRentPercent: Number(parsed.houseRentPercent) || 30,
        medicalPercent: Number(parsed.medicalPercent) || 10,
        conveyancePercent: Number(parsed.conveyancePercent) || 10,
      };
    }
  } catch {}
  return {
    basicPercent: 50,
    houseRentPercent: 30,
    medicalPercent: 10,
    conveyancePercent: 10,
  };
}

const AVATAR_OPTIONS = ['👨‍💼', '👩‍💼', '👨‍💻', '👩‍💻', '👨‍🔬', '👩‍🔬', '👨‍🔧', '👩‍🔧', '🧑‍💼', '🧑‍💻'];

export function EmployeeManagement() {
  const {
    employees, allEmployees, departments, shifts, branches, activeBranch, setActiveBranch,
    getEmployeeBranch, addEmployee, updateEmployee, deleteEmployee, addNotification
  } = useData();
  const [showForm, setShowForm] = useState(false);
  const [viewingEmployee, setViewingEmployee] = useState<Employee | null>(null);
  const [editing, setEditing] = useState<Employee | null>(null);
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
  const [deptFilter, setDeptFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [activeTab, setActiveTab] = useState<'personal' | 'salary' | 'access'>('personal');
  const [photoUploadError, setPhotoUploadError] = useState('');
  const formPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const viewModalPhotoInputRef = useRef<HTMLInputElement | null>(null);

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

  const [formData, setFormData] = useState<Omit<Employee, 'id'>>({
    name: '',
    employeeId: '',
    email: '',
    phone: '',
    department: '',
    designation: '',
    shift: '',
    grossSalary: 30000,
    basicSalary: 15000,
    basic: 15000,
    houseRent: 9000,
    medical: 3000,
    transport: 3000,
    conveyance: 3000,
    food: 0,
    attendanceBonus: 0,
    bankName: '',
    accountNumber: '',
    rfidCard: '',
    password: 'password123',
    joinDate: getBangladeshTodayStr(),
    status: 'active',
    lastWorkingDay: '',
    avatar: '👨‍💼',
    address: '',
    emergencyContact: '',
    managerId: '',
    managerName: '',
    isManager: false,
    branch: activeBranch !== 'All' ? activeBranch : (branches[0]?.name || 'Main Head Office (Dhaka)'),
    branchId: branches[0]?.id || 'BR-001',
  });

  // Calculate salary components from gross salary
  const handleGrossSalaryChange = (newGross: number) => {
    const p = getPayrollPercentages();
    const basic = Math.round(newGross * (p.basicPercent / 100));
    const house = Math.round(newGross * (p.houseRentPercent / 100));
    const med = Math.round(newGross * (p.medicalPercent / 100));
    const conv = Math.round(newGross * (p.conveyancePercent / 100));

    setFormData(prev => ({
      ...prev,
      grossSalary: newGross,
      basicSalary: basic,
      basic: basic,
      houseRent: house,
      medical: med,
      transport: conv,
      conveyance: conv,
    }));
  };

  // Recalculate components using current gross salary
  const handleRecalculateBreakdown = () => {
    const gross = Number(formData.grossSalary) || 0;
    handleGrossSalaryChange(gross);
  };

  // Handle Profile Picture Upload inside Add / Edit Employee Form
  const handleFormPhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setPhotoUploadError('');
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setPhotoUploadError('Please select a valid image file (JPG, PNG, WEBP).');
      return;
    }
    try {
      const compressedDataUrl = await compressProfileImage(file);
      setFormData(prev => ({ ...prev, avatar: compressedDataUrl }));
    } catch {
      setPhotoUploadError('Could not process the selected photo. Please try another image.');
    } finally {
      if (formPhotoInputRef.current) formPhotoInputRef.current.value = '';
    }
  };

  // Handle Direct Profile Picture Upload for a Running Employee inside View Modal
  const handleRunningEmployeePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !viewingEmployee) return;
    if (!file.type.startsWith('image/')) return;
    try {
      const compressedDataUrl = await compressProfileImage(file);
      await updateEmployee(viewingEmployee.id, { avatar: compressedDataUrl });
      setViewingEmployee(prev => (prev ? { ...prev, avatar: compressedDataUrl } : null));
      addNotification({
        title: 'Employee Profile Picture Updated',
        message: `Updated profile photo for ${viewingEmployee.name} (${viewingEmployee.employeeId})`,
        read: false,
        type: 'system',
        targetPage: 'employee',
      });
    } catch {} finally {
      if (viewModalPhotoInputRef.current) viewModalPhotoInputRef.current.value = '';
    }
  };

  const openCreateModal = () => {
    setPhotoUploadError('');
    const defaultGross = 30000;
    const p = getPayrollPercentages();
    const basic = Math.round(defaultGross * (p.basicPercent / 100));
    const house = Math.round(defaultGross * (p.houseRentPercent / 100));
    const med = Math.round(defaultGross * (p.medicalPercent / 100));
    const conv = Math.round(defaultGross * (p.conveyancePercent / 100));

    setEditing(null);
    setActiveTab('personal');
    const targetBranch = activeBranch !== 'All' ? activeBranch : (branches[0]?.name || 'Main Head Office (Dhaka)');
    const matchedBranchObj = branches.find(b => b.name === targetBranch) || branches[0];
    setFormData({
      name: '',
      employeeId: `WNH-${1000 + (allEmployees?.length || employees.length) + 1}`,
      email: '',
      phone: '',
      department: departments[0]?.name || 'Engineering',
      designation: '',
      shift: '',
      branch: targetBranch,
      branchId: matchedBranchObj?.id || 'BR-001',
      grossSalary: defaultGross,
      basicSalary: basic,
      basic: basic,
      houseRent: house,
      medical: med,
      transport: conv,
      conveyance: conv,
      food: 0,
      attendanceBonus: 0,
      bankName: '',
      accountNumber: '',
      rfidCard: '',
      password: 'password123',
      joinDate: new Date().toISOString().split('T')[0],
      status: 'active',
      lastWorkingDay: '',
      avatar: '👨‍💼',
      address: '',
      emergencyContact: '',
      managerId: '',
      managerName: '',
      isManager: false,
    });
    setShowForm(true);
  };

  const handleEdit = (emp: Employee) => {
    setPhotoUploadError('');
    setEditing(emp);
    setActiveTab('personal');

    const rawGross = emp.grossSalary ?? (emp.basicSalary ? Math.round(emp.basicSalary * 2) : 30000);
    const p = getPayrollPercentages();
    const basic = emp.basicSalary ?? emp.basic ?? Math.round(rawGross * (p.basicPercent / 100));
    const house = emp.houseRent ?? Math.round(rawGross * (p.houseRentPercent / 100));
    const med = emp.medical ?? Math.round(rawGross * (p.medicalPercent / 100));
    const conv = emp.transport ?? emp.conveyance ?? Math.round(rawGross * (p.conveyancePercent / 100));
    const food = emp.food ?? 0;

    const empDeptTrim = (emp.department || '').trim().toLowerCase();
    const matchedDept = departments.find(d => {
      const dName = (d.name || '').trim().toLowerCase();
      const dCode = (d.code || '').trim().toLowerCase();
      const prefix = dName.slice(0, 8);
      return (
        empDeptTrim === dName ||
        (dCode && empDeptTrim === dCode) ||
        (prefix.length >= 5 && empDeptTrim.startsWith(prefix))
      );
    });

    setFormData({
      name: emp.name || '',
      employeeId: emp.employeeId || '',
      email: emp.email || '',
      phone: emp.phone || '',
      department: matchedDept ? matchedDept.name : (emp.department || departments[0]?.name || ''),
      designation: emp.designation || '',
      shift: emp.shift || '',
      branch: getEmployeeBranch(emp),
      branchId: emp.branchId || branches.find(b => b.name === getEmployeeBranch(emp))?.id || 'BR-001',
      grossSalary: rawGross,
      basicSalary: basic,
      basic: basic,
      houseRent: house,
      medical: med,
      transport: conv,
      conveyance: conv,
      food: food,
      attendanceBonus: emp.attendanceBonus ?? 0,
      bankName: emp.bankName || '',
      accountNumber: emp.accountNumber || '',
      rfidCard: emp.rfidCard || '',
      password: emp.password || 'password123',
      joinDate: emp.joinDate || new Date().toISOString().split('T')[0],
      status: emp.status || 'active',
      lastWorkingDay: emp.lastWorkingDay || '',
      avatar: emp.avatar || '👨‍💼',
      address: emp.address || '',
      emergencyContact: emp.emergencyContact || '',
      managerId: emp.managerId || '',
      managerName: emp.managerName || '',
      isManager: Boolean(emp.isManager),
    });
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const gross = Number(formData.grossSalary) || 0;
    const basic = Number(formData.basicSalary) || 0;
    const house = Number(formData.houseRent) || 0;
    const med = Number(formData.medical) || 0;
    const trans = Number(formData.transport) || 0;
    const food = Number(formData.food) || 0;

    const selectedBranchObj = branches.find(b => b.name === formData.branch);
    const nonActiveStatuses = ['inactive', 'suspended', 'terminated', 'resigned'];
    const isNonActive = nonActiveStatuses.includes(formData.status);
    const effectiveLastWorkingDay = isNonActive
      ? (formData.lastWorkingDay || editing?.lastWorkingDay || getBangladeshTodayStr())
      : undefined;

    const payload: Omit<Employee, 'id'> = {
      ...formData,
      lastWorkingDay: effectiveLastWorkingDay,
      branch: formData.branch || 'Main Head Office (Dhaka)',
      branchId: selectedBranchObj?.id || formData.branchId || 'BR-001',
      grossSalary: gross,
      basicSalary: basic,
      basic: basic,
      houseRent: house,
      medical: med,
      transport: trans,
      conveyance: trans,
      food: food,
      bankName: formData.bankName || '',
      accountNumber: formData.accountNumber || '',
      rfidCard: formData.rfidCard || '',
      password: formData.password || 'password123',
      address: formData.address || '',
      emergencyContact: formData.emergencyContact || '',
    };

    if (editing) {
      await updateEmployee(editing.id, payload);
      addNotification({
        title: 'Employee Profile Updated',
        message: `${formData.name} (${formData.employeeId}) updated with gross salary ৳${gross.toLocaleString()}`,
        read: false,
        type: 'system',
        targetPage: 'employee',
      });
    } else {
      await addEmployee(payload);
      addNotification({
        title: 'New Employee Created',
        message: `${formData.name} (${formData.employeeId}) saved with auto-calculated salary ৳${gross.toLocaleString()}`,
        read: false,
        type: 'system',
        targetPage: 'employee',
      });
    }
    setShowForm(false);
    setEditing(null);
  };

  const handleDelete = async (id: string, name: string) => {
    if (confirm(`Are you sure you want to delete ${name} from Firestore?`)) {
      await deleteEmployee(id);
      addNotification({
        title: 'Employee Deleted',
        message: `${name} was deleted from Firestore`,
        read: false,
        type: 'system',
        targetPage: 'employee',
      });
    }
  };

  const filtered = employees.filter(e => {
    const q = search.toLowerCase().trim();
    const matchesSearch =
      !q ||
      (e.name || '').toLowerCase().includes(q) ||
      (e.employeeId || '').toLowerCase().includes(q) ||
      (e.department || '').toLowerCase().includes(q) ||
      (e.designation || '').toLowerCase().includes(q) ||
      (e.email || '').toLowerCase().includes(q) ||
      (e.phone || '').toLowerCase().includes(q) ||
      (e.rfidCard || '').toLowerCase().includes(q);
    const matchesDept = !deptFilter || e.department === deptFilter;
    const matchesStatus = !statusFilter || e.status === statusFilter;
    return matchesSearch && matchesDept && matchesStatus;
  });

  // Calculate component sum for verification
  const calculatedSum =
    (Number(formData.basicSalary) || 0) +
    (Number(formData.houseRent) || 0) +
    (Number(formData.medical) || 0) +
    (Number(formData.transport) || 0) +
    (Number(formData.food) || 0);

  const getEmpGross = (emp: Employee): number => {
    const explicitGross = Number(emp.grossSalary);
    if (!isNaN(explicitGross) && explicitGross > 0) {
      return explicitGross;
    }
    const compSum =
      (Number(emp.basicSalary ?? emp.basic) || 0) +
      (Number(emp.houseRent) || 0) +
      (Number(emp.medical) || 0) +
      (Number(emp.transport ?? emp.conveyance) || 0) +
      (Number(emp.food) || 0);
    if (compSum > 0) {
      return compSum;
    }
    const basicOnly = Number(emp.basicSalary ?? emp.basic) || 0;
    return basicOnly > 0 ? basicOnly * 2 : 0;
  };

  const totalPayrollGross = useMemo(() => {
    return employees.reduce((acc, emp) => acc + getEmpGross(emp), 0);
  }, [employees]);

  const activeStaffCount = useMemo(() => {
    return employees.filter(e => e.status === 'active').length;
  }, [employees]);

  const payrollPercentages = getPayrollPercentages();

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Header & Metrics */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-800">Employee Management</h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Manage employee profiles, biometric enrollment, shifts, and auto-calculated salary structures
          </p>
        </div>
        <button
          id="btn-add-employee"
          onClick={openCreateModal}
          className="w-full sm:w-auto px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-2xs font-semibold flex items-center justify-center space-x-2 transition-all cursor-pointer"
        >
          <span className="text-base">➕</span>
          <span className="text-xs sm:text-sm">Add Employee</span>
        </button>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
        <div className="p-3.5 sm:p-4 bg-white rounded-2xl border border-slate-200 shadow-2xs">
          <p className="text-[10px] sm:text-xs font-semibold text-slate-400 uppercase tracking-wide">Total Employees</p>
          <p className="text-xl sm:text-2xl font-bold text-slate-800 mt-1">{employees.length}</p>
        </div>
        <div className="p-3.5 sm:p-4 bg-white rounded-2xl border border-slate-200 shadow-2xs">
          <p className="text-[10px] sm:text-xs font-semibold text-emerald-600 uppercase tracking-wide">Active Staff</p>
          <p className="text-xl sm:text-2xl font-bold text-emerald-600 mt-1">{activeStaffCount}</p>
        </div>
        <div className="p-3.5 sm:p-4 bg-white rounded-2xl border border-slate-200 shadow-2xs">
          <p className="text-[10px] sm:text-xs font-semibold text-indigo-600 uppercase tracking-wide">Monthly Payroll</p>
          <p className="text-lg sm:text-2xl font-bold text-indigo-600 mt-1 truncate">৳ {totalPayrollGross.toLocaleString()}</p>
        </div>
        <div className="p-3.5 sm:p-4 bg-white rounded-2xl border border-slate-200 shadow-2xs">
          <p className="text-[10px] sm:text-xs font-semibold text-slate-400 uppercase tracking-wide">Departments</p>
          <p className="text-xl sm:text-2xl font-bold text-slate-800 mt-1">{departments.length}</p>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="bg-white rounded-2xl p-3.5 sm:p-4 shadow-2xs border border-slate-200 grid grid-cols-1 md:grid-cols-5 gap-2.5 sm:gap-3">
        <div className="md:col-span-2">
          <input
            type="text"
            placeholder="🔍 Search name, ID, RFID, branch, phone or email..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs sm:text-sm"
          />
        </div>
        <div>
          <select
            value={activeBranch}
            onChange={e => setActiveBranch(e.target.value)}
            className="w-full px-3.5 py-2 bg-indigo-50/70 border border-indigo-200 rounded-xl font-semibold text-indigo-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs sm:text-sm"
          >
            <option value="All">🏢 All Offices ({allEmployees.length})</option>
            {branches.map(b => {
              const count = allEmployees.filter(e => getEmployeeBranch(e) === b.name).length;
              return (
                <option key={b.id} value={b.name}>
                  {b.isHeadOffice ? '🏢 ' : '📍 '}{b.name} ({count})
                </option>
              );
            })}
          </select>
        </div>
        <div>
          <select
            value={deptFilter}
            onChange={e => setDeptFilter(e.target.value)}
            className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs sm:text-sm"
          >
            <option value="">All Departments</option>
            {departments.map(d => (
              <option key={d.id} value={d.name}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs sm:text-sm"
          >
            <option value="">All Statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="on_leave">On Leave</option>
          </select>
        </div>
      </div>

      {/* Employee List Table */}
      <div className="bg-white rounded-2xl shadow-2xs border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto thin-scroll">
          <table className="w-full text-xs sm:text-sm min-w-[820px]">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-slate-700 whitespace-nowrap min-w-[200px]">EMPLOYEE</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700 whitespace-nowrap min-w-[110px]">ID / RFID</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700 whitespace-nowrap min-w-[130px]">DEPARTMENT</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700 whitespace-nowrap min-w-[130px]">DESIGNATION</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700 whitespace-nowrap min-w-[120px]">SHIFT</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700 whitespace-nowrap min-w-[140px]">SALARY BREAKDOWN</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700 whitespace-nowrap min-w-[110px]">STATUS</th>
                <th className="px-4 py-3 text-right font-semibold text-slate-700 whitespace-nowrap min-w-[110px]">ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-10 text-slate-400">
                    No employees found matching your criteria.
                  </td>
                </tr>
              ) : (
                filtered.map(emp => {
                  const gross = getEmpGross(emp);
                  const basic = Number(emp.basicSalary ?? emp.basic) || Math.round(gross * 0.5);

                  return (
                    <tr key={emp.id} className="border-b border-slate-100 hover:bg-slate-50/80 transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center space-x-3">
                          <Avatar
                            avatar={emp.avatar}
                            name={emp.name}
                            sizeClass="w-10 h-10"
                            roundedClass="rounded-xl"
                          />
                          <div>
                            <div className="font-semibold text-slate-800 whitespace-nowrap">{emp.name}</div>
                            <div className="text-xs text-slate-400 whitespace-nowrap">{emp.email || emp.phone}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="font-mono text-xs font-bold text-indigo-600">{emp.employeeId}</div>
                        {emp.rfidCard && (
                          <div className="text-[11px] font-mono text-slate-400">RFID: {emp.rfidCard}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="font-medium text-slate-700">{emp.department}</div>
                        <div className="text-[11px] font-semibold text-indigo-600 mt-0.5 flex items-center space-x-1">
                          <span>🏢</span>
                          <span>{getEmployeeBranch(emp)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{emp.designation}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="inline-block whitespace-nowrap px-2.5 py-1 bg-slate-100 text-slate-700 rounded-lg text-xs font-semibold border border-slate-200/60">
                          {emp.shift}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="font-bold text-indigo-700 whitespace-nowrap">৳ {gross.toLocaleString()}</div>
                        <div className="text-[11px] text-slate-500 whitespace-nowrap">Basic: ৳ {basic.toLocaleString()}</div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`inline-block whitespace-nowrap text-xs px-2.5 py-1 rounded-full font-semibold ${
                            emp.status === 'active'
                              ? 'bg-emerald-100 text-emerald-700'
                              : emp.status === 'on_leave'
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {emp.status === 'active' ? 'Active' : emp.status === 'on_leave' ? 'On Leave' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right space-x-1.5">
                        <button
                          onClick={() => setViewingEmployee(emp)}
                          className="px-2.5 py-1.5 text-xs font-medium border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-100 transition-all"
                          title="View Profile & Salary Breakdown"
                        >
                          View
                        </button>
                        <button
                          onClick={() => handleEdit(emp)}
                          className="px-2.5 py-1.5 text-xs font-medium border border-indigo-200 text-indigo-600 rounded-lg hover:bg-indigo-50 transition-all"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(emp.id, emp.name)}
                          className="px-2.5 py-1.5 text-xs font-medium border border-rose-200 text-rose-600 rounded-lg hover:bg-rose-50 transition-all"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-3xl p-6 max-h-[92vh] overflow-y-auto shadow-2xl animate-slide-down border border-slate-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center space-x-3">
                <Avatar
                  avatar={formData.avatar}
                  name={formData.name}
                  sizeClass="w-12 h-12"
                  textClass="text-2xl"
                  roundedClass="rounded-xl"
                  bgClass="bg-indigo-50 text-indigo-700"
                />
                <div>
                  <h3 className="text-lg font-bold text-slate-900">
                    {editing ? `Edit ${editing.name}` : 'Add New Employee'}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {editing ? `Employee Code: ${editing.employeeId}` : 'Complete employee profile and auto-calculated compensation'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 text-lg"
              >
                ✕
              </button>
            </div>

            {/* Navigation Tabs inside Modal */}
            <div className="flex space-x-2 border-b border-slate-100 my-4">
              <button
                type="button"
                onClick={() => setActiveTab('personal')}
                className={`pb-2.5 px-3 text-xs font-bold border-b-2 transition-all ${
                  activeTab === 'personal'
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                👤 Personal &amp; Employment
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('salary')}
                className={`pb-2.5 px-3 text-xs font-bold border-b-2 transition-all flex items-center space-x-1.5 ${
                  activeTab === 'salary'
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <span>💰 Salary &amp; Auto-Calculation</span>
                <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] rounded-full font-bold">
                  Auto
                </span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('access')}
                className={`pb-2.5 px-3 text-xs font-bold border-b-2 transition-all ${
                  activeTab === 'access'
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                🔐 Biometrics, Banking &amp; Info
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* TAB 1: PERSONAL & EMPLOYMENT */}
              {activeTab === 'personal' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-semibold text-slate-700">Full Name *</label>
                      <input
                        type="text"
                        required
                        value={formData.name}
                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                        placeholder="e.g. Tanvir Ahmed"
                        className="w-full mt-1 px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-700">Employee ID / Code *</label>
                      <input
                        type="text"
                        required
                        value={formData.employeeId}
                        onChange={e => setFormData({ ...formData, employeeId: e.target.value })}
                        placeholder="e.g. WNH-1001"
                        className="w-full mt-1 px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-semibold text-slate-700">Email Address *</label>
                      <input
                        type="email"
                        required
                        value={formData.email}
                        onChange={e => setFormData({ ...formData, email: e.target.value })}
                        placeholder="e.g. tanvir@company.com"
                        className="w-full mt-1 px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-700">Phone Number *</label>
                      <input
                        type="tel"
                        required
                        value={formData.phone}
                        onChange={e => setFormData({ ...formData, phone: e.target.value })}
                        placeholder="e.g. +880 1712-345678"
                        className="w-full mt-1 px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="bg-indigo-50/70 border border-indigo-200 rounded-xl p-3.5">
                    <label className="text-xs font-bold text-indigo-900 block mb-1">
                      Assigned Branch Office (কোন অফিসে কর্মরত?) *
                    </label>
                    <select
                      value={formData.branch || 'Main Head Office (Dhaka)'}
                      onChange={e => {
                        const bObj = branches.find(b => b.name === e.target.value);
                        setFormData({ ...formData, branch: e.target.value, branchId: bObj?.id || 'BR-001' });
                      }}
                      className="w-full px-3.5 py-2 border border-indigo-200 rounded-xl text-sm font-bold text-slate-800 bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    >
                      {branches.map(b => (
                        <option key={b.id} value={b.name}>
                          {b.isHeadOffice ? `🏢 [Head Office] ${b.name}` : `📍 [Branch] ${b.name}`} — {b.city} ({b.code})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="text-xs font-semibold text-slate-700">Department *</label>
                      <select
                        value={formData.department}
                        onChange={e => setFormData({ ...formData, department: e.target.value })}
                        className="w-full mt-1 px-3.5 py-2 border border-slate-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      >
                        {departments.map(d => (
                          <option key={d.id} value={d.name}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-700">Designation *</label>
                      <input
                        type="text"
                        required
                        value={formData.designation}
                        onChange={e => setFormData({ ...formData, designation: e.target.value })}
                        placeholder="e.g. Senior Software Engineer"
                        className="w-full mt-1 px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-700">Assigned Shift</label>
                      <select
                        value={formData.shift}
                        onChange={e => setFormData({ ...formData, shift: e.target.value })}
                        className="w-full mt-1 px-3.5 py-2 border border-slate-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none cursor-pointer"
                      >
                        <option value="">-- No Fixed Shift (Roster Governed) --</option>
                        {shifts.map(s => (
                          <option key={s.id} value={s.name}>
                            {s.name} ({s.startTime}-{s.endTime})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="text-xs font-semibold text-slate-700">Gross Salary (BDT) *</label>
                      <div className="relative mt-1">
                        <span className="absolute left-3 top-2 text-xs font-bold text-indigo-600">৳</span>
                        <input
                          type="number"
                          required
                          min="0"
                          step="100"
                          value={formData.grossSalary || ''}
                          onChange={e => handleGrossSalaryChange(Number(e.target.value))}
                          placeholder="e.g. 30000"
                          className="w-full pl-7 pr-3.5 py-2 border border-indigo-200 bg-indigo-50/40 rounded-xl text-sm font-bold text-indigo-900 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-700">Joining Date</label>
                      <input
                        type="date"
                        required
                        value={formData.joinDate}
                        onChange={e => setFormData({ ...formData, joinDate: e.target.value })}
                        className="w-full mt-1 px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-700">Employment Status</label>
                      <select
                        value={formData.status}
                        onChange={e => {
                          const nextStatus = e.target.value as any;
                          setFormData(prev => ({
                            ...prev,
                            status: nextStatus,
                            lastWorkingDay: nextStatus !== 'active' && !prev.lastWorkingDay ? getBangladeshTodayStr() : prev.lastWorkingDay,
                          }));
                        }}
                        className="w-full mt-1 px-3.5 py-2 border border-slate-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      >
                        <option value="active">Active (সক্রিয়)</option>
                        <option value="inactive">Inactive (নিষ্ক্রিয়)</option>
                        <option value="suspended">Suspended (স্থগিত)</option>
                        <option value="terminated">Terminated (বরখাস্ত)</option>
                        <option value="on_leave">On Leave (ছুটিতে)</option>
                      </select>
                    </div>

                    {formData.status !== 'active' && formData.status !== 'on_leave' && (
                      <div className="col-span-1 md:col-span-3 p-3 bg-amber-50/70 border border-amber-200 rounded-xl animate-fade-in">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div>
                            <label className="text-xs font-bold text-amber-900 block">
                              Last Working Day / Exit Date (শেষ কর্মদিবস)
                            </label>
                            <p className="text-[11px] text-amber-700 mt-0.5">
                              এই তারিখের পর থেকে কর্মীকে আর দৈনিক হাজিরায় Absent বা তালিকায় দেখানো হবে না। অতীতের সব রেকর্ড সংরক্ষিত থাকবে।
                            </p>
                          </div>
                          <input
                            type="date"
                            value={formData.lastWorkingDay || ''}
                            onChange={e => setFormData({ ...formData, lastWorkingDay: e.target.value })}
                            className="px-3 py-1.5 border border-amber-300 bg-white rounded-lg text-xs font-semibold text-slate-800 focus:ring-2 focus:ring-amber-500 focus:outline-none shrink-0"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Reporting Manager & Manager Self-Service Role */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
                    <div>
                      <label className="text-xs font-semibold text-slate-700">Reporting Manager (Direct Supervisor)</label>
                      <select
                        value={formData.managerId || ''}
                        onChange={e => {
                          const mgr = employees.find(x => x.employeeId === e.target.value || x.id === e.target.value);
                          setFormData({
                            ...formData,
                            managerId: e.target.value,
                            managerName: mgr ? mgr.name : '',
                          });
                        }}
                        className="w-full mt-1 px-3.5 py-2 border border-slate-200 rounded-xl text-xs bg-white"
                      >
                        <option value="">-- Department Head / HR Default --</option>
                        {employees
                          .filter(x => !editing || x.id !== editing.id)
                          .map(x => (
                            <option key={x.id} value={x.employeeId || x.id}>
                              {x.name} ({x.employeeId}) · {x.designation}
                            </option>
                          ))}
                      </select>
                    </div>
                    <div className="flex items-center pt-5">
                      <label className="inline-flex items-center space-x-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean(formData.isManager)}
                          onChange={e => setFormData({ ...formData, isManager: e.target.checked })}
                          className="w-4 h-4 text-indigo-600 rounded"
                        />
                        <span className="text-xs font-bold text-slate-800">
                          Enable Manager Self-Service (MSS) for this employee
                        </span>
                      </label>
                    </div>
                  </div>

                  {/* Employee Profile Picture Upload & Avatar Selection */}
                  <div className="p-4 bg-indigo-50/50 border-2 border-dashed border-indigo-200 rounded-2xl space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center space-x-3.5">
                        <Avatar
                          avatar={formData.avatar}
                          name={formData.name || 'Profile Preview'}
                          sizeClass="w-16 h-16"
                          textClass="text-3xl font-bold"
                          roundedClass="rounded-2xl"
                          bgClass="bg-white border-2 border-indigo-200 text-indigo-700"
                        />
                        <div>
                          <label className="text-xs sm:text-sm font-extrabold text-indigo-950 block">
                            📷 Employee Profile Picture (প্রোফাইল ছবি আপলোড করুন)
                          </label>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            Upload employee photo (JPG, PNG, WEBP) for New or Running Employee profile &amp; ID card.
                          </p>
                          {isImageAvatar(formData.avatar) && (
                            <span className="inline-block mt-1 px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded text-[10px] font-bold">
                              ✅ Custom Profile Photo Uploaded
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <label className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer inline-flex items-center space-x-1.5">
                          <span>📤 Upload Photo</span>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handleFormPhotoSelect}
                            className="hidden"
                          />
                        </label>
                        {isImageAvatar(formData.avatar) && (
                          <button
                            type="button"
                            onClick={() => setFormData({ ...formData, avatar: '👨‍💼' })}
                            className="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-xl text-xs font-bold cursor-pointer"
                          >
                            ✕ Remove Photo
                          </button>
                        )}
                      </div>
                    </div>

                    {photoUploadError && (
                      <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs font-semibold">
                        ⚠️ {photoUploadError}
                      </div>
                    )}

                    <div className="pt-2 border-t border-indigo-100">
                      <label className="text-[11px] font-semibold text-slate-500 block mb-1.5">
                        Or choose a default avatar icon if no photo is uploaded:
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {AVATAR_OPTIONS.map(em => (
                          <button
                            key={em}
                            type="button"
                            onClick={() => setFormData({ ...formData, avatar: em })}
                            className={`w-9 h-9 text-lg rounded-xl border flex items-center justify-center transition-all cursor-pointer ${
                              formData.avatar === em
                                ? 'border-indigo-600 bg-white ring-2 ring-indigo-500/20 shadow-2xs'
                                : 'border-slate-200 bg-white/70 hover:bg-white'
                            }`}
                          >
                            {em}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="pt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => setActiveTab('salary')}
                      className="px-4 py-2 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-xl text-xs font-bold transition-all flex items-center space-x-1"
                    >
                      <span>Next: Salary &amp; Auto-Calculation</span>
                      <span>→</span>
                    </button>
                  </div>
                </div>
              )}

              {/* TAB 2: SALARY & AUTO-CALCULATION (THE CORE RESTORED FEATURE) */}
              {activeTab === 'salary' && (
                <div className="space-y-4">
                  {/* Highlighted Gross Salary Card */}
                  <div className="p-4 bg-gradient-to-r from-indigo-50/80 to-purple-50/80 border-2 border-indigo-200 rounded-2xl">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                      <div>
                        <label className="text-sm font-bold text-indigo-900 flex items-center space-x-1.5">
                          <span>💰 Gross Salary (BDT) *</span>
                          <span className="text-[11px] font-normal text-indigo-700 bg-indigo-100/80 px-2 py-0.5 rounded-full">
                            Master Input
                          </span>
                        </label>
                        <p className="text-xs text-indigo-700/80 mt-0.5">
                          Entering Gross Salary automatically calculates and populates all standard breakdown components below.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleRecalculateBreakdown}
                        className="self-start sm:self-auto px-3 py-1.5 bg-white border border-indigo-200 hover:border-indigo-300 text-indigo-700 rounded-xl text-xs font-semibold shadow-xs flex items-center space-x-1 hover:bg-indigo-50/50 transition-all"
                      >
                        <span>🔄</span>
                        <span>Recalculate Breakdown</span>
                      </button>
                    </div>

                    <div className="relative mt-2">
                      <span className="absolute left-3.5 top-2.5 text-base font-bold text-indigo-400">৳</span>
                      <input
                        id="input-gross-salary"
                        type="number"
                        required
                        min="0"
                        step="100"
                        value={formData.grossSalary || ''}
                        onChange={e => handleGrossSalaryChange(Number(e.target.value))}
                        placeholder="e.g. 50000"
                        className="w-full pl-8 pr-4 py-2.5 text-lg font-bold text-indigo-950 bg-white border border-indigo-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none shadow-xs"
                      />
                    </div>

                    {/* Formula notice */}
                    <div className="mt-3 flex flex-wrap items-center justify-between text-xs text-indigo-800/90 pt-2 border-t border-indigo-100">
                      <span>
                        Current Formula: Basic {payrollPercentages.basicPercent}%, House Rent {payrollPercentages.houseRentPercent}%, Medical {payrollPercentages.medicalPercent}%, Transport {payrollPercentages.conveyancePercent}%
                      </span>
                      <span className="font-semibold text-emerald-700">
                        ✓ Synchronized Auto-Calculation
                      </span>
                    </div>
                  </div>

                  {/* Calculated Salary Components Grid (Editable for Manual Overrides) */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                        Salary Components Breakdown (Editable)
                      </h4>
                      <span className="text-xs text-slate-500">
                        Sum: <strong className="text-slate-800">৳ {calculatedSum.toLocaleString()}</strong> / Gross: <strong className="text-indigo-600">৳ {(formData.grossSalary || 0).toLocaleString()}</strong>
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {/* Basic Salary */}
                      <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-xs font-bold text-slate-700">Basic Salary</label>
                          <span className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">
                            {payrollPercentages.basicPercent}% of Gross
                          </span>
                        </div>
                        <div className="relative">
                          <span className="absolute left-3 top-2 text-xs text-slate-400 font-bold">৳</span>
                          <input
                            type="number"
                            value={formData.basicSalary || ''}
                            onChange={e => {
                              const val = Number(e.target.value);
                              setFormData({ ...formData, basicSalary: val, basic: val });
                            }}
                            className="w-full pl-7 pr-3 py-1.5 border border-slate-200 rounded-lg text-sm font-semibold bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                          />
                        </div>
                      </div>

                      {/* House Rent */}
                      <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-xs font-bold text-slate-700">House Rent Allowance</label>
                          <span className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">
                            {payrollPercentages.houseRentPercent}% of Gross
                          </span>
                        </div>
                        <div className="relative">
                          <span className="absolute left-3 top-2 text-xs text-slate-400 font-bold">৳</span>
                          <input
                            type="number"
                            value={formData.houseRent || ''}
                            onChange={e => setFormData({ ...formData, houseRent: Number(e.target.value) })}
                            className="w-full pl-7 pr-3 py-1.5 border border-slate-200 rounded-lg text-sm font-semibold bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                          />
                        </div>
                      </div>

                      {/* Medical Allowance */}
                      <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-xs font-bold text-slate-700">Medical Allowance</label>
                          <span className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">
                            {payrollPercentages.medicalPercent}% of Gross
                          </span>
                        </div>
                        <div className="relative">
                          <span className="absolute left-3 top-2 text-xs text-slate-400 font-bold">৳</span>
                          <input
                            type="number"
                            value={formData.medical || ''}
                            onChange={e => setFormData({ ...formData, medical: Number(e.target.value) })}
                            className="w-full pl-7 pr-3 py-1.5 border border-slate-200 rounded-lg text-sm font-semibold bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                          />
                        </div>
                      </div>

                      {/* Transport / Conveyance */}
                      <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-xs font-bold text-slate-700">Transport / Conveyance</label>
                          <span className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">
                            {payrollPercentages.conveyancePercent}% of Gross
                          </span>
                        </div>
                        <div className="relative">
                          <span className="absolute left-3 top-2 text-xs text-slate-400 font-bold">৳</span>
                          <input
                            type="number"
                            value={formData.transport || formData.conveyance || ''}
                            onChange={e => {
                              const val = Number(e.target.value);
                              setFormData({ ...formData, transport: val, conveyance: val });
                            }}
                            className="w-full pl-7 pr-3 py-1.5 border border-slate-200 rounded-lg text-sm font-semibold bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                          />
                        </div>
                      </div>

                      {/* Food Allowance */}
                      <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-xs font-bold text-slate-700">Food Allowance</label>
                          <span className="text-[10px] font-semibold text-slate-500 bg-slate-200 px-1.5 py-0.5 rounded">
                            Optional
                          </span>
                        </div>
                        <div className="relative">
                          <span className="absolute left-3 top-2 text-xs text-slate-400 font-bold">৳</span>
                          <input
                            type="number"
                            value={formData.food || ''}
                            onChange={e => setFormData({ ...formData, food: Number(e.target.value) })}
                            placeholder="0"
                            className="w-full pl-7 pr-3 py-1.5 border border-slate-200 rounded-lg text-sm font-semibold bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                          />
                        </div>
                      </div>

                      {/* Attendance Bonus */}
                      <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-xs font-bold text-slate-700">Attendance Bonus</label>
                          <span className="text-[10px] font-semibold text-slate-500 bg-slate-200 px-1.5 py-0.5 rounded">
                            Optional
                          </span>
                        </div>
                        <div className="relative">
                          <span className="absolute left-3 top-2 text-xs text-slate-400 font-bold">৳</span>
                          <input
                            type="number"
                            value={formData.attendanceBonus || ''}
                            onChange={e => setFormData({ ...formData, attendanceBonus: Number(e.target.value) })}
                            placeholder="0"
                            className="w-full pl-7 pr-3 py-1.5 border border-slate-200 rounded-lg text-sm font-semibold bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Visual Proportion Bar */}
                  <div className="p-3 bg-white border border-slate-200 rounded-xl space-y-2">
                    <p className="text-xs font-bold text-slate-700">Salary Component Distribution</p>
                    <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden flex">
                      <div
                        style={{ width: `${payrollPercentages.basicPercent}%` }}
                        className="bg-indigo-600 h-full"
                        title={`Basic: ${payrollPercentages.basicPercent}%`}
                      />
                      <div
                        style={{ width: `${payrollPercentages.houseRentPercent}%` }}
                        className="bg-blue-500 h-full"
                        title={`House Rent: ${payrollPercentages.houseRentPercent}%`}
                      />
                      <div
                        style={{ width: `${payrollPercentages.medicalPercent}%` }}
                        className="bg-emerald-500 h-full"
                        title={`Medical: ${payrollPercentages.medicalPercent}%`}
                      />
                      <div
                        style={{ width: `${payrollPercentages.conveyancePercent}%` }}
                        className="bg-amber-500 h-full"
                        title={`Transport: ${payrollPercentages.conveyancePercent}%`}
                      />
                    </div>
                    <div className="flex flex-wrap gap-3 text-[11px] text-slate-600">
                      <span className="flex items-center space-x-1">
                        <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 inline-block" />
                        <span>Basic ({payrollPercentages.basicPercent}%)</span>
                      </span>
                      <span className="flex items-center space-x-1">
                        <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" />
                        <span>House Rent ({payrollPercentages.houseRentPercent}%)</span>
                      </span>
                      <span className="flex items-center space-x-1">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
                        <span>Medical ({payrollPercentages.medicalPercent}%)</span>
                      </span>
                      <span className="flex items-center space-x-1">
                        <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" />
                        <span>Transport ({payrollPercentages.conveyancePercent}%)</span>
                      </span>
                    </div>
                  </div>

                  <div className="pt-2 flex justify-between">
                    <button
                      type="button"
                      onClick={() => setActiveTab('personal')}
                      className="px-3.5 py-2 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl text-xs font-semibold"
                    >
                      ← Back
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab('access')}
                      className="px-4 py-2 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-xl text-xs font-bold transition-all flex items-center space-x-1"
                    >
                      <span>Next: Biometrics &amp; Banking</span>
                      <span>→</span>
                    </button>
                  </div>
                </div>
              )}

              {/* TAB 3: BIOMETRICS, BANKING & INFO */}
              {activeTab === 'access' && (
                <div className="space-y-4">
                  {/* Biometric Card & Login Info */}
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
                    <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                      Biometric Device &amp; Portal Authentication
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-semibold text-slate-700">
                          RFID / Biometric Card ID (ZKTeco SenseFace 2A)
                        </label>
                        <input
                          type="text"
                          value={formData.rfidCard || ''}
                          onChange={e => setFormData({ ...formData, rfidCard: e.target.value })}
                          placeholder="e.g. 0008472911"
                          className="w-full mt-1 px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-mono bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                        />
                        <p className="text-[11px] text-slate-400 mt-1">
                          Enter physical card badge number or biometric enrolled ID.
                        </p>
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-slate-700">
                          Portal Login Password
                        </label>
                        <input
                          type="password"
                          value={formData.password || ''}
                          onChange={e => setFormData({ ...formData, password: e.target.value })}
                          placeholder="••••••••"
                          className="w-full mt-1 px-3.5 py-2 border border-slate-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                        />
                        <p className="text-[11px] text-slate-400 mt-1">
                          Used by employee for self-service camera check-in portal.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Banking Info */}
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
                    <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                      Banking &amp; Payroll Disbursal
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-semibold text-slate-700">Bank Name / Provider</label>
                        <input
                          type="text"
                          value={formData.bankName || ''}
                          onChange={e => setFormData({ ...formData, bankName: e.target.value })}
                          placeholder="e.g. Dutch-Bangla Bank / bKash"
                          className="w-full mt-1 px-3.5 py-2 border border-slate-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-slate-700">Account / Wallet Number</label>
                        <input
                          type="text"
                          value={formData.accountNumber || ''}
                          onChange={e => setFormData({ ...formData, accountNumber: e.target.value })}
                          placeholder="e.g. 104.120.98472"
                          className="w-full mt-1 px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-mono bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Address & Emergency Contact */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-semibold text-slate-700">Present Address</label>
                      <input
                        type="text"
                        value={formData.address || ''}
                        onChange={e => setFormData({ ...formData, address: e.target.value })}
                        placeholder="e.g. House 14, Road 5, Dhanmondi, Dhaka"
                        className="w-full mt-1 px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-700">Emergency Contact</label>
                      <input
                        type="text"
                        value={formData.emergencyContact || ''}
                        onChange={e => setFormData({ ...formData, emergencyContact: e.target.value })}
                        placeholder="e.g. Brother (+880 1812-998877)"
                        className="w-full mt-1 px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="pt-2 flex justify-between">
                    <button
                      type="button"
                      onClick={() => setActiveTab('salary')}
                      className="px-3.5 py-2 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl text-xs font-semibold"
                    >
                      ← Back to Salary
                    </button>
                  </div>
                </div>
              )}

              {/* Form Action Buttons */}
              <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-5 py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-sm font-semibold transition-all"
                >
                  Cancel
                </button>
                <button
                  id="btn-save-employee"
                  type="submit"
                  className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold shadow-md hover:shadow-lg transition-all"
                >
                  {editing ? 'Update Employee' : 'Save Employee'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* View Employee Profile & Salary Breakdown Modal */}
      {viewingEmployee && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto shadow-2xl animate-slide-down border border-slate-200">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center space-x-3.5">
                <Avatar
                  avatar={viewingEmployee.avatar}
                  name={viewingEmployee.name}
                  sizeClass="w-14 h-14"
                  textClass="text-2xl font-bold"
                  roundedClass="rounded-2xl"
                />
                <div>
                  <h3 className="text-lg font-bold text-slate-900">{viewingEmployee.name}</h3>
                  <p className="text-xs text-slate-500">
                    {viewingEmployee.designation} • {viewingEmployee.department} ({viewingEmployee.employeeId})
                  </p>
                  <label className="mt-1.5 inline-flex items-center space-x-1 px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-[11px] font-bold cursor-pointer transition-all">
                    <span>📷 Change Profile Photo</span>
                    <input
                      ref={viewModalPhotoInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleRunningEmployeePhotoSelect}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setViewingEmployee(null)}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 text-lg"
              >
                ✕
              </button>
            </div>

            <div className="space-y-5 my-4">
              {/* Status Badge & Basic Info */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 bg-slate-50 rounded-xl">
                  <span className="text-[11px] text-slate-400 uppercase font-semibold block">Status</span>
                  <span className="text-xs font-bold text-emerald-700">{viewingEmployee.status}</span>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl">
                  <span className="text-[11px] text-slate-400 uppercase font-semibold block">Shift</span>
                  <span className="text-xs font-bold text-slate-800">{viewingEmployee.shift}</span>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl">
                  <span className="text-[11px] text-slate-400 uppercase font-semibold block">RFID Card</span>
                  <span className="text-xs font-mono font-bold text-indigo-600">
                    {viewingEmployee.rfidCard || 'Not Assigned'}
                  </span>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl">
                  <span className="text-[11px] text-slate-400 uppercase font-semibold block">Joining Date</span>
                  <span className="text-xs font-bold text-slate-800">{viewingEmployee.joinDate}</span>
                </div>
              </div>

              {/* Salary Breakdown Card */}
              <div className="p-4 bg-indigo-50/60 border border-indigo-100 rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-indigo-900 uppercase tracking-wide">
                    Compensation &amp; Salary Structure
                  </h4>
                  <span className="text-sm font-bold text-indigo-700">
                    Gross: ৳{' '}
                    {(
                      viewingEmployee.grossSalary ??
                      (viewingEmployee.basicSalary ? viewingEmployee.basicSalary * 2 : 0)
                    ).toLocaleString()}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                  <div className="p-2.5 bg-white rounded-lg border border-indigo-100">
                    <span className="text-slate-500 block">Basic Salary</span>
                    <span className="font-bold text-slate-800">
                      ৳ {(viewingEmployee.basicSalary ?? viewingEmployee.basic ?? 0).toLocaleString()}
                    </span>
                  </div>
                  <div className="p-2.5 bg-white rounded-lg border border-indigo-100">
                    <span className="text-slate-500 block">House Rent</span>
                    <span className="font-bold text-slate-800">
                      ৳ {(viewingEmployee.houseRent ?? 0).toLocaleString()}
                    </span>
                  </div>
                  <div className="p-2.5 bg-white rounded-lg border border-indigo-100">
                    <span className="text-slate-500 block">Medical Allowance</span>
                    <span className="font-bold text-slate-800">
                      ৳ {(viewingEmployee.medical ?? 0).toLocaleString()}
                    </span>
                  </div>
                  <div className="p-2.5 bg-white rounded-lg border border-indigo-100">
                    <span className="text-slate-500 block">Transport Allowance</span>
                    <span className="font-bold text-slate-800">
                      ৳ {(viewingEmployee.transport ?? viewingEmployee.conveyance ?? 0).toLocaleString()}
                    </span>
                  </div>
                  <div className="p-2.5 bg-white rounded-lg border border-indigo-100">
                    <span className="text-slate-500 block">Food Allowance</span>
                    <span className="font-bold text-slate-800">
                      ৳ {(viewingEmployee.food ?? 0).toLocaleString()}
                    </span>
                  </div>
                  <div className="p-2.5 bg-white rounded-lg border border-indigo-100">
                    <span className="text-slate-500 block">Attendance Bonus</span>
                    <span className="font-bold text-slate-800">
                      ৳ {(viewingEmployee.attendanceBonus ?? 0).toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>

              {/* Contact & Banking Information */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="p-3 bg-slate-50 rounded-xl space-y-1">
                  <span className="text-slate-400 font-semibold block">Contact Details</span>
                  <div className="font-medium text-slate-700">Email: {viewingEmployee.email}</div>
                  <div className="font-medium text-slate-700">Phone: {viewingEmployee.phone}</div>
                  <div className="text-slate-500">Address: {viewingEmployee.address || 'N/A'}</div>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl space-y-1">
                  <span className="text-slate-400 font-semibold block">Banking &amp; Emergency</span>
                  <div className="font-medium text-slate-700">
                    Bank: {viewingEmployee.bankName || 'N/A'}
                  </div>
                  <div className="font-medium text-slate-700 font-mono">
                    A/C: {viewingEmployee.accountNumber || 'N/A'}
                  </div>
                  <div className="text-slate-500">
                    Emergency: {viewingEmployee.emergencyContact || 'N/A'}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setViewingEmployee(null)}
                className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-xs font-semibold hover:bg-slate-50"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  const target = viewingEmployee;
                  setViewingEmployee(null);
                  handleEdit(target);
                }}
                className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700"
              >
                Edit Employee
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
