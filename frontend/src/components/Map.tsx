'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { Report, Coordinates } from '@/lib/types';
import { SEVERITY_COLORS, CATEGORY_LABELS } from '@/lib/types';
import { DEFAULT_CENTER, DEFAULT_ZOOM } from '@/lib/geo';

// Marker size constants
const MARKER_SIZE = 24;
const MARKER_SIZE_HOVER = 30;

// Create popup HTML content for a report
function createPopupContent(report: Report): string {
  const mediaHtml = report.mediaType === 'image'
    ? `<img src="${report.mediaUrl}" alt="Report" style="width:100%;height:120px;object-fit:cover;border-radius:4px;" />`
    : `<video src="${report.mediaUrl}" style="width:100%;height:120px;object-fit:cover;border-radius:4px;" muted autoplay loop playsinline></video>`;

  const severityColor = SEVERITY_COLORS[report.analysis.severity];
  const categoryLabel = CATEGORY_LABELS[report.analysis.category];

  return `
    <div style="width:180px;font-family:system-ui,sans-serif;">
      ${mediaHtml}
      <div style="padding:8px 0 4px;">
        <div style="font-weight:600;font-size:13px;color:#f5f5f5;margin-bottom:4px;">${categoryLabel}</div>
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="width:8px;height:8px;border-radius:50%;background:${severityColor};"></span>
          <span style="font-size:12px;color:#a3a3a3;text-transform:capitalize;">${report.analysis.severity} severity</span>
        </div>
      </div>
    </div>
  `;
}

interface MarkerData {
  marker: mapboxgl.Marker;
  element: HTMLDivElement;
  reportId: string;
}

interface MapProps {
  reports: Report[];
  onPinClick?: (report: Report) => void;
  onMapClick?: (coordinates: Coordinates) => void;
  selectedReportId?: string | null;
  showClickMarker?: boolean;
  clickMarkerPosition?: Coordinates | null;
  // Center select mode: fixed marker at center, user pans map to select location
  centerSelectMode?: boolean;
  onCenterChange?: (coordinates: Coordinates) => void;
  initialCenter?: Coordinates | null;
  // Fly to this position when it changes (used for GPS recenter)
  flyToPosition?: Coordinates | null;
  // Disable panning but keep zoom enabled (for locked pin state)
  disablePan?: boolean;
  className?: string;
}

export default function Map({
  reports,
  onPinClick,
  onMapClick,
  selectedReportId,
  showClickMarker = false,
  clickMarkerPosition,
  centerSelectMode = false,
  onCenterChange,
  initialCenter,
  flyToPosition,
  disablePan = false,
  className = '',
}: MapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markersData = useRef<globalThis.Map<string, MarkerData>>(new globalThis.Map());
  const clickMarker = useRef<mapboxgl.Marker | null>(null);
  const hoverPopup = useRef<mapboxgl.Popup | null>(null);
  const allPopups = useRef<mapboxgl.Popup[]>([]);
  const onPinClickRef = useRef(onPinClick);
  const onCenterChangeRef = useRef(onCenterChange);
  const reportsRef = useRef(reports);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [showAllPopups, setShowAllPopups] = useState(false);

  // Keep onCenterChange ref updated
  useEffect(() => {
    onCenterChangeRef.current = onCenterChange;
  }, [onCenterChange]);

  // Keep reports ref updated for hover handler
  useEffect(() => {
    reportsRef.current = reports;
  }, [reports]);

  // Keep onPinClick ref updated to avoid recreating markers when callback changes
  useEffect(() => {
    onPinClickRef.current = onPinClick;
  }, [onPinClick]);

  // Initialize map with 3D buildings
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) {
      console.error('Mapbox token not found');
      return;
    }

    mapboxgl.accessToken = token;

    // Use initialCenter if provided, otherwise default
    const center = initialCenter
      ? [initialCenter.lng, initialCenter.lat] as [number, number]
      : [DEFAULT_CENTER.lng, DEFAULT_CENTER.lat] as [number, number];

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/standard',
      center,
      zoom: initialCenter ? 17 : DEFAULT_ZOOM,
      pitch: 45, // Tilt for 3D perspective
      bearing: -15, // Slight rotation for better 3D view
      antialias: true, // Smoother 3D rendering
    });

    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right');

    map.current.on('style.load', () => {
      if (!map.current) return;

      // Enable 3D terrain and buildings in Mapbox Standard style
      try {
        map.current.setConfigProperty('basemap', 'lightPreset', 'dusk');
        map.current.setConfigProperty('basemap', 'showPlaceLabels', true);
        map.current.setConfigProperty('basemap', 'showPointOfInterestLabels', true);
      } catch {
        // Fallback for older Mapbox versions - add 3D buildings manually
        if (!map.current.getLayer('3d-buildings')) {
          map.current.addLayer({
            id: '3d-buildings',
            source: 'composite',
            'source-layer': 'building',
            type: 'fill-extrusion',
            minzoom: 14,
            paint: {
              'fill-extrusion-color': '#aaa',
              'fill-extrusion-height': ['get', 'height'],
              'fill-extrusion-base': ['get', 'min_height'],
              'fill-extrusion-opacity': 0.8,
            },
          });
        }
      }
    });

    map.current.on('load', () => {
      setMapLoaded(true);
      // Emit initial center position
      if (onCenterChangeRef.current) {
        const mapCenter = map.current!.getCenter();
        onCenterChangeRef.current({ lng: mapCenter.lng, lat: mapCenter.lat });
      }
    });

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle center select mode - emit coordinates when map moves
  useEffect(() => {
    if (!map.current || !centerSelectMode) return;

    const handleMove = () => {
      if (!map.current || !onCenterChangeRef.current) return;
      const center = map.current.getCenter();
      onCenterChangeRef.current({ lng: center.lng, lat: center.lat });
    };

    map.current.on('moveend', handleMove);

    return () => {
      map.current?.off('moveend', handleMove);
    };
  }, [centerSelectMode, mapLoaded]);

  // Handle flyToPosition - fly to specified coordinates when prop changes
  useEffect(() => {
    if (!map.current || !flyToPosition || !mapLoaded) return;

    map.current.flyTo({
      center: [flyToPosition.lng, flyToPosition.lat],
      zoom: 16,
      duration: 1000,
    });
  }, [flyToPosition, mapLoaded]);

  // Handle disablePan - disable dragging but keep zoom enabled
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    if (disablePan) {
      map.current.dragPan.disable();
      map.current.touchZoomRotate.disableRotation();
    } else {
      map.current.dragPan.enable();
      map.current.touchZoomRotate.enableRotation();
    }
  }, [disablePan, mapLoaded]);

  // Handle map clicks
  useEffect(() => {
    if (!map.current || !onMapClick) return;

    const handleClick = (e: mapboxgl.MapMouseEvent) => {
      onMapClick({ lng: e.lngLat.lng, lat: e.lngLat.lat });
    };

    map.current.on('click', handleClick);

    return () => {
      map.current?.off('click', handleClick);
    };
  }, [onMapClick]);

  // Create marker element with hover popup
  const createMarkerElement = useCallback(
    (report: Report) => {
      const el = document.createElement('div');
      el.className = 'report-marker';
      el.dataset.reportId = report.id;
      el.style.cssText = `
        width: ${MARKER_SIZE}px;
        height: ${MARKER_SIZE}px;
        background-color: ${SEVERITY_COLORS[report.analysis.severity]};
        border: 3px solid white;
        border-radius: 50%;
        cursor: pointer;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        transition: width 0.15s ease-out, height 0.15s ease-out, margin 0.15s ease-out, border-color 0.15s ease-out;
        margin: 0;
      `;

      // Show popup on hover - use width/height instead of transform to avoid positioning issues
      el.addEventListener('mouseenter', () => {
        // Adjust margin to keep marker centered when size changes
        const sizeDiff = (MARKER_SIZE_HOVER - MARKER_SIZE) / 2;
        el.style.width = `${MARKER_SIZE_HOVER}px`;
        el.style.height = `${MARKER_SIZE_HOVER}px`;
        el.style.margin = `-${sizeDiff}px`;

        if (!map.current) return;

        // Find the current report data (in case it was updated)
        const currentReport = reportsRef.current.find((r) => r.id === report.id) || report;

        // Create or update popup
        if (!hoverPopup.current) {
          hoverPopup.current = new mapboxgl.Popup({
            closeButton: false,
            closeOnClick: false,
            offset: 20,
            className: 'report-hover-popup',
          });
        }

        hoverPopup.current
          .setLngLat([currentReport.coordinates.lng, currentReport.coordinates.lat])
          .setHTML(createPopupContent(currentReport))
          .addTo(map.current);
      });

      // Hide popup on mouse leave
      el.addEventListener('mouseleave', () => {
        el.style.width = `${MARKER_SIZE}px`;
        el.style.height = `${MARKER_SIZE}px`;
        el.style.margin = '0';
        hoverPopup.current?.remove();
      });

      // Click to open sidebar
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        hoverPopup.current?.remove();
        onPinClickRef.current?.(report);
      });

      return el;
    },
    []
  );

  // Update marker selection styling (without recreating markers)
  useEffect(() => {
    markersData.current.forEach((data) => {
      const isSelected = data.reportId === selectedReportId;
      data.element.style.borderColor = isSelected ? '#1d4ed8' : 'white';
    });
  }, [selectedReportId]);

  // Add/remove markers when reports change (only after map is loaded)
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const currentReportIds = new Set(reports.map((r) => r.id));

    // Remove markers for deleted reports
    markersData.current.forEach((data, id) => {
      if (!currentReportIds.has(id)) {
        data.marker.remove();
        markersData.current.delete(id);
      }
    });

    // Add markers for new reports only
    reports.forEach((report) => {
      if (!markersData.current.has(report.id)) {
        const el = createMarkerElement(report);
        const marker = new mapboxgl.Marker(el)
          .setLngLat([report.coordinates.lng, report.coordinates.lat])
          .addTo(map.current!);
        markersData.current.set(report.id, {
          marker,
          element: el,
          reportId: report.id,
        });
      }
    });
  }, [reports, createMarkerElement, mapLoaded]);

  // Handle click marker for manual location selection
  useEffect(() => {
    if (!map.current) return;

    if (showClickMarker && clickMarkerPosition) {
      if (!clickMarker.current) {
        const el = document.createElement('div');
        el.style.cssText = `
          width: 32px;
          height: 32px;
          background-color: #3b82f6;
          border: 4px solid white;
          border-radius: 50%;
          box-shadow: 0 2px 12px rgba(0,0,0,0.4);
        `;
        clickMarker.current = new mapboxgl.Marker(el);
      }
      clickMarker.current
        .setLngLat([clickMarkerPosition.lng, clickMarkerPosition.lat])
        .addTo(map.current);
    } else {
      clickMarker.current?.remove();
    }
  }, [showClickMarker, clickMarkerPosition]);

  // Fly to selected report
  useEffect(() => {
    if (!map.current || !selectedReportId) return;

    const report = reports.find((r) => r.id === selectedReportId);
    if (report) {
      map.current.flyTo({
        center: [report.coordinates.lng, report.coordinates.lat],
        zoom: 16,
        duration: 1000,
      });
    }
  }, [selectedReportId, reports]);

  // Handle showing/hiding all popups
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    // Remove all existing popups
    allPopups.current.forEach((popup) => popup.remove());
    allPopups.current = [];

    if (showAllPopups) {
      // Create popups for all reports
      reports.forEach((report) => {
        const popup = new mapboxgl.Popup({
          closeButton: false,
          closeOnClick: false,
          offset: 20,
          className: 'report-hover-popup',
        })
          .setLngLat([report.coordinates.lng, report.coordinates.lat])
          .setHTML(createPopupContent(report))
          .addTo(map.current!);
        allPopups.current.push(popup);
      });
    }
  }, [showAllPopups, reports, mapLoaded]);

  // Clean up all popups on unmount
  useEffect(() => {
    return () => {
      allPopups.current.forEach((popup) => popup.remove());
    };
  }, []);

  // If not in centerSelectMode, render map with show all button
  if (!centerSelectMode) {
    return (
      <div className={`relative w-full h-full ${className}`} style={{ minHeight: '400px' }}>
        <div ref={mapContainer} className="w-full h-full" />

        {/* Show All Popups button - only when there are reports */}
        {reports.length > 0 && (
          <button
            onClick={() => setShowAllPopups(!showAllPopups)}
            className={`absolute top-4 right-16 z-10 px-3 py-2 rounded-lg font-medium text-sm shadow-lg transition-colors ${
              showAllPopups
                ? 'bg-blue-600 text-white'
                : 'bg-[#1a1a1a]/90 backdrop-blur border border-[#333] text-gray-200 hover:bg-[#262626]'
            }`}
          >
            {showAllPopups ? 'Hide Info' : 'Show All'}
          </button>
        )}
      </div>
    );
  }

  // In centerSelectMode, render map with centered pin overlay
  return (
    <div className={`relative w-full h-full ${className}`} style={{ minHeight: '400px' }}>
      <div ref={mapContainer} className="w-full h-full" />

      {/* Centered pin marker - always at exact screen center */}
      <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-10">
        <div className="relative flex flex-col items-center">
          {/* Pin shadow on ground */}
          <div
            className="absolute w-4 h-1.5 bg-black/30 rounded-full blur-sm"
            style={{ bottom: '-4px' }}
          />
          {/* Pin icon - positioned so the point is at center */}
          <svg
            width="40"
            height="52"
            viewBox="0 0 40 52"
            fill="none"
            className="drop-shadow-lg"
            style={{ marginBottom: '-2px' }}
          >
            {/* Pin body */}
            <path
              d="M20 0C8.954 0 0 8.954 0 20c0 14.5 20 32 20 32s20-17.5 20-32C40 8.954 31.046 0 20 0z"
              fill="#3b82f6"
            />
            {/* Inner circle */}
            <circle cx="20" cy="18" r="8" fill="white" />
            {/* Center dot */}
            <circle cx="20" cy="18" r="3" fill="#3b82f6" />
          </svg>
        </div>
      </div>
    </div>
  );
}
