import { useState, useEffect } from 'react';
import { useData } from '../context/DataContext';
import { useTenant } from '../context/TenantContext';
import { recordZKTecoPunchToFirestore } from '../lib/firestoreService';
import { getBangladeshTodayStr, findShiftByNameOrId, isShiftOvertimeEnabled, resolveEmployeeScheduleForDate } from '../utils/attendanceScheduleEngine';
import { IconFingerprint, IconCheckCircle } from './Icons';

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

export function ZKTecoPunchTriggerModal({ isOpen, onClose }: Props) {
  const { employees, shifts, roster, devices, addNotification, getEmployeeBranch, getDeviceBranch } = useData();
  const { currentCompanyId } = useTenant();
  const [selectedEmpId, setSelectedEmpId] = useState<string>(employees[0]?.employeeId || '101');
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [deviceSerial, setDeviceSerial] = useState('BIO-K40-MAIN-GATE');
  const [deviceName, setDeviceName] = useState('Main Gate ZKTeco K40');
  const [verifyMode, setVerifyMode] = useState<'Fingerprint' | 'Face' | 'Card' | 'Password'>('Fingerprint');
  const [punchTime, setPunchTime] = useState(() => {
    const d = new Date();
    return d.toTimeString().slice(0, 5);
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  // Sync with default device if available
  useEffect(() => {
    if (devices.length > 0 && !selectedDeviceId) {
      const first = devices[0];
      setSelectedDeviceId(first.id);
      setDeviceName(first.name);
      setDeviceSerial(first.serialNumber || first.serial || 'BIO-01');
      if (first.faceRecognition || first.deviceType === 'facial') {
        setVerifyMode('Face');
      } else {
        setVerifyMode('Fingerprint');
      }
    }
  }, [devices, selectedDeviceId]);

  const handleDeviceSelect = (id: string) => {
    setSelectedDeviceId(id);
    const d = devices.find(x => x.id === id);
    if (d) {
      setDeviceName(d.name);
      setDeviceSerial(d.serialNumber || d.serial || 'BIO-01');
      if (d.faceRecognition || d.deviceType === 'facial') {
        setVerifyMode('Face');
      } else {
        setVerifyMode('Fingerprint');
      }
    }
  };

  if (!isOpen) return null;

  const handleSimulatePunch = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setResultMessage(null);

    const emp = employees.find(e => e.employeeId === selectedEmpId) || employees[0];
    const todayStr = getBangladeshTodayStr();
    const punchTimestamp = `${todayStr}T${punchTime}:00`;

    const sched = emp ? resolveEmployeeScheduleForDate(emp, todayStr, roster, shifts) : null;
    const matchedShift = (sched?.shift) || findShiftByNameOrId(shifts, emp?.shift) || shifts[0];
    const shiftStartTime = sched?.startTime && sched.startTime !== '--:--' ? sched.startTime : (matchedShift?.startTime || '09:00');
    const shiftEndTime = sched?.endTime && sched.endTime !== '--:--' ? sched.endTime : (matchedShift?.endTime || '19:00');
    const shiftGraceMinutes = sched?.graceTime ?? matchedShift?.graceTime ?? 15;
    const otThresholdMinutes = sched?.minOvertimeMinutes ?? matchedShift?.minOvertimeMinutes ?? 30;
    const overtimePolicyEnabled = sched ? (sched.overtimePolicyEnabled !== false && isShiftOvertimeEnabled(matchedShift)) : isShiftOvertimeEnabled(matchedShift);

    const selectedDevice = devices.find(d => d.id === selectedDeviceId);
    const resolvedBranch = selectedDevice ? getDeviceBranch(selectedDevice) : (emp ? getEmployeeBranch(emp) : 'Main Head Office (Dhaka)');
    const resolvedBranchId = selectedDevice?.branchId || emp?.branchId || 'BR-001';

    try {
      const res = await recordZKTecoPunchToFirestore({
        companyId: emp?.companyId || currentCompanyId || 'default',
        employeeId: selectedEmpId,
        employeeName: emp ? emp.name : `Employee ${selectedEmpId}`,
        department: emp ? emp.department : 'General',
        branch: resolvedBranch,
        branchId: resolvedBranchId,
        deviceSerialNumber: deviceSerial,
        deviceName: deviceName,
        verifyMode: verifyMode,
        punchTimestamp: punchTimestamp,
        shiftStartTime: shiftStartTime,
        shiftEndTime: shiftEndTime,
        shiftGraceMinutes: shiftGraceMinutes,
        otThresholdMinutes: otThresholdMinutes,
        overtimePolicyEnabled,
        maxOvertimeHours: sched?.maxOvertimeHours ?? matchedShift?.maxOvertimeHours ?? 0,
        latePolicyEnabled: sched ? sched.latePolicyEnabled : (matchedShift?.latePolicyEnabled !== false),
        isFlexible: matchedShift?.type === 'flexible',
        shiftName: sched?.shiftName && sched.shiftName !== 'Unassigned' ? sched.shiftName : (matchedShift ? matchedShift.name : 'Morning'),
        skipMonthFilter: true,
      });

      setIsSubmitting(false);
      setResultMessage(`Punch recorded in Firestore! Status: ${res.status.toUpperCase()} (${res.isFirstPunchToday ? 'Check In' : 'Check Out'})`);

      addNotification({
        title: 'Biometric Punch Captured',
        message: `${emp ? emp.name : selectedEmpId} punched at ${punchTime} via ${deviceName} (${verifyMode}) - ${res.status.toUpperCase()}`,
        read: false,
        type: 'attendance',
        targetPage: 'attendance',
      });
    } catch (err: any) {
      setIsSubmitting(false);
      setResultMessage(`Error: ${err.message}`);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-3 sm:p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl max-w-lg w-full p-5 sm:p-7 max-h-[88dvh] overflow-y-auto shadow-2xl border border-slate-100 animate-scale-in" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white shadow-md">
              <IconFingerprint size={22} />
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-900 tracking-tight">Biometric Punch Emulator</h3>
              <p className="text-xs text-slate-500">Simulate physical ZKTeco hardware machine punch</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-700 font-bold">
            ✕
          </button>
        </div>

        <form onSubmit={handleSimulatePunch} className="mt-5 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Select Employee *</label>
            <select
              value={selectedEmpId}
              onChange={e => setSelectedEmpId(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {employees.map(emp => (
                <option key={emp.id} value={emp.employeeId}>
                  {emp.name} — ID: {emp.employeeId} ({getEmployeeBranch(emp)} • {emp.department})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Verify Mode</label>
              <select
                value={verifyMode}
                onChange={e => setVerifyMode(e.target.value as any)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800"
              >
                <option value="Fingerprint">Fingerprint</option>
                <option value="Face">Face Recognition</option>
                <option value="Card">RFID Card</option>
                <option value="Password">PIN Code</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Punch Time (HH:MM)</label>
              <input
                type="time"
                value={punchTime}
                onChange={e => setPunchTime(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono font-semibold"
                required
              />
            </div>
          </div>

          {devices.length > 0 && (
            <div>
              <label className="block text-xs font-bold text-slate-600 uppercase mb-1">
                Select Registered Biometric Terminal
              </label>
              <select
                value={selectedDeviceId}
                onChange={e => handleDeviceSelect(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {devices.map(d => (
                  <option key={d.id} value={d.id}>
                    [{getDeviceBranch(d)}] {d.name} — {d.model || d.type || 'Terminal'} (SN: {d.serialNumber || d.serial || 'N/A'})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Hardware Device</label>
              <input
                type="text"
                value={deviceName}
                onChange={e => setDeviceName(e.target.value)}
                className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Device Serial</label>
              <input
                type="text"
                value={deviceSerial}
                onChange={e => setDeviceSerial(e.target.value)}
                className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-medium"
              />
            </div>
          </div>

          {resultMessage && (
            <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center space-x-2 text-xs font-semibold text-emerald-800 animate-fade-in">
              <IconCheckCircle size={18} className="text-emerald-600 flex-shrink-0" />
              <span>{resultMessage}</span>
            </div>
          )}

          <div className="p-3.5 bg-indigo-50 border border-indigo-100 rounded-2xl text-xs text-indigo-900 leading-relaxed">
            <strong>Hardware Push Protocol:</strong> Triggering this punch replicates the exact ADMS / Push SDK payload sent by physical ZKTeco devices (K40, MB20, uFace800). Writes to Firestore <code>/punches</code> and updates <code>/attendance</code> in real-time.
          </div>

          <div className="flex space-x-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold rounded-xl"
            >
              Close
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white text-xs font-bold rounded-xl shadow-md flex items-center justify-center space-x-1.5 disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                  <span>Writing to Firestore...</span>
                </>
              ) : (
                <>
                  <IconFingerprint size={16} />
                  <span>Send Machine Punch</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
