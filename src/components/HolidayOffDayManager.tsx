import React, { useState, useMemo } from 'react';
import {
  useData,
  CompanyHoliday,
  HolidayType,
  HolidayScope,
  Employee,
} from '../context/DataContext';
import { useTenant } from '../context/TenantContext';
import { printViaIframe } from '../utils/reportPrinter';

interface Props {
  onClose?: () => void;
  isModal?: boolean;
}

type HolidayPreset = {
  title: string;
  type: HolidayType;
  defaultDurationDays: number;
  monthDayStart: { month: number; day: number }; // 0-indexed month
  description: string;
  icon: string;
};

const BANGLADESH_HOLIDAY_PRESETS: HolidayPreset[] = [
  {
    title: 'Eid-ul-Fitr (ঈদুল ফিতর)',
    type: 'religious',
    defaultDurationDays: 3,
    monthDayStart: { month: 2, day: 31 }, // Late March / Early April
    description: 'Holy Eid-ul-Fitr religious festival and government holiday (3 days).',
    icon: '🌙',
  },
  {
    title: 'Eid-ul-Adha (ঈদুল আযহা)',
    type: 'religious',
    defaultDurationDays: 3,
    monthDayStart: { month: 5, day: 6 }, // June
    description: 'Holy Eid-ul-Adha Qurbani festival and government holiday (3 days).',
    icon: '🕋',
  },
  {
    title: 'Durga Puja / Bijoya Dashami (শারদীয় দুর্গাপূজা)',
    type: 'religious',
    defaultDurationDays: 2,
    monthDayStart: { month: 9, day: 20 }, // October
    description: 'Sharadiya Durga Puja & Bijoya Dashami religious holiday.',
    icon: '🪔',
  },
  {
    title: 'Independence Day (২৬শে মার্চ - স্বাধীনতা দিবস)',
    type: 'government',
    defaultDurationDays: 1,
    monthDayStart: { month: 2, day: 26 }, // March 26
    description: 'National Independence and National Day of Bangladesh.',
    icon: '🇧🇩',
  },
  {
    title: 'Victory Day (১৬ই ডিসেম্বর - বিজয় দিবস)',
    type: 'government',
    defaultDurationDays: 1,
    monthDayStart: { month: 11, day: 16 }, // Dec 16
    description: 'National Victory Day of Bangladesh.',
    icon: '🇧🇩',
  },
  {
    title: 'Shaheed Day & Int\'l Mother Language Day (২১শে ফেব্রুয়ারি)',
    type: 'government',
    defaultDurationDays: 1,
    monthDayStart: { month: 1, day: 21 }, // Feb 21
    description: 'Martyrs\' Day and International Mother Language Day.',
    icon: '🇧🇩',
  },
  {
    title: 'May Day / Labor Day (১লা মে - শ্রমিক দিবস)',
    type: 'government',
    defaultDurationDays: 1,
    monthDayStart: { month: 4, day: 1 }, // May 1
    description: 'International Workers\' Solidarity Day.',
    icon: '🛠️',
  },
  {
    title: 'Pohela Boishakh (পহেলা বৈশাখ - বাংলা নববর্ষ)',
    type: 'festival',
    defaultDurationDays: 1,
    monthDayStart: { month: 3, day: 14 }, // April 14
    description: 'Bengali New Year 1st Boishakh national celebration.',
    icon: '🌾',
  },
  {
    title: 'Christmas Day (২৫শে ডিসেম্বর - বড়দিন)',
    type: 'religious',
    defaultDurationDays: 1,
    monthDayStart: { month: 11, day: 25 }, // Dec 25
    description: 'Holy Christmas Day religious holiday.',
    icon: '🎄',
  },
  {
    title: 'Executive Special Office Closure (বিশেষ নির্বাহী ছুটি)',
    type: 'special_off',
    defaultDurationDays: 1,
    monthDayStart: { month: new Date().getMonth(), day: new Date().getDate() },
    description: 'Company-specific special off-day or emergency closure order.',
    icon: '🏢',
  },
];

export function HolidayOffDayManager({ onClose, isModal = false }: Props) {
  const {
    employees,
    allEmployees,
    departments,
    branches,
    shifts,
    companyHolidays,
    saveCompanyHoliday,
    deleteCompanyHoliday,
    getEmployeeBranch,
  } = useData();
  const { currentCompany } = useTenant();

  const activeEmployees = allEmployees.length > 0 ? allEmployees : employees;

  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Form / Editor Modal state
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingHolidayId, setEditingHolidayId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Form State
  const todayIso = new Date().toISOString().split('T')[0];
  const [formData, setFormData] = useState<{
    title: string;
    type: HolidayType;
    startDate: string;
    endDate: string;
    scope: HolidayScope;
    departments: string[];
    branches: string[];
    employeeIds: string[];
    hasDutyExceptions: boolean;
    dutyEmployeeIds: string[];
    dutyShiftName: string;
    notes: string;
    syncToRoster: boolean;
  }>({
    title: '',
    type: 'religious',
    startDate: todayIso,
    endDate: todayIso,
    scope: 'all',
    departments: [],
    branches: [],
    employeeIds: [],
    hasDutyExceptions: false,
    dutyEmployeeIds: [],
    dutyShiftName: shifts[0]?.name || 'General Shift',
    notes: '',
    syncToRoster: true,
  });

  // Employee search states within modal
  const [empPickerSearch, setEmpPickerSearch] = useState('');
  const [dutyPickerSearch, setDutyPickerSearch] = useState('');

  // Circular / Notice Printer Preview state
  const [circularHoliday, setCircularHoliday] = useState<CompanyHoliday | null>(null);

  // Toast feedback
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  };

  // Filtered list of holidays
  const filteredHolidays = useMemo(() => {
    return companyHolidays
      .filter((h) => {
        const matchesYear =
          selectedYear === 0 ||
          (h.startDate && h.startDate.startsWith(String(selectedYear))) ||
          (h.endDate && h.endDate.startsWith(String(selectedYear)));
        const matchesType = typeFilter === 'all' || h.type === typeFilter;
        const q = searchQuery.toLowerCase().trim();
        const matchesSearch =
          !q ||
          h.title.toLowerCase().includes(q) ||
          (h.notes || '').toLowerCase().includes(q) ||
          (h.type || '').toLowerCase().includes(q);
        return matchesYear && matchesType && matchesSearch;
      })
      .sort((a, b) => b.startDate.localeCompare(a.startDate));
  }, [companyHolidays, selectedYear, typeFilter, searchQuery]);

  // Statistics
  const stats = useMemo(() => {
    const yearHolidays = companyHolidays.filter(
      (h) =>
        selectedYear === 0 ||
        (h.startDate && h.startDate.startsWith(String(selectedYear)))
    );
    const totalDays = yearHolidays.reduce((sum, h) => sum + (h.daysCount || 1), 0);
    const govtCount = yearHolidays.filter((h) => h.type === 'government').length;
    const religiousCount = yearHolidays.filter((h) => h.type === 'religious').length;
    const specialCount = yearHolidays.filter((h) => h.type === 'special_off' || h.type === 'executive').length;
    const totalDutyExceptions = yearHolidays.reduce(
      (sum, h) => sum + (h.dutyEmployeeIds || []).length,
      0
    );
    return {
      totalHolidays: yearHolidays.length,
      totalDays,
      govtCount,
      religiousCount,
      specialCount,
      totalDutyExceptions,
    };
  }, [companyHolidays, selectedYear]);

  // Open Create Modal from scratch
  const handleOpenCreateModal = () => {
    setEditingHolidayId(null);
    setFormData({
      title: '',
      type: 'religious',
      startDate: todayIso,
      endDate: todayIso,
      scope: 'all',
      departments: [],
      branches: [],
      employeeIds: [],
      hasDutyExceptions: false,
      dutyEmployeeIds: [],
      dutyShiftName: shifts[0]?.name || 'General Shift',
      notes: '',
      syncToRoster: true,
    });
    setEmpPickerSearch('');
    setDutyPickerSearch('');
    setIsEditorOpen(true);
  };

  // Open Create Modal using a Preset
  const handleApplyPreset = (preset: HolidayPreset) => {
    const sDate = new Date(Date.UTC(selectedYear || currentYear, preset.monthDayStart.month, preset.monthDayStart.day));
    const eDate = new Date(sDate);
    eDate.setUTCDate(sDate.getUTCDate() + (preset.defaultDurationDays - 1));

    const sStr = sDate.toISOString().split('T')[0];
    const eStr = eDate.toISOString().split('T')[0];

    setEditingHolidayId(null);
    setFormData({
      title: preset.title,
      type: preset.type,
      startDate: sStr,
      endDate: eStr,
      scope: 'all',
      departments: [],
      branches: [],
      employeeIds: [],
      hasDutyExceptions: false,
      dutyEmployeeIds: [],
      dutyShiftName: shifts[0]?.name || 'General Shift',
      notes: preset.description,
      syncToRoster: true,
    });
    setEmpPickerSearch('');
    setDutyPickerSearch('');
    setIsEditorOpen(true);
  };

  // Open Edit Modal
  const handleOpenEditModal = (h: CompanyHoliday) => {
    setEditingHolidayId(h.id);
    setFormData({
      title: h.title,
      type: h.type,
      startDate: h.startDate,
      endDate: h.endDate || h.startDate,
      scope: h.scope,
      departments: h.departments || [],
      branches: h.branches || [],
      employeeIds: h.employeeIds || [],
      hasDutyExceptions: Boolean(h.dutyEmployeeIds && h.dutyEmployeeIds.length > 0),
      dutyEmployeeIds: h.dutyEmployeeIds || [],
      dutyShiftName: h.dutyShiftName || shifts[0]?.name || 'General Shift',
      notes: h.notes || '',
      syncToRoster: h.syncToRoster !== false,
    });
    setEmpPickerSearch('');
    setDutyPickerSearch('');
    setIsEditorOpen(true);
  };

  // Compute calculated duration in days
  const calculatedDays = useMemo(() => {
    try {
      const [sy, sm, sd] = formData.startDate.split('-').map(Number);
      const [ey, em, ed] = formData.endDate.split('-').map(Number);
      const s = new Date(Date.UTC(sy, sm - 1, sd));
      const e = new Date(Date.UTC(ey, em - 1, ed));
      const diffTime = e.getTime() - s.getTime();
      const diffDays = Math.round(diffTime / (1000 * 3600 * 24)) + 1;
      return diffDays > 0 ? diffDays : 1;
    } catch {
      return 1;
    }
  }, [formData.startDate, formData.endDate]);

  // Covered employees count for active form
  const coveredEmployeeCount = useMemo(() => {
    return activeEmployees.filter((emp) => {
      if (formData.scope === 'all') return true;
      if (formData.scope === 'departments') {
        return formData.departments.some(
          (d) => d.toLowerCase() === (emp.department || '').toLowerCase()
        );
      }
      if (formData.scope === 'branches') {
        const empBranch = getEmployeeBranch(emp);
        return formData.branches.some(
          (b) => b.toLowerCase() === empBranch.toLowerCase()
        );
      }
      if (formData.scope === 'custom_employees') {
        return formData.employeeIds.some(
          (id) => id === emp.id || id === emp.employeeId
        );
      }
      return true;
    }).length;
  }, [activeEmployees, formData.scope, formData.departments, formData.branches, formData.employeeIds, getEmployeeBranch]);

  // Handle Save Holiday
  const handleSaveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim()) {
      showToast('⚠️ Holiday title is required.');
      return;
    }
    if (!formData.startDate) {
      showToast('⚠️ Start date is required.');
      return;
    }

    setIsSaving(true);
    try {
      await saveCompanyHoliday({
        ...(editingHolidayId ? { id: editingHolidayId } : {}),
        title: formData.title.trim(),
        type: formData.type,
        startDate: formData.startDate,
        endDate: formData.endDate || formData.startDate,
        daysCount: calculatedDays,
        scope: formData.scope,
        departments: formData.scope === 'departments' ? formData.departments : [],
        branches: formData.scope === 'branches' ? formData.branches : [],
        employeeIds: formData.scope === 'custom_employees' ? formData.employeeIds : [],
        dutyEmployeeIds: formData.hasDutyExceptions ? formData.dutyEmployeeIds : [],
        dutyShiftName: formData.dutyShiftName || shifts[0]?.name || 'General Shift',
        notes: formData.notes.trim(),
        syncToRoster: formData.syncToRoster,
      });

      showToast(`🎉 Holiday "${formData.title}" applied & saved to roster!`);
      setIsEditorOpen(false);
    } catch (err: any) {
      showToast(`❌ Error saving holiday: ${err?.message || 'Check connection'}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Handle Delete Holiday
  const handleDeleteHoliday = async (h: CompanyHoliday) => {
    const confirmRevert = window.confirm(
      `Are you sure you want to delete "${h.title}"?\n\nClick OK to delete and also REVERT the holiday off-days in the Roster calendar.`
    );
    if (!confirmRevert) return;

    try {
      await deleteCompanyHoliday(h.id, true);
      showToast(`🗑️ Holiday "${h.title}" deleted and roster entries restored.`);
    } catch (err: any) {
      showToast(`❌ Error deleting holiday: ${err?.message || 'Failed'}`);
    }
  };

  // Generate & Print Official Circular Notice
  const handlePrintCircularNotice = async (h: CompanyHoliday) => {
    const companyName = currentCompany?.name || 'WorkNest HRMS Enterprise';
    const dutyStaff = activeEmployees.filter((emp) =>
      (h.dutyEmployeeIds || []).includes(emp.id) || (h.dutyEmployeeIds || []).includes(emp.employeeId)
    );

    const circularHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Official Notice: ${h.title}</title>
        <style>
          @page { size: A4 portrait; margin: 15mm; }
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0f172a; margin: 0; padding: 20px; }
          .header { border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 20px; text-align: center; }
          .company-name { font-size: 22px; font-weight: 900; letter-spacing: -0.5px; color: #1e1b4b; text-transform: uppercase; margin: 0; }
          .meta { font-size: 11px; color: #64748b; margin-top: 4px; }
          .ref-line { display: flex; justify-content: space-between; font-size: 11px; font-weight: bold; margin-bottom: 20px; border-bottom: 1px dashed #cbd5e1; padding-bottom: 8px; }
          .title-box { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 14px; text-align: center; margin-bottom: 20px; }
          .title-box h2 { margin: 0; font-size: 17px; color: #1e293b; text-transform: uppercase; }
          .title-box p { margin: 4px 0 0; font-size: 12px; color: #475569; }
          .body-text { font-size: 13px; line-height: 1.6; color: #334155; margin-bottom: 20px; }
          .table-container { margin: 20px 0; border: 1px solid #cbd5e1; border-radius: 6px; overflow: hidden; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th { background: #0f172a; color: #ffffff; text-align: left; padding: 8px 12px; font-size: 11px; text-transform: uppercase; }
          td { padding: 8px 12px; border-bottom: 1px solid #e2e8f0; }
          tr:nth-child(even) { background: #f8fafc; }
          .signatures { margin-top: 50px; display: flex; justify-content: space-between; text-align: center; font-size: 12px; }
          .sig-line { width: 180px; border-top: 1px solid #0f172a; padding-top: 6px; font-weight: bold; }
          .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: bold; text-transform: uppercase; }
          .badge-gov { background: #e0f2fe; color: #0369a1; }
          .badge-rel { background: #fef3c7; color: #b45309; }
          .badge-off { background: #f1f5f9; color: #334155; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1 class="company-name">${companyName}</h1>
          <div class="meta">Human Resources &amp; Corporate Administrative Operations • Official Circular</div>
        </div>

        <div class="ref-line">
          <span>CIRCULAR REF: WN-HR-HOLIDAY-${h.id.slice(-6).toUpperCase()}</span>
          <span>DATE: ${new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
        </div>

        <div class="title-box">
          <h2>OFFICE CIRCULAR: ${h.title}</h2>
          <p>
            Effective Period: <strong>${h.startDate}</strong> ${h.endDate && h.endDate !== h.startDate ? ` to <strong>${h.endDate}</strong>` : ''} 
            (${h.daysCount} Day${h.daysCount > 1 ? 's' : ''}) • Type: <strong>${h.type.replace(/_/g, ' ').toUpperCase()}</strong>
          </p>
        </div>

        <div class="body-text">
          <p>
            This is to notify all employees and departmental heads that <strong>${companyName}</strong> will observe official holiday on account of <strong>${h.title}</strong> from <strong>${h.startDate}</strong> ${h.endDate && h.endDate !== h.startDate ? ` through <strong>${h.endDate}</strong>` : ''}.
          </p>
          <p>
            <strong>Scope &amp; Applicability:</strong> 
            ${
              h.scope === 'all'
                ? 'All divisions, branch offices, and corporate personnel are officially excused from standard working duty.'
                : h.scope === 'departments'
                ? `Holiday is applicable specifically for: ${h.departments?.join(', ') || 'Designated Departments'}.`
                : h.scope === 'branches'
                ? `Holiday is applicable for branch locations: ${h.branches?.join(', ') || 'Designated Branches'}.`
                : 'Holiday is applicable for designated individual personnel.'
            }
          </p>
          ${h.notes ? `<p><strong>Administrative Remarks:</strong> ${h.notes}</p>` : ''}
        </div>

        ${
          dutyStaff.length > 0
            ? `
          <div style="margin-top: 25px;">
            <h3 style="font-size: 13px; text-transform: uppercase; color: #1e293b; margin-bottom: 8px;">
              ⚡ Authorized Emergency &amp; Skeleton Duty Roster:
            </h3>
            <p style="font-size: 11px; color: #64748b; margin-top: 0;">
              The following authorized personnel are designated on official duty roster to ensure uninterrupted critical operations:
            </p>
            <div class="table-container">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Staff Name</th>
                    <th>Employee ID</th>
                    <th>Department</th>
                    <th>Designation</th>
                    <th>Assigned Shift</th>
                  </tr>
                </thead>
                <tbody>
                  ${dutyStaff
                    .map(
                      (emp, idx) => `
                    <tr>
                      <td>${idx + 1}</td>
                      <td><strong>${emp.name}</strong></td>
                      <td><code>${emp.employeeId || emp.id}</code></td>
                      <td>${emp.department || '—'}</td>
                      <td>${emp.designation || '—'}</td>
                      <td><span style="font-weight: bold; color: #4338ca;">${h.dutyShiftName || emp.shift || 'General Shift'}</span></td>
                    </tr>
                  `
                    )
                    .join('')}
                </tbody>
              </table>
            </div>
          </div>
        `
            : `
          <div style="padding: 12px; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 6px; font-size: 12px; color: #065f46; margin: 20px 0;">
            ✓ All regular office operations and facilities will remain closed. Standard duty resumes on the next scheduled business day.
          </div>
        `
        }

        <div class="signatures">
          <div>
            <div class="sig-line">Prepared By</div>
            <div style="font-size: 10px; color: #64748b; margin-top: 2px;">HR Operations &amp; Roster Management</div>
          </div>
          <div>
            <div class="sig-line">Verified By</div>
            <div style="font-size: 10px; color: #64748b; margin-top: 2px;">Head of Human Resources</div>
          </div>
          <div>
            <div class="sig-line">Approved By</div>
            <div style="font-size: 10px; color: #64748b; margin-top: 2px;">Managing Director / Authority</div>
          </div>
        </div>
      </body>
      </html>
    `;

    await printViaIframe(circularHtml);
    showToast(`🖨️ Notice for "${h.title}" sent to printer.`);
  };

  const getTypeBadge = (type: HolidayType) => {
    switch (type) {
      case 'government':
        return { label: 'Govt / National', bg: 'bg-sky-50 text-sky-700 border-sky-200', icon: '🏛️' };
      case 'religious':
        return { label: 'Religious / Festival', bg: 'bg-amber-50 text-amber-800 border-amber-200', icon: '🌙' };
      case 'special_off':
        return { label: 'Office Special Off', bg: 'bg-emerald-50 text-emerald-800 border-emerald-200', icon: '🏢' };
      case 'festival':
        return { label: 'Cultural Festival', bg: 'bg-purple-50 text-purple-700 border-purple-200', icon: '🎨' };
      case 'executive':
        return { label: 'Executive Closure', bg: 'bg-rose-50 text-rose-700 border-rose-200', icon: '👔' };
      default:
        return { label: 'Holiday', bg: 'bg-slate-100 text-slate-700 border-slate-200', icon: '🎉' };
    }
  };

  return (
    <div className={`space-y-6 ${isModal ? 'p-1' : ''}`}>
      {/* Toast */}
      {toastMsg && (
        <div className="fixed top-20 right-6 z-50 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-bold shadow-xl border border-slate-700 flex items-center space-x-2 animate-bounce">
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Header Banner */}
      <div className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200/90 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2.5">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-amber-500 via-orange-500 to-rose-500 text-white flex items-center justify-center text-xl shadow-xs">
              🎉
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                  Special Off-Days &amp; Holiday Roster Center
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-200">
                  ছুটি ও বিশেষ বন্ধ
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Declare whole-office holidays, multi-day Eid / Puja festivals, department-specific off days, or assign emergency skeleton duty crew during holidays.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleOpenCreateModal}
            className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white text-xs font-bold shadow-md shadow-indigo-600/20 transition-all flex items-center space-x-1.5 cursor-pointer"
          >
            <span>➕</span>
            <span>Declare New Holiday / Off-Day</span>
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-all cursor-pointer"
            >
              Back to Calendar
            </button>
          )}
        </div>
      </div>

      {/* KPI Counters */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block truncate">
            Total Declared Holidays
          </span>
          <span className="text-2xl font-black text-slate-900 font-mono mt-1 block">
            {stats.totalHolidays}
          </span>
          <span className="text-[10px] text-slate-400 font-medium">In {selectedYear || 'All Time'}</span>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block truncate">
            Total Off-Days Span
          </span>
          <span className="text-2xl font-black text-amber-600 font-mono mt-1 block">
            {stats.totalDays} Days
          </span>
          <span className="text-[10px] text-slate-400 font-medium">Accumulated off days</span>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block truncate">
            Govt / National
          </span>
          <span className="text-2xl font-black text-sky-700 font-mono mt-1 block">
            {stats.govtCount}
          </span>
          <span className="text-[10px] text-slate-400 font-medium">Independence, Victory, etc.</span>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block truncate">
            Religious Festivals
          </span>
          <span className="text-2xl font-black text-violet-700 font-mono mt-1 block">
            {stats.religiousCount}
          </span>
          <span className="text-[10px] text-slate-400 font-medium">Eid, Puja, Christmas</span>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block truncate">
            Office Special Closures
          </span>
          <span className="text-2xl font-black text-emerald-700 font-mono mt-1 block">
            {stats.specialCount}
          </span>
          <span className="text-[10px] text-slate-400 font-medium">Executive off orders</span>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block truncate">
            Duty Exceptions
          </span>
          <span className="text-2xl font-black text-indigo-700 font-mono mt-1 block">
            {stats.totalDutyExceptions}
          </span>
          <span className="text-[10px] text-slate-400 font-medium">Staff rostered during off</span>
        </div>
      </div>

      {/* Quick Presets Bar (1-Click Template Apply) */}
      <div className="bg-gradient-to-r from-amber-50/70 via-orange-50/50 to-rose-50/40 rounded-2xl p-4 border border-amber-200/80 shadow-2xs space-y-2.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
          <div className="flex items-center space-x-2">
            <span className="text-base">⚡</span>
            <h3 className="text-xs font-black uppercase tracking-wider text-amber-950">
              Quick Holiday Presets (1-Click Template Setup):
            </h3>
          </div>
          <span className="text-[11px] text-amber-800">
            Click any festival to pre-fill holiday name, dates, &amp; duration automatically
          </span>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          {BANGLADESH_HOLIDAY_PRESETS.map((p, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => handleApplyPreset(p)}
              className="px-2.5 py-1.5 bg-white hover:bg-amber-100/90 text-slate-800 hover:text-amber-950 border border-amber-200/80 rounded-xl text-xs font-semibold shadow-2xs transition-all flex items-center space-x-1.5 cursor-pointer active:scale-95"
            >
              <span>{p.icon}</span>
              <span>{p.title.split('(')[0].trim()}</span>
              <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200">
                {p.defaultDurationDays}d
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-2xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Year selector */}
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-bold bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
          >
            <option value={0}>All Years</option>
            {[currentYear - 1, currentYear, currentYear + 1, currentYear + 2].map((y) => (
              <option key={y} value={y}>
                Year {y}
              </option>
            ))}
          </select>

          {/* Type filter */}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-bold bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
          >
            <option value="all">All Holiday Types</option>
            <option value="government">🏛️ Government / National</option>
            <option value="religious">🌙 Religious (Eid, Puja)</option>
            <option value="special_off">🏢 Office Special Off</option>
            <option value="festival">🎨 Cultural / Festival</option>
            <option value="executive">👔 Executive Declaration</option>
          </select>
        </div>

        <div className="flex items-center space-x-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search holiday title or notes..."
            className="px-3 py-1.5 text-xs border border-slate-200 rounded-xl w-64 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50/50"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="text-xs text-slate-400 hover:text-slate-600"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Declared Holidays List Table */}
      <div className="bg-white rounded-3xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-base font-black text-slate-900">
              Official Declared Holidays &amp; Special Off-Day Ledger
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Showing {filteredHolidays.length} declared holiday schedule(s) for {selectedYear || 'All Years'}
            </p>
          </div>
        </div>

        {filteredHolidays.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <span className="text-4xl block">🏖️</span>
            <h4 className="text-sm font-bold text-slate-700">No holidays declared yet</h4>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Use the Quick Presets above or click &quot;Declare New Holiday / Off-Day&quot; to set up whole-office closures, Eid/Puja festivals, or government holidays.
            </p>
            <button
              type="button"
              onClick={handleOpenCreateModal}
              className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 cursor-pointer"
            >
              + Declare First Holiday
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto thin-scroll">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <th className="py-3 px-4 font-bold uppercase tracking-wider text-[10px]">Holiday Title</th>
                  <th className="py-3 px-4 font-bold uppercase tracking-wider text-[10px]">Type</th>
                  <th className="py-3 px-4 font-bold uppercase tracking-wider text-[10px]">Date Range &amp; Duration</th>
                  <th className="py-3 px-4 font-bold uppercase tracking-wider text-[10px]">Applicable Scope</th>
                  <th className="py-3 px-4 font-bold uppercase tracking-wider text-[10px]">Duty Exceptions (Working)</th>
                  <th className="py-3 px-4 font-bold uppercase tracking-wider text-[10px]">Roster Sync</th>
                  <th className="py-3 px-4 font-bold uppercase tracking-wider text-[10px] text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {filteredHolidays.map((h) => {
                  const typeBadge = getTypeBadge(h.type);
                  const isMultiDay = h.startDate !== h.endDate;
                  const dutyCount = (h.dutyEmployeeIds || []).length;
                  const dutyStaffNames = activeEmployees
                    .filter((e) => (h.dutyEmployeeIds || []).includes(e.id) || (h.dutyEmployeeIds || []).includes(e.employeeId))
                    .map((e) => e.name);

                  return (
                    <tr key={h.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3.5 px-4 font-bold text-slate-900">
                        <div className="flex items-center space-x-2">
                          <span>{typeBadge.icon}</span>
                          <div>
                            <span className="text-sm font-bold text-slate-900">{h.title}</span>
                            {h.notes && (
                              <p className="text-[11px] text-slate-500 font-normal truncate max-w-xs">
                                {h.notes}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border ${typeBadge.bg}`}>
                          {typeBadge.label}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 font-mono">
                        <div className="font-bold text-slate-800">
                          {h.startDate}
                          {isMultiDay && <span> → {h.endDate}</span>}
                        </div>
                        <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.2 rounded border border-indigo-200">
                          {h.daysCount || 1} Day{(h.daysCount || 1) > 1 ? 's' : ''} Off
                        </span>
                      </td>

                      <td className="py-3.5 px-4">
                        {h.scope === 'all' && (
                          <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                            🏢 Entire Office (All Staff)
                          </span>
                        )}
                        {h.scope === 'departments' && (
                          <div>
                            <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-sky-50 text-sky-800 border border-sky-200">
                              🏛️ {h.departments?.length || 0} Department(s)
                            </span>
                            <p className="text-[10px] text-slate-500 mt-0.5 truncate max-w-[160px]">
                              {h.departments?.join(', ')}
                            </p>
                          </div>
                        )}
                        {h.scope === 'branches' && (
                          <div>
                            <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                              📍 {h.branches?.length || 0} Branch(es)
                            </span>
                            <p className="text-[10px] text-slate-500 mt-0.5 truncate max-w-[160px]">
                              {h.branches?.join(', ')}
                            </p>
                          </div>
                        )}
                        {h.scope === 'custom_employees' && (
                          <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-purple-50 text-purple-800 border border-purple-200">
                            👥 {h.employeeIds?.length || 0} Staff Selected
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-4">
                        {dutyCount > 0 ? (
                          <div title={dutyStaffNames.join(', ')}>
                            <span className="px-2 py-0.5 rounded-lg text-[10px] font-black bg-rose-50 text-rose-800 border border-rose-200 flex items-center space-x-1 w-max">
                              <span>⚡</span>
                              <span>{dutyCount} Staff on Duty</span>
                            </span>
                            <p className="text-[10px] text-slate-500 mt-0.5 truncate max-w-[160px]">
                              {dutyStaffNames.slice(0, 2).join(', ')}
                              {dutyStaffNames.length > 2 ? ` +${dutyStaffNames.length - 2} more` : ''}
                            </p>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-400 italic">No exceptions (All Off)</span>
                        )}
                      </td>

                      <td className="py-3.5 px-4">
                        {h.syncToRoster ? (
                          <span className="text-emerald-700 font-bold text-[11px] flex items-center space-x-1">
                            <span>✓</span>
                            <span>Applied</span>
                          </span>
                        ) : (
                          <span className="text-slate-400 text-[11px]">Notice only</span>
                        )}
                      </td>

                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end space-x-1.5">
                          <button
                            type="button"
                            onClick={() => handlePrintCircularNotice(h)}
                            title="Print Official Office Circular"
                            className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold transition-all cursor-pointer"
                          >
                            🖨️
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenEditModal(h)}
                            title="Edit Holiday"
                            className="p-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-xs font-bold transition-all cursor-pointer"
                          >
                            ✏️
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteHoliday(h)}
                            title="Delete and Revert Roster"
                            className="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg text-xs font-bold transition-all cursor-pointer"
                          >
                            🗑️
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* MODAL: DECLARE / EDIT HOLIDAY WITH SCOPE & DUTY EXCEPTION SELECTOR         */}
      {/* ========================================================================= */}
      {isEditorOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 shrink-0">
              <div className="flex items-center space-x-2">
                <span className="text-xl">🎉</span>
                <div>
                  <h3 className="text-base font-black text-slate-900">
                    {editingHolidayId ? 'Edit Declared Holiday' : 'Declare Special Off-Day / Holiday'}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Set up holiday dates, target departments, and assign skeleton duty staff
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsEditorOpen(false)}
                className="w-8 h-8 rounded-xl bg-slate-200/70 hover:bg-rose-500 hover:text-white flex items-center justify-center text-sm font-bold transition-all cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Form Body */}
            <form onSubmit={handleSaveSubmit} className="p-5 overflow-y-auto space-y-4 thin-scroll flex-1">
              {/* Title & Type */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block mb-1">
                    Holiday Title * (ছুটির নাম)
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    placeholder="e.g. Eid-ul-Fitr Holiday, Emergency Office Closure"
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-semibold"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block mb-1">
                    Holiday Category
                  </label>
                  <select
                    value={formData.type}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value as HolidayType })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-semibold bg-white cursor-pointer"
                  >
                    <option value="religious">🌙 Religious (Eid, Puja)</option>
                    <option value="government">🏛️ Government / National</option>
                    <option value="special_off">🏢 Office Special Off</option>
                    <option value="festival">🎨 Cultural / Festival</option>
                    <option value="executive">👔 Executive Declaration</option>
                  </select>
                </div>
              </div>

              {/* Date Span Picker */}
              <div className="bg-slate-50 rounded-2xl p-3.5 border border-slate-200/80 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-black text-slate-800 uppercase tracking-wider">
                    Holiday Dates &amp; Duration (তারিখ ও সময়সীমা)
                  </label>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-indigo-100 text-indigo-800 border border-indigo-200">
                    Total: {calculatedDays} Day{calculatedDays > 1 ? 's' : ''}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <span className="text-[10px] font-bold text-slate-500 block mb-0.5">Start Date *</span>
                    <input
                      type="date"
                      required
                      value={formData.startDate}
                      onChange={(e) => {
                        const newStart = e.target.value;
                        setFormData({
                          ...formData,
                          startDate: newStart,
                          endDate: formData.endDate < newStart ? newStart : formData.endDate,
                        });
                      }}
                      className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-xl bg-white font-mono font-bold"
                    />
                  </div>

                  <div>
                    <span className="text-[10px] font-bold text-slate-500 block mb-0.5">End Date *</span>
                    <input
                      type="date"
                      required
                      value={formData.endDate}
                      min={formData.startDate}
                      onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                      className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-xl bg-white font-mono font-bold"
                    />
                  </div>
                </div>
                <p className="text-[10px] text-slate-500 italic">
                  Single-day holiday: keep start date and end date the same. Multi-day (e.g. 3 days of Eid): set start to end date range.
                </p>
              </div>

              {/* Scope Selection */}
              <div>
                <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block mb-1">
                  Holiday Coverage Scope (ছুটি কার কার জন্য প্রযোজ্য?)
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { id: 'all', label: '🏢 Entire Office', desc: 'All Staff' },
                    { id: 'departments', label: '🏛️ Departments', desc: 'Selected Depts' },
                    { id: 'branches', label: '📍 Branches', desc: 'Selected Offices' },
                    { id: 'custom_employees', label: '👥 Specific Staff', desc: 'Pick Personnel' },
                  ].map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setFormData({ ...formData, scope: s.id as HolidayScope })}
                      className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                        formData.scope === s.id
                          ? 'bg-indigo-50 border-indigo-500 ring-2 ring-indigo-500/20 shadow-2xs'
                          : 'bg-white border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <span className="text-xs font-bold text-slate-900 block truncate">{s.label}</span>
                      <span className="text-[10px] text-slate-500 block truncate">{s.desc}</span>
                    </button>
                  ))}
                </div>

                {/* Scope Sub-pickers */}
                {formData.scope === 'departments' && (
                  <div className="mt-3 p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                    <span className="text-[10px] font-bold text-slate-700 uppercase tracking-wider block">
                      Select Departments to have Holiday Off:
                    </span>
                    <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto">
                      {departments.map((dept) => {
                        const isSelected = formData.departments.includes(dept.name);
                        return (
                          <button
                            key={dept.id}
                            type="button"
                            onClick={() => {
                              const next = isSelected
                                ? formData.departments.filter((d) => d !== dept.name)
                                : [...formData.departments, dept.name];
                              setFormData({ ...formData, departments: next });
                            }}
                            className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                              isSelected
                                ? 'bg-indigo-600 text-white border-indigo-700 shadow-2xs'
                                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            {isSelected ? '✓ ' : ''}{dept.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {formData.scope === 'branches' && (
                  <div className="mt-3 p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                    <span className="text-[10px] font-bold text-slate-700 uppercase tracking-wider block">
                      Select Branches to have Holiday Off:
                    </span>
                    <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto">
                      {branches.map((b) => {
                        const isSelected = formData.branches.includes(b.name);
                        return (
                          <button
                            key={b.id}
                            type="button"
                            onClick={() => {
                              const next = isSelected
                                ? formData.branches.filter((item) => item !== b.name)
                                : [...formData.branches, b.name];
                              setFormData({ ...formData, branches: next });
                            }}
                            className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                              isSelected
                                ? 'bg-indigo-600 text-white border-indigo-700 shadow-2xs'
                                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            {isSelected ? '✓ ' : ''}{b.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {formData.scope === 'custom_employees' && (
                  <div className="mt-3 p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-slate-700 uppercase tracking-wider block">
                        Select Staff Members ({formData.employeeIds.length} Selected):
                      </span>
                      <input
                        type="text"
                        value={empPickerSearch}
                        onChange={(e) => setEmpPickerSearch(e.target.value)}
                        placeholder="Search employee..."
                        className="px-2 py-0.5 text-[11px] border border-slate-200 rounded-lg bg-white"
                      />
                    </div>
                    <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto">
                      {activeEmployees
                        .filter(
                          (e) =>
                            !empPickerSearch ||
                            e.name.toLowerCase().includes(empPickerSearch.toLowerCase()) ||
                            e.employeeId.toLowerCase().includes(empPickerSearch.toLowerCase())
                        )
                        .map((emp) => {
                          const isSelected = formData.employeeIds.includes(emp.id);
                          return (
                            <button
                              key={emp.id}
                              type="button"
                              onClick={() => {
                                const next = isSelected
                                  ? formData.employeeIds.filter((id) => id !== emp.id)
                                  : [...formData.employeeIds, emp.id];
                                setFormData({ ...formData, employeeIds: next });
                              }}
                              className={`px-2 py-1 rounded-lg text-[11px] font-medium border transition-all cursor-pointer ${
                                isSelected
                                  ? 'bg-purple-600 text-white border-purple-700 shadow-2xs'
                                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                              }`}
                            >
                              {isSelected ? '✓ ' : ''}{emp.name} ({emp.employeeId})
                            </button>
                          );
                        })}
                    </div>
                  </div>
                )}
              </div>

              {/* DUTY EXCEPTIONS / SKELETON CREW (User explicit request: "kichu manus duty korbey bakira off") */}
              <div className="bg-gradient-to-r from-rose-50/70 via-orange-50/60 to-amber-50/50 rounded-2xl p-4 border border-rose-200/80 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="text-base">⚡</span>
                    <div>
                      <h4 className="text-xs font-black text-rose-950 uppercase tracking-wider">
                        On-Duty Exceptions (জরুরি ডিউটি কর্মী - যারা এই ছুটির দিনেও কাজ করবেন)
                      </h4>
                      <p className="text-[10px] text-rose-800">
                        Designate emergency personnel (Security, IT, Maintenance, Operators) who will NOT be off.
                      </p>
                    </div>
                  </div>
                  <label className="flex items-center space-x-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.hasDutyExceptions}
                      onChange={(e) => setFormData({ ...formData, hasDutyExceptions: e.target.checked })}
                      className="rounded text-rose-600 focus:ring-rose-500 w-4 h-4 cursor-pointer"
                    />
                    <span className="text-xs font-bold text-rose-900">Enable</span>
                  </label>
                </div>

                {formData.hasDutyExceptions && (
                  <div className="space-y-3 pt-2 border-t border-rose-200/60">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-bold text-rose-900 uppercase tracking-wider block mb-1">
                          Duty Shift Assigned to Exceptions:
                        </label>
                        <select
                          value={formData.dutyShiftName}
                          onChange={(e) => setFormData({ ...formData, dutyShiftName: e.target.value })}
                          className="w-full px-2.5 py-1.5 text-xs border border-rose-300 rounded-xl bg-white font-semibold cursor-pointer"
                        >
                          {shifts.map((s) => (
                            <option key={s.id} value={s.name}>
                              {s.name} ({s.startTime} - {s.endTime})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] font-bold text-rose-900 uppercase tracking-wider block mb-1">
                          Filter Staff:
                        </label>
                        <input
                          type="text"
                          value={dutyPickerSearch}
                          onChange={(e) => setDutyPickerSearch(e.target.value)}
                          placeholder="Search staff to add to duty..."
                          className="w-full px-2.5 py-1.5 text-xs border border-rose-300 rounded-xl bg-white"
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-bold text-rose-900 uppercase tracking-wider">
                          Select Staff on Duty ({formData.dutyEmployeeIds.length} Selected):
                        </span>
                        {formData.dutyEmployeeIds.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setFormData({ ...formData, dutyEmployeeIds: [] })}
                            className="text-[10px] text-rose-700 hover:underline"
                          >
                            Clear All
                          </button>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto p-2 bg-white/80 rounded-xl border border-rose-200">
                        {activeEmployees
                          .filter(
                            (e) =>
                              !dutyPickerSearch ||
                              e.name.toLowerCase().includes(dutyPickerSearch.toLowerCase()) ||
                              e.employeeId.toLowerCase().includes(dutyPickerSearch.toLowerCase()) ||
                              (e.department || '').toLowerCase().includes(dutyPickerSearch.toLowerCase())
                          )
                          .map((emp) => {
                            const isDuty = formData.dutyEmployeeIds.includes(emp.id) || formData.dutyEmployeeIds.includes(emp.employeeId);
                            return (
                              <button
                                key={emp.id}
                                type="button"
                                onClick={() => {
                                  const idToUse = emp.employeeId || emp.id;
                                  const next = isDuty
                                    ? formData.dutyEmployeeIds.filter((id) => id !== emp.id && id !== emp.employeeId)
                                    : [...formData.dutyEmployeeIds, idToUse];
                                  setFormData({ ...formData, dutyEmployeeIds: next });
                                }}
                                className={`px-2 py-1 rounded-lg text-[11px] font-medium border transition-all cursor-pointer ${
                                  isDuty
                                    ? 'bg-rose-600 text-white border-rose-700 shadow-2xs font-bold'
                                    : 'bg-white text-slate-700 border-slate-200 hover:bg-rose-50'
                                }`}
                              >
                                {isDuty ? '⚡ On Duty: ' : ''}{emp.name} ({emp.department || 'Staff'})
                              </button>
                            );
                          })}
                      </div>
                      <p className="text-[10px] text-rose-800 mt-1 italic">
                        Selected employees will stay scheduled for work during this holiday and will NOT be marked Off.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Notes & Description */}
              <div>
                <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block mb-1">
                  Administrative Remarks / Circular Note (ঐচ্ছিক মন্তব্য)
                </label>
                <textarea
                  rows={2}
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="e.g. Approved as per Government Notification Gazette #49 / Executive Order"
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* Sync to Roster Checkbox */}
              <div className="p-3 bg-indigo-50/70 border border-indigo-200 rounded-xl flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <span className="text-base">📅</span>
                  <div>
                    <span className="text-xs font-bold text-indigo-950 block">
                      Auto-Apply to Roster Calendar &amp; Attendance
                    </span>
                    <span className="text-[10px] text-indigo-800 block">
                      Automatically marks {coveredEmployeeCount - (formData.hasDutyExceptions ? formData.dutyEmployeeIds.length : 0)} employee(s) as Off and sets active shifts for on-duty crew.
                    </span>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={formData.syncToRoster}
                  onChange={(e) => setFormData({ ...formData, syncToRoster: e.target.checked })}
                  className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                />
              </div>

              {/* Action Buttons */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setIsEditorOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-all cursor-pointer"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-md shadow-indigo-600/20 transition-all flex items-center space-x-1.5 cursor-pointer disabled:opacity-50"
                >
                  <span>{isSaving ? '⏳ Saving...' : '💾 Save Holiday & Apply to Roster'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
