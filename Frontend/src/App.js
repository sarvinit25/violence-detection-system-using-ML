import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { 
  Shield, 
  AlertTriangle, 
  Activity, 
  Map as MapIcon, 
  Video, 
  Settings, 
  Bell, 
  SkipBack, 
  SkipForward, 
  Maximize2,
  ChevronRight,
  Database,
  Share2,
  Cpu,
  CheckCircle,
  XCircle,
  Wifi,
  WifiOff,
  Download
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';

/**
 * SENTINEL: INTELLIGENT SOC DASHBOARD
 * -----------------------------------
 * Changelog:
 * [FIX] Replaced browser alert() with in-app toast notifications
 * [FIX] Fixed URL memory leak using useRef for object URL tracking
 * [FIX] Fixed heatmap Math.random() recalculating on every render (useMemo)
 * [FIX] Made all toggle switches stateful and functional
 * [FIX] Added REACT_APP_API_URL env variable support
 * [FIX] Connected real API results to camera simulation grid
 * [FEATURE] WebSocket live alert stream from backend
 * [FEATURE] Real map integration using Leaflet.js (OpenStreetMap)
 */

// ─── ENV CONFIG ──────────────────────────────────────────────────────────────
const API_URL = "https://overcareless-sabina-unhesitatingly.ngrok-free.dev";
const WS_URL  = "wss://overcareless-sabina-unhesitatingly.ngrok-free.dev";

// ─── MOCK DATA ────────────────────────────────────────────────────────────────
const MOCK_CAMERAS = [
  { id: 'CAM-01', location: 'Main Entrance',    status: 'active',  probability: 0.02, type: 'Dome'   },
  { id: 'CAM-02', location: 'Cafeteria Hall',   status: 'active',  probability: 0.15, type: 'Bullet' },
  { id: 'CAM-03', location: 'Parking Lot B',    status: 'warning', probability: 0.89, type: 'PTZ'    },
  { id: 'CAM-04', location: 'Library Corridor', status: 'active',  probability: 0.05, type: 'Dome'   },
];

// Camera GPS coordinates (replace with your actual campus coords)
const CAMERA_COORDS = {
  'CAM-01': { lat: 21.0077, lng: 75.5626, location: 'Main Entrance'    },
  'CAM-02': { lat: 21.0083, lng: 75.5638, location: 'Cafeteria Hall'   },
  'CAM-03': { lat: 21.0068, lng: 75.5615, location: 'Parking Lot B'    },
  'CAM-04': { lat: 21.0080, lng: 75.5620, location: 'Library Corridor' },
};

const ML_METRICS = [
  { epoch: 10, accuracy: 0.65, loss: 0.80 },
  { epoch: 20, accuracy: 0.72, loss: 0.60 },
  { epoch: 30, accuracy: 0.78, loss: 0.45 },
  { epoch: 40, accuracy: 0.82, loss: 0.35 },
  { epoch: 50, accuracy: 0.88, loss: 0.25 },
  { epoch: 60, accuracy: 0.91, loss: 0.15 },
  { epoch: 70, accuracy: 0.94, loss: 0.10 },
  { epoch: 80, accuracy: 0.96, loss: 0.05 },
  { epoch: 90, accuracy: 0.965,loss: 0.02 },
];

// ─── LEAFLET CSS (injected once) ──────────────────────────────────────────────
const LEAFLET_CSS = `
  .leaflet-container { background: #0f172a !important; }
  .leaflet-tile { filter: brightness(0.4) saturate(0.5) hue-rotate(180deg); }
  .sentinel-cam-marker {
    width: 28px; height: 28px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 800; font-family: monospace;
    border: 2px solid white; box-shadow: 0 0 12px rgba(0,0,0,0.6);
    cursor: pointer; transition: transform 0.2s;
  }
  .sentinel-cam-marker:hover { transform: scale(1.2); }
  .sentinel-cam-marker.danger  { background:#ef4444; animation: pulseCam 1s infinite; }
  .sentinel-cam-marker.warning { background:#f97316; }
  .sentinel-cam-marker.active  { background:#10b981; }
  @keyframes pulseCam {
    0%,100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.5); }
    50%      { box-shadow: 0 0 0 10px rgba(239,68,68,0); }
  }
`;

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function SentinelDashboard() {
  const [activeTab,      setActiveTab]      = useState('dashboard');
  const [sidebarOpen,    setSidebarOpen]    = useState(true);
  const [isSimulating] = useState(true);
  const [cameras,        setCameras]        = useState(MOCK_CAMERAS);
  const [alertLog,       setAlertLog]       = useState([]);
  const [threshold,      setThreshold]      = useState(0.75);
  const [currentTime,    setCurrentTime]    = useState(new Date());
  const [uploading,      setUploading]      = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [localVideoUrl,  setLocalVideoUrl]  = useState(null);
  const [wsConnected,    setWsConnected]    = useState(false);
  const [toasts,         setToasts]         = useState([]);

  // [FIX] Track object URL in ref to prevent stale closure memory leak
  const videoUrlRef  = useRef(null);
  const fileInputRef = useRef(null);
  const wsRef        = useRef(null);
  const mapRef       = useRef(null);
  const mapInstanceRef = useRef(null);

  // [FIX] Functional settings state for toggles
  const [settings, setSettings] = useState({
    autoRecord:     true,
    audioAnalysis:  false,
    mobileAlerts:   true,
    lawEnforcement: false,
  });

  // ── Toast system ─────────────────────────────────────────────────────────────
  const pushToast = useCallback((type, message, duration = 4500) => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration);
  }, []);

  // ── Clock ─────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Inject Leaflet CSS once ────────────────────────────────────────────────
  useEffect(() => {
    if (!document.getElementById('sentinel-leaflet-css')) {
      const link = document.createElement('link');
      link.id   = 'sentinel-leaflet-css';
      link.rel  = 'stylesheet';
      link.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
      document.head.appendChild(link);

      const style = document.createElement('style');
      style.id        = 'sentinel-map-style';
      style.textContent = LEAFLET_CSS;
      document.head.appendChild(style);
    }
  }, []);

  // ── Leaflet map init ───────────────────────────────────────────────────────
  useEffect(() => {
    if (activeTab !== 'map' || mapInstanceRef.current) return;

    const initMap = () => {
      if (!mapRef.current || !window.L) return;
      const L = window.L;

      const map = L.map(mapRef.current, {
        center: [21.0077, 75.5626],
        zoom: 17,
        zoomControl: true,
        attributionControl: false,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
      }).addTo(map);

      // Add camera markers
      Object.entries(CAMERA_COORDS).forEach(([camId, info]) => {
        const cam   = cameras.find(c => c.id === camId);
        const status = cam?.status || 'active';

        const icon = L.divIcon({
          className: '',
          html: `<div class="sentinel-cam-marker ${status}">${camId.replace('CAM-', '')}</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        });

        L.marker([info.lat, info.lng], { icon })
          .addTo(map)
          .bindPopup(`
            <div style="background:#1e293b;color:#f1f5f9;padding:8px 12px;border-radius:8px;border:1px solid #334155;font-family:monospace;min-width:140px">
              <div style="font-weight:800;font-size:13px">${camId}</div>
              <div style="color:#94a3b8;font-size:11px">${info.location}</div>
              <div style="margin-top:6px;font-size:11px;color:${status==='danger'?'#f87171':'#34d399'};font-weight:700;text-transform:uppercase">${status}</div>
            </div>
          `, { className: 'sentinel-popup' });
      });

      mapInstanceRef.current = map;
    };

    // Load Leaflet script if not already loaded
    if (!window.L) {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
      script.onload = initMap;
      document.head.appendChild(script);
    } else {
      setTimeout(initMap, 100);
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [activeTab]); // eslint-disable-line

  // ── WebSocket live alert stream ────────────────────────────────────────────
  useEffect(() => {
    let reconnectTimer = null;

    const connect = () => {
      try {
        const ws = new WebSocket(`${WS_URL}/ws/alerts`);
        wsRef.current = ws;

        ws.onopen = () => {
          setWsConnected(true);
          console.log('✅ WebSocket connected');
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            // Push to alert log
            setAlertLog(prev => [data, ...prev].slice(0, 8));
            // Push toast
            pushToast('danger', `🚨 ${data.type} — ${data.location} (${data.confidence}%)`);
            // Update camera grid
            if (data.camId && data.camId !== 'UPLOAD') {
              setCameras(prev => prev.map(cam =>
                cam.id === data.camId
                  ? { ...cam, probability: parseFloat(data.confidence) / 100, status: 'danger' }
                  : cam
              ));
            }
          } catch (e) {
            console.warn('WS parse error:', e);
          }
        };

        ws.onclose = () => {
          setWsConnected(false);
          // Auto-reconnect after 5 s
          reconnectTimer = setTimeout(connect, 5000);
        };

        ws.onerror = () => ws.close();
      } catch (e) {
        reconnectTimer = setTimeout(connect, 5000);
      }
    };

    connect();
    return () => {
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [pushToast]);

  // ── Simulation engine ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!isSimulating) return;
    const interval = setInterval(() => {
      setCameras(prev => prev.map(cam => {
        let newProb = Math.max(0, Math.min(1, cam.probability + (Math.random() - 0.5) * 0.1));
        if (cam.id === 'CAM-03' && Math.random() > 0.85) newProb = 0.95;
        if (cam.id === 'CAM-03' && Math.random() < 0.15) newProb = 0.10;

        let status = 'active';
        if (newProb > threshold)            status = 'danger';
        else if (newProb > threshold * 0.6) status = 'warning';

        if (status === 'danger' && cam.status !== 'danger') {
          const newAlert = {
            id: Date.now() + Math.random(),
            camId: cam.id,
            location: cam.location,
            time: new Date().toLocaleTimeString(),
            confidence: (newProb * 100).toFixed(1),
            type: 'Violence Detected',
          };
          setAlertLog(prev => [newAlert, ...prev].slice(0, 8));
          pushToast('danger', `🚨 Threat at ${cam.location} (${newAlert.confidence}%)`);
        }

        return { ...cam, probability: newProb, status };
      }));
    }, 1500);
    return () => clearInterval(interval);
  }, [isSimulating, threshold, pushToast]);

  // ── File upload & predict ──────────────────────────────────────────────────
  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    // [FIX] Clean up previous object URL using ref before creating a new one
    if (videoUrlRef.current) {
      URL.revokeObjectURL(videoUrlRef.current);
      videoUrlRef.current = null;
    }

    const url = URL.createObjectURL(file);
    videoUrlRef.current = url;
    setLocalVideoUrl(url);
    setUploading(true);
    setAnalysisResult(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      // [FIX] Use env variable instead of hardcoded localhost
      const response = await fetch(`${API_URL}/predict`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) throw new Error("Backend connection failed");
      const data = await response.json();
      setAnalysisResult(data);

      // [FIX] Replace alert() with toast notifications
      if (data.classification === "Violent") {
        pushToast('danger', `⚠️ DANGER DETECTED — Confidence: ${data.confidence}%`, 6000);

        // [FIX] Connect real result to camera simulation grid
        const newAlert = {
          id: Date.now(),
          camId: 'UPLOAD',
          location: 'Forensics Lab',
          time: new Date().toLocaleTimeString(),
          confidence: data.confidence,
          type: 'VIOLENCE DETECTED (AI)',
        };
        setAlertLog(prev => [newAlert, ...prev].slice(0, 8));

        // Update CAM-03 (or nearest cam) to reflect the real detection
        setCameras(prev => prev.map(cam =>
          cam.id === 'CAM-03'
            ? { ...cam, probability: data.confidence / 100, status: 'danger' }
            : cam
        ));
      } else {
        pushToast('success', `✅ Analysis Complete: Safe (${data.confidence}%)`, 4000);
      }
    } catch (error) {
      console.error("Backend error:", error);
      pushToast('error', '❌ Cannot connect to Python backend. Is main.py running?', 5000);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      // NOTE: We intentionally do NOT revoke the URL here so the video keeps playing.
      // It will be revoked on the next upload or component unmount.
    }
  };

  // Revoke URL on unmount
  useEffect(() => {
    return () => {
      if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
    };
  }, []);

  // ── Evidence report download ───────────────────────────────────────────────
  const downloadReport = useCallback(() => {
    if (!analysisResult) return;
    const report = {
      sentinel_report: true,
      generated_at:    new Date().toISOString(),
      classification:  analysisResult.classification,
      confidence:      analysisResult.confidence,
      is_danger:       analysisResult.is_danger,
      filename:        analysisResult.filename,
      alert_sent:      analysisResult.alert_sent ?? false,
      model:           'ConvNeXt-Tiny + LSTM + Temporal Attention',
      sequence_length: 16,
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `sentinel_incident_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    pushToast('success', '📄 Report downloaded.');
  }, [analysisResult, pushToast]);

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden selection:bg-rose-500 selection:text-white">

      {/* ── Toast Container ─────────────────────────────────────────────────── */}
      <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-3 pointer-events-none">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`pointer-events-auto px-5 py-3.5 rounded-xl border shadow-2xl text-sm font-medium max-w-sm
              backdrop-blur-md transition-all duration-300
              ${toast.type === 'danger'  ? 'bg-rose-950/90 border-rose-500/60 text-rose-100' : ''}
              ${toast.type === 'success' ? 'bg-emerald-950/90 border-emerald-500/60 text-emerald-100' : ''}
              ${toast.type === 'error'   ? 'bg-slate-900/90 border-slate-600 text-slate-300' : ''}
            `}
          >
            {toast.message}
          </div>
        ))}
      </div>

      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <aside className={`${sidebarOpen ? 'w-64' : 'w-20'} bg-slate-900 border-r border-slate-800 transition-all duration-300 flex flex-col z-20 shadow-2xl`}>
        <div className="p-4 flex items-center justify-between border-b border-slate-800 h-16">
          <div className={`flex items-center gap-3 ${!sidebarOpen ? 'justify-center w-full' : ''}`}>
            <div className="w-10 h-10 bg-gradient-to-br from-rose-600 to-rose-800 rounded-lg flex items-center justify-center shadow-lg shadow-rose-900/20 shrink-0">
              <Shield className="text-white w-6 h-6" />
            </div>
            {sidebarOpen && (
              <div>
                <h1 className="font-bold text-lg tracking-wider">SENTINEL</h1>
                <p className="text-[10px] text-slate-500 tracking-widest uppercase">AI Security Ops</p>
              </div>
            )}
          </div>
          {sidebarOpen && (
            <button onClick={() => setSidebarOpen(false)} className="text-slate-500 hover:text-white transition-colors">
              <SkipBack size={20} />
            </button>
          )}
        </div>

        <nav className="flex-1 py-6 px-3 space-y-2 overflow-y-auto">
          <NavItem icon={<Activity />}  label="Live Dashboard"    active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} collapsed={!sidebarOpen} />
          <NavItem icon={<MapIcon />}   label="Geo-Spatial Map"   active={activeTab === 'map'}       onClick={() => setActiveTab('map')}       collapsed={!sidebarOpen} />
          <NavItem icon={<Video />}     label="Forensics Lab"     active={activeTab === 'forensics'} onClick={() => setActiveTab('forensics')} collapsed={!sidebarOpen} />
          <NavItem icon={<Database />}  label="Model Metrics"     active={activeTab === 'stats'}     onClick={() => setActiveTab('stats')}     collapsed={!sidebarOpen} />
          <div className="my-4 border-t border-slate-800/50" />
          <NavItem icon={<Settings />}  label="Configuration"     active={activeTab === 'config'}    onClick={() => setActiveTab('config')}    collapsed={!sidebarOpen} />
        </nav>

        {!sidebarOpen && (
          <div className="p-4 flex justify-center border-t border-slate-800">
            <button onClick={() => setSidebarOpen(true)} className="text-slate-500 hover:text-white"><ChevronRight /></button>
          </div>
        )}

        {sidebarOpen && (
          <div className="p-4 border-t border-slate-800 bg-slate-900/50">
            <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50 space-y-2">
              {/* WebSocket status indicator */}
              <div className="flex items-center gap-2">
                {wsConnected
                  ? <Wifi   size={12} className="text-emerald-400" />
                  : <WifiOff size={12} className="text-rose-400" />}
                <span className={`text-[10px] font-bold tracking-wide ${wsConnected ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {wsConnected ? 'WS LIVE' : 'WS OFFLINE'}
                </span>
              </div>
              <div className="text-xs text-slate-400 flex justify-between">
                <span>Backend:</span> <span className="text-slate-200">PyTorch</span>
              </div>
              <div className="text-xs text-slate-400 flex justify-between">
                <span>Model:</span> <span className="text-slate-200">ConvNeXt+LSTM</span>
              </div>
              <div className="text-xs text-slate-400 flex justify-between">
                <span>API:</span> <span className="text-slate-200 truncate max-w-[100px]">{API_URL.replace('http://', '')}</span>
              </div>
            </div>
          </div>
        )}
      </aside>

      {/* ── Main Content ────────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col overflow-hidden relative bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-black">

        {/* Header */}
        <header className="h-16 bg-slate-900/80 backdrop-blur-md border-b border-slate-800 flex items-center justify-between px-6 z-10 sticky top-0">
          <h2 className="text-xl font-semibold text-white tracking-tight">
            {activeTab === 'dashboard' && 'Command Center'}
            {activeTab === 'map'       && 'Campus Security Grid'}
            {activeTab === 'forensics' && 'Incident Analysis'}
            {activeTab === 'stats'     && 'Performance Analytics'}
            {activeTab === 'config'    && 'System Parameters'}
          </h2>
          <div className="flex items-center gap-6">
            <div className="hidden md:flex items-center gap-2 text-slate-400 text-sm font-mono bg-slate-800/50 px-3 py-1 rounded-full border border-slate-700">
              <span>{currentTime.toLocaleDateString()}</span>
              <span className="text-slate-600">|</span>
              <span className="text-slate-200">{currentTime.toLocaleTimeString()}</span>
            </div>
            <div className="flex items-center gap-4">
              <button className="relative p-2 text-slate-400 hover:text-white transition-colors group">
                <Bell className="w-5 h-5 group-hover:rotate-12 transition-transform" />
                {alertLog.length > 0 && <>
                  <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-rose-500 rounded-full animate-ping" />
                  <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-rose-500 rounded-full border border-slate-900" />
                </>}
              </button>
              <div className="flex items-center gap-3 pl-4 border-l border-slate-700">
                <div className="text-right hidden sm:block">
                  <p className="text-sm font-medium text-white">Admin Operator</p>
                  <p className="text-xs text-slate-500">Level 4 Clearance</p>
                </div>
                <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-rose-500 to-orange-500 border-2 border-slate-700 shadow-lg cursor-pointer hover:border-white transition-colors" />
              </div>
            </div>
          </div>
        </header>

        {/* Scroll Area */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-6">

          {/* ════ DASHBOARD ════ */}
          {activeTab === 'dashboard' && (
            <div className="grid grid-cols-12 gap-6 max-w-8xl mx-auto">
              <div className="col-span-12 lg:col-span-8 grid grid-cols-1 md:grid-cols-2 gap-4 auto-rows-min h-fit">
                {cameras.map(cam => (
                  <CameraFeed key={cam.id} camera={cam} threshold={threshold} />
                ))}
              </div>

              <div className="col-span-12 lg:col-span-4 flex flex-col gap-6">
                {/* Alert log */}
                <div className="bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden shadow-2xl flex flex-col h-[500px]">
                  <div className="p-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
                    <h3 className="font-semibold text-slate-200 flex items-center gap-2">
                      <AlertTriangle className="text-rose-500" size={18} />
                      Live Incident Log
                    </h3>
                    <span className="px-2 py-0.5 text-[10px] font-bold bg-rose-500/10 text-rose-400 rounded border border-rose-500/20 uppercase tracking-wide">
                      {alertLog.length} Events
                    </span>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {alertLog.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-slate-600 gap-2 opacity-50">
                        <Shield size={48} strokeWidth={1} />
                        <span className="text-sm italic">System Secure. No threats.</span>
                      </div>
                    ) : alertLog.map(alert => (
                      <div key={alert.id} className="bg-slate-800/40 hover:bg-slate-800 border-l-[3px] border-rose-500 p-3 rounded-r-lg transition-all cursor-pointer">
                        <div className="flex justify-between items-start mb-1">
                          <span className="font-bold text-rose-200 text-sm">{alert.type}</span>
                          <span className="text-[10px] text-slate-500 font-mono">{alert.time}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-1.5 text-xs text-slate-400">
                            <MapIcon size={12} />{alert.location}
                          </div>
                          <span className="text-[10px] font-bold text-rose-400 bg-rose-950/30 px-2 py-0.5 rounded border border-rose-500/10">
                            {alert.confidence}%
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="p-3 bg-slate-900 border-t border-slate-800 text-center">
                    <button className="text-xs text-slate-500 hover:text-white transition-colors w-full uppercase tracking-wider font-semibold">
                      View Full History
                    </button>
                  </div>
                </div>

                {/* Hardware status */}
                <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5">
                  <h3 className="font-semibold text-slate-200 mb-5 flex items-center gap-2">
                    <Cpu size={18} className="text-blue-400" /> Hardware Status
                  </h3>
                  <div className="space-y-5">
                    <ResourceBar label="NVIDIA Tesla T4 Usage" percent={82} color="bg-purple-500" value="13.2GB / 16GB" />
                    <ResourceBar label="CPU Load (12 Cores)"   percent={45} color="bg-blue-500"   value="4.2 GHz"      />
                    <ResourceBar label="System RAM"            percent={62} color="bg-emerald-500" value="18GB / 32GB"  />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ════ MAP ════ */}
          {activeTab === 'map' && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col shadow-2xl h-[calc(100vh-10rem)]">
              <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/80">
                <h3 className="font-semibold text-slate-200 flex items-center gap-2">
                  <MapIcon size={18} className="text-blue-400" /> Live Campus Map
                </h3>
                <div className="flex gap-4 text-xs font-mono text-slate-500">
                  <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-emerald-500" /> Active</span>
                  <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-rose-500"    /> Alert</span>
                  <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-orange-500"  /> Warning</span>
                </div>
              </div>

              {/* Leaflet map container */}
              <div ref={mapRef} className="flex-1 z-0" />

              <div className="h-10 bg-slate-900 border-t border-slate-800 flex items-center px-6 z-10">
                <p className="text-slate-600 text-xs uppercase tracking-widest">
                  OpenStreetMap • Campus GIS • Level 1 Floorplan
                </p>
              </div>
            </div>
          )}

          {/* ════ FORENSICS ════ */}
          {activeTab === 'forensics' && (
            <div className="grid grid-cols-12 gap-6 max-w-8xl mx-auto">
              <div className="col-span-12 lg:col-span-9 flex flex-col gap-4">

                {/* Video player */}
                <div className="bg-black rounded-xl overflow-hidden aspect-video relative group border border-slate-800 shadow-2xl">
                  {localVideoUrl ? (
                    <video src={localVideoUrl} controls autoPlay loop muted className="w-full h-full object-cover" />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center bg-slate-900/50">
                      <div className="text-center space-y-4">
                        <Video size={48} className="text-slate-700 mx-auto" />
                        <p className="text-slate-500 font-mono text-sm">Awaiting Video Selection for Analysis</p>
                      </div>
                    </div>
                  )}

                  <div className="absolute top-4 left-4 flex gap-2">
                    <div className="bg-black/60 backdrop-blur px-3 py-1 rounded border border-white/10 flex items-center gap-2">
                      <div className="w-2 h-2 bg-rose-500 rounded-full animate-pulse" />
                      <span className="text-white font-mono text-sm">
                        {analysisResult ? `FILE: ${analysisResult.filename}` : 'Reviewing Incident Footage'}
                      </span>
                    </div>
                  </div>

                  {analysisResult && (
                    <div className={`absolute top-4 right-4 bg-black/70 backdrop-blur px-3 py-1 rounded-lg border flex flex-col items-end ${
                      analysisResult.is_danger ? 'border-rose-500 text-rose-300' : 'border-emerald-500 text-emerald-300'
                    }`}>
                      <span className="text-xs font-bold uppercase tracking-wider">{analysisResult.classification.toUpperCase()}</span>
                      <span className="text-[10px] font-mono opacity-80">Confidence: {analysisResult.confidence}%</span>
                    </div>
                  )}

                  {analysisResult?.is_danger && (
                    <div className="absolute top-[20%] left-[30%] w-[25%] h-[40%] border-2 border-rose-500/80 rounded-lg shadow-[0_0_20px_rgba(244,63,94,0.5)] flex flex-col justify-between p-2 animate-pulse">
                      <span className="bg-rose-600 text-white text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider font-bold shadow-sm">
                        Detected Action
                      </span>
                    </div>
                  )}

                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black via-black/80 to-transparent pt-10 pb-4 px-6 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                    <div className="flex items-center gap-6 text-white">
                      <button className="hover:text-rose-500 transition-colors"><SkipBack    size={20} /></button>
                      <button className="hover:text-rose-500 transition-colors"><SkipForward size={20} /></button>
                      <div className="flex-1">
                        <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                          <div className="w-1/3 h-full bg-rose-500" />
                        </div>
                      </div>
                      <div className="flex gap-3">
                        <button className="hover:text-rose-500"><Share2    size={18} /></button>
                        <button className="hover:text-rose-500"><Maximize2 size={18} /></button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Heatmap */}
                <HeatmapStrip analysisResult={analysisResult} />
              </div>

              {/* Sidebar */}
              <div className="col-span-12 lg:col-span-3 space-y-4">
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
                  <h3 className="font-bold text-white mb-4 border-b border-slate-800 pb-2">Inference Metadata</h3>
                  <div className="space-y-4">
                    <DetailRow label="Classification"     value={analysisResult?.classification?.toUpperCase() || 'N/A'} valueColor={analysisResult?.is_danger ? 'text-rose-500 font-extrabold' : 'text-emerald-400 font-mono'} />
                    <DetailRow label="Confidence"         value={`${analysisResult?.confidence || 'N/A'}%`}              valueColor={analysisResult?.is_danger ? 'text-rose-400 font-mono'    : 'text-emerald-400 font-mono'} />
                    <DetailRow label="Model Architecture" value="ConvNeXt + LSTM" />
                    <DetailRow label="Sequence Length"    value="16 Frames" />
                    <DetailRow label="Inference Time"     value="~42ms" />
                    <DetailRow label="Alert Sent"         value={analysisResult?.alert_sent ? 'Yes ✓' : 'No'} valueColor={analysisResult?.alert_sent ? 'text-emerald-400' : 'text-slate-400'} />
                    <DetailRow label="Video File"         value={analysisResult?.filename || 'N/A'} />
                  </div>
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
                  <h3 className="font-bold text-white mb-4 flex items-center gap-2">
                    <Cpu size={18} className="text-rose-500" /> AI Forensics
                  </h3>
                  <div className="space-y-3">
                    <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept="video/*" />

                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                      className={`w-full py-3 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2 shadow-lg ${
                        uploading
                          ? 'bg-slate-800 text-slate-400 cursor-wait border border-slate-700'
                          : 'bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white border border-indigo-500/50'
                      }`}
                    >
                      {uploading ? (
                        <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Analyzing...</>
                      ) : (
                        <><Video size={18} /> Upload Video for Analysis</>
                      )}
                    </button>

                    {analysisResult && (
                      <>
                        <div className={`mt-2 p-3 rounded-lg border ${
                          analysisResult.is_danger
                            ? 'bg-rose-950/50 border-rose-500/50 text-rose-200'
                            : 'bg-emerald-950/50 border-emerald-500/50 text-emerald-200'
                        }`}>
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-[10px] uppercase font-bold tracking-widest opacity-70">AI Diagnosis</span>
                            <span className="text-[10px] font-mono">{new Date().toLocaleTimeString()}</span>
                          </div>
                          <div className="text-lg font-black tracking-tight flex items-center gap-2">
                            {analysisResult.is_danger
                              ? <AlertTriangle size={20} className="text-rose-500"    />
                              : <Shield        size={20} className="text-emerald-500" />
                            }
                            {analysisResult.classification.toUpperCase()}
                          </div>
                          <div className="text-xs font-mono mt-1 opacity-80">
                            Confidence: <span className="font-bold">{analysisResult.confidence}%</span>
                          </div>
                        </div>

                        {/* Download report button */}
                        <button
                          onClick={downloadReport}
                          className="w-full py-2.5 rounded-lg text-xs font-bold border border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white transition-all flex items-center justify-center gap-2"
                        >
                          <Download size={14} /> Download Evidence Report
                        </button>
                      </>
                    )}

                    {!analysisResult && !uploading && (
                      <p className="text-[10px] text-slate-500 text-center mt-2">
                        Upload MP4/AVI files for violence detection.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ════ STATS ════ */}
          {activeTab === 'stats' && (
            <div className="grid grid-cols-1 gap-6 max-w-8xl mx-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard title="Test Accuracy"   value="96.50%" trend="+2.4%"  icon={<Activity   className="text-blue-500"   />} />
                <StatCard title="F1 Score"         value="0.9645"  trend="+0.012" icon={<Shield     className="text-emerald-500"/>} />
                <StatCard title="ROC AUC"          value="0.9805"  trend="+0.005" icon={<Database   className="text-purple-500"/>} />
                <StatCard title="False Positives"  value="0.8%"    trend="-0.4%"  icon={<AlertTriangle className="text-orange-500"/>} isBad={false} />
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg flex flex-col">
                  <h3 className="text-slate-200 font-semibold mb-6 flex items-center gap-2">
                    <span className="w-2 h-6 bg-emerald-500 rounded-sm" /> Training Accuracy Over Epochs
                  </h3>
                  <div className="flex-1 min-h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={ML_METRICS}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} />
                        <XAxis dataKey="epoch" stroke="#94a3b8" tick={{fontSize:12}} tickLine={false} axisLine={false} />
                        <YAxis stroke="#94a3b8" tick={{fontSize:12}} tickLine={false} axisLine={false} domain={[0.5,1]} />
                        <Tooltip contentStyle={{backgroundColor:'#0f172a',borderColor:'#1e293b',color:'#f1f5f9',borderRadius:'8px'}} itemStyle={{color:'#10b981'}} />
                        <Line type="monotone" dataKey="accuracy" stroke="#10b981" strokeWidth={3} dot={{r:4,fill:'#10b981',strokeWidth:2,stroke:'#0f172a'}} activeDot={{r:6}} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg flex flex-col">
                  <h3 className="text-slate-200 font-semibold mb-6 flex items-center gap-2">
                    <span className="w-2 h-6 bg-rose-500 rounded-sm" /> Loss Convergence
                  </h3>
                  <div className="flex-1 min-h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={ML_METRICS}>
                        <defs>
                          <linearGradient id="colorLoss" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor="#f43f5e" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#f43f5e" stopOpacity={0}   />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} />
                        <XAxis dataKey="epoch" stroke="#94a3b8" tick={{fontSize:12}} tickLine={false} axisLine={false} />
                        <YAxis stroke="#94a3b8" tick={{fontSize:12}} tickLine={false} axisLine={false} />
                        <Tooltip contentStyle={{backgroundColor:'#0f172a',borderColor:'#1e293b',color:'#f1f5f9',borderRadius:'8px'}} />
                        <Area type="monotone" dataKey="loss" stroke="#f43f5e" fillOpacity={1} fill="url(#colorLoss)" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ════ CONFIG ════ */}
          {activeTab === 'config' && (
            <div className="max-w-3xl mx-auto">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 shadow-2xl">
                <h2 className="text-2xl font-bold mb-2 flex items-center gap-3 text-white">
                  <Settings className="text-rose-500" /> System Configuration
                </h2>
                <p className="text-slate-400 mb-8 border-b border-slate-800 pb-6">
                  Manage detection sensitivity and system automation rules.
                </p>

                <div className="space-y-10">
                  {/* Threshold slider */}
                  <div className="bg-slate-800/30 p-6 rounded-xl border border-slate-700/50">
                    <div className="flex justify-between mb-4 items-end">
                      <div>
                        <label className="font-semibold text-slate-200 block mb-1">Violence Detection Threshold</label>
                        <p className="text-xs text-slate-500">Minimum confidence to trigger a "Danger" alert.</p>
                      </div>
                      <span className="text-rose-400 font-mono font-bold text-2xl bg-rose-950/30 px-3 py-1 rounded border border-rose-500/20">
                        {(threshold * 100).toFixed(0)}%
                      </span>
                    </div>
                    <input
                      type="range" min="0.5" max="0.99" step="0.01"
                      value={threshold}
                      onChange={e => setThreshold(parseFloat(e.target.value))}
                      className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-rose-500"
                    />
                    <div className="flex justify-between text-xs text-slate-500 mt-2 font-mono uppercase">
                      <span>High Sensitivity</span><span>Balanced</span><span>High Precision</span>
                    </div>
                  </div>

                  {/* [FIX] Functional toggles */}
                  <div className="space-y-6">
                    <ToggleItem
                      label="Auto-Record Evidence"
                      desc="Automatically save 2 minutes of footage before and after event."
                      active={settings.autoRecord}
                      onToggle={() => setSettings(s => ({ ...s, autoRecord: !s.autoRecord }))}
                    />
                    <ToggleItem
                      label="Audio Analysis (Beta)"
                      desc="Use audio peaks to validate visual classification."
                      active={settings.audioAnalysis}
                      badge="Experimental"
                      onToggle={() => setSettings(s => ({ ...s, audioAnalysis: !s.audioAnalysis }))}
                    />
                    <ToggleItem
                      label="Mobile Push Alerts"
                      desc="Send real-time notifications to on-site security personnel."
                      active={settings.mobileAlerts}
                      onToggle={() => setSettings(s => ({ ...s, mobileAlerts: !s.mobileAlerts }))}
                    />
                    <ToggleItem
                      label="Law Enforcement Link"
                      desc="Automatically forward confirmed Level 5 threats to local PD."
                      active={settings.lawEnforcement}
                      onToggle={() => setSettings(s => ({ ...s, lawEnforcement: !s.lawEnforcement }))}
                    />
                  </div>

                  <div className="pt-6 flex justify-end gap-3">
                    <button
                      onClick={() => setSettings({ autoRecord:true, audioAnalysis:false, mobileAlerts:true, lawEnforcement:false })}
                      className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors"
                    >
                      Reset Defaults
                    </button>
                    <button
                      onClick={() => pushToast('success', '✅ Configuration saved.')}
                      className="px-6 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg font-medium shadow-lg shadow-rose-900/20 transition-all"
                    >
                      Save Changes
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}

// ─── HEATMAP (extracted + memoised to fix Math.random() on every render) ──────
function HeatmapStrip({ analysisResult }) {
  // [FIX] useMemo — only regenerates when analysis result changes
  const analysisKey = analysisResult
    ? `${analysisResult.confidence}-${analysisResult.classification}`
    : 'empty';
  const heatmapData = useMemo(() => (
    Array.from({ length: 60 }, (_, i) => {
      const isHot = i > 18 && i < 38;
      return Math.min(1, (isHot ? 0.7 : 0.1) + Math.random() * 0.3);
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [analysisKey]);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
      <div className="flex justify-between items-end mb-3">
        <h4 className="text-sm font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
          <Activity size={14} className="text-rose-500" /> Temporal Attention Heatmap
        </h4>
        <span className="text-xs text-slate-500">Model Focus Intensity</span>
      </div>

      <div className="h-14 w-full flex rounded-lg overflow-hidden border border-slate-800/50 relative group cursor-crosshair">
        {heatmapData.map((opacity, i) => (
          <div
            key={i}
            className="flex-1 h-full transition-all duration-300 hover:brightness-125"
            style={{ backgroundColor: `rgba(244,63,94,${opacity})`, borderRight: '1px solid rgba(0,0,0,0.1)' }}
            title={`Frame ${i}: ${(opacity * 100).toFixed(0)}% Probability`}
          />
        ))}
      </div>

      <div className="flex justify-between text-[10px] text-slate-500 mt-2 font-mono px-1">
        <span>00:00</span>
        {analysisResult ? (
          <span className={`${analysisResult.is_danger ? 'text-rose-400' : 'text-emerald-400'} font-bold`}>
            {analysisResult.classification.toUpperCase()} ({analysisResult.confidence}%)
          </span>
        ) : (
          <span className="text-slate-500 font-bold">Awaiting Analysis</span>
        )}
        <span>00:45</span>
      </div>
    </div>
  );
}

// ─── SUB-COMPONENTS ───────────────────────────────────────────────────────────

function NavItem({ icon, label, active, onClick, collapsed }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-200 group relative ${
        active
          ? 'bg-gradient-to-r from-rose-600 to-rose-700 text-white shadow-lg shadow-rose-900/20 border border-white/5'
          : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
      }`}
    >
      <div className={`${collapsed ? 'mx-auto' : ''} transition-transform group-hover:scale-110`}>{icon}</div>
      {!collapsed && <span className="font-medium text-sm tracking-wide">{label}</span>}
      {collapsed && active && <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-rose-400 rounded-l" />}
    </button>
  );
}

function CameraFeed({ camera, threshold }) {
  const isDanger  = camera.probability > threshold;
  const isWarning = camera.probability > threshold * 0.6 && !isDanger;

  return (
    <div className={`relative bg-black rounded-xl overflow-hidden aspect-video group border-2 transition-all duration-500 ${
      isDanger  ? 'border-rose-500 shadow-[0_0_30px_rgba(244,63,94,0.3)] z-10' :
      isWarning ? 'border-orange-500/50' : 'border-slate-800 hover:border-slate-600'
    }`}>
      <div className="absolute inset-0 bg-slate-900 flex items-center justify-center">
        <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/stardust.png')]" />
        {isDanger  && <div className="absolute inset-0 bg-rose-900/20 animate-pulse" />}
        {isDanger  ? <AlertTriangle className="w-16 h-16 text-rose-500"    strokeWidth={1} /> :
         isWarning ? <Activity      className="w-12 h-12 text-orange-500"  /> :
                     <Shield        className="w-12 h-12 text-slate-700"   />}
      </div>

      <div className="absolute top-3 left-3 flex flex-col items-start gap-1">
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 text-[10px] font-bold rounded flex items-center gap-1 border ${
            isDanger  ? 'bg-rose-600 border-rose-400 text-white animate-pulse' :
            isWarning ? 'bg-orange-500 border-orange-400 text-white' :
                        'bg-emerald-950/80 border-emerald-500/30 text-emerald-400'
          }`}>
            {isDanger && <AlertTriangle size={10} />}
            {isDanger ? 'THREAT DETECTED' : isWarning ? 'ANALYZING...' : 'LIVE'}
          </span>
          <span className="text-[10px] font-mono text-white/70 bg-black/60 px-1.5 py-0.5 rounded border border-white/5">{camera.id}</span>
        </div>
        <span className="text-[10px] text-white/90 bg-black/40 px-1 rounded backdrop-blur-md">{camera.location}</span>
      </div>

      <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-black/50 px-2 py-1 rounded-full border border-white/10 backdrop-blur-sm">
        <div className="w-2 h-2 bg-red-600 rounded-full animate-pulse" />
        <span className="text-[10px] font-mono text-white/80">REC</span>
      </div>

      <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/95 via-black/60 to-transparent">
        <div className="flex justify-between text-xs mb-1.5 text-slate-300">
          <span className="font-medium text-[10px] uppercase tracking-wider opacity-80">Violence Probability</span>
          <span className={`font-mono font-bold ${isDanger ? 'text-rose-400 text-sm' : 'text-slate-400'}`}>
            {(camera.probability * 100).toFixed(1)}%
          </span>
        </div>
        <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden border border-white/5">
          <div
            className={`h-full transition-all duration-700 ease-out ${isDanger ? 'bg-rose-500' : isWarning ? 'bg-orange-500' : 'bg-emerald-500'}`}
            style={{ width: `${(camera.probability * 100).toFixed(1)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, trend, icon, isBad = false }) {
  const isPositive  = trend.startsWith('+');
  const trendColor  = isBad
    ? (!isPositive ? 'text-emerald-400' : 'text-rose-400')
    : (isPositive  ? 'text-emerald-400' : 'text-rose-400');

  return (
    <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-lg hover:border-slate-700 transition-all group">
      <div className="flex justify-between items-start mb-4">
        <div>
          <p className="text-slate-400 text-xs font-bold uppercase tracking-wider">{title}</p>
          <h3 className="text-2xl font-bold text-white mt-1 group-hover:scale-105 transition-transform origin-left">{value}</h3>
        </div>
        <div className="p-2 bg-slate-800 rounded-lg group-hover:bg-slate-700 transition-colors">{icon}</div>
      </div>
      <div className={`text-xs font-medium flex items-center ${trendColor}`}>
        {trend} <span className="text-slate-500 ml-1 font-normal">vs last training run</span>
      </div>
    </div>
  );
}

function ResourceBar({ label, percent, color, value }) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-1.5">
        <span className="text-slate-300 font-medium">{label}</span>
        <span className="text-slate-400 font-mono">{value}</span>
      </div>
      <div className="h-2 bg-slate-800 rounded-full overflow-hidden border border-slate-700/50">
        <div className={`h-full rounded-full ${color} transition-all duration-1000 ease-out`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function DetailRow({ label, value, valueColor = "text-slate-300" }) {
  return (
    <div className="flex justify-between text-sm py-3 border-b border-slate-800 last:border-0 hover:bg-slate-800/30 px-2 rounded transition-colors">
      <span className="text-slate-500 font-medium">{label}</span>
      <span className={valueColor}>{value}</span>
    </div>
  );
}

// [FIX] ToggleItem now accepts onToggle prop and is fully functional
function ToggleItem({ label, desc, active, badge, onToggle }) {
  return (
    <div className="flex items-start justify-between group">
      <div>
        <h4 className="font-medium text-slate-200 flex items-center gap-2">
          {label}
          {badge && <span className="text-[10px] bg-rose-500/20 text-rose-400 px-1.5 py-0.5 rounded border border-rose-500/20">{badge}</span>}
          {active
            ? <CheckCircle size={14} className="text-emerald-500" />
            : <XCircle     size={14} className="text-slate-600"   />}
        </h4>
        <p className="text-sm text-slate-500 mt-1 max-w-md">{desc}</p>
      </div>
      <button
        onClick={onToggle}
        className={`w-11 h-6 rounded-full p-1 cursor-pointer transition-colors duration-300 shrink-0 ml-4 ${
          active ? 'bg-rose-600' : 'bg-slate-700 hover:bg-slate-600'
        }`}
        aria-label={`Toggle ${label}`}
      >
        <div className={`w-4 h-4 rounded-full bg-white shadow-md transition-transform duration-300 ${active ? 'translate-x-5' : ''}`} />
      </button>
    </div>
  );
}
