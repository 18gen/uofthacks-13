'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Report } from '@/lib/types';

export function useReports() {
  const [reports, setReports] = useState<Report[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Load from API on mount
  useEffect(() => {
    async function fetchReports() {
      try {
        const response = await fetch('/api/reports');
        if (response.ok) {
          const data = await response.json();
          setReports(data);
        }
      } catch (error) {
        console.error('Failed to fetch reports:', error);
      } finally {
        setIsLoaded(true);
      }
    }
    fetchReports();
  }, []);

  const addReport = useCallback(
    async (reportData: Omit<Report, 'id' | 'createdAt'>): Promise<Report | null> => {
      setIsSubmitting(true);
      try {
        const response = await fetch('/api/reports', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(reportData),
        });

        if (!response.ok) {
          throw new Error('Failed to create report');
        }

        const newReport: Report = await response.json();
        setReports((prev) => [newReport, ...prev]);
        return newReport;
      } catch (error) {
        console.error('Failed to add report:', error);
        return null;
      } finally {
        setIsSubmitting(false);
      }
    },
    []
  );

  const removeReport = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/reports/${id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setReports((prev) => prev.filter((r) => r.id !== id));
      }
    } catch (error) {
      console.error('Failed to remove report:', error);
    }
  }, []);

  const clearReports = useCallback(() => {
    // This is mainly for UI state - typically wouldn't clear all from DB
    setReports([]);
  }, []);

  const refreshReports = useCallback(async () => {
    try {
      const response = await fetch('/api/reports');
      if (response.ok) {
        const data = await response.json();
        setReports(data);
      }
    } catch (error) {
      console.error('Failed to refresh reports:', error);
    }
  }, []);

  return {
    reports,
    isLoaded,
    isSubmitting,
    addReport,
    removeReport,
    clearReports,
    refreshReports,
  };
}
