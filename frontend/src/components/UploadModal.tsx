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
  onSubmit: (report: Omit<Report, 'id' | 'createdAt'>) => void;
}

export default function UploadModal({ isOpen, onClose, onSubmit }: UploadModalProps) {
  const [step, setStep] = useState<UploadStep>('select');
  const [file, setFile] = useState<File | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [geoMethod, setGeoMethod] = useState<'auto' | 'manual'>('auto');
  const [geoError, setGeoError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetState = useCallback(() => {
    setStep('select');
    setFile(null);
    if (mediaUrl) URL.revokeObjectURL(mediaUrl);
    setMediaUrl(null);
    setCoordinates(null);
    setGeoMethod('auto');
    setGeoError(null);
    setAnalysis(null);
    setIsAnalyzing(false);
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
      setGeoMethod('auto');
      setGeoError(null);
    } catch {
      setGeoError('Could not get your location. Pan the map to set location.');
      setGeoMethod('manual');
    }
  };

  const handleCenterChange = (coords: Coordinates) => {
    setCoordinates(coords);
    if (geoMethod === 'auto' && geoError === null) {
      // Keep auto if this is the initial position from geolocation
    } else {
      setGeoMethod('manual');
    }
    setGeoError(null);
  };

  const handleAnalyze = async () => {
    if (!file || !coordinates) return;

    setStep('analyzing');
    setIsAnalyzing(true);
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
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSubmit = () => {
    if (!file || !mediaUrl || !coordinates || !analysis) return;

    const report: Omit<Report, 'id' | 'createdAt'> = {
      coordinates,
      mediaUrl,
      mediaType: file.type.startsWith('image/') ? 'image' : 'video',
      fileName: file.name,
      fileSize: file.size,
      analysis,
      geoMethod,
    };

    onSubmit(report);
    resetState();
    onClose();
  };

  const handleBackFromLocation = () => {
    setStep('select');
    setFile(null);
    if (mediaUrl) URL.revokeObjectURL(mediaUrl);
    setMediaUrl(null);
    setCoordinates(null);
    setGeoError(null);
  };

  if (!isOpen) return null;

  // Full-screen location picker (Uber-style)
  if (step === 'location') {
    return (
      <div className="fixed inset-0 z-50 bg-[#0f0f0f]">
        {/* Full-screen map */}
        <div className="absolute inset-0">
          <Map
            reports={[]}
            centerSelectMode={true}
            onCenterChange={handleCenterChange}
            initialCenter={coordinates}
          />
        </div>

        {/* Back button - top left */}
        <button
          onClick={handleBackFromLocation}
          className="absolute top-4 left-4 z-20 w-10 h-10 bg-[#1a1a1a] border border-[#333] rounded-full flex items-center justify-center shadow-lg hover:bg-[#262626] transition-colors"
        >
          <svg className="w-5 h-5 text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        {/* Close button - top right */}
        {/* <button
          onClick={handleClose}
          className="absolute top-4 right-4 z-20 w-10 h-10 bg-[#1a1a1a] border border-[#333] rounded-full flex items-center justify-center shadow-lg hover:bg-[#262626] transition-colors"
        >
          <svg className="w-5 h-5 text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button> */}

        {/* Bottom sheet with image preview */}
        <div className="absolute bottom-0 left-0 right-0 z-20">
          {/* Curved top edge */}
          <div className="bg-[#1a1a1a] rounded-t-3xl border-t border-[#333] shadow-2xl">
            {/* Handle bar */}
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 bg-[#404040] rounded-full" />
            </div>

            {/* Content */}
            <div className="px-4 pb-4 sm:px-6 sm:pb-6">
              {/* Error message */}
              {geoError && (
                <div className="mb-3 p-2 bg-yellow-900/30 border border-yellow-800 rounded-lg text-yellow-400 text-xs sm:text-sm">
                  {geoError}
                </div>
              )}

              {/* Image preview and info */}
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
                  <h3 className="text-gray-100 font-semibold text-sm sm:text-base">Set barrier location</h3>
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

              {/* Confirm button */}
              <button
                onClick={handleAnalyze}
                disabled={!coordinates || isAnalyzing}
                className="w-full mt-4 py-3 sm:py-3.5 bg-blue-600 text-white rounded-xl font-semibold text-sm sm:text-base hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Confirm Location
              </button>
            </div>

            {/* Safe area padding for mobile */}
            <div className="h-safe-area-inset-bottom bg-[#1a1a1a]" />
          </div>
        </div>
      </div>
    );
  }

  // Regular modal for other steps
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-[#1a1a1a] border border-[#333] rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-[#333] flex items-center justify-between">
          <h2 className="text-lg sm:text-xl font-semibold text-gray-100">
            {step === 'select' && 'Report Barrier'}
            {step === 'converting' && 'Processing...'}
            {step === 'analyzing' && 'Analyzing...'}
            {step === 'review' && 'Review Report'}
          </h2>
          <button
            onClick={handleClose}
            className="text-gray-500 hover:text-gray-300 transition-colors p-1"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-900/30 border border-red-800 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Step 1: File Selection */}
          {step === 'select' && (
            <div className="space-y-4">
              <p className="text-gray-400 text-sm sm:text-base">
                Upload a photo or video of the accessibility barrier.
              </p>
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
            </div>
          )}

          {/* Step 1.5: Converting HEIC */}
          {step === 'converting' && (
            <div className="py-8 sm:py-12 text-center">
              <div className="animate-spin w-10 h-10 sm:w-12 sm:h-12 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4" />
              <p className="text-gray-300 font-medium text-sm sm:text-base">Converting image...</p>
              <p className="text-gray-500 text-xs sm:text-sm mt-1">Please wait</p>
            </div>
          )}

          {/* Step 3: Analyzing */}
          {step === 'analyzing' && (
            <div className="py-8 sm:py-12 text-center">
              {/* Image preview while analyzing */}
              {mediaUrl && file && (
                <div className="w-24 h-24 sm:w-32 sm:h-32 rounded-xl overflow-hidden bg-[#262626] mx-auto mb-4">
                  {file.type.startsWith('image/') ? (
                    <img src={mediaUrl} alt="Preview" className="w-full h-full object-cover" />
                  ) : (
                    <video src={mediaUrl} className="w-full h-full object-cover" />
                  )}
                </div>
              )}
              <div className="animate-spin w-8 h-8 sm:w-10 sm:h-10 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4" />
              <p className="text-gray-300 font-medium text-sm sm:text-base">Analyzing barrier...</p>
              <p className="text-gray-500 text-xs sm:text-sm mt-1">AI is identifying the issue</p>
            </div>
          )}

          {/* Step 4: Review */}
          {step === 'review' && analysis && (
            <div className="space-y-4">
              {mediaUrl && file && (
                <div className="rounded-xl overflow-hidden bg-[#262626]">
                  {file.type.startsWith('image/') ? (
                    <img src={mediaUrl} alt="Preview" className="w-full h-40 sm:h-48 object-contain" />
                  ) : (
                    <video src={mediaUrl} controls className="w-full h-40 sm:h-48 object-contain" />
                  )}
                </div>
              )}

              {/* AI Analysis Results */}
              <div className="bg-[#262626] border border-[#333] rounded-xl p-3 sm:p-4 space-y-2 sm:space-y-3">
                <h3 className="font-semibold text-gray-100 text-sm sm:text-base">AI Analysis</h3>

                <div className="flex items-center justify-between">
                  <span className="text-gray-500 text-xs sm:text-sm">Category</span>
                  <span className="font-medium text-gray-200 text-xs sm:text-sm">{CATEGORY_LABELS[analysis.category]}</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-gray-500 text-xs sm:text-sm">Severity</span>
                  <span
                    className="px-2 py-0.5 rounded-full text-xs font-medium text-white"
                    style={{ backgroundColor: SEVERITY_COLORS[analysis.severity] }}
                  >
                    {analysis.severity.charAt(0).toUpperCase() + analysis.severity.slice(1)}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-gray-500 text-xs sm:text-sm">Confidence</span>
                  <span className="font-medium text-gray-200 text-xs sm:text-sm">{Math.round(analysis.confidence * 100)}%</span>
                </div>

                <div className="pt-2 border-t border-[#333]">
                  <span className="text-gray-500 text-xs sm:text-sm block mb-1">Summary</span>
                  <p className="text-gray-300 text-xs sm:text-sm">{analysis.summary}</p>
                </div>
              </div>

              {coordinates && (
                <p className="text-xs sm:text-sm text-gray-500">
                  Location: {coordinates.lat.toFixed(5)}, {coordinates.lng.toFixed(5)}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {(step === 'select' || step === 'review') && (
          <div className="px-4 py-3 sm:px-6 sm:py-4 border-t border-[#333] bg-[#141414]">
            {step === 'select' && (
              <button
                onClick={handleClose}
                className="w-full py-2.5 sm:py-3 text-gray-400 hover:text-gray-200 transition-colors text-sm sm:text-base"
              >
                Cancel
              </button>
            )}

            {step === 'review' && (
              <div className="flex gap-3">
                <button
                  onClick={() => setStep('location')}
                  className="flex-1 py-2.5 sm:py-3 text-gray-400 hover:text-gray-200 transition-colors text-sm sm:text-base"
                >
                  Back
                </button>
                <button
                  onClick={handleSubmit}
                  className="flex-1 py-2.5 sm:py-3 bg-green-600 text-white rounded-xl font-semibold text-sm sm:text-base hover:bg-green-500 transition-colors"
                >
                  Submit Report
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
