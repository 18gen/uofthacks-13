'use client';

import { useState, useRef, useCallback } from 'react';
import type { Coordinates, AnalyzeResponse, Report } from '@/lib/types';
import { CATEGORY_LABELS, SEVERITY_COLORS } from '@/lib/types';
import { getCurrentPosition } from '@/lib/geo';
import { analytics } from '@/lib/analytics';
import Map from './Map';

type UploadStep = 'select' | 'converting' | 'location' | 'analyzing' | 'review';

// Check if file is HEIC format
function isHeicFile(file: File): boolean {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return (
    name.endsWith('.heic') ||
    name.endsWith('.heif') ||
    type === 'image/heic' ||
    type === 'image/heif'
  );
}

// Convert HEIC to JPEG (dynamically imports heic2any to avoid SSR issues)
async function convertHeicToJpeg(file: File): Promise<{ blob: Blob; file: File }> {
  const heic2any = (await import('heic2any')).default;

  const convertedBlob = await heic2any({
    blob: file,
    toType: 'image/jpeg',
    quality: 0.9,
  });

  // heic2any can return Blob or Blob[]
  const blob = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;

  // Create a new File object with .jpg extension
  const newFileName = file.name.replace(/\.(heic|heif)$/i, '.jpg');
  const convertedFile = new File([blob], newFileName, { type: 'image/jpeg' });

  return { blob, file: convertedFile };
}

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (report: Omit<Report, 'id' | 'createdAt'>) => void | Promise<void>;
}

export default function UploadModal({ isOpen, onClose, onSubmit }: UploadModalProps) {
  const [step, setStep] = useState<UploadStep>('select');
  const [file, setFile] = useState<File | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [gpsCoordinates, setGpsCoordinates] = useState<Coordinates | null>(null);
  const [flyToPosition, setFlyToPosition] = useState<Coordinates | null>(null);
  const [geoMethod, setGeoMethod] = useState<'auto' | 'manual'>('auto');
  const [geoError, setGeoError] = useState<string | null>(null);
  const [isLoadingGps, setIsLoadingGps] = useState(false);
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetState = useCallback(() => {
    setStep('select');
    setFile(null);
    if (mediaUrl) URL.revokeObjectURL(mediaUrl);
    setMediaUrl(null);
    setCoordinates(null);
    setGpsCoordinates(null);
    setFlyToPosition(null);
    setGeoMethod('auto');
    setGeoError(null);
    setIsLoadingGps(false);
    setAnalysis(null);
    setError(null);
  }, [mediaUrl]);

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    // Check if HEIC - these need special handling
    const isHeic = isHeicFile(selectedFile);
    const isImage = selectedFile.type.startsWith('image/') || isHeic;
    const isVideo = selectedFile.type.startsWith('video/');

    if (!isImage && !isVideo) {
      setError('Please select an image or video file');
      return;
    }

    if (selectedFile.size > 20 * 1024 * 1024) {
      setError('File must be under 20MB');
      return;
    }

    setError(null);

    // Convert HEIC to JPEG for browser compatibility
    let processedFile = selectedFile;
    let processedUrl: string;

    if (isHeic) {
      try {
        setStep('converting');
        const { blob, file: convertedFile } = await convertHeicToJpeg(selectedFile);
        processedFile = convertedFile;
        processedUrl = URL.createObjectURL(blob);
      } catch {
        setError('Failed to convert HEIC image. Please try a different format.');
        setStep('select');
        return;
      }
    } else {
      processedUrl = URL.createObjectURL(selectedFile);
    }

    setFile(processedFile);
    setMediaUrl(processedUrl);

    analytics.mediaSelected(isImage ? 'image' : 'video');

    setStep('location');
    try {
      const pos = await getCurrentPosition();
      setCoordinates(pos);
      setGpsCoordinates(pos);
      setGeoMethod('auto');
      setGeoError(null);
    } catch {
      setGeoError('Could not get your location. Pan the map to set location.');
      setGeoMethod('manual');
    }
  };

  const handleCenterChange = (coords: Coordinates) => {
    // Only update coordinates if we're in location step (not during analyzing/review)
    if (step !== 'location') return;

    setCoordinates(coords);
    // Once user moves the map, mark as manual
    if (gpsCoordinates) {
      const distance = Math.abs(coords.lat - gpsCoordinates.lat) + Math.abs(coords.lng - gpsCoordinates.lng);
      if (distance > 0.0001) {
        setGeoMethod('manual');
      }
    }
  };

  const handleRecenterToGps = async () => {
    setIsLoadingGps(true);
    try {
      const pos = await getCurrentPosition();
      setGpsCoordinates(pos);
      setCoordinates(pos);
      setGeoMethod('auto');
      setGeoError(null);
      // Trigger map to fly to this position
      setFlyToPosition({ ...pos });
    } catch {
      setGeoError('Could not get your location.');
    } finally {
      setIsLoadingGps(false);
    }
  };

  const handleAnalyze = async () => {
    if (!file || !coordinates) return;

    setStep('analyzing');
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/analyze', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Analysis failed');
      }

      const result: AnalyzeResponse = await response.json();
      setAnalysis(result);
      setStep('review');

      analytics.aiResultShown(result.category, result.severity, result.confidence, geoMethod);
    } catch {
      setError('Failed to analyze media. Please try again.');
      setStep('location');
    }
  };

  const handleSubmit = async () => {
    if (!file || !mediaUrl || !coordinates || !analysis) return;

    // Convert blob URL to base64 data URL so it persists in localStorage
    let persistentMediaUrl = mediaUrl;
    try {
      const response = await fetch(mediaUrl);
      const blob = await response.blob();
      persistentMediaUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
    } catch {
      // If conversion fails, use original URL (won't persist but at least works for session)
      console.warn('Failed to convert media to base64');
    }

    const report: Omit<Report, 'id' | 'createdAt'> = {
      coordinates,
      mediaUrl: persistentMediaUrl,
      mediaType: file.type.startsWith('image/') ? 'image' : 'video',
      fileName: file.name,
      fileSize: file.size,
      analysis,
      geoMethod,
    };

    await onSubmit(report);
    resetState();
    onClose();
  };

  const handleBackFromLocation = () => {
    setStep('select');
    setFile(null);
    if (mediaUrl) URL.revokeObjectURL(mediaUrl);
    setMediaUrl(null);
    setCoordinates(null);
    setGpsCoordinates(null);
    setFlyToPosition(null);
    setGeoError(null);
    setAnalysis(null);
  };

  const handleBackToLocation = () => {
    setStep('location');
    setAnalysis(null);
    setError(null);
  };

  if (!isOpen) return null;

  // Full-screen map view for location, analyzing, and review steps
  const isFullScreenStep = step === 'location' || step === 'analyzing' || step === 'review';

  if (isFullScreenStep) {
    return (
      <div className="fixed inset-0 z-50 bg-[#0f0f0f]">
        {/* Full-screen map with centered pin */}
        <div className="absolute inset-0">
          <Map
            reports={[]}
            centerSelectMode={true}
            onCenterChange={handleCenterChange}
            initialCenter={coordinates}
            flyToPosition={flyToPosition}
            disablePan={step === 'analyzing' || step === 'review'}
          />
        </div>

        {/* Top controls */}
        <div className="absolute top-4 left-4 z-20 flex items-center gap-2">
          {/* Back button */}
          <button
            onClick={step === 'location' ? handleBackFromLocation : handleBackToLocation}
            disabled={step === 'analyzing'}
            className="w-10 h-10 bg-[#1a1a1a]/90 backdrop-blur border border-[#333] rounded-full flex items-center justify-center shadow-lg hover:bg-[#262626] transition-colors disabled:opacity-50"
          >
            <svg className="w-5 h-5 text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        </div>

        {/* GPS recenter button - only show during location step */}
        {step === 'location' && (
          <button
            onClick={handleRecenterToGps}
            disabled={isLoadingGps}
            className="absolute top-4 right-4 z-20 w-10 h-10 bg-[#1a1a1a]/90 backdrop-blur border border-[#333] rounded-full flex items-center justify-center shadow-lg hover:bg-[#262626] transition-colors disabled:opacity-50"
            title="Recenter to GPS"
          >
            {isLoadingGps ? (
              <div className="w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-5 h-5 text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            )}
          </button>
        )}

        {/* Bottom sheet - content changes based on step */}
        <div className="absolute bottom-0 left-0 right-0 z-20">
          <div className="bg-[#1a1a1a] rounded-t-3xl border-t border-[#333] shadow-2xl">
            {/* Handle bar */}
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 bg-[#404040] rounded-full" />
            </div>

            {/* Content area */}
            <div className="px-4 pb-4 sm:px-6 sm:pb-6">
              {/* Error message */}
              {(geoError || error) && (
                <div className="mb-3 p-2 bg-yellow-900/30 border border-yellow-800 rounded-lg text-yellow-400 text-xs sm:text-sm">
                  {geoError || error}
                </div>
              )}

              {/* LOCATION STEP */}
              {step === 'location' && (
                <>
                  <div className="flex gap-3 sm:gap-4 items-start">
                    {/* Thumbnail */}
                    {mediaUrl && file && (
                      <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden bg-[#262626] flex-shrink-0">
                        {file.type.startsWith('image/') ? (
                          <img src={mediaUrl} alt="Preview" className="w-full h-full object-cover" />
                        ) : (
                          <video src={mediaUrl} className="w-full h-full object-cover" />
                        )}
                      </div>
                    )}

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <h3 className="text-gray-100 font-semibold text-sm sm:text-base">Confirm barrier location</h3>
                      <p className="text-gray-500 text-xs sm:text-sm mt-0.5">
                        Pan the map to position the pin
                      </p>
                      {coordinates && (
                        <p className="text-gray-600 text-xs mt-1 truncate">
                          {coordinates.lat.toFixed(5)}, {coordinates.lng.toFixed(5)}
                          {geoMethod === 'auto' && ' (GPS)'}
                        </p>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={handleAnalyze}
                    disabled={!coordinates}
                    className="w-full mt-4 py-3 sm:py-3.5 bg-blue-600 text-white rounded-xl font-semibold text-sm sm:text-base hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Confirm Location
                  </button>
                </>
              )}

              {/* ANALYZING STEP */}
              {step === 'analyzing' && (
                <div className="flex gap-3 sm:gap-4 items-center">
                  {/* Thumbnail */}
                  {mediaUrl && file && (
                    <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden bg-[#262626] flex-shrink-0">
                      {file.type.startsWith('image/') ? (
                        <img src={mediaUrl} alt="Preview" className="w-full h-full object-cover" />
                      ) : (
                        <video src={mediaUrl} className="w-full h-full object-cover" />
                      )}
                    </div>
                  )}

                  {/* Loading state */}
                  <div className="flex-1 min-w-0 flex items-center gap-3">
                    <div className="animate-spin w-6 h-6 border-3 border-blue-500 border-t-transparent rounded-full flex-shrink-0" />
                    <div>
                      <h3 className="text-gray-100 font-semibold text-sm sm:text-base">Analyzing barrier...</h3>
                      <p className="text-gray-500 text-xs sm:text-sm mt-0.5">
                        AI is identifying the issue
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* REVIEW STEP */}
              {step === 'review' && analysis && (
                <>
                  <div className="flex gap-3 sm:gap-4 items-start">
                    {/* Thumbnail */}
                    {mediaUrl && file && (
                      <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden bg-[#262626] flex-shrink-0">
                        {file.type.startsWith('image/') ? (
                          <img src={mediaUrl} alt="Preview" className="w-full h-full object-cover" />
                        ) : (
                          <video src={mediaUrl} className="w-full h-full object-cover" />
                        )}
                      </div>
                    )}

                    {/* Analysis info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: SEVERITY_COLORS[analysis.severity] }}
                        />
                        <h3 className="text-gray-100 font-semibold text-sm sm:text-base truncate">
                          {CATEGORY_LABELS[analysis.category]}
                        </h3>
                      </div>
                      <p className="text-gray-500 text-xs sm:text-sm line-clamp-2">
                        {analysis.summary}
                      </p>
                      <div className="flex items-center gap-3 mt-1.5">
                        <span className="text-xs text-gray-600 capitalize">
                          {analysis.severity} severity
                        </span>
                        <span className="text-xs text-gray-600">
                          {Math.round(analysis.confidence * 100)}% confidence
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-3 mt-4">
                    <button
                      onClick={handleBackToLocation}
                      className="flex-1 py-3 sm:py-3.5 text-gray-400 hover:text-gray-200 border border-[#333] rounded-xl font-medium text-sm sm:text-base transition-colors"
                    >
                      Adjust Location
                    </button>
                    <button
                      onClick={handleSubmit}
                      className="flex-1 py-3 sm:py-3.5 bg-green-600 text-white rounded-xl font-semibold text-sm sm:text-base hover:bg-green-500 transition-colors"
                    >
                      Submit Report
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Safe area padding for mobile */}
            <div className="h-safe-area-inset-bottom bg-[#1a1a1a]" />
          </div>
        </div>
      </div>
    );
  }

  // Floating modal for select and converting steps
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="relative bg-[#1a1a1a] border border-[#333] rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute top-3 right-3 z-10 w-8 h-8 bg-[#262626] hover:bg-[#333] rounded-full flex items-center justify-center transition-colors"
        >
          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Content */}
        <div className="p-5 sm:p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-900/30 border border-red-800 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* File Selection */}
          {step === 'select' && (
            <div className="space-y-4">
              <div className="pr-8">
                <h2 className="text-xl font-semibold text-gray-100 mb-1">Report Barrier</h2>
                <p className="text-gray-500 text-sm">
                  Upload a photo or video of the accessibility barrier.
                </p>
              </div>
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-[#404040] rounded-xl p-8 sm:p-12 text-center cursor-pointer hover:border-blue-500 hover:bg-blue-500/10 transition-colors"
              >
                <svg className="w-10 h-10 sm:w-12 sm:h-12 mx-auto text-gray-500 mb-3 sm:mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <p className="text-gray-300 font-medium text-sm sm:text-base">Tap to upload</p>
                <p className="text-gray-500 text-xs sm:text-sm mt-1">Image or video up to 20MB</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*,.heic,.heif"
                capture="environment"
                onChange={handleFileSelect}
                className="hidden"
              />
              <button
                onClick={handleClose}
                className="w-full py-2.5 text-gray-400 hover:text-gray-200 transition-colors text-sm"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Converting HEIC */}
          {step === 'converting' && (
            <div className="py-8 sm:py-12 text-center">
              <div className="animate-spin w-10 h-10 sm:w-12 sm:h-12 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4" />
              <p className="text-gray-300 font-medium text-sm sm:text-base">Converting image...</p>
              <p className="text-gray-500 text-xs sm:text-sm mt-1">Please wait</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
