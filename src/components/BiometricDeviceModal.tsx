import { useState, useEffect } from 'react';
import { BiometricDevice, useData } from '../context/DataContext';
import {
  IconServer, IconFingerprint, IconShield, IconActivity,
  IconCheck, IconX, IconInfo, IconCloud
} from './Icons';

type Props = {
  isOpen: boolean;
  deviceToEdit?: BiometricDevice | null;
  editingDevice?: BiometricDevice | null;
  defaultBranch?: string;
  onClose: () => void;
};

const COMMON_MODELS = [
  'ZKTeco SenseFace 2A',
  'ZKTeco K40',
  'ZKTeco MB20',
  'ZKTeco uFace800',
  'ZKTeco SilkBio-100TC',
  'ZKTeco F18',
  'ZKTeco IN01-A',
  'Other / Generic ZKTeco'
];

export function BiometricDeviceModal({ isOpen, deviceToEdit: propDeviceToEdit, editingDevice, defaultBranch, onClose }: Props) {
  const deviceToEdit = propDeviceToEdit || editingDevice || null;
  const { devices, allDevices, addDevice, updateDevice, addNotification, branches, activeBranch, getDeviceBranch } = useData();

  const [name, setName] = useState('');
  const [branch, setBranch] = useState(defaultBranch || (activeBranch !== 'All' ? activeBranch : (branches[0]?.name || 'Main Head Office (Dhaka)')));
  const [model, setModel] = useState('ZKTeco SenseFace 2A');
  const [customModel, setCustomModel] = useState('');
  const [deviceType, setDeviceType] = useState('facial');
  const [serialNumber, setSerialNumber] = useState('');
  const [deviceId, setDeviceId] = useState('1');
  const [connectionType, setConnectionType] = useState<'adms' | 'tcp' | 'standalone'>('adms');
  const [ipAddress, setIpAddress] = useState('192.168.1.201');
  const [port, setPort] = useState<number | string>(443);
  const [location, setLocation] = useState('Main Entrance');
  const [enabled, setEnabled] = useState(true);
  const [autoSync, setAutoSync] = useState(true);
  const [notes, setNotes] = useState('');

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (deviceToEdit) {
      setName(deviceToEdit.name || '');
      const isCommon = COMMON_MODELS.includes(deviceToEdit.model || '');
      if (isCommon) {
        setModel(deviceToEdit.model || COMMON_MODELS[0]);
        setCustomModel('');
      } else {
        setModel('Other / Generic ZKTeco');
        setCustomModel(deviceToEdit.model || '');
      }
      setDeviceType(deviceToEdit.deviceType || (deviceToEdit.faceRecognition ? 'facial' : 'fingerprint'));
      setSerialNumber(deviceToEdit.serialNumber || deviceToEdit.serial || '');
      setDeviceId(deviceToEdit.deviceId || '1');
      const connType = deviceToEdit.connectionType || (String(deviceToEdit.port) === '4370' ? 'tcp' : 'adms');
      setConnectionType(connType);
      setIpAddress(deviceToEdit.ipAddress || deviceToEdit.ip || '192.168.1.201');
      setPort(deviceToEdit.port || (connType === 'tcp' ? 4370 : 443));
      setLocation(deviceToEdit.location || '');
      setBranch(getDeviceBranch(deviceToEdit));
      setEnabled(deviceToEdit.enabled !== false);
      setAutoSync(deviceToEdit.autoSync !== false);
      setNotes(deviceToEdit.notes || '');
    } else {
      const targetBranch = defaultBranch || (activeBranch !== 'All' ? activeBranch : (branches[0]?.name || 'Main Head Office (Dhaka)'));
      setBranch(targetBranch);
      setName(defaultBranch ? `${defaultBranch.split('(')[0].trim()} Terminal` : '');
      setModel('ZKTeco SenseFace 2A');
      setCustomModel('');
      setDeviceType('facial');
      setSerialNumber('');
      setDeviceId(`DEV-${((allDevices?.length || devices.length) + 1).toString().padStart(2, '0')}`);
      setConnectionType('adms');
      setIpAddress('192.168.1.201');
      setPort(443);
      setLocation('Main Entrance');
      setEnabled(true);
      setAutoSync(true);
      setNotes('');
    }
    setErrors({});
  }, [deviceToEdit, isOpen, devices.length, defaultBranch, activeBranch]);

  // Update default port based on connection type
  const handleConnectionTypeChange = (type: 'adms' | 'tcp' | 'standalone') => {
    setConnectionType(type);
    if (type === 'adms' && (port === 4370 || !port)) {
      setPort(443);
    } else if (type === 'tcp' && (port === 443 || !port)) {
      setPort(4370);
    }
  };

  const validate = () => {
    const errs: Record<string, string> = {};

    if (!name.trim()) {
      errs.name = 'Device name is required.';
    }

    const cleanSerial = serialNumber.trim();
    if (!cleanSerial) {
      errs.serialNumber = 'Hardware Serial Number is required for biometric authentication.';
    } else {
      // Check duplicate serial number
      const existing = devices.find(d => {
        const dSerial = (d.serialNumber || d.serial || '').trim().toLowerCase();
        return dSerial === cleanSerial.toLowerCase() && d.id !== deviceToEdit?.id;
      });
      if (existing) {
        errs.serialNumber = `Serial number is already assigned to "${existing.name}". Duplicate devices are prevented.`;
      }
    }

    if (model === 'Other / Generic ZKTeco' && !customModel.trim()) {
      errs.model = 'Please specify the device model name.';
    }

    // IP validation for TCP/IP mode
    if (connectionType === 'tcp') {
      const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
      if (!ipAddress.trim()) {
        errs.ipAddress = 'IP Address is required for TCP/IP network mode.';
      } else if (!ipRegex.test(ipAddress.trim())) {
        errs.ipAddress = 'Please enter a valid IPv4 address (e.g. 192.168.1.201).';
      }
    }

    // Port validation
    const numPort = Number(port);
    if (!port || isNaN(numPort) || numPort < 1 || numPort > 65535) {
      errs.port = 'Port must be a valid number between 1 and 65535.';
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setIsSubmitting(true);
    const resolvedModel = model === 'Other / Generic ZKTeco' ? customModel.trim() : model;

    const selectedBranchObj = branches.find(b => b.name === branch);

    const deviceData = {
      name: name.trim(),
      branch: branch || 'Main Head Office (Dhaka)',
      branchId: selectedBranchObj?.id || 'BR-001',
      model: resolvedModel,
      deviceType,
      type: resolvedModel,
      serialNumber: serialNumber.trim(),
      serial: serialNumber.trim(),
      deviceId: deviceId.trim() || '1',
      ipAddress: ipAddress.trim(),
      ip: ipAddress.trim(),
      port: Number(port),
      connectionType,
      status: deviceToEdit?.status || 'untested',
      enabled,
      biometricEnabled: deviceType === 'fingerprint' || deviceType === 'hybrid',
      faceRecognition: deviceType === 'facial' || deviceType === 'hybrid' || resolvedModel.toLowerCase().includes('face'),
      rfidEnabled: deviceType === 'rfid' || deviceType === 'hybrid',
      autoSync,
      location: location.trim(),
      notes: notes.trim(),
      lastSeen: deviceToEdit?.lastSeen || null,
      lastSync: deviceToEdit?.lastSync || null,
    };

    try {
      if (deviceToEdit) {
        await updateDevice(deviceToEdit.id, deviceData);
        addNotification({
          title: 'Device Updated',
          message: `Biometric terminal "${deviceData.name}" has been updated successfully.`,
          read: false,
          type: 'system',
          targetPage: 'zkteco',
        });
      } else {
        await addDevice(deviceData);
        addNotification({
          title: 'New Device Registered',
          message: `Biometric device "${deviceData.name}" (${deviceData.serialNumber}) registered in Firestore.`,
          read: false,
          type: 'system',
          targetPage: 'zkteco',
        });
      }
      setIsSubmitting(false);
      onClose();
    } catch (err: any) {
      console.error('Failed to save biometric device:', err);
      setErrors({ submit: err?.message || 'Failed to save device. Please check connection.' });
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-3xl max-w-2xl w-full p-6 sm:p-7 shadow-2xl border border-slate-100 max-h-[92vh] overflow-y-auto animate-scale-in"
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white shadow-md">
              <IconServer size={20} />
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-900 tracking-tight">
                {deviceToEdit ? 'Edit Biometric Device' : 'Register New Biometric Device'}
              </h3>
              <p className="text-xs text-slate-500">
                {deviceToEdit ? `Update hardware parameters for ${deviceToEdit.name}` : 'Configure physical ZKTeco terminal parameters'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-700 font-bold transition-colors"
          >
            ✕
          </button>
        </div>

        {errors.submit && (
          <div className="mt-4 p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 font-medium">
            {errors.submit}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {/* Row 0: Assigned Office / Branch Selection */}
          <div className="bg-indigo-50/80 border border-indigo-200 rounded-2xl p-4">
            <label className="block text-xs font-bold text-indigo-900 uppercase mb-1.5">
              Assigned Branch Office (মেশিনটি কোন অফিসে লাগানো আছে?) <span className="text-rose-500">*</span>
            </label>
            <select
              value={branch}
              onChange={e => setBranch(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-white border border-indigo-200 rounded-xl text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {branches.map(b => (
                <option key={b.id} value={b.name}>
                  {b.isHeadOffice ? `🏢 [Head Office] ${b.name}` : `📍 [Branch Office] ${b.name}`} — {b.city} ({b.code})
                </option>
              ))}
            </select>
            <p className="text-[11px] text-indigo-700 mt-1.5 font-medium">
              ঢাকার মেইন অফিস বা যেকোনো শাখা অফিস সিলেক্ট করুন। মেশিনের সিরিয়াল নাম্বার অনুযায়ী অটোমেটিক ওই ব্রাঞ্চের এমপ্লয়ীদের হাজিরা সিঙ্ক হবে।
            </p>
          </div>

          {/* Row 1: Device Name & Terminal ID */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Device Name <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                placeholder="e.g. Main Gate SenseFace 2A"
                value={name}
                onChange={e => setName(e.target.value)}
                className={`w-full px-3.5 py-2.5 bg-slate-50 border rounded-xl text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                  errors.name ? 'border-rose-400 bg-rose-50/40' : 'border-slate-200'
                }`}
              />
              {errors.name && <p className="text-[11px] text-rose-600 mt-1">{errors.name}</p>}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Terminal ID
              </label>
              <input
                type="text"
                placeholder="e.g. 1 or DEV-01"
                value={deviceId}
                onChange={e => setDeviceId(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* Row 2: Model & Hardware Type */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Hardware Model <span className="text-rose-500">*</span>
              </label>
              <select
                value={model}
                onChange={e => setModel(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {COMMON_MODELS.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              {model === 'Other / Generic ZKTeco' && (
                <input
                  type="text"
                  placeholder="Enter model name..."
                  value={customModel}
                  onChange={e => setCustomModel(e.target.value)}
                  className="mt-2 w-full px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-800"
                />
              )}
              {errors.model && <p className="text-[11px] text-rose-600 mt-1">{errors.model}</p>}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Biometric Modality
              </label>
              <select
                value={deviceType}
                onChange={e => setDeviceType(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="facial">Visible Light Facial Recognition</option>
                <option value="fingerprint">Optical / SilkID Fingerprint</option>
                <option value="hybrid">Hybrid (Face + Fingerprint + RFID)</option>
                <option value="rfid">RFID Card / Proximity</option>
                <option value="palm">Palm Scanner</option>
              </select>
            </div>
          </div>

          {/* Row 3: Serial Number & Physical Location */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Serial Number (SN) <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                placeholder="e.g. NYU7251500061"
                value={serialNumber}
                onChange={e => setSerialNumber(e.target.value)}
                className={`w-full px-3.5 py-2.5 bg-slate-50 border rounded-xl text-sm font-mono font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                  errors.serialNumber ? 'border-rose-400 bg-rose-50/40' : 'border-slate-200'
                }`}
              />
              {errors.serialNumber ? (
                <p className="text-[11px] text-rose-600 mt-1">{errors.serialNumber}</p>
              ) : (
                <span className="text-[10px] text-slate-400">Found on the device sticker or Menu &gt; Sys Info</span>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Installation Location / Branch
              </label>
              <input
                type="text"
                placeholder="e.g. Main Gate Entrance"
                value={location}
                onChange={e => setLocation(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* Row 4: Connection Mode Selection */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
              Connection Architecture
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => handleConnectionTypeChange('adms')}
                className={`p-3 rounded-xl border text-left transition-all ${
                  connectionType === 'adms'
                    ? 'bg-indigo-50/80 border-indigo-300 ring-2 ring-indigo-500/20 text-indigo-900'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100/70'
                }`}
              >
                <div className="flex items-center space-x-2">
                  <IconCloud size={16} className={connectionType === 'adms' ? 'text-indigo-600' : 'text-slate-400'} />
                  <span className="text-xs font-bold">ADMS / Cloud</span>
                </div>
                <p className="text-[10px] text-slate-500 mt-1">Recommended for Web. Pushes directly to webhook.</p>
              </button>

              <button
                type="button"
                onClick={() => handleConnectionTypeChange('tcp')}
                className={`p-3 rounded-xl border text-left transition-all ${
                  connectionType === 'tcp'
                    ? 'bg-indigo-50/80 border-indigo-300 ring-2 ring-indigo-500/20 text-indigo-900'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100/70'
                }`}
              >
                <div className="flex items-center space-x-2">
                  <IconServer size={16} className={connectionType === 'tcp' ? 'text-indigo-600' : 'text-slate-400'} />
                  <span className="text-xs font-bold">TCP/IP (Local LAN)</span>
                </div>
                <p className="text-[10px] text-slate-500 mt-1">Standard local Ethernet IP connection.</p>
              </button>

              <button
                type="button"
                onClick={() => handleConnectionTypeChange('standalone')}
                className={`p-3 rounded-xl border text-left transition-all ${
                  connectionType === 'standalone'
                    ? 'bg-indigo-50/80 border-indigo-300 ring-2 ring-indigo-500/20 text-indigo-900'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100/70'
                }`}
              >
                <div className="flex items-center space-x-2">
                  <IconFingerprint size={16} className={connectionType === 'standalone' ? 'text-indigo-600' : 'text-slate-400'} />
                  <span className="text-xs font-bold">Standalone / USB</span>
                </div>
                <p className="text-[10px] text-slate-500 mt-1">Manual flash drive import / offline branch.</p>
              </button>
            </div>

            {/* IP & Port Fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                  Device IP Address {connectionType === 'tcp' && <span className="text-rose-500">*</span>}
                </label>
                <input
                  type="text"
                  placeholder="192.168.1.201"
                  value={ipAddress}
                  onChange={e => setIpAddress(e.target.value)}
                  className={`w-full px-3 py-2 bg-white border rounded-xl text-xs font-mono text-slate-800 ${
                    errors.ipAddress ? 'border-rose-400' : 'border-slate-200'
                  }`}
                />
                {errors.ipAddress && <p className="text-[11px] text-rose-600 mt-0.5">{errors.ipAddress}</p>}
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                  Port <span className="text-rose-500">*</span>
                </label>
                <input
                  type="number"
                  placeholder={connectionType === 'tcp' ? '4370' : '443'}
                  value={port}
                  onChange={e => setPort(e.target.value)}
                  className={`w-full px-3 py-2 bg-white border rounded-xl text-xs font-mono text-slate-800 ${
                    errors.port ? 'border-rose-400' : 'border-slate-200'
                  }`}
                />
                {errors.port && <p className="text-[11px] text-rose-600 mt-0.5">{errors.port}</p>}
              </div>
            </div>
          </div>

          {/* Row 5: Toggles & Operational State */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs">
            <label className="flex items-center space-x-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={enabled}
                onChange={e => setEnabled(e.target.checked)}
                className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
              />
              <span className="font-bold text-slate-800">Device Active &amp; Accepting Punches</span>
            </label>

            <label className="flex items-center space-x-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={autoSync}
                onChange={e => setAutoSync(e.target.checked)}
                className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
              />
              <span className="font-bold text-slate-800">Auto-Sync Attendance to WorkNest</span>
            </label>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
              Configuration Notes (Optional)
            </label>
            <textarea
              rows={2}
              placeholder="e.g. Connected to Main Gate router on VLAN 10. Managed by Security desk."
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-500/20 flex items-center space-x-1.5 transition-all disabled:opacity-50"
            >
              <IconCheck size={16} />
              <span>{isSubmitting ? 'Saving to Firestore...' : deviceToEdit ? 'Save Changes' : 'Register Device'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

type DeleteModalProps = {
  isOpen: boolean;
  device: BiometricDevice | null;
  onClose: () => void;
  onConfirm: () => Promise<void>;
};

export function DeleteDeviceConfirmationModal({ isOpen, device, onClose, onConfirm }: DeleteModalProps) {
  const [isDeleting, setIsDeleting] = useState(false);

  if (!isOpen || !device) return null;

  const handleConfirm = async () => {
    setIsDeleting(true);
    await onConfirm();
    setIsDeleting(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-100 animate-scale-in"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mb-4">
          <IconShield size={24} />
        </div>

        <h3 className="text-base font-black text-slate-900 tracking-tight">
          Delete Biometric Device?
        </h3>
        <p className="text-xs text-slate-600 mt-1 leading-relaxed">
          Are you sure you want to delete <strong className="text-slate-900">{device.name}</strong> ({device.serialNumber || device.serial})?
        </p>

        <div className="mt-3 p-3 bg-emerald-50/70 border border-emerald-100 rounded-xl text-[11px] text-emerald-900 space-y-1">
          <p className="font-bold flex items-center space-x-1">
            <span>✓</span>
            <span>Historical Data Protected</span>
          </p>
          <p className="text-slate-600 leading-normal">
            Punches, attendance logs, employee profiles, payroll, and shifts will <strong>NOT</strong> be deleted. All existing records remain preserved.
          </p>
        </div>

        <div className="flex items-center justify-end space-x-3 mt-5 pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isDeleting}
            className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shadow-md shadow-rose-500/20 transition-all disabled:opacity-50"
          >
            {isDeleting ? 'Deleting...' : 'Yes, Delete Device'}
          </button>
        </div>
      </div>
    </div>
  );
}
