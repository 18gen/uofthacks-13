'use client';

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import type { Report } from '@/lib/types';
import { useReports } from '@/hooks/useReports';
import { initAmplitude, analytics } from '@/lib/analytics';
import UploadModal from '@/components/UploadModal';
import PinDrawer from '@/components/PinDrawer';
import Toast, { useToast } from '@/components/Toast';

// Dynamic import Map to avoid SSR issues with Mapbox
const Map = dynamic(() => import('@/components/Map'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-[#1a1a1a]">
      <div className="text-gray-400">Loading map...</div>
    </div>
  ),
});

export default function HomePage() {
  const { reports, isLoaded, addReport } = useReports();
  const { toasts, addToast, dismissToast } = useToast();

  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Initialize Amplitude
  useEffect(() => {
    initAmplitude();
  }, []);

  const handleReportButtonClick = () => {
    analytics.reportStart();
    setIsUploadModalOpen(true);
  };

  const handleReportSubmit = useCallback(
    async (reportData: Omit<Report, 'id' | 'createdAt'>) => {
      const newReport = await addReport(reportData);
      if (newReport) {
        analytics.reportSubmitted(
          newReport.id,
          newReport.analysis.category,
          newReport.analysis.severity,
          newReport.mediaType,
          newReport.geoMethod
        );
        addToast('Report submitted successfully!', 'success');
      } else {
        addToast('Failed to submit report. Please try again.', 'error');
      }
    },
    [addReport, addToast]
  );

  const handlePinClick = useCallback((report: Report) => {
    analytics.pinOpened(report.id, report.analysis.category, report.analysis.severity);
    setSelectedReport(report);
    setIsDrawerOpen(true);
  }, []);

  const handleDrawerClose = () => {
    setIsDrawerOpen(false);
    setSelectedReport(null);
  };

  return (
    <div className="h-screen w-screen bg-[#0f0f0f]">
      {/* Full-screen Map */}
      <main className="absolute inset-0">
        {isLoaded ? (
          <Map
            reports={reports}
            onPinClick={handlePinClick}
            selectedReportId={selectedReport?.id}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-[#1a1a1a]">
            <div className="text-gray-400">Loading...</div>
          </div>
        )}

        {/* Floating controls - top left */}
        <div className="absolute top-4 left-4 z-20 flex items-center gap-2">
          <a
            href="/admin"
            className="px-4 py-2.5 bg-[#1a1a1a]/90 backdrop-blur border border-[#333] text-gray-200 rounded-xl font-medium hover:bg-[#262626] transition-colors shadow-lg text-sm"
          >
            Admin
          </a>
          <button
            onClick={handleReportButtonClick}
            className="px-4 py-2.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-500 transition-colors shadow-lg flex items-center gap-2 text-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Report Barrier
          </button>
        </div>

        {/* Legend */}
        <div className="absolute bottom-4 left-4 bg-[#1a1a1a]/90 backdrop-blur border border-[#333] rounded-xl shadow-xl p-3 z-10">
          <p className="text-xs font-medium text-gray-400 mb-2">Severity</p>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-red-500" />
              <span className="text-sm text-gray-300">High</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-yellow-500" />
              <span className="text-sm text-gray-300">Medium</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-green-500" />
              <span className="text-sm text-gray-300">Low</span>
            </div>
          </div>
          {reports.length > 0 && (
            <p className="text-xs text-gray-500 mt-2 pt-2 border-t border-[#333]">
              {reports.length} report{reports.length !== 1 ? 's' : ''} total
            </p>
          )}
        </div>
      </main>

      {/* Upload Modal */}
      <UploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onSubmit={handleReportSubmit}
      />

      {/* Pin Detail Drawer */}
      <PinDrawer
        report={selectedReport}
        isOpen={isDrawerOpen}
        onClose={handleDrawerClose}
      />

      {/* Toast Notifications */}
      <Toast toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
