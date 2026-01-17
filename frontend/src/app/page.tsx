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
    (reportData: Omit<Report, 'id' | 'createdAt'>) => {
      const newReport = addReport(reportData);
      analytics.reportSubmitted(
        newReport.id,
        newReport.analysis.category,
        newReport.analysis.severity,
        newReport.mediaType,
        newReport.geoMethod
      );
      addToast('Report submitted successfully!', 'success');
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
    <div className="h-screen w-screen flex flex-col bg-[#0f0f0f]">
      {/* Header */}
      <header className="bg-[#1a1a1a] border-b border-[#333] px-4 py-3 flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-100">Mobilify</h1>
            {/* <p className="text-sm text-gray-500">Report accessibility barriers</p> */}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <a
            href="/admin"
            className="text-sm text-gray-400 hover:text-gray-200 transition-colors"
          >
            Admin
          </a>
          <button
            onClick={handleReportButtonClick}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-500 transition-colors flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Report Barrier
          </button>
        </div>
      </header>

      {/* Map */}
      <main className="flex-1 relative">
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

        {/* Legend */}
        <div className="absolute bottom-4 left-4 bg-[#1a1a1a] border border-[#333] rounded-lg shadow-xl p-3 z-10">
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
