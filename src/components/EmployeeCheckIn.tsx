import { useState, useRef, useEffect } from 'react';
import { useData } from '../context/DataContext';
import { useTenant } from '../context/TenantContext';
import { pushToFirebase } from '../lib/firebase';
import { recordZKTecoPunchToFirestore } from '../lib/firestoreService';
import { formatTo12Hour } from '../utils/timeFormat';
import { resolveEmployeeScheduleForDate, calculateOvertimeHours, getBangladeshTodayStr } from '../utils/attendanceScheduleEngine';

type CheckInRecord = {
  date: string;
  checkIn: string;
  checkOut: string;
  status: 'present' | 'absent' | 'holiday';
  checkInPhoto?: string;
  checkOutPhoto?: string;
  otHours?: number;
};

export function EmployeeCheckIn() {
  const { currentEmployee, addNotification, firebaseConnected, shifts, roster } = useData();
  const { currentCompanyId } = useTenant();
  const [showCamera, setShowCamera] = useState(false);
  const [cameraMode, setCameraMode] = useState<'in' | 'out'>('in');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState<number | null>(null);
  const [autoCaptureEnabled, setAutoCaptureEnabled] = useState(true);
  const [faceDetected, setFaceDetected] = useState(false);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [isSyncingToCloud, setIsSyncingToCloud] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null);
  const detectionIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Load saved check-in records from localStorage (Preserve fallback)
  const [records, setRecords] = useState<CheckInRecord[]>(() => {
    if (!currentEmployee) return [];
    try {
      const saved = localStorage.getItem(`attendance_${currentEmployee.id}`);
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    // Default initial mock data
    return [
      { date: '2026-09-17', checkIn: '09:06', checkOut: '18:53', status: 'present' },
      { date: '2026-09-16', checkIn: '-', checkOut: '-', status: 'absent' },
      { date: '2026-09-15', checkIn: '-', checkOut: '-', status: 'absent' },
      { date: '2026-09-14', checkIn: '09:15', checkOut: '18:18', status: 'present', otHours: 2 },
      { date: '2026-09-13', checkIn: '09:19', checkOut: '18:33', status: 'present' },
      { date: '2026-09-12', checkIn: '09:12', checkOut: '18:43', status: 'present' },
      { date: '2026-09-11', checkIn: '-', checkOut: '-', status: 'holiday' },
    ];
  });

  const today = getBangladeshTodayStr();
  const todayRecord = records.find(r => r.date === today) || { date: today, checkIn: '-', checkOut: '-', status: 'present' as const };

  useEffect(() => {
    if (currentEmployee) {
      try {
        localStorage.setItem(`attendance_${currentEmployee.id}`, JSON.stringify(records));
      } catch (e) {}
    }
  }, [records, currentEmployee]);

  const startCamera = async (mode: 'in' | 'out') => {
    setError('');
    setCameraMode(mode);
    setCapturedPhoto(null);
    setCountdown(null);
    setIsCameraReady(false);
    setFaceDetected(false);
    setShowCamera(true);

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        videoRef.current.onloadedmetadata = () => {
          setIsCameraReady(true);
          if (autoCaptureEnabled) {
            startCountdown();
          }
        };
      }
    } catch (err: any) {
      setError(`📷 Camera access denied. Please allow camera permission in your browser settings. Error: ${err.message}`);
    }
  };

  const startCountdown = () => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
    }
    setCountdown(3);
    countdownTimerRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev === null) return null;
        if (prev <= 1) {
          if (countdownTimerRef.current) {
            clearInterval(countdownTimerRef.current);
            countdownTimerRef.current = null;
          }
          setTimeout(() => doCapture(), 100);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const detectFace = () => {
    if (!videoRef.current || !canvasRef.current || !isCameraReady) return false;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;

    canvas.width = 160;
    canvas.height = 120;
    ctx.drawImage(video, 0, 0, 160, 120);

    try {
      const imageData = ctx.getImageData(0, 0, 160, 120);
      const data = imageData.data;
      let skinTonePixels = 0;
      let totalPixels = 0;

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        totalPixels++;
        if (r > 95 && g > 40 && b > 20 && r > g && r > b && Math.abs(r - g) > 15) {
          skinTonePixels++;
        }
      }

      const skinRatio = skinTonePixels / totalPixels;
      const detected = skinRatio > 0.05 && skinRatio < 0.4;
      setFaceDetected(detected);
      return detected;
    } catch (e) {
      return false;
    }
  };

  const doCapture = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    if (!context) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Add timestamp overlay on photo
    const timestamp = new Date().toLocaleString('en-GB');
    const employeeName = currentEmployee?.name || 'Employee';
    const employeeId = currentEmployee?.employeeId || '';
    const mode = cameraMode === 'in' ? 'CHECK IN' : 'CHECK OUT';

    context.fillStyle = 'rgba(0, 0, 0, 0.7)';
    context.fillRect(0, canvas.height - 90, canvas.width, 90);
    context.fillStyle = '#ffffff';
    context.font = 'bold 22px Arial';
    context.fillText(`${mode} - ${employeeName}`, 12, canvas.height - 55);
    context.font = '16px Arial';
    context.fillText(`${employeeId}`, 12, canvas.height - 30);
    context.fillText(timestamp, 12, canvas.height - 10);

    // Watermark logo
    context.fillStyle = 'rgba(255, 255, 255, 0.8)';
    context.font = 'bold 14px Arial';
    context.fillText('Worknest HR', canvas.width - 130, 25);

    const photoData = canvas.toDataURL('image/jpeg', 0.7);
    setCapturedPhoto(photoData);
    setCountdown(null);

    addNotification({
      title: '📸 Photo Captured',
      message: `${mode} photo captured automatically for ${employeeName}`,
      read: false,
      type: 'attendance',
      targetPage: 'attendance',
    });
  };

  const capturePhoto = () => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    setCountdown(null);
    doCapture();
  };

  const syncAttendanceToBackend = async (record: CheckInRecord, mode: 'in' | 'out') => {
    if (!currentEmployee) return;
    setIsSyncingToCloud(true);

    const now = new Date();
    const fullTimestamp = now.toISOString();
    const todayStr = fullTimestamp.split('T')[0];
    const sched = resolveEmployeeScheduleForDate(currentEmployee, todayStr, roster, shifts);
    const shiftStartTime = sched.startTime !== '--:--' ? sched.startTime : '09:00';
    const shiftEndTime = sched.endTime !== '--:--' ? sched.endTime : '18:00';
    const shiftGraceMinutes = sched.graceTime || 15;
    const shiftName = sched.isWeekend ? 'Weekend / Off' : (sched.shiftName || 'General Shift');

    try {
      // 1. Write directly to Firestore collections ('punches' and 'attendance') so Admin Attendance displays it immediately
      await recordZKTecoPunchToFirestore({
        companyId: currentEmployee.companyId || currentCompanyId || 'default',
        employeeId: currentEmployee.employeeId || currentEmployee.id,
        employeeName: currentEmployee.name,
        department: currentEmployee.department || 'General',
        deviceSerialNumber: 'BROWSER-CAM-01',
        deviceName: 'Web Browser Camera',
        verifyMode: 'Face',
        punchTimestamp: fullTimestamp,
        shiftStartTime,
        shiftEndTime,
        shiftGraceMinutes,
        shiftName,
        otThresholdMinutes: sched.minOvertimeMinutes || 30,
        overtimePolicyEnabled: sched.overtimePolicyEnabled !== false,
        maxOvertimeHours: sched.maxOvertimeHours || 0,
        latePolicyEnabled: sched.latePolicyEnabled !== false,
        isFlexible: sched.shift?.type === 'flexible',
        photoProof: capturedPhoto,
        skipMonthFilter: true
      });

      // 2. Also preserve Realtime Database backup if configured
      const data = {
        employeeId: currentEmployee.id,
        employeeCode: currentEmployee.employeeId,
        employeeName: currentEmployee.name,
        department: currentEmployee.department,
        designation: currentEmployee.designation,
        date: today,
        checkIn: record.checkIn,
        checkOut: record.checkOut,
        status: record.status,
        checkInPhoto: record.checkInPhoto || null,
        checkOutPhoto: record.checkOutPhoto || null,
        otHours: record.otHours || 0,
        lastAction: mode,
        timestamp: fullTimestamp,
      };
      await pushToFirebase(`attendance/${currentEmployee.id}/${today}`, data).catch(() => {});
      await pushToFirebase(`attendance_by_code/${currentEmployee.employeeId}/${today}`, data).catch(() => {});

      setIsSyncingToCloud(false);
      addNotification({
        title: '☁️ Synced to Firestore & Cloud',
        message: `Your ${mode === 'in' ? 'check-in' : 'check-out'} and photo proof are now live in Admin Attendance!`,
        read: false,
        type: 'attendance',
        targetPage: 'attendance',
      });
    } catch (e: any) {
      setIsSyncingToCloud(false);
      console.error('Sync attendance to Firestore error:', e);
    }
  };

  const confirmCheckIn = async () => {
    if (!capturedPhoto) {
      setError('⚠️ Please capture a photo first');
      return;
    }

    const now = new Date();
    const timeStr = now.toTimeString().slice(0, 5);
    let updatedRecord: CheckInRecord | null = null;

    if (cameraMode === 'in') {
      const existingIdx = records.findIndex(r => r.date === today);
      const newRecord: CheckInRecord = {
        date: today,
        checkIn: timeStr,
        checkOut: '-',
        status: 'present',
        checkInPhoto: capturedPhoto,
      };

      if (existingIdx >= 0) {
        const updated = [...records];
        updated[existingIdx] = { ...updated[existingIdx], checkIn: timeStr, checkInPhoto: capturedPhoto };
        setRecords(updated);
        updatedRecord = updated[existingIdx];
      } else {
        const newRecords = [newRecord, ...records];
        setRecords(newRecords);
        updatedRecord = newRecord;
      }
      addNotification({ title: '✅ Check In Successful', message: `Welcome ${currentEmployee?.name}! You checked in at ${timeStr}`, read: false, type: 'attendance', targetPage: 'attendance' });
    } else {
      const existingIdx = records.findIndex(r => r.date === today);
      if (existingIdx >= 0) {
        const updated = [...records];
        const checkInTime = updated[existingIdx].checkIn;
        const sched = currentEmployee ? resolveEmployeeScheduleForDate(currentEmployee, today, roster, shifts) : null;
        const otHours = calculateOvertimeHours(checkInTime, timeStr, sched);
        updated[existingIdx] = {
          ...updated[existingIdx],
          checkOut: timeStr,
          checkOutPhoto: capturedPhoto,
          otHours,
        };
        setRecords(updated);
        updatedRecord = updated[existingIdx];
      }
      addNotification({ title: '✅ Check Out Successful', message: `Goodbye ${currentEmployee?.name}! You checked out at ${timeStr}`, read: false, type: 'attendance', targetPage: 'attendance' });
    }

    if (updatedRecord) {
      await syncAttendanceToBackend(updatedRecord, cameraMode);
    }
    stopCamera();
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    if (detectionIntervalRef.current) {
      clearInterval(detectionIntervalRef.current);
      detectionIntervalRef.current = null;
    }
    setShowCamera(false);
    setCapturedPhoto(null);
    setError('');
    setCountdown(null);
    setFaceDetected(false);
    setIsCameraReady(false);
  };

  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
      if (detectionIntervalRef.current) clearInterval(detectionIntervalRef.current);
    };
  }, [stream]);

  useEffect(() => {
    if (isCameraReady && autoCaptureEnabled && !capturedPhoto) {
      detectionIntervalRef.current = setInterval(() => {
        detectFace();
      }, 500);
      return () => {
        if (detectionIntervalRef.current) {
          clearInterval(detectionIntervalRef.current);
          detectionIntervalRef.current = null;
        }
      };
    }
  }, [isCameraReady, autoCaptureEnabled, capturedPhoto]);

  const retakePhoto = () => {
    setCapturedPhoto(null);
    setError('');
    setCountdown(null);
    if (autoCaptureEnabled) {
      startCountdown();
    }
  };

  if (!currentEmployee) return null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-800 flex items-center space-x-2">
          <span>📷</span><span>My Attendance</span>
        </h2>
        <p className="text-sm text-slate-500 mt-1">Check in / Check out with camera photo proof (synced to Firestore)</p>
      </div>

      {/* Today's Status Card */}
      <div className="bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 rounded-2xl p-6 text-white">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <p className="text-xs opacity-90">📅 Today: {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
            <p className="text-2xl font-bold mt-1">
              Status: <span className="capitalize">{todayRecord.status}</span>
            </p>
            <p className="text-sm mt-2 opacity-90">
              IN: <span className="font-mono font-bold">{formatTo12Hour(todayRecord.checkIn)}</span>
              {'   '}
              OUT: <span className="font-mono font-bold">{formatTo12Hour(todayRecord.checkOut)}</span>
            </p>
            {todayRecord.otHours && todayRecord.otHours > 0 && (
              <p className="text-xs mt-1 opacity-90">OT: <strong>{todayRecord.otHours}h</strong></p>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => startCamera('in')}
              disabled={todayRecord.checkIn !== '-'}
              className="px-6 py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-bold disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2 shadow-lg"
            >
              <span>🟢</span><span>Check In</span>
            </button>
            <button
              onClick={() => startCamera('out')}
              disabled={todayRecord.checkIn === '-' || todayRecord.checkOut !== '-'}
              className="px-6 py-3 bg-pink-500 hover:bg-pink-600 text-white rounded-xl font-bold disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2 shadow-lg"
            >
              <span>🔴</span><span>Check Out</span>
            </button>
          </div>
        </div>
      </div>

      {/* Photo Proof Gallery */}
      {(todayRecord.checkInPhoto || todayRecord.checkOutPhoto) && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
          <h3 className="font-semibold text-slate-800 mb-3 flex items-center space-x-2">
            <span>📷</span><span>Today's Photo Proof</span>
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {todayRecord.checkInPhoto && (
              <div>
                <p className="text-sm font-semibold text-emerald-700 mb-2">🟢 Check In Photo</p>
                <img src={todayRecord.checkInPhoto} alt="Check In" className="w-full rounded-lg border-2 border-emerald-300" />
              </div>
            )}
            {todayRecord.checkOutPhoto && (
              <div>
                <p className="text-sm font-semibold text-pink-700 mb-2">🔴 Check Out Photo</p>
                <img src={todayRecord.checkOutPhoto} alt="Check Out" className="w-full rounded-lg border-2 border-pink-300" />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Attendance History Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">DATE</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">IN</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">OUT</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">OT</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">STATUS</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">PHOTOS</th>
              </tr>
            </thead>
            <tbody>
              {records.slice(0, 10).map((r, i) => (
                <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono">{r.date}</td>
                  <td className="px-4 py-3 font-mono">{formatTo12Hour(r.checkIn)}</td>
                  <td className="px-4 py-3 font-mono">{formatTo12Hour(r.checkOut)}</td>
                  <td className="px-4 py-3">{r.otHours ? `${r.otHours}h` : '-'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded-full font-semibold ${
                      r.status === 'present' ? 'bg-emerald-100 text-emerald-700' :
                      r.status === 'absent' ? 'bg-red-100 text-red-700' :
                      'bg-amber-100 text-amber-700'
                    }`}>
                      {r.status === 'present' ? '✓ Present' : r.status === 'absent' ? '✗ Absent' : '🏖️ Holiday'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      {r.checkInPhoto && <span title="Has Check In photo">📷</span>}
                      {r.checkOutPhoto && <span title="Has Check Out photo">📸</span>}
                      {!r.checkInPhoto && !r.checkOutPhoto && <span className="text-slate-300">-</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Camera Modal */}
      {showCamera && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={stopCamera}>
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className={`p-4 text-white ${cameraMode === 'in' ? 'bg-gradient-to-r from-emerald-500 to-teal-600' : 'bg-gradient-to-r from-pink-500 to-rose-600'}`}>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-bold">
                    {cameraMode === 'in' ? '🟢 Check In' : '🔴 Check Out'} - Photo Proof
                  </h3>
                  <p className="text-xs opacity-90 mt-1">Position your face in the frame and click Capture</p>
                </div>
                <button
                  type="button"
                  onClick={stopCamera}
                  className="w-9 h-9 bg-white/30 hover:bg-white/50 rounded-full flex items-center justify-center text-lg font-bold"
                >✕</button>
              </div>
            </div>

            <div className="p-5">
              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  {error}
                </div>
              )}

              <div className="relative bg-slate-900 rounded-xl overflow-hidden" style={{ aspectRatio: '4/3' }}>
                {!capturedPhoto ? (
                  <>
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-cover"
                      style={{ transform: 'scaleX(-1)' }}
                    />
                    <canvas ref={canvasRef} className="hidden" />

                    {/* Face guide overlay */}
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className={`w-48 h-48 border-4 rounded-full transition-colors ${
                        faceDetected ? 'border-emerald-400 border-solid' : 'border-white/70 border-dashed'
                      }`}></div>
                    </div>

                    {/* Countdown Number */}
                    {countdown !== null && countdown > 0 && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="bg-black/40 rounded-full p-2">
                          <span className="text-white text-8xl font-bold drop-shadow-2xl">
                            {countdown}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Status indicators */}
                    <div className="absolute top-3 left-3 right-3 flex justify-between pointer-events-none">
                      <div className={`px-3 py-1.5 rounded-full text-xs font-bold flex items-center space-x-1 ${
                        faceDetected ? 'bg-emerald-500 text-white' : 'bg-amber-500 text-white'
                      }`}>
                        <span>{faceDetected ? '🟢' : '🟡'}</span>
                        <span>{faceDetected ? 'Face Detected' : 'Detecting...'}</span>
                      </div>
                      <div className="px-3 py-1.5 rounded-full text-xs font-bold bg-red-600 text-white flex items-center space-x-1">
                        <span className="w-2 h-2 bg-white rounded-full animate-pulse"></span>
                        <span>● REC</span>
                      </div>
                    </div>

                    {/* Bottom hint */}
                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-black/60 text-white px-3 py-1 rounded-full text-xs">
                      {countdown !== null ? `Auto-capture in ${countdown}s...` : 'Initializing...'}
                    </div>
                  </>
                ) : (
                  <img src={capturedPhoto} alt="Captured" className="w-full h-full object-cover" />
                )}
              </div>

              <div className="mt-4 flex justify-center gap-3">
                {!capturedPhoto ? (
                  <>
                    <button
                      onClick={capturePhoto}
                      disabled={!stream}
                      className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 disabled:opacity-50 flex items-center space-x-2"
                    >
                      <span>📸</span><span>Capture Now</span>
                    </button>
                    <button
                      onClick={() => setAutoCaptureEnabled(!autoCaptureEnabled)}
                      className={`px-4 py-3 rounded-xl text-sm font-medium border ${
                        autoCaptureEnabled ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-slate-50 border-slate-300 text-slate-700'
                      }`}
                    >
                      {autoCaptureEnabled ? '⏱️ Auto ON' : '⏱️ Auto OFF'}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={retakePhoto}
                      className="px-4 py-2.5 border border-slate-200 rounded-lg hover:bg-slate-50 font-medium"
                    >
                      🔄 Retake
                    </button>
                    <button
                      onClick={confirmCheckIn}
                      disabled={isSyncingToCloud}
                      className={`px-6 py-2.5 text-white rounded-lg font-bold flex items-center space-x-2 shadow-lg ${cameraMode === 'in' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-pink-600 hover:bg-pink-700'}`}
                    >
                      {isSyncingToCloud ? (
                        <>
                          <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                          <span>Syncing to Cloud...</span>
                        </>
                      ) : (
                        <>
                          <span>{cameraMode === 'in' ? '🟢' : '🔴'}</span>
                          <span>{cameraMode === 'in' ? 'Confirm Check In' : 'Confirm Check Out'}</span>
                        </>
                      )}
                    </button>
                  </>
                )}
              </div>

              <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
                <strong>🔒 Verification:</strong> Your photo is captured as proof of attendance with a timestamp overlay and saved to your account in Firestore.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
