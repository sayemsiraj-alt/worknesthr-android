import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Branch } from '../context/DataContext';
import { generateBranchQRPayload } from '../utils/geofenceEngine';
import { IconBuilding, IconCheckCircle, IconPrinter, IconDownload } from './Icons';

interface BranchQRModalProps {
  branch: Branch;
  companyName: string;
  onClose: () => void;
}

export function BranchQRModal({ branch, companyName, onClose }: BranchQRModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [isCopied, setIsCopied] = useState(false);

  const qrPayload = generateBranchQRPayload({
    id: branch.id,
    companyId: branch.companyId || 'default',
    code: branch.code,
    qrSecret: branch.qrSecret,
  });

  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(
        canvasRef.current,
        qrPayload,
        {
          width: 300,
          margin: 2,
          color: {
            dark: '#0f172a',
            light: '#ffffff',
          },
        },
        (error) => {
          if (error) console.error('Error generating QR canvas:', error);
          else {
            try {
              const url = canvasRef.current?.toDataURL('image/png') || '';
              setQrDataUrl(url);
            } catch (e) {}
          }
        }
      );
    }
  }, [qrPayload]);

  const handlePrint = () => {
    window.print();
  };

  const handleDownload = () => {
    if (!qrDataUrl) return;
    const link = document.createElement('a');
    link.download = `WorkNest_Attendance_QR_${branch.code || branch.id}.png`;
    link.href = qrDataUrl;
    link.click();
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(branch.code || branch.id);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-fade-in print:p-0 print:bg-white print:static">
      <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl border border-slate-200 text-slate-800 animate-slide-down print:shadow-none print:border-none print:max-w-none print:w-full print:p-0">

        {/* Modal Header (Hidden on Print) */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 print:hidden">
          <div className="flex items-center space-x-2.5">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <IconBuilding size={20} />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Office Attendance QR Poster</h3>
              <p className="text-xs text-slate-500">{branch.name} • Geofenced</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center cursor-pointer transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Printable Poster Section */}
        <div className="my-6 text-center space-y-4 print:my-0 print:p-8">
          <div className="inline-block px-3 py-1 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-700 text-xs font-black uppercase tracking-wider">
            {companyName || 'WorkNest HR'}
          </div>

          <div>
            <h2 className="text-2xl font-black text-slate-900 tracking-tight">{branch.name}</h2>
            <p className="text-xs text-slate-500 font-medium mt-1">
              {branch.address ? `${branch.address}, ${branch.city}` : branch.city || 'Office Premises'}
            </p>
          </div>

          {/* QR Code Canvas Box */}
          <div className="flex justify-center my-4">
            <div className="p-4 bg-white rounded-3xl border-2 border-dashed border-indigo-200 shadow-md inline-block">
              <canvas ref={canvasRef} className="max-w-full h-auto mx-auto rounded-xl" />
            </div>
          </div>

          {/* GPS Geofence Security Badge */}
          <div className="bg-emerald-50 border border-emerald-200/80 rounded-2xl p-3.5 text-xs text-emerald-800 text-center space-y-1">
            <div className="flex items-center justify-center space-x-1.5 font-bold text-emerald-900">
              <IconCheckCircle size={15} className="text-emerald-600" />
              <span>Anti-Fraud GPS Geofence Protected</span>
            </div>
            <p className="text-[11px] text-emerald-700">
              {branch.latitude && branch.longitude ? (
                <>Allowed radius: <strong>{branch.radiusMeters || 100} meters</strong> from office GPS ({branch.latitude.toFixed(4)}, {branch.longitude.toFixed(4)})</>
              ) : (
                <>Locked to office premises. Attendance from outside the building is blocked.</>
              )}
            </p>
          </div>

          {/* Employee Instructions */}
          <div className="bg-slate-50 border border-slate-200/70 rounded-2xl p-4 text-left text-xs text-slate-600 space-y-2">
            <p className="font-bold text-slate-800 uppercase text-[10px] tracking-wider">How to punch in / out:</p>
            <ol className="list-decimal list-inside space-y-1 text-[11px]">
              <li>Open your <strong>WorkNest Employee Panel</strong> on your mobile browser.</li>
              <li>Tap on <strong>"Office QR &amp; GPS Punch"</strong>.</li>
              <li>Scan this QR code. Your attendance will be registered instantly!</li>
            </ol>
            <p className="text-[10px] text-slate-400 italic pt-1">
              * Note: Attempting to scan a picture of this code from home or outside the office will be rejected by the GPS verification.
            </p>
          </div>

          <div className="text-[11px] font-mono text-slate-400 flex items-center justify-center space-x-2">
            <span>Branch Code: <strong className="text-slate-700">{branch.code}</strong></span>
            <button
              onClick={handleCopyCode}
              className="text-indigo-600 hover:underline cursor-pointer font-sans font-bold"
            >
              {isCopied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>

        {/* Modal Actions (Hidden on Print) */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-slate-100 print:hidden">
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            Close
          </button>

          <div className="w-full sm:w-auto flex items-center space-x-2">
            <button
              type="button"
              onClick={handleDownload}
              className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition-all shadow-xs flex items-center justify-center space-x-1.5 cursor-pointer"
            >
              <IconDownload size={14} />
              <span>Download PNG</span>
            </button>

            <button
              type="button"
              onClick={handlePrint}
              className="flex-1 sm:flex-none px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition-all shadow-md flex items-center justify-center space-x-1.5 cursor-pointer"
            >
              <IconPrinter size={14} />
              <span>Print Office Poster</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
