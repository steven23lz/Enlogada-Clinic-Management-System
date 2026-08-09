import React, { useEffect, useRef, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Camera, CameraOff, AlertCircle } from 'lucide-react';

const SCANNER_ELEMENT_ID = 'qr-scanner-viewport';

// Camera-based QR scanner for desktop webcams. Decodes via html5-qrcode (the only
// QR library in the repo) and hands the raw decoded text back to the caller — it
// makes no assumption about what format that text is in.
const QrScanner = ({ active, onScan, onError }) => {
  const [permissionState, setPermissionState] = useState('idle'); // idle | requesting | granted | denied | unsupported
  const [cameras, setCameras] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState('');
  const scannerRef = useRef(null);
  const isScanningRef = useRef(false);

  const stopScanner = async () => {
    const scanner = scannerRef.current;
    if (scanner && isScanningRef.current) {
      isScanningRef.current = false;
      try {
        await scanner.stop();
        await scanner.clear();
      } catch {
        // Scanner may already be stopped (e.g. rapid open/close) — nothing to do.
      }
    }
  };

  const startScanner = async (cameraId) => {
    const { Html5Qrcode } = await import('html5-qrcode');
    if (!scannerRef.current) {
      scannerRef.current = new Html5Qrcode(SCANNER_ELEMENT_ID);
    }
    try {
      await scannerRef.current.start(
        cameraId,
        { fps: 10, qrbox: 250 },
        async (decodedText) => {
          await stopScanner();
          onScan(decodedText);
        },
        () => {
          // Per-frame decode failures are expected while no QR code is in view — ignore.
        }
      );
      isScanningRef.current = true;
    } catch (err) {
      setPermissionState('denied');
      if (onError) onError(err?.message || 'Unable to start the camera.');
    }
  };

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      if (!active) return;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setPermissionState('unsupported');
        return;
      }
      setPermissionState('requesting');
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        const devices = await Html5Qrcode.getCameras();
        if (cancelled) return;
        if (!devices || devices.length === 0) {
          setPermissionState('denied');
          if (onError) onError('No camera was detected on this device.');
          return;
        }
        setCameras(devices);
        const preferred = devices.find(d => /back|rear|environment/i.test(d.label)) || devices[0];
        setSelectedCameraId(preferred.id);
        setPermissionState('granted');
        await startScanner(preferred.id);
      } catch (err) {
        if (cancelled) return;
        setPermissionState('denied');
        if (onError) onError(err?.message || 'Camera permission was denied.');
      }
    };

    init();

    return () => {
      cancelled = true;
      stopScanner();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const handleCameraChange = async (cameraId) => {
    setSelectedCameraId(cameraId);
    await stopScanner();
    await startScanner(cameraId);
  };

  if (!active) return null;

  return (
    <div className="space-y-2">
      {cameras.length > 1 && (
        <Select value={selectedCameraId} onValueChange={handleCameraChange}>
          <SelectTrigger className="rounded-xl text-xs">
            <SelectValue placeholder="Select camera" />
          </SelectTrigger>
          <SelectContent>
            {cameras.map(cam => (
              <SelectItem key={cam.id} value={cam.id}>{cam.label || cam.id}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {permissionState === 'requesting' && (
        <div className="flex items-center justify-center py-8 text-xs font-semibold text-gray-500 space-x-2">
          <Camera className="w-4 h-4 animate-pulse" />
          <span>Requesting camera access...</span>
        </div>
      )}

      {permissionState === 'unsupported' && (
        <div className="p-3 bg-amber-50 border border-amber-200 text-amber-700 text-xs font-bold rounded-xl flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>This browser does not support camera access. Use manual entry below.</span>
        </div>
      )}

      {permissionState === 'denied' && (
        <div className="p-3 bg-amber-50 border border-amber-200 text-amber-700 text-xs font-bold rounded-xl flex items-center space-x-2">
          <CameraOff className="w-4 h-4 flex-shrink-0" />
          <span>Camera unavailable or permission denied. Use manual entry below.</span>
        </div>
      )}

      <div
        id={SCANNER_ELEMENT_ID}
        className={permissionState === 'granted' ? 'rounded-xl overflow-hidden border border-gray-200' : 'hidden'}
      />
    </div>
  );
};

export default QrScanner;
