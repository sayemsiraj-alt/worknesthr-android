import { useState, useRef, useEffect, useCallback } from 'react';
import jsQR from 'jsqr';
import { useData, Branch } from '../context/DataContext';
import { useTenant } from '../context/TenantContext';
import { recordZKTecoPunchToFirestore } from '../lib/firestoreService';
import { pushToFirebase } from '../lib/firebase';
import { resolveEmployeeScheduleForDate, getBangladeshTodayStr } from '../utils/attendanceScheduleEngine';
import {
  parseScannedQRPayload,
  verifyGeofenceBounds,
  calculateHaversineDistance,
  OfficeBranchLocation,
} from '../utils/geofenceEngine';
import {
  IconQrCode,
  IconMapPin,
  IconCheckCircle,
  IconXCircle,
  IconRefresh,
  IconBuilding,
  IconClock,
} from './Icons';

interface OfficeQRGpsCheckInProps {
  onSuccess?: () => void;
  onClose: () => void;
}

export function OfficeQRGpsCheckIn({ onSuccess, onClose }: OfficeQRGpsCheckInProps) {
  const { currentEmployee, branches = [], shifts, roster, addNotification } = useData();
  const { currentCompanyId } = useTenant();

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanAnimFrameRef = useRef<number | null>(null);
  const isMountedRef = useRef(true);

  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);
  const [gpsLocation, setGpsLocation] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [isGpsLoading, setIsGpsLoading] = useState(true);
  const [allowQrWithoutGps, setAllowQrWithoutGps] = useState(false);
  const [showChromeHelp, setShowChromeHelp] = useState(false);

  const isInsideIframe = typeof window !== 'undefined' && window.self !== window.top;

  const allowQrWithoutGpsRef = useRef(allowQrWithoutGps);
  allowQrWithoutGpsRef.current = allowQrWithoutGps;
  const pendingScannedBranchRef = useRef<OfficeBranchLocation | null>(null);

  const [scanResult, setScanResult] = useState<{
    status: 'idle' | 'success' | 'fraud_blocked' | 'error';
    message: string;
    details?: string;
    distance?: number;
    branchName?: string;
    timestamp?: string;
    action?: 'in' | 'out';
  }>({
    status: 'idle',
    message: '',
  });

  const [isProcessingPunch, setIsProcessingPunch] = useState(false);
  const [targetBranch, setTargetBranch] = useState<OfficeBranchLocation | null>(null);

  // Determine employee's assigned branch or default to first active branch
  useEffect(() => {
    if (branches.length === 0) return;
    const employeeBranchName = currentEmployee?.branch || '';
    const matched =
      branches.find(
        (b) =>
          b.name.toLowerCase() === employeeBranchName.toLowerCase() ||
          b.id === employeeBranchName ||
          b.code.toLowerCase() === employeeBranchName.toLowerCase()
      ) ||
      branches.find((b) => b.isHeadOffice) ||
      branches[0];

    if (matched) {
      setTargetBranch({
        id: matched.id,
        name: matched.name,
        code: matched.code,
        companyId: matched.companyId,
        latitude: matched.latitude,
        longitude: matched.longitude,
        radiusMeters: matched.radiusMeters || 100,
        qrSecret: matched.qrSecret,
      });
    }
  }, [branches, currentEmployee]);

  // 1. Acquire Real GPS Position with Multi-Tier Fallback
  const requestGpsCoordinates = useCallback(() => {
    setIsGpsLoading(true);
    setGpsError(null);

    if (!navigator.geolocation) {
      setGpsError('Geolocation is not supported by your browser or device.');
      setIsGpsLoading(false);
      return;
    }

    const handleSuccess = (pos: GeolocationPosition) => {
      setGpsLocation({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: Math.round(pos.coords.accuracy),
      });
      setGpsError(null);
      setIsGpsLoading(false);
    };

    const handleFinalError = (err: GeolocationPositionError) => {
      let msg = 'Failed to get GPS location. Please allow location access in your device settings.';
      if (err.code === 1) {
        msg = isInsideIframe
          ? 'ব্রাউজারে লোকেশন পারমিশন ব্লক রয়েছে (Google Chrome Iframe)। নিচে "Proceed with Office QR" বাটনে ক্লিক করে সরাসরি হাজিরা দিন অথবা সরাসরি ফুল ব্রাউজারে খুলুন।'
          : 'Location permission was denied in Google Chrome. Please allow location access in Chrome Site Settings, or proceed with Office QR punch below.';
      } else if (err.code === 2) {
        msg = 'GPS signal unavailable. Please ensure your device location/GPS is turned on.';
      } else if (err.code === 3) {
        msg = 'GPS request timed out. Please tap retry or proceed with Office QR scan.';
      }
      setGpsError(msg);
      setIsGpsLoading(false);
    };

    // Try High Accuracy first; if it times out or is unavailable, fallback to standard accuracy
    navigator.geolocation.getCurrentPosition(
      handleSuccess,
      (firstErr) => {
        if (firstErr.code === 2 || firstErr.code === 3) {
          navigator.geolocation.getCurrentPosition(
            handleSuccess,
            (secondErr) => handleFinalError(secondErr),
            { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
          );
        } else {
          handleFinalError(firstErr);
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 6000,
        maximumAge: 60000,
      }
    );
  }, [isInsideIframe]);

  useEffect(() => {
    requestGpsCoordinates();
  }, [requestGpsCoordinates]);

  // 2. Start Camera Feed (prefer back/environment camera on phones, fallback to front)
  const startCamera = useCallback(async () => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }

      if (!navigator?.mediaDevices?.getUserMedia) {
        if (isMountedRef.current) setHasCameraPermission(false);
        return;
      }

      let mediaStream: MediaStream;
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
      } catch (e: any) {
        // Fallback to any available camera (e.g. laptop webcam)
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
      }

      if (!isMountedRef.current) {
        mediaStream.getTracks().forEach((t) => t.stop());
        return;
      }

      streamRef.current = mediaStream;
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        videoRef.current.setAttribute('playsinline', 'true');
        videoRef.current.muted = true;

        try {
          await videoRef.current.play();
        } catch (playErr: any) {
          // AbortError is triggered when a new load request interrupts play() (e.g. fast remount)
          // It is not an actual permission failure.
          if (playErr?.name === 'AbortError') {
            return;
          }
          console.warn('Camera play warning:', playErr);
        }

        if (isMountedRef.current) {
          setHasCameraPermission(true);
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('Camera init error:', err);
      if (isMountedRef.current) {
        setHasCameraPermission(false);
      }
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    startCamera();
    return () => {
      isMountedRef.current = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      if (scanAnimFrameRef.current) {
        cancelAnimationFrame(scanAnimFrameRef.current);
      }
    };
  }, [startCamera]);

  // Core attendance recording function (shared by geofence pass and 1-tap QR bypass)
  const recordAttendancePunch = useCallback(
    async (scannedBranch: OfficeBranchLocation, isGpsVerified: boolean) => {
      setIsProcessingPunch(true);
      try {
        if (!currentEmployee) {
          setScanResult({
            status: 'error',
            message: 'Employee Session Required',
            details: 'Please log in with your employee account to record attendance.',
          });
          setTimeout(() => setIsProcessingPunch(false), 2500);
          return;
        }

        const now = new Date();
        const fullTimestamp = now.toISOString();
        const todayStr = getBangladeshTodayStr();
        const sched = resolveEmployeeScheduleForDate(currentEmployee, todayStr, roster, shifts);
        const shiftStartTime = sched.startTime !== '--:--' ? sched.startTime : '09:00';
        const shiftEndTime = sched.endTime !== '--:--' ? sched.endTime : '18:00';
        const shiftGraceMinutes = sched.graceTime || 15;
        const shiftName = sched.isWeekend ? 'Weekend / Off' : sched.shiftName || 'General Shift';

        const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        const verifyModeString = isGpsVerified ? 'QR + GPS Geofence' : 'Office QR (Physical Code Validated)';

        const res = await recordZKTecoPunchToFirestore({
          companyId: currentEmployee?.companyId || currentCompanyId || 'default',
          employeeId: currentEmployee?.employeeId || currentEmployee?.id || '',
          employeeName: currentEmployee?.name || '',
          department: currentEmployee?.department || 'General',
          branch: scannedBranch.name,
          branchId: scannedBranch.id,
          deviceSerialNumber: `QR-GPS-${scannedBranch.code || scannedBranch.id}`,
          deviceName: `Office QR Station (${scannedBranch.name})`,
          verifyMode: verifyModeString,
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
        });

        const distanceM =
          gpsLocation && scannedBranch.latitude
            ? calculateHaversineDistance(
                gpsLocation.lat,
                gpsLocation.lng,
                scannedBranch.latitude,
                scannedBranch.longitude || 0
              )
            : 0;

        // Backup to Realtime Database
        if (currentEmployee) {
          const punchAction = res?.status === 'in' || res?.checkIn === timeStr ? 'in' : 'out';
          const rtdbPayload = {
            employeeId: currentEmployee.id,
            employeeCode: currentEmployee.employeeId,
            employeeName: currentEmployee.name,
            department: currentEmployee.department,
            branch: scannedBranch.name,
            date: todayStr,
            checkIn: res?.checkIn || timeStr,
            checkOut: res?.checkOut || '-',
            status: 'present',
            verifyMode: verifyModeString,
            distanceMeters: distanceM,
            gpsCoordinates: gpsLocation ? { lat: gpsLocation.lat, lng: gpsLocation.lng } : null,
            lastAction: punchAction,
            timestamp: fullTimestamp,
          };
          await pushToFirebase(`attendance/${currentEmployee.id}/${todayStr}`, rtdbPayload).catch(() => {});
        }

        setScanResult({
          status: 'success',
          message: 'Attendance Verified & Recorded!',
          details: isGpsVerified
            ? `Physically verified at ${scannedBranch.name} (${distanceM}m from center).`
            : `Verified at ${scannedBranch.name} via physical Office QR code.`,
          distance: distanceM,
          branchName: scannedBranch.name,
          timestamp: timeStr,
          action: res?.checkIn === timeStr ? 'in' : 'out',
        });

        addNotification({
          title: '✅ In-Office Attendance Recorded',
          message: `Attendance marked successfully at ${scannedBranch.name} via ${verifyModeString}.`,
          read: false,
          type: 'attendance',
          targetPage: 'attendance',
        });

        if (onSuccess) onSuccess();

        setTimeout(() => {
          onClose();
        }, 2200);
      } catch (err: any) {
        console.error('Punch save error:', err);
        setScanResult({
          status: 'error',
          message: 'Failed to save attendance',
          details: err?.message || 'Server connection error. Please try again.',
        });
        setTimeout(() => setIsProcessingPunch(false), 3000);
      }
    },
    [
      currentEmployee,
      currentCompanyId,
      roster,
      shifts,
      gpsLocation,
      addNotification,
      onSuccess,
      onClose,
    ]
  );

  // 3. QR Decoding Loop via jsQR
  const handleDecodedQR = useCallback(
    async (decodedText: string) => {
      if (isProcessingPunch) return;
      setIsProcessingPunch(true);

      const parsed = parseScannedQRPayload(decodedText);
      if (!parsed.valid) {
        setScanResult({
          status: 'error',
          message: 'Invalid QR Code',
          details: 'The scanned code is not a valid WorkNest Attendance QR.',
        });
        setTimeout(() => {
          setIsProcessingPunch(false);
          setScanResult((prev) => (prev.status === 'error' ? { status: 'idle', message: '' } : prev));
        }, 2500);
        return;
      }

      // Find the matched branch from the QR code
      const scannedBranch =
        branches.find(
          (b) =>
            b.id === parsed.branchId ||
            b.code?.toLowerCase() === parsed.code?.toLowerCase() ||
            (parsed.branchId && b.name.toLowerCase().includes(parsed.branchId.toLowerCase()))
        ) || targetBranch;

      if (!scannedBranch) {
        setScanResult({
          status: 'error',
          message: 'Branch Not Found',
          details: 'Could not associate this QR code with any registered office branch.',
        });
        setTimeout(() => setIsProcessingPunch(false), 2500);
        return;
      }

      // CRITICAL STEP: Verify Geofence GPS Bounds
      // If employee did not provide GPS or GPS error
      if (!gpsLocation) {
        if (allowQrWithoutGpsRef.current) {
          await recordAttendancePunch(scannedBranch as OfficeBranchLocation, false);
          return;
        } else {
          pendingScannedBranchRef.current = scannedBranch as OfficeBranchLocation;
          setScanResult({
            status: 'fraud_blocked',
            message: 'GPS Permission Restricted (Chrome / Iframe)',
            details: isInsideIframe
              ? 'মোবাইলে GPS অন থাকলেও Chrome আইফ্রেম বা ব্রাউজার পারমিশনের কারণে লোকেশন লক করা যায়নি। নিচের বোতামে চাপ দিয়ে সরাসরি অফিস কিউআর দিয়ে হাজিরা দিন।'
              : 'GPS was not accessible in your browser. Tap "হাজিরা নিশ্চিত করুন (Confirm Attendance)" below to record attendance immediately via office poster verification.',
            branchName: scannedBranch.name,
          });
          return;
        }
      } else {
        const geofenceCheck = verifyGeofenceBounds(
          gpsLocation.lat,
          gpsLocation.lng,
          scannedBranch as OfficeBranchLocation
        );

        // FRAUD DETECTED: Scanned QR code but GPS is outside office perimeter (e.g. photo taken from home)
        if (!geofenceCheck.isWithinBounds) {
          setScanResult({
            status: 'fraud_blocked',
            message: 'Attendance Blocked: Location Mismatch',
            details: `You are approximately ${geofenceCheck.distanceMeters} meters away from "${scannedBranch.name}". In-office attendance is strictly locked to within ${geofenceCheck.allowedRadiusMeters}m of office premises.`,
            distance: geofenceCheck.distanceMeters,
            branchName: scannedBranch.name,
          });

          // Trigger fraud attempt notification for audit logs
          addNotification({
            title: '⚠️ Geofence Attendance Blocked',
            message: `${currentEmployee?.name || 'Employee'} attempted attendance from ${geofenceCheck.distanceMeters}m away from ${scannedBranch.name} (outside ${geofenceCheck.allowedRadiusMeters}m radius).`,
            read: false,
            type: 'attendance',
            targetPage: 'attendance',
          });

          setTimeout(() => setIsProcessingPunch(false), 4000);
          return;
        }

        // Passed Geofence
        await recordAttendancePunch(scannedBranch as OfficeBranchLocation, true);
      }
    },
    [
      isProcessingPunch,
      branches,
      targetBranch,
      gpsLocation,
      isInsideIframe,
      recordAttendancePunch,
      currentEmployee,
      addNotification,
    ]
  );

  // Scanning loop tick
  const tickScan = useCallback(() => {
    if (
      videoRef.current &&
      videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA &&
      canvasRef.current &&
      !isProcessingPunch &&
      scanResult.status === 'idle'
    ) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      if (ctx) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert',
        });

        if (code && code.data) {
          handleDecodedQR(code.data);
          return;
        }
      }
    }

    scanAnimFrameRef.current = requestAnimationFrame(tickScan);
  }, [isProcessingPunch, scanResult.status, handleDecodedQR]);

  useEffect(() => {
    scanAnimFrameRef.current = requestAnimationFrame(tickScan);
    return () => {
      if (scanAnimFrameRef.current) {
        cancelAnimationFrame(scanAnimFrameRef.current);
      }
    };
  }, [tickScan]);

  // Current distance calculation for display
  const currentDistanceMeters =
    gpsLocation && targetBranch?.latitude && targetBranch?.longitude
      ? calculateHaversineDistance(
          gpsLocation.lat,
          gpsLocation.lng,
          targetBranch.latitude,
          targetBranch.longitude
        )
      : null;

  const isInsideAllowedRadius =
    currentDistanceMeters !== null && targetBranch?.radiusMeters
      ? currentDistanceMeters <= targetBranch.radiusMeters
      : null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 animate-fade-in">
      <div className="bg-slate-900 border border-slate-700/80 rounded-3xl max-w-md w-full p-5 sm:p-6 shadow-2xl text-white relative flex flex-col max-h-[92vh] overflow-y-auto">
        
        {/* Top Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center space-x-2.5">
            <div className="w-10 h-10 rounded-2xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center">
              <IconQrCode size={22} />
            </div>
            <div>
              <h3 className="text-base font-black text-white">Office QR &amp; GPS Punch</h3>
              <p className="text-[11px] text-slate-400 font-medium">Anti-Fraud Physical Presence Verification</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center cursor-pointer transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Live GPS Geofence Status Pill */}
        <div className="mt-4 mb-3">
          {allowQrWithoutGps ? (
            <div className="bg-emerald-950/60 border border-emerald-500/40 rounded-2xl p-3 text-xs text-emerald-200 flex items-center justify-between shadow-xs">
              <div className="flex items-center space-x-2">
                <IconCheckCircle className="text-emerald-400 shrink-0" size={16} />
                <div>
                  <p className="font-bold">Office QR Mode Active (GPS Bypass)</p>
                  <p className="text-[11px] opacity-80">Point camera at office QR poster to mark attendance</p>
                </div>
              </div>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 uppercase">
                Active
              </span>
            </div>
          ) : isGpsLoading ? (
            <div className="bg-indigo-950/60 border border-indigo-700/40 rounded-2xl p-3 flex items-center space-x-3 text-xs text-indigo-300">
              <IconRefresh className="animate-spin shrink-0 text-indigo-400" size={16} />
              <span>Acquiring satellite GPS coordinates...</span>
            </div>
          ) : gpsError ? (
            <div className="bg-rose-950/60 border border-rose-700/50 rounded-2xl p-3.5 text-xs text-rose-300 space-y-2.5">
              <div className="flex items-center justify-between font-bold text-rose-200">
                <span className="flex items-center space-x-1.5">
                  <IconXCircle size={15} />
                  <span>GPS Location Required</span>
                </span>
                <button
                  type="button"
                  onClick={requestGpsCoordinates}
                  className="px-2.5 py-1 rounded-lg bg-rose-800/70 hover:bg-rose-700 text-[10px] text-white font-bold cursor-pointer"
                >
                  Retry GPS
                </button>
              </div>
              <p className="text-[11px] text-rose-300/90 leading-relaxed">{gpsError}</p>

              {/* Action Buttons: 1-Tap Unblock & Help */}
              <div className="pt-1 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setAllowQrWithoutGps(true);
                    setScanResult({ status: 'idle', message: '' });
                    setIsProcessingPunch(false);
                  }}
                  className="flex-1 sm:flex-initial px-3.5 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold rounded-xl text-xs shadow-md flex items-center justify-center space-x-1.5 cursor-pointer active:scale-95 transition-all"
                >
                  <span>⚡</span>
                  <span>Proceed with Office QR (হাজিরা দিন)</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowChromeHelp(!showChromeHelp)}
                  className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl text-[11px] cursor-pointer transition-colors"
                >
                  📖 Chrome Settings Help
                </button>

                {isInsideIframe && (
                  <button
                    type="button"
                    onClick={() => window.open(window.location.href, '_blank')}
                    className="px-3 py-2 bg-indigo-600/70 hover:bg-indigo-600 text-white font-semibold rounded-xl text-[11px] cursor-pointer transition-colors"
                  >
                    🌐 Open in Full App
                  </button>
                )}
              </div>

              {/* Expandable Chrome Help Guide */}
              {showChromeHelp && (
                <div className="p-3 bg-slate-900/95 border border-slate-700 rounded-xl text-[11px] text-slate-300 space-y-1.5 animate-fade-in">
                  <p className="font-bold text-white flex items-center space-x-1.5">
                    <span>📱</span>
                    <span>Android Chrome-এ লোকেশন অন করার নিয়ম:</span>
                  </p>
                  <ol className="list-decimal list-inside space-y-1 text-slate-300">
                    <li>Chrome ব্রাউজারের উপরে URL বারের বামে <strong>🔒 লক</strong> বা <strong>⚙️ টিউন</strong> আইকনে চাপুন।</li>
                    <li><strong>Permissions</strong>-এ ট্যাপ করে <strong>Location</strong>-এ যান।</li>
                    <li>সেখানে <strong>&ldquo;Allow&rdquo;</strong> সিলেক্ট করুন। এরপর &ldquo;Retry GPS&rdquo; চাপুন।</li>
                  </ol>
                  <p className="text-[10px] text-emerald-400 font-semibold pt-1">
                    💡 অথবা কোনো ঝামেলা ছাড়াই সরাসরি উপরে <strong>&ldquo;Proceed with Office QR&rdquo;</strong> চাপলেই কিউআর স্ক্যান করে হাজিরা সম্পন্ন করতে পারবেন।
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div
              className={`border rounded-2xl p-3 text-xs flex items-center justify-between ${
                isInsideAllowedRadius === false
                  ? 'bg-amber-950/40 border-amber-500/40 text-amber-200'
                  : 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
              }`}
            >
              <div className="flex items-center space-x-2">
                <IconMapPin
                  size={16}
                  className={isInsideAllowedRadius === false ? 'text-amber-400' : 'text-emerald-400'}
                />
                <div>
                  <p className="font-bold">
                    {targetBranch?.name || 'Office Branch'}
                  </p>
                  <p className="text-[11px] opacity-80">
                    {currentDistanceMeters !== null ? (
                      <>
                        Distance: <strong>{currentDistanceMeters}m</strong> (Allowed:{' '}
                        {targetBranch?.radiusMeters || 100}m)
                      </>
                    ) : (
                      <>GPS Locked (Accuracy: ±{gpsLocation?.accuracy}m)</>
                    )}
                  </p>
                </div>
              </div>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                  isInsideAllowedRadius === false
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                }`}
              >
                {isInsideAllowedRadius === false ? 'Outside Office' : 'Inside Zone'}
              </span>
            </div>
          )}
        </div>

        {/* Video Camera Scanner Viewport */}
        <div className="relative rounded-2xl overflow-hidden bg-black aspect-square max-h-[300px] border border-slate-700 shadow-inner flex items-center justify-center">
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            playsInline
            muted
            autoPlay
          />
          <canvas ref={canvasRef} className="hidden" />

          {/* Scanner Overlay / Target Frame */}
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            {/* Darkened corners */}
            <div className="relative w-56 h-56 border-2 border-indigo-400/90 rounded-2xl shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]">
              {/* Corner brackets */}
              <div className="absolute -top-1 -left-1 w-6 h-6 border-t-4 border-l-4 border-indigo-400 rounded-tl-lg" />
              <div className="absolute -top-1 -right-1 w-6 h-6 border-t-4 border-r-4 border-indigo-400 rounded-tr-lg" />
              <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-4 border-l-4 border-indigo-400 rounded-bl-lg" />
              <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-4 border-r-4 border-indigo-400 rounded-br-lg" />

              {/* Animated laser scan line */}
              {scanResult.status === 'idle' && (
                <div className="w-full h-0.5 bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_12px_#38bdf8] animate-pulse absolute top-1/2 -translate-y-1/2" />
              )}
            </div>
          </div>

          {/* Camera Permission Error Overlay */}
          {hasCameraPermission === false && (
            <div className="absolute inset-0 bg-slate-950/90 flex flex-col items-center justify-center p-6 text-center space-y-3">
              <IconXCircle className="text-rose-500" size={32} />
              <p className="text-xs font-bold text-white">Camera Access Denied</p>
              <p className="text-[11px] text-slate-400">
                Please allow camera permissions in your browser to scan the office attendance QR code.
              </p>
              <button
                onClick={startCamera}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white cursor-pointer"
              >
                Allow &amp; Retry
              </button>
            </div>
          )}

          {/* Processing / Result Overlay */}
          {scanResult.status !== 'idle' && (
            <div
              className={`absolute inset-0 flex flex-col items-center justify-center p-6 text-center space-y-3 backdrop-blur-md animate-fade-in ${
                scanResult.status === 'success'
                  ? 'bg-emerald-950/90 text-emerald-100'
                  : scanResult.status === 'fraud_blocked'
                  ? 'bg-rose-950/95 text-rose-100'
                  : 'bg-slate-900/90 text-slate-100'
              }`}
            >
              {scanResult.status === 'success' && (
                <>
                  <div className="w-16 h-16 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center shadow-lg">
                    <IconCheckCircle size={36} />
                  </div>
                  <div>
                    <h4 className="text-base font-black text-white">{scanResult.message}</h4>
                    <p className="text-xs text-emerald-300 font-semibold mt-1">{scanResult.details}</p>
                    <p className="text-[11px] text-emerald-400/80 mt-2 font-mono">
                      Recorded at {scanResult.timestamp}
                    </p>
                  </div>
                </>
              )}

              {scanResult.status === 'fraud_blocked' && (
                <>
                  {!gpsLocation ? (
                    // GPS Permission Denied / Iframe Blocked: Helpful 1-tap resolution
                    <div className="w-full max-w-sm space-y-3 p-1">
                      <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center shadow-lg">
                        <IconMapPin size={28} />
                      </div>
                      <div>
                        <h4 className="text-sm font-black text-amber-200">{scanResult.message}</h4>
                        <p className="text-[11px] text-amber-100/90 mt-1 leading-relaxed">
                          {scanResult.details}
                        </p>
                      </div>

                      {/* 1-Tap Attendance Punch Button */}
                      <div className="pt-1 flex flex-col space-y-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (pendingScannedBranchRef.current) {
                              recordAttendancePunch(pendingScannedBranchRef.current, false);
                            } else {
                              setAllowQrWithoutGps(true);
                              setScanResult({ status: 'idle', message: '' });
                              setIsProcessingPunch(false);
                            }
                          }}
                          className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black text-xs shadow-lg flex items-center justify-center space-x-2 cursor-pointer active:scale-95 transition-all"
                        >
                          <span>⚡</span>
                          <span>হাজিরা নিশ্চিত করুন (Confirm Attendance)</span>
                        </button>

                        <div className="grid grid-cols-2 gap-2 text-[11px]">
                          <button
                            type="button"
                            onClick={() => setShowChromeHelp(true)}
                            className="py-1.5 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium cursor-pointer transition-colors"
                          >
                            📖 Chrome গাইড
                          </button>
                          {isInsideIframe ? (
                            <button
                              type="button"
                              onClick={() => window.open(window.location.href, '_blank')}
                              className="py-1.5 px-2.5 rounded-lg bg-indigo-600/80 hover:bg-indigo-600 text-white font-medium cursor-pointer transition-colors truncate"
                            >
                              🌐 ফুল ব্রাউজার
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setScanResult({ status: 'idle', message: '' });
                                setIsProcessingPunch(false);
                              }}
                              className="py-1.5 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white cursor-pointer"
                            >
                              ↺ আবার স্ক্যান
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    // Actual Distance / Geofence Mismatch (Fraud attempt from home/remote location)
                    <>
                      <div className="w-16 h-16 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center justify-center shadow-lg animate-bounce">
                        <IconXCircle size={36} />
                      </div>
                      <div>
                        <h4 className="text-base font-black text-rose-200">{scanResult.message}</h4>
                        <p className="text-xs text-rose-300/90 mt-1 font-medium">{scanResult.details}</p>
                        <p className="text-[10px] text-rose-400/80 mt-3 bg-rose-900/40 border border-rose-800/60 rounded-xl p-2 font-mono">
                          🛑 Anti-Fraud Guard: You cannot mark attendance using a photo of the QR from home.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setScanResult({ status: 'idle', message: '' });
                          setIsProcessingPunch(false);
                        }}
                        className="mt-2 px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 cursor-pointer"
                      >
                        Dismiss &amp; Try Again
                      </button>
                    </>
                  )}
                </>
              )}

              {scanResult.status === 'error' && (
                <>
                  <div className="w-14 h-14 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center">
                    <IconXCircle size={30} />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">{scanResult.message}</h4>
                    <p className="text-xs text-amber-300 mt-1">{scanResult.details}</p>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Guidance Footer */}
        <div className="mt-4 pt-3 border-t border-slate-800 text-xs text-slate-400 space-y-1">
          <p className="flex items-center space-x-1.5 font-semibold text-slate-300">
            <IconBuilding size={14} className="text-indigo-400" />
            <span>Point camera at the official Office QR Poster at reception.</span>
          </p>
          <p className="text-[11px] text-slate-500">
            Both <strong>QR validation</strong> and <strong>GPS presence</strong> are checked simultaneously to ensure authentic in-office attendance.
          </p>
        </div>

        {/* Action Button */}
        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={requestGpsCoordinates}
            className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center space-x-1.5 cursor-pointer transition-colors"
          >
            <IconRefresh size={13} className={isGpsLoading ? 'animate-spin' : ''} />
            <span>Refresh GPS</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold cursor-pointer transition-colors"
          >
            Cancel
          </button>
        </div>

      </div>
    </div>
  );
}
