'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import type { Report } from '@/lib/types';
import { useReports } from '@/hooks/useReports';
import { useAreas } from '@/hooks/useAreas';
import { getReportsInArea, getAreasContainingPoint } from '@/lib/geo';
import { initAmplitude, analytics } from '@/lib/analytics';
import AdminPasswordGate from '@/components/AdminPasswordGate';
import AdminSidebar from '@/components/AdminSidebar';
import PinDrawer from '@/components/PinDrawer';
import Toast, { useToast } from '@/components/Toast';

const AdminMap = dynamic(() => import('@/components/AdminMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-[#1a1a1a]">
      <div className="text-gray-400">Loading map...</div>
    </div>
  ),
});

export default function AdminPage() {
  const { reports, isLoaded: reportsLoaded } = useReports();
  const { areas, isLoaded: areasLoaded, addArea, updateArea, removeArea } = useAreas();
  const { toasts, addToast, dismissToast } = useToast();

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const prevReportsRef = useRef<Report[]>([]);

  useEffect(() => {
    initAmplitude();
  }, []);

  useEffect(() => {
    if (!reportsLoaded || !areasLoaded || areas.length === 0) return;

    const prevIds = new Set(prevReportsRef.current.map((r) => r.id));
    const newReports = reports.filter((r) => !prevIds.has(r.id));

    newReports.forEach((report) => {
      const containingAreas = getAreasContainingPoint(report.coordinates, areas);
      if (containingAreas.length > 0) {
        const areaNames = containingAreas.map((a) => a.name).join(', ');
        addToast(
          `New ${report.analysis.severity} severity report in: ${areaNames}`,
          report.analysis.severity === 'high' ? 'warning' : 'info'
        );
      }
    });

    prevReportsRef.current = reports;
  }, [reports, areas, reportsLoaded, areasLoaded, addToast]);

  const highlightedReportIds = useMemo(() => {
    if (!selectedAreaId) return [];
    const selectedArea = areas.find((a) => a.id === selectedAreaId);
    if (!selectedArea) return [];
    return getReportsInArea(reports, selectedArea).map((r) => r.id);
  }, [selectedAreaId, areas, reports]);

  const handleAreaCreated = useCallback(
    async (geometry: GeoJSON.Polygon) => {
      const areaNumber = areas.length + 1;
      const newArea = await addArea(geometry, `Area ${areaNumber}`);
      if (newArea) {
        analytics.adminAreaSaved(newArea.id);
        addToast('Responsibility area created', 'success');
      } else {
        addToast('Failed to create area', 'error');
      }
    },
    [areas.length, addArea, addToast]
  );

  const handleAreaDeleted = useCallback(
    (areaId: string) => {
      removeArea(areaId);
      if (selectedAreaId === areaId) {
        setSelectedAreaId(null);
      }
      addToast('Area deleted', 'info');
    },
    [removeArea, selectedAreaId, addToast]
  );

  const handleAreaRename = useCallback(
    (areaId: string, newName: string) => {
      updateArea(areaId, { name: newName });
      addToast('Area renamed', 'success');
    },
    [updateArea, addToast]
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

  if (!isAuthenticated) {
    return <AdminPasswordGate onAuthenticated={() => setIsAuthenticated(true)} />;
  }

  const isLoaded = reportsLoaded && areasLoaded;

  return (
    <div className="h-screen w-screen flex flex-col bg-[#0f0f0f]">
      {/* Header */}
      <header className="bg-[#1a1a1a] border-b border-[#333] px-4 py-3 flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-100">Admin Dashboard</h1>
            <p className="text-sm text-gray-500">Manage responsibility areas</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <a
            href="/"
            className="px-4 py-2 text-gray-400 hover:text-gray-200 transition-colors"
          >
            Back to Map
          </a>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Map */}
        <main className="flex-1 relative">
          {isLoaded ? (
            <AdminMap
              reports={reports}
              areas={areas}
              selectedAreaId={selectedAreaId}
              highlightedReportIds={highlightedReportIds}
              onAreaCreated={handleAreaCreated}
              onAreaDeleted={handleAreaDeleted}
              onPinClick={handlePinClick}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-[#1a1a1a]">
              <div className="text-gray-400">Loading...</div>
            </div>
          )}

          {/* Instructions overlay */}
          {isLoaded && areas.length === 0 && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-[#1a1a1a] border border-[#333] rounded-lg shadow-xl px-6 py-4 z-10 text-center">
              <p className="text-gray-200 font-medium">Draw your first responsibility area</p>
              <p className="text-gray-500 text-sm mt-1">
                Use the polygon tool (top-left) to define areas on the map
              </p>
            </div>
          )}
        </main>

        {/* Sidebar */}
        {isLoaded && (
          <AdminSidebar
            reports={reports}
            areas={areas}
            selectedAreaId={selectedAreaId}
            onAreaSelect={setSelectedAreaId}
            onAreaDelete={handleAreaDeleted}
            onAreaRename={handleAreaRename}
          />
        )}
      </div>

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
