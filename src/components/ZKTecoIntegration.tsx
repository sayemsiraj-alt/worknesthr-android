import { useState, useEffect } from 'react';
import { useData, BiometricDevice } from '../context/DataContext';
import { useTenant } from '../context/TenantContext';
import { collection, onSnapshot, query, where, orderBy, limit } from 'firebase/firestore';
import { db } from '../lib/firestoreService';
import { ZKTecoPunchTriggerModal } from './ZKTecoPunchTriggerModal';
import { BiometricDeviceModal, DeleteDeviceConfirmationModal } from './BiometricDeviceModal';
import {
  IconFingerprint, IconCheckCircle, IconRefresh, IconCloud, IconServer,
  IconShield, IconActivity, IconInfo, IconPlus, IconEdit, IconTrash, IconX, IconBuilding
} from './Icons';

export function ZKTecoIntegration() {
  const {
    employees, devices, allDevices, updateDevice, deleteDevice, testDeviceConnection,
    addNotification, branches, activeBranch, setActiveBranch, getDeviceBranch
  } = useData();
  const { currentCompanyId } = useTenant();
  const activeTenant = currentCompanyId || 'default';
  const [isPunchModalOpen, setIsPunchModalOpen] = useState(false);
  const [recentPunches, setRecentPunches] = useState<any[]>([]);
  const [loadingPunches, setLoadingPunches] = useState(true);
  const [copiedUrl, setCopiedUrl] = useState(false);

  // Device management modal state
  const [isDeviceModalOpen, setIsDeviceModalOpen] = useState(false);
  const [deviceToEdit, setDeviceToEdit] = useState<BiometricDevice | null>(null);
  const [deviceToDelete, setDeviceToDelete] = useState<BiometricDevice | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [testingDeviceId, setTestingDeviceId] = useState<string | null>(null);
  const [testFeedback, setTestFeedback] = useState<{ [id: string]: { success: boolean; message: string; latency?: number } }>({});

  // Cloud webhook URL (or local proxy)
  const webhookUrl = `${window.location.origin}/.netlify/functions/iclock`;

  // Real-time listener for last 25 biometric punches
  useEffect(() => {
    try {
      const q = activeTenant !== 'default'
        ? query(collection(db, 'punches'), where('companyId', '==', activeTenant), limit(25))
        : query(collection(db, 'punches'), orderBy('timestamp', 'desc'), limit(25));

      const unsub = onSnapshot(q, (snapshot) => {
        const list: any[] = [];
        snapshot.forEach(doc => {
          const data = doc.data();
          const isOplog = doc.id.includes('OPLOG') ||
            String(data.employeeId || '').toUpperCase().includes('OPLOG') ||
            String(data.employeeName || '').toUpperCase().includes('OPLOG');
          if (isOplog) return;

          const docComp = data.companyId || 'default';
          const matches = activeTenant !== 'default' ? docComp === activeTenant : (!data.companyId || docComp === 'default');
          if (matches) {
            list.push({ id: doc.id, ...data });
          }
        });
        list.sort((a, b) => (b.timestamp || b.punchTimestamp || '').localeCompare(a.timestamp || a.punchTimestamp || ''));
        setRecentPunches(list);
        setLoadingPunches(false);
      }, (err) => {
        console.warn('Recent punches listener error:', err);
        setLoadingPunches(false);
      });
      return () => unsub();
    } catch (e) {
      console.warn(e);
      setLoadingPunches(false);
    }
  }, [activeTenant]);

  const handleCopy = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
    addNotification({
      title: 'Webhook URL Copied',
      message: 'ADMS Server Webhook endpoint copied to clipboard.',
      read: false,
      type: 'system',
      targetPage: 'zkteco',
    });
  };

  const handleTestConnection = async (device: BiometricDevice) => {
    setTestingDeviceId(device.id);
    const res = await testDeviceConnection(device);
    setTestingDeviceId(null);
    setTestFeedback(prev => ({ ...prev, [device.id]: res }));
    addNotification({
      title: res.success ? 'Device Connection Confirmed' : 'Connection Test Result',
      message: `${device.name}: ${res.message}`,
      read: false,
      type: res.success ? 'system' : 'attendance',
      targetPage: 'zkteco',
    });
    setTimeout(() => {
      setTestFeedback(prev => {
        const next = { ...prev };
        delete next[device.id];
        return next;
      });
    }, 9000);
  };

  const handleToggleEnable = async (device: BiometricDevice) => {
    const nextState = !device.enabled;
    await updateDevice(device.id, { enabled: nextState });
    addNotification({
      title: nextState ? 'Device Enabled' : 'Device Disabled',
      message: `${device.name} is now ${nextState ? 'active and accepting punches' : 'disabled'}.`,
      read: false,
      type: 'system',
      targetPage: 'zkteco',
    });
  };

  const handleDeleteConfirm = async () => {
    if (deviceToDelete) {
      await deleteDevice(deviceToDelete.id);
      addNotification({
        title: 'Device Removed',
        message: `${deviceToDelete.name} has been removed. Historical punches and attendance records remain preserved.`,
        read: false,
        type: 'system',
        targetPage: 'zkteco',
      });
      setDeviceToDelete(null);
    }
  };

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto animate-fade-in pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider">ZKTeco ADMS &amp; Push Protocol</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight mt-0.5">Biometric Hardware Integration</h2>
          <p className="text-xs text-slate-500 mt-0.5">Connect physical biometric fingerprint &amp; face machines directly to Firestore</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => {
              setDeviceToEdit(null);
              setIsDeviceModalOpen(true);
            }}
            className="w-full sm:w-auto px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white rounded-xl text-xs font-bold shadow-2xs flex items-center justify-center space-x-1.5 transition-all cursor-pointer"
          >
            <IconPlus size={16} />
            <span>Add New Device</span>
          </button>

          <button
            onClick={() => setIsPunchModalOpen(true)}
            className="w-full sm:w-auto px-4 py-2.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-xl text-xs font-bold shadow-2xs flex items-center justify-center space-x-1.5 transition-all cursor-pointer"
          >
            <IconFingerprint size={16} className="text-indigo-600" />
            <span>Test Biometric Punch</span>
          </button>
        </div>
      </div>

      {/* RESTORED: Biometric Device Management Section */}
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-sm p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
                <IconServer size={18} />
              </div>
              <h3 className="text-base font-bold text-slate-900 tracking-tight">Registered Biometric Terminals</h3>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-100">
                {devices.length} {devices.length === 1 ? 'Device' : 'Devices'}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Configure physical on-premise hardware machines across Head Office &amp; all Branch Offices
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
            <div className="flex items-center space-x-1.5 bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200">
              <IconBuilding size={14} className="text-indigo-600 shrink-0" />
              <span className="text-[11px] font-bold text-slate-600">Office:</span>
              <select
                value={activeBranch}
                onChange={e => setActiveBranch(e.target.value)}
                className="bg-transparent text-xs font-bold text-indigo-700 focus:outline-none cursor-pointer"
              >
                <option value="All">All Offices ({allDevices.length})</option>
                {branches.map(b => {
                  const count = allDevices.filter(d => getDeviceBranch(d) === b.name).length;
                  return (
                    <option key={b.id} value={b.name}>
                      {b.isHeadOffice ? '🏢 ' : '📍 '}{b.name} ({count})
                    </option>
                  );
                })}
              </select>
            </div>
            <button
              onClick={() => {
                setDeviceToEdit(null);
                setIsDeviceModalOpen(true);
              }}
              className="px-3.5 py-2 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-slate-700 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5"
            >
              <IconPlus size={15} />
              <span>Register Device</span>
            </button>
          </div>
        </div>

        {/* Device Cards Grid */}
        {devices.length === 0 ? (
          <div className="py-12 px-4 text-center border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
            <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto mb-3">
              <IconServer size={24} />
            </div>
            <h4 className="text-sm font-bold text-slate-800">No Biometric Devices Registered</h4>
            <p className="text-xs text-slate-500 max-w-md mx-auto mt-1 mb-4">
              Add your physical ZKTeco fingerprint or facial terminal to enable real-time attendance ingestion, device status monitoring, and hardware punch logging.
            </p>
            <button
              onClick={() => {
                setDeviceToEdit(null);
                setIsDeviceModalOpen(true);
              }}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-500/20 inline-flex items-center space-x-1.5 transition-all"
            >
              <IconPlus size={16} />
              <span>Register First Device</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {devices.map(device => {
              const feedback = testFeedback[device.id];
              const isTesting = testingDeviceId === device.id;
              const sn = device.serialNumber || device.serial || 'N/A';
              const ip = device.ipAddress || device.ip || '—';
              const isAdms = device.connectionType === 'adms' || !device.connectionType || String(device.port) === '443';

              return (
                <div
                  key={device.id}
                  className={`p-5 rounded-2xl border transition-all flex flex-col justify-between ${
                    device.enabled !== false
                      ? 'bg-white border-slate-200/90 shadow-sm hover:border-indigo-300'
                      : 'bg-slate-50/70 border-slate-200 opacity-80'
                  }`}
                >
                  <div>
                    {/* Top Row: Icon + Name + Status */}
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-50 to-violet-100 text-indigo-700 flex items-center justify-center font-bold">
                          {device.faceRecognition || (device.deviceType === 'facial') ? (
                            <span className="text-lg">👤</span>
                          ) : (
                            <IconFingerprint size={20} />
                          )}
                        </div>
                        <div>
                          <h4 className="text-sm font-bold text-slate-900 tracking-tight leading-snug">
                            {device.name}
                          </h4>
                          <span className="text-[11px] font-semibold text-slate-500">
                            {device.model || device.type || 'ZKTeco Terminal'}
                          </span>
                        </div>
                      </div>

                      {/* Status Badge */}
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider flex items-center space-x-1 shrink-0 ${
                          device.status === 'connected' || device.status === 'online'
                            ? 'bg-emerald-100 text-emerald-800'
                            : device.status === 'offline'
                            ? 'bg-slate-100 text-slate-600'
                            : device.status === 'error'
                            ? 'bg-rose-100 text-rose-700'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            device.status === 'connected' || device.status === 'online'
                              ? 'bg-emerald-500 animate-pulse'
                              : device.status === 'error'
                              ? 'bg-rose-500'
                              : 'bg-amber-500'
                          }`}
                        ></span>
                        <span>
                          {device.status === 'connected'
                            ? 'Connected'
                            : device.status === 'online'
                            ? 'Online'
                            : device.status === 'error'
                            ? 'Error'
                            : 'Not Tested'}
                        </span>
                      </span>
                    </div>

                    {/* Metadata Badges */}
                    <div className="flex flex-wrap items-center gap-1.5 mb-3">
                      <span className="px-2.5 py-0.5 rounded-md text-[10px] font-bold bg-indigo-600 text-white shadow-2xs flex items-center space-x-1">
                        <IconBuilding size={11} />
                        <span>{getDeviceBranch(device)}</span>
                      </span>
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200 font-mono">
                        SN: {sn}
                      </span>
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-100">
                        {isAdms ? 'ADMS Push' : 'TCP/IP LAN'}
                      </span>
                      {device.location && (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-50 text-slate-600 border border-slate-200">
                          📍 {device.location}
                        </span>
                      )}
                      {device.enabled === false && (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                          Disabled
                        </span>
                      )}
                    </div>

                    {/* Technical Parameter Grid */}
                    <div className="grid grid-cols-2 gap-2 p-2.5 bg-slate-50/80 rounded-xl border border-slate-100 text-[11px] mb-3 font-mono">
                      <div>
                        <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">Network</span>
                        <span className="text-slate-800 font-medium truncate block">{ip}:{device.port}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">Terminal ID</span>
                        <span className="text-slate-800 font-medium truncate block">{device.deviceId || '1'}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">Last Sync</span>
                        <span className="text-slate-700 truncate block">{device.lastSync || 'Pending'}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">Last Seen</span>
                        <span className="text-slate-700 truncate block">
                          {device.lastSeen ? new Date(device.lastSeen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Never'}
                        </span>
                      </div>
                    </div>

                    {/* Dynamic Connection Test Feedback Alert */}
                    {feedback && (
                      <div
                        className={`p-2.5 rounded-xl text-[11px] mb-3 leading-relaxed border ${
                          feedback.success
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                            : 'bg-amber-50 border-amber-200 text-amber-900'
                        }`}
                      >
                        <p className="font-bold flex items-center space-x-1 mb-0.5">
                          <span>{feedback.success ? '✓ Verified' : 'ℹ Notice:'}</span>
                          {feedback.latency && <span className="font-mono">({feedback.latency}ms)</span>}
                        </p>
                        <p className="text-[10px] leading-normal">{feedback.message}</p>
                      </div>
                    )}
                  </div>

                  {/* Card Actions */}
                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                    <button
                      onClick={() => handleTestConnection(device)}
                      disabled={isTesting}
                      className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-[11px] font-bold rounded-lg transition-all flex items-center space-x-1 disabled:opacity-50"
                      title="Ping or verify handshake with device"
                    >
                      <IconActivity size={13} className={isTesting ? 'animate-spin text-indigo-600' : 'text-slate-600'} />
                      <span>{isTesting ? 'Testing...' : 'Test Connection'}</span>
                    </button>

                    <div className="flex items-center space-x-1">
                      <button
                        onClick={() => handleToggleEnable(device)}
                        className={`px-2 py-1 text-[10px] font-bold rounded-lg transition-colors ${
                          device.enabled !== false
                            ? 'text-slate-500 hover:text-rose-600 hover:bg-rose-50'
                            : 'text-emerald-700 hover:bg-emerald-50'
                        }`}
                        title={device.enabled !== false ? 'Disable device' : 'Enable device'}
                      >
                        {device.enabled !== false ? 'Disable' : 'Enable'}
                      </button>

                      <button
                        onClick={() => {
                          setDeviceToEdit(device);
                          setIsDeviceModalOpen(true);
                        }}
                        className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                        title="Edit device configuration"
                      >
                        <IconEdit size={14} />
                      </button>

                      <button
                        onClick={() => {
                          setDeviceToDelete(device);
                          setIsDeleteModalOpen(true);
                        }}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                        title="Delete device"
                      >
                        <IconTrash size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Connection & Configuration Details */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Hardware ADMS Settings Box */}
        <div className="lg:col-span-2 p-6 bg-white rounded-3xl border border-slate-200/80 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                <IconServer size={20} />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Machine ADMS / Cloud Server Setup</h3>
                <p className="text-xs text-slate-500">Configure your physical ZKTeco terminal (SenseFace 2A, K40, MB20, uFace800, SilkBio)</p>
              </div>
            </div>
            <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase bg-emerald-100 text-emerald-700">
              Protocol Ready
            </span>
          </div>

          <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
            <div>
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                ADMS Webhook Endpoint (Netlify / Express)
              </label>
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  readOnly
                  value={webhookUrl}
                  className="flex-1 px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-xs font-mono text-slate-800"
                />
                <button
                  onClick={handleCopy}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition-all"
                >
                  {copiedUrl ? '✓ Copied' : 'Copy'}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs pt-1">
              <div className="p-2.5 bg-white rounded-xl border border-slate-200">
                <span className="text-[10px] text-slate-400 font-bold block uppercase">Server Port</span>
                <span className="font-mono font-bold text-slate-800">80 / 443 (HTTPS)</span>
              </div>
              <div className="p-2.5 bg-white rounded-xl border border-slate-200">
                <span className="text-[10px] text-slate-400 font-bold block uppercase">Device Mode</span>
                <span className="font-bold text-emerald-700">ADMS / Push SDK</span>
              </div>
              <div className="p-2.5 bg-white rounded-xl border border-slate-200">
                <span className="text-[10px] text-slate-400 font-bold block uppercase">Real-time Push</span>
                <span className="font-bold text-indigo-700">Enabled (Instant)</span>
              </div>
            </div>
          </div>

          {/* Device Step-by-Step Instructions */}
          <div className="space-y-2 text-xs text-slate-600">
            <h4 className="font-bold text-slate-800 flex items-center space-x-1.5">
              <IconInfo size={14} className="text-indigo-600" />
              <span>How to setup physical machine in 3 steps:</span>
            </h4>
            <ol className="list-decimal list-inside space-y-1 pl-1 text-slate-600 leading-relaxed">
              <li>Open your device menu: <strong>Comm. &gt; Cloud Server Setting / ADMS</strong></li>
              <li>Set Server Address to your domain or host, and Port to <strong>443</strong></li>
              <li>Enable <strong>Enable Domain Name</strong> if using a web URL. Save and restart the machine.</li>
            </ol>
          </div>
        </div>

        {/* Sync Engine Status */}
        <div className="p-6 bg-white rounded-3xl border border-slate-200/80 shadow-sm space-y-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <IconCloud size={20} />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Firestore Sync Engine</h3>
              <p className="text-xs text-slate-500">Auto-calculation rules</p>
            </div>
          </div>

          <div className="space-y-2.5 text-xs text-slate-600">
            <div className="p-3 bg-emerald-50/70 border border-emerald-100 rounded-2xl space-y-1">
              <span className="font-bold text-emerald-900 block">✓ First Punch = Check In</span>
              <p className="text-slate-600 text-[11px]">Auto-determines Present vs Late using the employee's assigned shift start time and grace minutes.</p>
            </div>
            <div className="p-3 bg-indigo-50/70 border border-indigo-100 rounded-2xl space-y-1">
              <span className="font-bold text-indigo-900 block">✓ Subsequent Punches = Check Out</span>
              <p className="text-slate-600 text-[11px]">Updates the check-out timestamp and computes total work hours and overtime (OT) exceeding 8.0h.</p>
            </div>
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl space-y-1">
              <span className="font-bold text-slate-800 block">✓ Deduplication Guard</span>
              <p className="text-slate-600 text-[11px]">Prevents duplicate reads or double logs within a 1-minute window.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Live Machine Punches Table */}
      <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200/80 shadow-2xs p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 mb-4">
          <div>
            <h3 className="text-sm sm:text-base font-bold text-slate-900 tracking-tight">Recent Machine Punches</h3>
            <p className="text-[11px] sm:text-xs text-slate-500">Live feed directly from Firestore <code className="font-mono bg-slate-100 px-1 py-0.5 rounded">/punches</code> collection</p>
          </div>
          <button
            onClick={() => setIsPunchModalOpen(true)}
            className="self-start sm:self-auto px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all cursor-pointer"
          >
            + Trigger Test Punch
          </button>
        </div>

        {loadingPunches ? (
          <div className="py-12 text-center text-xs text-slate-400">Loading punches from Firestore...</div>
        ) : recentPunches.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-xs">
            No machine punches logged yet today. Click "Test Biometric Punch" above to send one!
          </div>
        ) : (
          <div className="overflow-x-auto thin-scroll">
            <table className="w-full text-xs min-w-[640px]">
              <thead className="bg-slate-50/80 border-b border-slate-100">
                <tr className="text-left text-slate-500 font-bold uppercase">
                  <th className="py-3 px-4">EMPLOYEE</th>
                  <th className="py-3 px-4">ID</th>
                  <th className="py-3 px-4">TIMESTAMP</th>
                  <th className="py-3 px-4">VERIFY MODE</th>
                  <th className="py-3 px-4">DEVICE</th>
                  <th className="py-3 px-4">DEVICE SERIAL</th>
                  <th className="py-3 px-4">SHIFT</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentPunches.map(p => {
                  const empCode = p.employeeId || p.employeeCode || p.pin || '';
                  const matchedEmp = employees.find(
                    e => String(e.employeeId || '').trim() === String(empCode).trim() || String(e.id || '').trim() === String(empCode).trim()
                  );
                  const displayTime = p.punchTime || p.time || p.punchTimestamp || p.timestamp || p.createdAt || '-';
                  const displayDate = p.date || (typeof p.punchTimestamp === 'string' ? p.punchTimestamp.split('T')[0].split(' ')[0] : '');
                  return (
                    <tr key={p.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-3 px-4 font-bold text-slate-900">{p.employeeName || matchedEmp?.name || `Employee ${empCode}`}</td>
                      <td className="py-3 px-4 font-mono font-bold text-indigo-600">{empCode}</td>
                      <td className="py-3 px-4 font-mono text-slate-600">{displayDate ? `${displayDate} • ${displayTime}` : displayTime}</td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-700 font-bold text-[10px]">
                          {p.verifyMode || (p.verify === 15 ? 'Face' : p.verify === 1 ? 'Fingerprint' : 'Fingerprint')}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-700">{p.deviceName || 'ZKTeco Terminal'}</td>
                      <td className="py-3 px-4 font-mono text-slate-500">{p.deviceSerialNumber || p.deviceSerial || 'BIO-01'}</td>
                      <td className="py-3 px-4 text-slate-600">{p.shiftName || matchedEmp?.shift || 'Morning'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Device Modal */}
      <BiometricDeviceModal
        isOpen={isDeviceModalOpen}
        deviceToEdit={deviceToEdit}
        onClose={() => {
          setIsDeviceModalOpen(false);
          setDeviceToEdit(null);
        }}
      />

      {/* Delete Device Confirmation Modal */}
      <DeleteDeviceConfirmationModal
        isOpen={isDeleteModalOpen}
        device={deviceToDelete}
        onClose={() => {
          setIsDeleteModalOpen(false);
          setDeviceToDelete(null);
        }}
        onConfirm={handleDeleteConfirm}
      />

      {/* Test Punch Modal */}
      <ZKTecoPunchTriggerModal
        isOpen={isPunchModalOpen}
        onClose={() => setIsPunchModalOpen(false)}
      />
    </div>
  );
}
