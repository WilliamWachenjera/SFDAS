
    // -------------------------------------------------------
    // CONFIG
    // -------------------------------------------------------
    const API_BASE = window.location.hostname === 'localhost'
      ? 'http://localhost:5000/api'
      : '/api';

    // -------------------------------------------------------
    // STATE
    // -------------------------------------------------------
    let authToken = localStorage.getItem('sfdaass_token') || null;
    let currentUser = JSON.parse(localStorage.getItem('sfdaass_user') || 'null');
    let socket = null;
    let smokeChart = null, tempChart = null;
    let map1 = null, map2 = null, map3 = null, map4 = null;
    let map2Init = false, map3Init = false, map4Init = false;
    let geoCircle = null, geoLayer = null;
    let polyPoints = [], polyMarkers = [], polyLine = null;
    let devicesData = [], incidentsData = [];
    let uptimeSecs = 0;
    let activeIncidentCount = 0;

    // -------------------------------------------------------
    // INIT
    // -------------------------------------------------------
    document.addEventListener('DOMContentLoaded', () => {
      startClock();
      if (authToken && currentUser) {
        showApp();
      } else {
        document.getElementById('login-screen').style.display = 'flex';
      }
      // Allow Enter key for login
      ['loginEmail', 'loginPassword'].forEach(id => {
        document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
      });
    });

    // -------------------------------------------------------
    // CLOCK
    // -------------------------------------------------------
    function startClock() {
      setInterval(() => {
        document.getElementById('clock').textContent = new Date().toLocaleTimeString('en-GB');
        uptimeSecs++;
        const h = String(Math.floor(uptimeSecs / 3600)).padStart(2, '0');
        const m = String(Math.floor((uptimeSecs % 3600) / 60)).padStart(2, '0');
        const s = String(uptimeSecs % 60).padStart(2, '0');
        document.getElementById('uptime').textContent = `${h}:${m}:${s}`;
      }, 1000);
    }

    // -------------------------------------------------------
    // AUTH
    // -------------------------------------------------------
    async function doLogin() {
      const email = document.getElementById('loginEmail').value.trim();
      const password = document.getElementById('loginPassword').value;
      const btn = document.getElementById('loginBtn');
      const errEl = document.getElementById('loginError');

      if (!email || !password) { showLoginError('Please enter email and password'); return; }

      btn.disabled = true;
      btn.textContent = 'Authenticating...';
      errEl.classList.remove('show');

      try {
        const res = await fetch(`${API_BASE}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json();

        if (data.success) {
          authToken = data.accessToken;
          currentUser = data.user;
          localStorage.setItem('sfdaass_token', authToken);
          localStorage.setItem('sfdaass_user', JSON.stringify(currentUser));
          localStorage.setItem('sfdaass_refresh', data.refreshToken || '');
          showApp();
        } else {
          showLoginError(data.message || 'Invalid credentials');
        }
      } catch (err) {
        // Demo mode when backend not available
        if (email === 'admin@sfdaass.io' && password === 'Admin@1234') {
          authToken = 'demo-token';
          currentUser = { id: 'demo', name: 'Admin Demo', email, role: 'admin' };
          localStorage.setItem('sfdaass_token', authToken);
          localStorage.setItem('sfdaass_user', JSON.stringify(currentUser));
          showApp();
          toast('? Running in DEMO mode — backend not connected', 'warn');
        } else {
          showLoginError('Cannot connect to server. Try demo: admin@sfdaass.io / Admin@1234');
        }
      } finally {
        btn.disabled = false;
        btn.textContent = 'ACCESS SYSTEM';
      }
    }

    function showLoginError(msg) {
      const el = document.getElementById('loginError');
      el.textContent = msg;
      el.classList.add('show');
    }

    async function doLogout() {
      try {
        if (authToken !== 'demo-token') {
          await apiFetch('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken: localStorage.getItem('sfdaass_refresh') }) });
        }
      } catch (e) { }
      authToken = null; currentUser = null;
      localStorage.removeItem('sfdaass_token');
      localStorage.removeItem('sfdaass_user');
      localStorage.removeItem('sfdaass_refresh');
      if (socket) { socket.disconnect(); socket = null; }
      document.getElementById('app').classList.remove('visible');
      document.getElementById('app').style.display = 'none';
      document.getElementById('login-screen').classList.remove('hidden');
      document.getElementById('login-screen').style.display = 'flex';
      document.getElementById('loginPassword').value = '';
    }

    // -------------------------------------------------------
    // SHOW APP
    // -------------------------------------------------------
    function showApp() {
      document.getElementById('login-screen').classList.add('hidden');
      document.getElementById('app').style.display = 'flex';
      document.getElementById('app').classList.add('visible');

      // Set user info
      const u = currentUser;
      document.getElementById('userName').textContent = u.name;
      document.getElementById('userRole').textContent = u.role.toUpperCase();
      const initials = u.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
      document.getElementById('userInitials').textContent = initials;

      // Show admin nav
      if (u.role === 'admin') {
        document.getElementById('adminNav').style.display = 'block';
        document.getElementById('registerDevBtn').style.display = 'flex';
      }

      // Init maps and data
      setTimeout(() => {
        initMap1();
        initCharts();
        connectSocket();
        loadDashboard();
        loadDevices();
        loadIncidents();
        loadGeofence();
        if (u.role === 'admin') loadUsers();
      }, 200);
    }

    // -------------------------------------------------------
    // API HELPER
    // -------------------------------------------------------
    async function apiFetch(path, options = {}) {
      const headers = {
        'Content-Type': 'application/json',
        ...(authToken && authToken !== 'demo-token' ? { Authorization: `Bearer ${authToken}` } : {}),
        ...(options.headers || {}),
      };
      const res = await fetch(API_BASE + path, { ...options, headers });

      if (res.status === 401) {
        // Try refresh
        const refreshed = await tryRefresh();
        if (refreshed) {
          headers.Authorization = `Bearer ${authToken}`;
          return fetch(API_BASE + path, { ...options, headers });
        }
        doLogout();
        throw new Error('Session expired');
      }
      return res;
    }

    async function tryRefresh() {
      const rt = localStorage.getItem('sfdaass_refresh');
      if (!rt) return false;
      try {
        const res = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: rt }),
        });
        const data = await res.json();
        if (data.success) {
          authToken = data.accessToken;
          localStorage.setItem('sfdaass_token', authToken);
          localStorage.setItem('sfdaass_refresh', data.refreshToken);
          return true;
        }
      } catch (e) { }
      return false;
    }

    // -------------------------------------------------------
    // SOCKET.IO
    // -------------------------------------------------------
    function connectSocket() {
      if (authToken === 'demo-token') {
        setConnStatus(false);
        startDemoSimulation();
        return;
      }

      try {
        socket = io(API_BASE.replace('/api', ''), {
          auth: { token: authToken },
          transports: ['websocket', 'polling'],
          reconnectionDelay: 2000,
        });

        socket.on('connect', () => {
          setConnStatus(true);
          toast('? Real-time connection established');
        });

        socket.on('disconnect', (reason) => {
          setConnStatus(false);
        });

        socket.on('connect_error', () => {
          setConnStatus(false);
          startDemoSimulation();
        });

        socket.on('init:state', ({ activeIncidents, devices, sprinklerZones }) => {
          updateAlertCount(activeIncidents.length);
          renderAlerts(activeIncidents);
          renderZones(sprinklerZones);
          devicesData = devices;
          renderDevicesTable(devices);
          updateDeviceStats(devices);
        });

        socket.on('sensor:reading', (data) => {
          updateSensorTiles(data);
          updateDeviceOnMap(data);
        });

        socket.on('incident:created', (inc) => {
          activeIncidentCount++;
          updateAlertCount(activeIncidentCount);
          document.getElementById('fire-overlay').classList.add('active');
          setTimeout(() => document.getElementById('fire-overlay').classList.remove('active'), 8000);
          toast(`?? FIRE DETECTED: ${inc.incident_code} — ${inc.locationLabel}`, 'error');
          loadDashboard();
          loadIncidents();
        });

        socket.on('incident:resolved', () => { loadDashboard(); loadIncidents(); });
        socket.on('sprinkler:activated', ({ zone }) => { toast(`?? Sprinkler ${zone} activated`); loadDashboard(); });
        socket.on('sprinkler:deactivated', ({ zone }) => { toast(`? Sprinkler ${zone} deactivated`); loadDashboard(); });
        socket.on('geofence:updated', () => { loadGeofence(); });
        socket.on('device:status', ({ deviceCode, status }) => {
          toast(`?? ${deviceCode}: ${status.toUpperCase()}`);
          loadDevices();
        });
        socket.on('system:heartbeat', ({ connectedClients }) => {
          // silent
        });

      } catch (e) {
        setConnStatus(false);
        startDemoSimulation();
      }
    }

    function setConnStatus(connected) {
      const dot = document.getElementById('wsConnDot');
      const label = document.getElementById('wsConnLabel');
      if (connected) {
        dot.className = 'conn-dot';
        label.textContent = 'Live';
      } else {
        dot.className = 'conn-dot disconnected';
        label.textContent = 'Demo Mode';
      }
    }

    // -------------------------------------------------------
    // DEMO SIMULATION (when backend is offline)
    // -------------------------------------------------------
    const DEMO_DEVICES = [
      { device_code: 'DEV-001', location_label: 'Block A, Floor 1', status: 'online', smoke_ppm: 120, temperature_c: 28, gas_ppm: 95, humidity_pct: 45, flame_detected: false, gps_lat: -13.960, gps_lng: 33.775, inside_geofence: true, battery_pct: 87, rssi: -62, seconds_since_seen: 12 },
      { device_code: 'DEV-002', location_label: 'Block A, Floor 2', status: 'online', smoke_ppm: 95, temperature_c: 30, gas_ppm: 80, humidity_pct: 43, flame_detected: false, gps_lat: -13.961, gps_lng: 33.774, inside_geofence: true, battery_pct: 92, rssi: -58, seconds_since_seen: 8 },
      { device_code: 'DEV-003', location_label: 'Warehouse B, Sec 2', status: 'online', smoke_ppm: 620, temperature_c: 89, gas_ppm: 400, humidity_pct: 38, flame_detected: true, gps_lat: -13.962, gps_lng: 33.778, inside_geofence: true, battery_pct: 75, rssi: -71, seconds_since_seen: 3 },
      { device_code: 'DEV-004', location_label: 'Parking Lot', status: 'offline', smoke_ppm: 45, temperature_c: 27, gas_ppm: 30, humidity_pct: 52, flame_detected: false, gps_lat: -13.968, gps_lng: 33.765, inside_geofence: false, battery_pct: 12, rssi: null, seconds_since_seen: 340 },
      { device_code: 'DEV-005', location_label: 'Block C, Lab', status: 'online', smoke_ppm: 80, temperature_c: 35, gas_ppm: 110, humidity_pct: 41, flame_detected: false, gps_lat: -13.967, gps_lng: 33.769, inside_geofence: true, battery_pct: 88, rssi: -65, seconds_since_seen: 5 },
      { device_code: 'DEV-006', location_label: 'Main Gate', status: 'offline', smoke_ppm: 30, temperature_c: 26, gas_ppm: 25, humidity_pct: 55, flame_detected: false, gps_lat: -13.970, gps_lng: 33.760, inside_geofence: false, battery_pct: 0, rssi: null, seconds_since_seen: 820 },
      { device_code: 'DEV-007', location_label: 'Building 3, Zone A', status: 'online', smoke_ppm: 850, temperature_c: 142, gas_ppm: 580, humidity_pct: 28, flame_detected: true, gps_lat: -13.958, gps_lng: 33.770, inside_geofence: true, battery_pct: 81, rssi: -69, seconds_since_seen: 2 },
      { device_code: 'DEV-008', location_label: 'Cafeteria', status: 'online', smoke_ppm: 110, temperature_c: 33, gas_ppm: 90, humidity_pct: 48, flame_detected: false, gps_lat: -13.964, gps_lng: 33.773, inside_geofence: true, battery_pct: 95, rssi: -54, seconds_since_seen: 9 },
      { device_code: 'DEV-009', location_label: 'Admin Block', status: 'online', smoke_ppm: 90, temperature_c: 29, gas_ppm: 75, humidity_pct: 44, flame_detected: false, gps_lat: -13.963, gps_lng: 33.781, inside_geofence: true, battery_pct: 89, rssi: -60, seconds_since_seen: 14 },
      { device_code: 'DEV-010', location_label: 'Server Room', status: 'warning', smoke_ppm: 280, temperature_c: 58, gas_ppm: 210, humidity_pct: 36, flame_detected: false, gps_lat: -13.959, gps_lng: 33.776, inside_geofence: true, battery_pct: 70, rssi: -74, seconds_since_seen: 22 },
      { device_code: 'DEV-011', location_label: 'Lab Room 4', status: 'online', smoke_ppm: 320, temperature_c: 67, gas_ppm: 290, humidity_pct: 40, flame_detected: false, gps_lat: -13.965, gps_lng: 33.772, inside_geofence: true, battery_pct: 82, rssi: -66, seconds_since_seen: 7 },
      { device_code: 'DEV-012', location_label: 'Storage C', status: 'online', smoke_ppm: 75, temperature_c: 28, gas_ppm: 60, humidity_pct: 50, flame_detected: false, gps_lat: -13.966, gps_lng: 33.777, inside_geofence: true, battery_pct: 93, rssi: -56, seconds_since_seen: 11 },
    ];
    const DEMO_INCIDENTS = [
      { id: 'i1', incident_code: 'INC-2025-047', detected_at: '2025-07-12T02:14:33Z', device_code: 'DEV-007', location_label: 'Building 3, Zone A', severity: 'critical', sprinkler_activated: true, status: 'active', smoke_ppm: 850, temperature_c: 142, gps_lat: -13.958, gps_lng: 33.770, inside_geofence: true },
      { id: 'i2', incident_code: 'INC-2025-046', detected_at: '2025-07-12T08:41:02Z', device_code: 'DEV-003', location_label: 'Warehouse B, Sec 2', severity: 'critical', sprinkler_activated: true, status: 'active', smoke_ppm: 620, temperature_c: 89, gps_lat: -13.962, gps_lng: 33.778, inside_geofence: true },
      { id: 'i3', incident_code: 'INC-2025-045', detected_at: '2025-07-11T16:23:11Z', device_code: 'DEV-011', location_label: 'Lab Room 4', severity: 'warning', sprinkler_activated: false, status: 'monitoring', smoke_ppm: 320, temperature_c: 67, gps_lat: -13.965, gps_lng: 33.772, inside_geofence: true },
      { id: 'i4', incident_code: 'INC-2025-044', detected_at: '2025-07-10T09:05:44Z', device_code: 'DEV-002', location_label: 'Block A, Floor 2', severity: 'critical', sprinkler_activated: true, status: 'resolved', smoke_ppm: 710, temperature_c: 118, gps_lat: -13.961, gps_lng: 33.774, inside_geofence: true },
      { id: 'i5', incident_code: 'INC-2025-043', detected_at: '2025-07-09T14:37:28Z', device_code: 'DEV-008', location_label: 'Cafeteria', severity: 'warning', sprinkler_activated: false, status: 'resolved', smoke_ppm: 410, temperature_c: 74, gps_lat: -13.964, gps_lng: 33.773, inside_geofence: true },
      { id: 'i6', incident_code: 'INC-2025-042', detected_at: '2025-07-08T07:12:05Z', device_code: 'DEV-005', location_label: 'Block C, Lab', severity: 'low', sprinkler_activated: false, status: 'resolved', smoke_ppm: 310, temperature_c: 61, gps_lat: -13.967, gps_lng: 33.769, inside_geofence: true },
    ];
    const DEMO_ZONES = [
      { zone_code: 'ZONE-A', name: 'Zone A — Building 3', status: 'active' },
      { zone_code: 'ZONE-B', name: 'Zone B — Warehouse', status: 'standby' },
      { zone_code: 'ZONE-C', name: 'Zone C — Lab Block', status: 'active' },
      { zone_code: 'ZONE-D', name: 'Zone D — Admin', status: 'standby' },
    ];

    function startDemoSimulation() {
      devicesData = DEMO_DEVICES;
      incidentsData = DEMO_INCIDENTS;
      renderAlerts(DEMO_INCIDENTS.filter(i => i.status !== 'resolved'));
      renderZones(DEMO_ZONES);
      updateAlertCount(2);
      renderDevicesTable(DEMO_DEVICES);
      updateDeviceStats(DEMO_DEVICES);
      renderIncidentsTable(DEMO_INCIDENTS);
      updateIncidentStats();
      updateDashboardStats();
      addDemoDevicesToMap();
      addIncidentMarkersToMap();

      // Jitter sensor tiles
      setInterval(() => {
        const d = DEMO_DEVICES.find(d => d.flame_detected) || DEMO_DEVICES[2];
        updateSensorTiles({
          smoke_ppm: d.smoke_ppm + Math.round((Math.random() - .5) * 40),
          temperature_c: d.temperature_c + Math.round((Math.random() - .5) * 8),
          gas_ppm: d.gas_ppm + Math.round((Math.random() - .5) * 30),
          humidity_pct: d.humidity_pct + Math.round((Math.random() - .5) * 3),
        });
      }, 3000);

      loadChartData();
    }

    // -------------------------------------------------------
    // DASHBOARD
    // -------------------------------------------------------
    async function loadDashboard() {
      if (authToken === 'demo-token') { updateDashboardStats(); loadChartData(); return; }
      try {
        const res = await apiFetch('/dashboard/stats');
        const data = await res.json();
        if (!data.success) return;

        const { incidents, devices, sprinklerZones, activeIncidents, recentReadings } = data;

        document.getElementById('stat-active').textContent = incidents.active_count || 0;
        document.getElementById('stat-active-sub').textContent = `${incidents.today || 0} today`;
        document.getElementById('stat-online').textContent = devices.online || 0;
        document.getElementById('stat-online-sub').textContent = `${devices.total || 0} total / ${devices.offline || 0} offline`;
        const activeSpr = sprinklerZones.filter(z => z.status === 'active').length;
        document.getElementById('stat-sprinklers').textContent = activeSpr;
        document.getElementById('stat-spr-sub').textContent = sprinklerZones.filter(z => z.status === 'active').map(z => z.zone_code).join(', ') || 'None';
        document.getElementById('stat-total').textContent = incidents.total || 0;
        document.getElementById('stat-total-sub').textContent = `This month: ${incidents.this_month || 0}`;

        updateAlertCount(parseInt(incidents.active_count) || 0);
        renderAlerts(activeIncidents);
        renderZones(sprinklerZones);

        if (recentReadings && recentReadings.length > 0) {
          updateSensorTiles(recentReadings[0]);
        }

        loadChartData();
      } catch (e) {
        updateDashboardStats();
        loadChartData();
      }
    }

    function updateDashboardStats() {
      const active = DEMO_INCIDENTS.filter(i => i.status === 'active').length;
      const online = DEMO_DEVICES.filter(d => d.status === 'online').length;
      const activeSpr = DEMO_ZONES.filter(z => z.status === 'active').length;
      document.getElementById('stat-active').textContent = active;
      document.getElementById('stat-active-sub').textContent = `${active} today`;
      document.getElementById('stat-online').textContent = online;
      document.getElementById('stat-online-sub').textContent = `${DEMO_DEVICES.length} total / ${DEMO_DEVICES.filter(d => d.status === 'offline').length} offline`;
      document.getElementById('stat-sprinklers').textContent = activeSpr;
      document.getElementById('stat-spr-sub').textContent = DEMO_ZONES.filter(z => z.status === 'active').map(z => z.zone_code).join(', ');
      document.getElementById('stat-total').textContent = DEMO_INCIDENTS.length;
      document.getElementById('stat-total-sub').textContent = 'This month: 8';
      updateAlertCount(active);
    }

    function renderAlerts(incidents) {
      const el = document.getElementById('alertList');
      if (!incidents || incidents.length === 0) {
        el.innerHTML = '<div style="color:var(--accent-green);font-size:13px;padding:8px 0">? No active alerts</div>';
        return;
      }
      el.innerHTML = incidents.slice(0, 5).map(i => {
        const dotCls = i.severity === 'critical' ? 'critical' : i.severity === 'warning' ? 'warning' : 'low';
        const sevBadge = `<span class="sev sev-${i.severity}">${i.severity.toUpperCase()}</span>`;
        const dt = new Date(i.detected_at);
        const timeStr = dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        return `<div class="alert-item" onclick="openIncidentModal('${i.id || i.incident_code}')">
      <div class="alert-dot ${dotCls}"></div>
      <div style="flex:1">
        <div class="alert-title">${i.severity === 'critical' ? 'FIRE DETECTED' : 'ALERT'} — ${i.location_label || i.locationLabel}</div>
        <div class="alert-meta">${i.device_code || i.deviceCode} &nbsp;|&nbsp; Smoke:${i.smoke_ppm}ppm Temp:${i.temperature_c}°C &nbsp;|&nbsp; ${sevBadge}</div>
      </div>
      <div class="alert-time">${timeStr}</div>
    </div>`;
      }).join('');
    }

    function renderZones(zones) {
      if (!zones || zones.length === 0) return;
      document.getElementById('zoneGrid').innerHTML = zones.map(z => {
        const active = z.status === 'active';
        const color = active ? 'var(--accent-fire)' : 'var(--accent-green)';
        const btnClass = active ? 'off' : 'on';
        const btnLabel = active ? 'Deactivate' : 'Activate';
        return `<div class="zone-tile">
      <div class="zl">${z.zone_code}</div>
      <div class="zs" style="color:${color}">${active ? 'ACTIVE' : 'STANDBY'}</div>
      <button class="${btnClass}" onclick="toggleZone('${z.zone_code}',this)">${btnLabel}</button>
    </div>`;
      }).join('');
    }

    function updateAlertCount(n) {
      activeIncidentCount = n;
      document.getElementById('alert-badge').textContent = n;
      document.getElementById('topbarAlertPill').textContent = n > 0 ? `? ${n} ACTIVE ALERT${n > 1 ? 'S' : ''}` : '? ALL CLEAR';
    }

    function updateSensorTiles(data) {
      const { smoke_ppm, temperature_c, gas_ppm, humidity_pct } = data;
      const s = v => v != null ? Math.round(v) : '—';
      const pct = (v, max) => v != null ? Math.min(100, Math.round(v / max * 100)) + '%' : '0%';
      if (smoke_ppm != null) { document.getElementById('sv-smoke').textContent = s(smoke_ppm); document.getElementById('sb-smoke').style.width = pct(smoke_ppm, 1000); }
      if (temperature_c != null) { document.getElementById('sv-temp').textContent = s(temperature_c); document.getElementById('sb-temp').style.width = pct(temperature_c, 200); }
      if (gas_ppm != null) { document.getElementById('sv-gas').textContent = s(gas_ppm); document.getElementById('sb-gas').style.width = pct(gas_ppm, 1000); }
      if (humidity_pct != null) { document.getElementById('sv-hum').textContent = s(humidity_pct); document.getElementById('sb-hum').style.width = pct(humidity_pct, 100); }
    }

    async function loadChartData() {
      let labels, smokeVals, tempVals;

      if (authToken !== 'demo-token') {
        try {
          const res = await apiFetch('/dashboard/chart-data?hours=24');
          const data = await res.json();
          if (data.success && data.chartData.length > 0) {
            labels = data.chartData.map(r => new Date(r.hour).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
            smokeVals = data.chartData.map(r => parseFloat(r.avg_smoke) || 0);
            tempVals = data.chartData.map(r => parseFloat(r.avg_temp) || 0);
          }
        } catch (e) { }
      }

      if (!labels) {
        labels = Array.from({ length: 24 }, (_, i) => `${i}:00`);
        smokeVals = [120, 90, 80, 110, 130, 200, 180, 220, 300, 280, 260, 400, 850, 820, 780, 740, 620, 580, 540, 490, 440, 380, 310, 220];
        tempVals = [28, 27, 26, 28, 29, 32, 31, 34, 40, 38, 36, 55, 142, 138, 132, 128, 89, 85, 80, 74, 68, 62, 54, 44];
      }

      if (smokeChart) { smokeChart.data.labels = labels; smokeChart.data.datasets[0].data = smokeVals; smokeChart.update(); }
      if (tempChart) { tempChart.data.labels = labels; tempChart.data.datasets[0].data = tempVals; tempChart.update(); }
    }

    // -------------------------------------------------------
    // DEVICES
    // -------------------------------------------------------
    async function loadDevices() {
      if (authToken === 'demo-token') {
        devicesData = DEMO_DEVICES;
        renderDevicesTable(DEMO_DEVICES);
        updateDeviceStats(DEMO_DEVICES);
        return;
      }
      try {
        const res = await apiFetch('/devices');
        const data = await res.json();
        if (data.success) {
          devicesData = data.devices;
          renderDevicesTable(data.devices);
          updateDeviceStats(data.devices);
          if (map2Init) addDevicesToMap2(data.devices);
        }
      } catch (e) { devicesData = DEMO_DEVICES; renderDevicesTable(DEMO_DEVICES); updateDeviceStats(DEMO_DEVICES); }
    }

    function updateDeviceStats(devices) {
      document.getElementById('dev-online').textContent = devices.filter(d => d.status === 'online').length;
      document.getElementById('dev-offline').textContent = devices.filter(d => d.status === 'offline').length;
      document.getElementById('dev-warn').textContent = devices.filter(d => d.status === 'warning').length;
      document.getElementById('dev-total').textContent = devices.length;
    }

    function renderDevicesTable(list) {
      document.getElementById('devicesTbody').innerHTML = list.map(d => {
        const sColor = d.smoke_ppm > 500 ? 'var(--accent-fire)' : d.smoke_ppm > 250 ? 'var(--accent-amber)' : 'var(--accent-green)';
        const tColor = d.temperature_c > 100 ? 'var(--accent-fire)' : d.temperature_c > 50 ? 'var(--accent-amber)' : 'var(--accent-green)';
        const pCls = d.status === 'online' ? 'pill-on' : d.status === 'warning' ? 'pill-warn' : 'pill-off';
        const geo = d.inside_geofence ? '<span style="color:var(--accent-green)">? INSIDE</span>' : '<span style="color:var(--accent-red)">? OUT</span>';
        const bat = d.battery_pct != null ? `<div style="display:flex;align-items:center;gap:5px"><span style="font-family:var(--font-mono);font-size:11px">${Math.round(d.battery_pct)}%</span><div style="width:40px"><div class="prog"><div class="prog-fill" style="width:${d.battery_pct}%;background:${d.battery_pct < 20 ? 'var(--accent-fire)' : d.battery_pct < 50 ? 'var(--accent-amber)' : 'var(--accent-green)'}"></div></div></div></div>` : '—';
        const lastSeen = d.seconds_since_seen < 60 ? `${d.seconds_since_seen}s ago` : d.seconds_since_seen < 3600 ? `${Math.floor(d.seconds_since_seen / 60)}m ago` : `${Math.floor(d.seconds_since_seen / 3600)}h ago`;
        return `<tr>
      <td><span class="mono">${d.device_code}</span></td>
      <td>${d.location_label || '—'}</td>
      <td style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted)">${d.gps_lat ? `${d.gps_lat.toFixed(4)}, ${d.gps_lng.toFixed(4)}` : '—'}</td>
      <td>${geo}</td>
      <td style="color:${sColor};font-family:var(--font-mono);font-weight:700">${d.smoke_ppm ?? '—'}</td>
      <td style="color:${tColor};font-family:var(--font-mono);font-weight:700">${d.temperature_c != null ? d.temperature_c + '°' : '—'}</td>
      <td>${bat}</td>
      <td style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted)">${lastSeen}</td>
      <td><span class="pill ${pCls}">${d.status}</span></td>
      <td><button class="btn btn-ghost" style="font-size:10px;padding:3px 8px" onclick="openDeviceConfig('${d.id || d.device_code}')">?? Config</button></td>
    </tr>`;
      }).join('');
    }

    function filterDevices() {
      const q = document.getElementById('devSearch').value.toLowerCase();
      const f = document.getElementById('devStatusFilter').value;
      const filtered = devicesData.filter(d =>
        (d.device_code.toLowerCase().includes(q) || (d.location_label || '').toLowerCase().includes(q)) &&
        (!f || d.status === f)
      );
      renderDevicesTable(filtered);
    }

    // -------------------------------------------------------
    // INCIDENTS
    // -------------------------------------------------------
    async function loadIncidents() {
      if (authToken === 'demo-token') {
        incidentsData = DEMO_INCIDENTS;
        renderIncidentsTable(DEMO_INCIDENTS);
        updateIncidentStats();
        return;
      }
      try {
        const res = await apiFetch('/incidents?limit=100&days=90');
        const data = await res.json();
        if (data.success) {
          incidentsData = data.incidents;
          renderIncidentsTable(data.incidents);
        }

        const sRes = await apiFetch('/incidents/stats');
        const sData = await sRes.json();
        if (sData.success) {
          const s = sData.stats;
          document.getElementById('inc-total').textContent = s.total || 0;
          document.getElementById('inc-month').textContent = s.this_month || 0;
          document.getElementById('inc-resolved').textContent = s.resolved_count || 0;
          const avgSecs = parseInt(s.avg_resolution_secs || 0);
          document.getElementById('inc-avgresp').textContent = avgSecs > 0 ? `${Math.floor(avgSecs / 60)}m ${avgSecs % 60}s` : '—';
        }
      } catch (e) { incidentsData = DEMO_INCIDENTS; renderIncidentsTable(DEMO_INCIDENTS); updateIncidentStats(); }
    }

    function updateIncidentStats() {
      document.getElementById('inc-total').textContent = DEMO_INCIDENTS.length;
      document.getElementById('inc-month').textContent = 8;
      document.getElementById('inc-resolved').textContent = DEMO_INCIDENTS.filter(i => i.status === 'resolved').length;
      document.getElementById('inc-avgresp').textContent = '1m 42s';
    }

    function renderIncidentsTable(list) {
      document.getElementById('incidentsTbody').innerHTML = list.map(i => {
        const stColor = i.status === 'active' ? 'var(--accent-fire)' : i.status === 'monitoring' ? 'var(--accent-amber)' : 'var(--accent-green)';
        const sprIcon = i.sprinkler_activated ? '?? ACTIVATED' : 'STANDBY';
        const sprColor = i.sprinkler_activated ? 'var(--accent-teal)' : 'var(--text-muted)';
        const dt = new Date(i.detected_at).toLocaleString('en-GB');
        const canResolve = ['active', 'monitoring'].includes(i.status) && ['admin', 'operator'].includes(currentUser.role);
        return `<tr onclick="openIncidentModal('${i.id || i.incident_code}')">
      <td><span class="mono">${i.incident_code}</span></td>
      <td style="font-size:12px">${dt}</td>
      <td><span class="mono">${i.device_code}</span></td>
      <td style="font-size:12px">${i.location_label}</td>
      <td><span class="sev sev-${i.severity}">${i.severity.toUpperCase()}</span></td>
      <td style="color:${sprColor};font-size:12px">${sprIcon}</td>
      <td style="color:${stColor};font-size:12px;font-weight:600">${i.status.toUpperCase()}</td>
      <td onclick="event.stopPropagation()" style="display:flex;gap:5px;flex-wrap:wrap">
        ${canResolve ? `<button class="btn btn-ghost" style="font-size:10px;padding:3px 8px" onclick="resolveIncident('${i.id || i.incident_code}')">? Resolve</button>` : ''}
        <button class="btn btn-ghost" style="font-size:10px;padding:3px 8px" onclick="exportIncidentCSV('${i.id || i.incident_code}')">CSV</button>
      </td>
    </tr>`;
      }).join('');
    }

    function filterIncidents() {
      const q = document.getElementById('incSearch').value.toLowerCase();
      const sev = document.getElementById('incSevFilter').value;
      const stat = document.getElementById('incStatusFilter').value;
      const filtered = incidentsData.filter(i =>
        (i.incident_code.toLowerCase().includes(q) || (i.device_code || '').toLowerCase().includes(q) || (i.location_label || '').toLowerCase().includes(q)) &&
        (!sev || i.severity === sev) && (!stat || i.status === stat)
      );
      renderIncidentsTable(filtered);
    }

    async function resolveIncident(id) {
      if (!confirm('Mark this incident as resolved?')) return;
      if (authToken === 'demo-token') {
        const inc = incidentsData.find(i => i.id === id || i.incident_code === id);
        if (inc) { inc.status = 'resolved'; renderIncidentsTable(incidentsData); updateAlertCount(activeIncidentCount - 1); toast('? Incident resolved'); }
        return;
      }
      try {
        const res = await apiFetch(`/incidents/${id}/resolve`, { method: 'PATCH', body: JSON.stringify({ notes: 'Resolved via dashboard' }) });
        const data = await res.json();
        if (data.success) { toast('? Incident resolved'); loadIncidents(); loadDashboard(); }
        else toast(data.message, 'error');
      } catch (e) { toast('Server error', 'error'); }
    }

    async function openIncidentModal(id) {
      const modal = document.getElementById('incModal');
      modal.classList.add('open');

      let inc, events = [], alerts = [];

      if (authToken === 'demo-token') {
        inc = incidentsData.find(i => i.id === id || i.incident_code === id) || incidentsData[0];
        events = [
          { occurred_at: inc.detected_at, event_type: 'detected', description: 'Fire detected — sensor thresholds exceeded', actor: 'system', _type: 'fire' },
          { occurred_at: new Date(new Date(inc.detected_at).getTime() + 2000).toISOString(), event_type: 'confirmed', description: 'Geofence validation: INSIDE protected area', actor: 'system', _type: 'fire' },
          { occurred_at: new Date(new Date(inc.detected_at).getTime() + 3000).toISOString(), event_type: 'sms_sent', description: 'SMS & email alerts dispatched', actor: 'system', _type: 'warn' },
          { occurred_at: new Date(new Date(inc.detected_at).getTime() + 4000).toISOString(), event_type: 'sprinkler_activated', description: 'Water sprinkler Zone A activated automatically', actor: 'system', _type: '' },
          { occurred_at: new Date(new Date(inc.detected_at).getTime() + 5000).toISOString(), event_type: 'alarm', description: 'Alarm buzzer activated', actor: 'system', _type: '' },
        ];
        if (inc.status === 'resolved') {
          events.push({ occurred_at: new Date(new Date(inc.detected_at).getTime() + 160000).toISOString(), event_type: 'resolved', description: 'Fire suppressed — sensors normalised', actor: 'operator', _type: '' });
        }
      } else {
        try {
          const res = await apiFetch(`/incidents/${id}`);
          const data = await res.json();
          if (data.success) { inc = data.incident; events = data.events; alerts = data.alerts; }
        } catch (e) { }
        if (!inc) return;
      }

      document.getElementById('mIncCode').textContent = inc.incident_code;

      const sColor = inc.severity === 'critical' ? 'var(--accent-fire)' : inc.severity === 'warning' ? 'var(--accent-amber)' : 'var(--accent-green)';
      document.getElementById('mDetailGrid').innerHTML = `
    <div class="detail-field"><div class="df-label">Date & Time</div><div class="df-val">${new Date(inc.detected_at).toLocaleString('en-GB')}</div></div>
    <div class="detail-field"><div class="df-label">Device</div><div class="df-val" style="color:var(--accent-teal)">${inc.device_code}</div></div>
    <div class="detail-field"><div class="df-label">GPS Coordinates</div><div class="df-val">${inc.gps_lat ? `${inc.gps_lat.toFixed(4)}, ${inc.gps_lng.toFixed(4)}` : 'N/A'}</div></div>
    <div class="detail-field"><div class="df-label">Geofence</div><div class="df-val" style="color:${inc.inside_geofence ? 'var(--accent-green)' : 'var(--accent-red)'}">${inc.inside_geofence ? '? INSIDE' : '? OUTSIDE'}</div></div>
    <div class="detail-field"><div class="df-label">Smoke Level</div><div class="df-val" style="color:var(--accent-fire)">${inc.smoke_ppm ?? '—'} ppm</div></div>
    <div class="detail-field"><div class="df-label">Temperature</div><div class="df-val" style="color:var(--accent-amber)">${inc.temperature_c ?? '—'}°C</div></div>
    <div class="detail-field"><div class="df-label">Severity</div><div class="df-val"><span class="sev sev-${inc.severity}">${inc.severity.toUpperCase()}</span></div></div>
    <div class="detail-field"><div class="df-label">Sprinkler</div><div class="df-val" style="color:${inc.sprinkler_activated ? 'var(--accent-teal)' : 'var(--text-muted)'}">${inc.sprinkler_activated ? '?? ACTIVATED' : 'STANDBY'}</div></div>
    <div class="detail-field"><div class="df-label">Status</div><div class="df-val" style="color:${sColor}">${inc.status.toUpperCase()}</div></div>
    <div class="detail-field"><div class="df-label">Location</div><div class="df-val">${inc.location_label}</div></div>
  `;

      document.getElementById('mTimeline').innerHTML = events.map(e => {
        const tCls = e._type || e.event_type === 'detected' || e.event_type === 'confirmed' ? 'fire' : e.event_type.includes('sms') || e.event_type.includes('alert') ? 'warn' : '';
        return `<div class="tl-item ${tCls}"><div class="tl-time">${new Date(e.occurred_at).toLocaleTimeString('en-GB')}</div><div class="tl-label">${e.description}</div></div>`;
      }).join('');

      const canAct = ['admin', 'operator'].includes(currentUser.role) && ['active', 'monitoring', 'acknowledged'].includes(inc.status);
      const canAck = canAct && inc.status !== 'acknowledged';

      document.getElementById('mActions').innerHTML = `
    ${canAck ? `<button class="btn btn-amber" onclick="acknowledgeIncident('\${inc.id||inc.incident_code}${inc.id||inc.incident_code}');closeModal('incModal')">? Acknowledge</button>` : ''}
    ${canAct ? `<button class="btn btn-fire" onclick="escalateIncident('\${inc.id||inc.incident_code}${inc.id||inc.incident_code}');closeModal('incModal')">?? Escalate</button>` : ''}
    ${canAct ? `<button class="btn btn-teal" onclick="resolveIncident('\${inc.id||inc.incident_code}${inc.id||inc.incident_code}');closeModal('incModal')">? Resolve</button>` : ''}
    <button class="btn btn-ghost" onclick="exportIncidentCSV('\${inc.id||inc.incident_code}${inc.id||inc.incident_code}')">? Export CSV</button>
    <button class="btn btn-ghost" onclick="closeModal('incModal')">Close</button>
  `;
}

// -------------------------------------------------------
// GEOFENCE
// -------------------------------------------------------
async function loadGeofence() {
  if (authToken === 'demo-token') {
    updateGeoStatus({ type:'circle', name:'Main Facility', center_lat:-13.9626, center_lng:33.7741, radius_meters:500 });
    return;
  }
  try {
    const res = await apiFetch('/geofence/active');
    const data = await res.json();
    if (data.success && data.geofence) {
      const g = data.geofence;
      document.getElementById('geoType').value = g.type;
      document.getElementById('geoName').value = g.name || 'Main Facility';
      document.getElementById('geoLat').value = g.center_lat || -13.9626;
      document.getElementById('geoLng').value = g.center_lng || 33.7741;
      document.getElementById('geoRadius').value = g.radius_meters || 500;
      updateGeoTypeUI();
      updateGeoStatus(g);
      if (map4Init) applyGeoToMap4(g);
    }
  } catch(e) { updateGeoStatus({ type:'circle', name:'Main Facility', center_lat:-13.9626, center_lng:33.7741, radius_meters:500 }); }
}

function updateGeoStatus(g) {
  document.getElementById('geoStatus').innerHTML = `
        < div > Type: <span style="color:var(--accent-teal)">${g.type === 'circle' ? 'Circle (Radius-Based)' : 'Polygon (Custom)'}</span></div >
          <div>Name: <span style="color:var(--text-primary)">${g.name || '—'}</span></div>
    ${
        g.type === 'circle' ? `<div>Center: <span style="color:var(--text-primary)">${g.center_lat?.toFixed(4)}, ${g.center_lng?.toFixed(4)}</span></div>
    <div>Radius: <span style="color:var(--text-primary)">${g.radius_meters}m</span></div>` : '<div>Polygon: custom shape</div>'
      }
      <div>Last Updated: <span style="color:var(--text-primary)">${new Date().toLocaleTimeString()}</span></div>
      `;
}

function updateGeoTypeUI() {
  const t = document.getElementById('geoType').value;
  document.getElementById('geoCircleOpts').style.display = t==='circle'?'':'none';
  document.getElementById('geoPolyOpts').style.display = t==='polygon'?'':'none';
}

async function saveGeofence() {
  const type = document.getElementById('geoType').value;
  const body = {
    name: document.getElementById('geoName').value,
    type,
    center_lat: parseFloat(document.getElementById('geoLat').value),
    center_lng: parseFloat(document.getElementById('geoLng').value),
    radius_meters: parseFloat(document.getElementById('geoRadius').value),
  };
  if (type === 'polygon') { body.polygon_coords = polyPoints; }

  if (authToken === 'demo-token') {
    updateGeoStatus(body);
    applyGeoToMap4(body);
    toast('? Geofence updated (demo)');
    return;
  }
  try {
    const res = await apiFetch('/geofence', { method:'POST', body: JSON.stringify(body) });
    const data = await res.json();
    if (data.success) { toast('? Geofence saved'); applyGeoToMap4(data.geofence); updateGeoStatus(data.geofence); }
    else toast(data.message, 'error');
  } catch(e) { toast('Error saving geofence', 'error'); }
}

function applyGeoToMap4(g) {
  if (!map4) return;
  if (geoLayer) { map4.removeLayer(geoLayer); }
  if (g.type === 'circle') {
    geoLayer = L.circle([g.center_lat, g.center_lng], {
      radius: g.radius_meters, color:'#00d4aa', fillColor:'#00d4aa', fillOpacity:.08, dashArray:'6,4', weight:2
    }).addTo(map4);
    map4.setView([g.center_lat, g.center_lng], 15);
  } else if (g.polygon_coords) {
    geoLayer = L.polygon(g.polygon_coords.map(c=>[c.lat,c.lng]), { color:'#00d4aa', fillColor:'#00d4aa', fillOpacity:.08, dashArray:'6,4', weight:2 }).addTo(map4);
  }
}

function clearPoly() {
  polyPoints = [];
  polyMarkers.forEach(m => { if(map4) map4.removeLayer(m); });
  polyMarkers = [];
  if (polyLine && map4) { map4.removeLayer(polyLine); polyLine = null; }
  document.getElementById('polyCount').textContent = 0;
  toast('Polygon cleared');
}

// -------------------------------------------------------
// USERS (Admin)
// -------------------------------------------------------
async function loadUsers() {
  if (authToken === 'demo-token') {
    renderUsers([
      { name:'System Admin', email:'admin@sfdaass.io', role:'admin', phone:'+265999000001', is_active:true, last_login: new Date().toISOString() },
      { name:'Operator One', email:'operator@sfdaass.io', role:'operator', phone:'+265999000002', is_active:true, last_login: null },
    ]);
    return;
  }
  try {
    const res = await apiFetch('/users');
    const data = await res.json();
    if (data.success) renderUsers(data.users);
  } catch(e){}
}

function renderUsers(users) {
  document.getElementById('usersTbody').innerHTML = users.map(u => `
        < tr >
      <td style="font-weight:600">${u.name}</td>
      <td><span class="mono">${u.email}</span></td>
      <td><span class="sev ${u.role==='admin'?'sev-critical':u.role==='operator'?'sev-warning':'sev-low'}">${u.role}</span></td>
      <td style="font-family:var(--font-mono);font-size:11px">${u.phone||'—'}</td>
      <td style="font-size:12px">${u.last_login ? new Date(u.last_login).toLocaleString('en-GB') : 'Never'}</td>
      <td><span class="pill ${u.is_active?'pill-on':'pill-off'}">${u.is_active?'ACTIVE':'INACTIVE'}</span></td>
      <td><button class="btn btn-ghost" style="font-size:11px;padding:3px 9px">Edit</button></td>
    </tr > `).join('');
}

// -------------------------------------------------------
// MAPS
// -------------------------------------------------------
const CENTER = [-13.9626, 33.7741];
const tileUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const tileFilter = 'brightness(0.65) hue-rotate(180deg) saturate(1.6)';
let map1Markers = {};

function initMap1() {
  map1 = L.map('map1', { zoomControl:true, attributionControl:false }).setView(CENTER, 15);
  L.tileLayer(tileUrl).addTo(map1);
  map1.getContainer().style.filter = tileFilter;
  geoCircle = L.circle(CENTER, { radius:500, color:'#00d4aa', fillColor:'#00d4aa', fillOpacity:.07, dashArray:'6,4', weight:2 }).addTo(map1);
  addDemoDevicesToMap();
  addIncidentMarkersToMap();
}

function makeMarkerIcon(color) {
  return L.divIcon({ html:`< div style = "width:13px;height:13px;border-radius:50%;background:${color};box-shadow:0 0 10px ${color};border:2px solid #fff" ></div > `, className:'', iconAnchor:[6,6] });
}

function addDemoDevicesToMap() {
  if (!map1) return;
  DEMO_DEVICES.forEach(d => {
    if (!d.gps_lat) return;
    const color = d.status==='offline'?'#3d5a70':d.smoke_ppm>500?'#ff4e1a':d.smoke_ppm>250?'#ffaa00':'#22c55e';
    const marker = L.marker([d.gps_lat, d.gps_lng], { icon: makeMarkerIcon(color) })
      .addTo(map1)
      .bindPopup(`< b > ${ d.device_code }</b > <br />${ d.location_label } <br />Smoke:${ d.smoke_ppm }ppm Temp:${ d.temperature_c }°C`);
    map1Markers[d.device_code] = marker;
  });
}

function addIncidentMarkersToMap() {
  if (!map1) return;
  DEMO_INCIDENTS.filter(i=>i.status!=='resolved').forEach(i => {
    if (!i.gps_lat) return;
    const icon = L.divIcon({ html:'<div style="font-size:18px">??</div>', className:'', iconAnchor:[9,9] });
    L.marker([i.gps_lat, i.gps_lng], {icon}).addTo(map1).bindPopup(`< b > ${ i.incident_code }</b > <br />${ i.severity.toUpperCase() } `);
  });
}

function updateDeviceOnMap(data) {
  if (!map1 || !data.gps_lat) return;
  const color = data.smoke_ppm>500?'#ff4e1a':data.smoke_ppm>250?'#ffaa00':'#22c55e';
  if (map1Markers[data.deviceCode]) {
    map1Markers[data.deviceCode].setIcon(makeMarkerIcon(color));
  }
}

function initMap2() {
  map2 = L.map('map2', { attributionControl:false }).setView(CENTER, 15);
  L.tileLayer(tileUrl).addTo(map2);
  map2.getContainer().style.filter = tileFilter;
  L.circle(CENTER, { radius:500, color:'#00d4aa', fillColor:'#00d4aa', fillOpacity:.06, dashArray:'5,4', weight:2 }).addTo(map2);
  addDevicesToMap2(devicesData.length ? devicesData : DEMO_DEVICES);
  map2Init = true;
}

function addDevicesToMap2(devices) {
  if (!map2) return;
  devices.forEach(d => {
    if (!d.gps_lat) return;
    const color = d.status==='offline'?'#3d5a70':d.smoke_ppm>500?'#ff4e1a':d.smoke_ppm>250?'#ffaa00':'#22c55e';
    L.marker([d.gps_lat, d.gps_lng], { icon: makeMarkerIcon(color) }).addTo(map2)
      .bindPopup(`< b > ${ d.device_code }</b > <br />${ d.location_label || '—' } <br />Smoke:${ d.smoke_ppm ?? '—' } ppm`);
  });
}

function initMap3() {
  map3 = L.map('map3', { attributionControl:false }).setView(CENTER, 15);
  L.tileLayer(tileUrl).addTo(map3);
  map3.getContainer().style.filter = tileFilter;
  const src = incidentsData.length ? incidentsData : DEMO_INCIDENTS;
  src.forEach(i => {
    if (!i.gps_lat) return;
    const color = i.severity==='critical'?'#ff4e1a':i.severity==='warning'?'#ffaa00':'#22c55e';
    const icon = L.divIcon({ html:`< div style = "width:13px;height:13px;border-radius:50%;background:${color};box-shadow:0 0 8px ${color};border:2px solid #fff" ></div > `, className:'', iconAnchor:[6,6] });
    L.marker([i.gps_lat, i.gps_lng], {icon}).addTo(map3).bindPopup(`< b > ${ i.incident_code }</b > `);
  });
  map3Init = true;
}

function initMap4() {
  map4 = L.map('map4', { attributionControl:false }).setView(CENTER, 15);
  L.tileLayer(tileUrl).addTo(map4);
  map4.getContainer().style.filter = tileFilter;
  geoLayer = L.circle(CENTER, { radius:500, color:'#00d4aa', fillColor:'#00d4aa', fillOpacity:.07, dashArray:'6,4', weight:2 }).addTo(map4);
  (devicesData.length ? devicesData : DEMO_DEVICES).forEach(d => {
    if (!d.gps_lat) return;
    const color = d.status==='offline'?'#3d5a70':d.smoke_ppm>500?'#ff4e1a':'#22c55e';
    L.marker([d.gps_lat, d.gps_lng], { icon: makeMarkerIcon(color) }).addTo(map4).bindPopup(`< b > ${ d.device_code }</b > `);
  });
  map4.on('click', (e) => {
    if (document.getElementById('geoType').value === 'polygon') {
      const p = { lat: e.latlng.lat, lng: e.latlng.lng };
      polyPoints.push(p);
      document.getElementById('polyCount').textContent = polyPoints.length;
      const m = L.circleMarker([p.lat,p.lng], { radius:5, color:'#00d4aa', fillColor:'#00d4aa', fillOpacity:1 }).addTo(map4);
      polyMarkers.push(m);
      if (polyLine) map4.removeLayer(polyLine);
      if (polyPoints.length > 1) {
        polyLine = L.polygon(polyPoints.map(pp=>[pp.lat,pp.lng]), { color:'#00d4aa', fillColor:'#00d4aa', fillOpacity:.07, dashArray:'6,4', weight:2 }).addTo(map4);
      }
    }
  });
  map4Init = true;
  loadGeofence();
}

// -------------------------------------------------------
// CHARTS
// -------------------------------------------------------
function initCharts() {
  const chartOpts = (color) => ({
    responsive:true, maintainAspectRatio:false,
    plugins:{ legend:{ display:false } },
    scales:{
      x:{ grid:{ color:'rgba(255,255,255,.04)' }, ticks:{ color:'#3d5a70', font:{ size:9 }, maxTicksLimit:8 } },
      y:{ grid:{ color:'rgba(255,255,255,.04)' }, ticks:{ color:'#3d5a70', font:{ size:9 } } }
    }
  });

  smokeChart = new Chart(document.getElementById('smokeChart'), {
    type:'line',
    data:{ labels:[], datasets:[{ data:[], borderColor:'#ff4e1a', backgroundColor:'rgba(255,78,26,.12)', fill:true, tension:.4, pointRadius:2, borderWidth:2 }] },
    options: chartOpts('#ff4e1a')
  });
  tempChart = new Chart(document.getElementById('tempChart'), {
    type:'line',
    data:{ labels:[], datasets:[{ data:[], borderColor:'#ffaa00', backgroundColor:'rgba(255,170,0,.10)', fill:true, tension:.4, pointRadius:2, borderWidth:2 }] },
    options: chartOpts('#ffaa00')
  });
}

// -------------------------------------------------------
// SPRINKLER CONTROL
// -------------------------------------------------------
async function toggleZone(zoneCode, btn) {
  const isActive = btn.classList.contains('off');
  const action = isActive ? 'deactivate' : 'activate';

  if (socket && socket.connected) {
    socket.emit('sprinkler:control', { zoneCode, action });
  } else if (authToken !== 'demo-token') {
    try {
      await apiFetch(`/ sprinklers / ${ zoneCode }/${action}`, { method:'POST', body:'{}'
    });
    } catch (e) { }
  }

    // Optimistic UI
    const zs = btn.parentElement.querySelector('.zs');
    if (isActive) {
      zs.textContent = 'STANDBY'; zs.style.color = 'var(--accent-green)';
      btn.textContent = 'Activate'; btn.className = 'on';
    } else {
      zs.textContent = 'ACTIVE'; zs.style.color = 'var(--accent-fire)';
      btn.textContent = 'Deactivate'; btn.className = 'off';
    }
    toast(`?? Zone ${zoneCode} ${isActive ? 'deactivated' : 'activated'}`);
}

    // -------------------------------------------------------
    // DEVICE REGISTRATION
    // -------------------------------------------------------
    function openRegisterDevice() { document.getElementById('regDevModal').classList.add('open'); }

    async function registerDevice() {
      const code = document.getElementById('rdCode').value.trim();
      const name = document.getElementById('rdName').value.trim();
      const loc = document.getElementById('rdLoc').value.trim();
      const mac = document.getElementById('rdMac').value.trim();
      const fw = document.getElementById('rdFw').value.trim();

      if (!code) { toast('Device code is required', 'error'); return; }

      if (authToken === 'demo-token') {
        document.getElementById('rdResult').style.display = 'block';
        document.getElementById('rdResult').style.color = 'var(--accent-teal)';
        document.getElementById('rdResult').textContent = `? Demo: Device ${code} registered. API Key: demo-key-${Date.now()}`;
        return;
      }

      try {
        const res = await apiFetch('/devices', { method: 'POST', body: JSON.stringify({ device_code: code, name, location_label: loc, mac_address: mac, firmware_version: fw }) });
        const data = await res.json();
        const resultEl = document.getElementById('rdResult');
        resultEl.style.display = 'block';
        if (data.success) {
          resultEl.style.color = 'var(--accent-teal)';
          resultEl.textContent = `? Device ${data.device.device_code} registered! API Key: ${data.device.api_key}`;
          loadDevices();
        } else {
          resultEl.style.color = 'var(--accent-fire)';
          resultEl.textContent = '? ' + data.message;
        }
      } catch (e) { toast('Error registering device', 'error'); }
    }

    // -------------------------------------------------------
    // CONTACT
    // -------------------------------------------------------
    async function sendContact() {
      const name = document.getElementById('cName').value.trim();
      const email = document.getElementById('cEmail').value.trim();
      const subject = document.getElementById('cSubject').value;
      const message = document.getElementById('cMsg').value.trim();

      if (!name || !email || !message) { toast('Please fill all required fields', 'error'); return; }

      if (authToken === 'demo-token') {
        toast(`?? Message sent! We'll respond to ${email} (demo mode)`);
        document.getElementById('cName').value = '';
        document.getElementById('cEmail').value = '';
        document.getElementById('cMsg').value = '';
        return;
      }

      try {
        const res = await fetch(`${API_BASE}/contact`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, subject, message })
        });
        const data = await res.json();
        if (data.success) {
          toast(`?? Message sent! We'll respond to ${email}`);
          document.getElementById('cName').value = '';
          document.getElementById('cEmail').value = '';
          document.getElementById('cMsg').value = '';
        } else toast(data.message, 'error');
      } catch (e) { toast('Failed to send message', 'error'); }
    }

    // -------------------------------------------------------
    // FIRE SIMULATION
    // -------------------------------------------------------
    function simFire() {
      document.getElementById('fire-overlay').classList.add('active');
      document.getElementById('topbarAlertPill').textContent = '?? FIRE DETECTED — CRITICAL';
      toast('?? FIRE SIMULATION — Zone D activated!', 'error');
      updateSensorTiles({ smoke_ppm: 920, temperature_c: 167, gas_ppm: 680, humidity_pct: 22 });
      setTimeout(() => {
        document.getElementById('fire-overlay').classList.remove('active');
        document.getElementById('topbarAlertPill').textContent = `? ${activeIncidentCount} ACTIVE ALERT${activeIncidentCount !== 1 ? 'S' : ''}`;
        toast('? Simulation ended');
      }, 8000);
    }

    // -------------------------------------------------------
    // EXPORT
    // -------------------------------------------------------
    function exportIncidentCSV(id) {
      if (authToken !== 'demo-token') {
        window.open(`${API_BASE}/incidents/${id}/export/csv`, '_blank');
        return;
      }
      const inc = incidentsData.find(i => i.id === id || i.incident_code === id);
      if (!inc) return;
      const csv = `"Field","Value"\${inc.id||inc.incident_code}n"Incident ID","${inc.incident_code}"\${inc.id||inc.incident_code}n"Date","${new Date(inc.detected_at).toLocaleString()}"\${inc.id||inc.incident_code}n"Device","${inc.device_code}"\${inc.id||inc.incident_code}n"Location","${inc.location_label}"\${inc.id||inc.incident_code}n"Severity","${inc.severity}"\${inc.id||inc.incident_code}n"Status","${inc.status}"\${inc.id||inc.incident_code}n"Smoke (ppm)","${inc.smoke_ppm}"\${inc.id||inc.incident_code}n"Temp (°C)","${inc.temperature_c}"\${inc.id||inc.incident_code}n"Sprinkler","${inc.sprinkler_activated}"`;
      download(`incident_${inc.incident_code}.csv`, csv);
      toast('? CSV downloaded');
    }

    function exportAllCSV() {
      if (authToken !== 'demo-token') { window.open(`${API_BASE}/incidents/export/all`, '_blank'); return; }
      const headers = '"Incident Code","Date","Device","Location","Severity","Status","Sprinkler"';
      const rows = incidentsData.map(i => `"${i.incident_code}","${new Date(i.detected_at).toLocaleString()}","${i.device_code}","${i.location_label}","${i.severity}","${i.status}","${i.sprinkler_activated}"`);
      download('all_incidents.csv', [headers, ...rows].join('\${inc.id||inc.incident_code}n'));
      toast('? CSV downloaded');
    }

    function download(filename, text) {
      const a = document.createElement('a');
      a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(text);
      a.download = filename;
      a.click();
    }

    // -------------------------------------------------------
    // NAVIGATION
    // -------------------------------------------------------
    function goTo(page, btn) {
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      document.getElementById('page-' + page).classList.add('active');
      if (btn) btn.classList.add('active');
      else {
        const navBtn = document.querySelector(`.nav-item[onclick*="${page}"]`);
        if (navBtn) navBtn.classList.add('active');
      }

      // Lazy-init maps
      if (page === 'devices' && !map2Init) setTimeout(initMap2, 100);
      if (page === 'incidents' && !map3Init) setTimeout(initMap3, 100);
      if (page === 'geofence' && !map4Init) setTimeout(initMap4, 100);
    }

    // -------------------------------------------------------
    // MODAL
    // -------------------------------------------------------
    function closeModal(id) { document.getElementById(id).classList.remove('open'); }
    function openAddUser() { toast('User registration form — connect backend to enable', 'warn'); }

    // -------------------------------------------------------
    // TOAST
    // -------------------------------------------------------
    let toastTimer;
    function toast(msg, type = '') {
      const el = document.getElementById('toast');
      el.textContent = msg;
      el.className = `toast show ${type}`;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => el.className = 'toast', 3800);
    }

    // -------------------------------------------------------
    // NEW ENTERPRISE FEATURES
    // -------------------------------------------------------

    async function acknowledgeIncident(id) {
      if (authToken === 'demo-token') { toast('Acknowledge simulated in demo'); return; }
      try {
        const res = await apiFetch(`/incidents/${id}/acknowledge`, { method: 'PATCH', body: JSON.stringify({ notes: 'Acknowledged via dashboard' }) });
        if (res.ok) { toast('Incident acknowledged'); loadIncidents(); loadDashboard(); } else toast('Failed to acknowledge', 'error');
      } catch (e) { toast('Error', 'error'); }
    }

    async function escalateIncident(id) {
      if (authToken === 'demo-token') { toast('Escalate simulated in demo'); return; }
      try {
        const res = await apiFetch(`/incidents/${id}/escalate`, { method: 'PATCH', body: JSON.stringify({ notes: 'Escalated via dashboard' }) });
        if (res.ok) { toast('Incident escalated!'); loadIncidents(); loadDashboard(); } else toast('Failed to escalate', 'error');
      } catch (e) { toast('Error', 'error'); }
    }

    async function loadSystemConfig() {
      if (authToken === 'demo-token') return;
      try {
        const res = await apiFetch('/system-config/thresholds');
        const data = await res.json();
        if (data.success && data.thresholds) {
          document.getElementById('sysSmokeW').value = data.thresholds.smoke_warning || 250;
          document.getElementById('sysSmokeC').value = data.thresholds.smoke_critical || 500;
          document.getElementById('sysTempW').value = data.thresholds.temp_warning || 50;
          document.getElementById('sysTempC').value = data.thresholds.temp_critical || 100;
          document.getElementById('sysGasW').value = data.thresholds.gas_warning || 150;
          document.getElementById('sysGasC').value = data.thresholds.gas_critical || 300;
          document.getElementById('sysConfMs').value = data.thresholds.confirm_duration_ms || 5000;
        }
      } catch (e) { }
    }

    async function saveSystemThresholds() {
      if (authToken === 'demo-token') { toast('Settings simulated in demo mode'); return; }
      const body = {
        smoke_warning: parseInt(document.getElementById('sysSmokeW').value),
        smoke_critical: parseInt(document.getElementById('sysSmokeC').value),
        temp_warning: parseInt(document.getElementById('sysTempW').value),
        temp_critical: parseInt(document.getElementById('sysTempC').value),
        gas_warning: parseInt(document.getElementById('sysGasW').value),
        gas_critical: parseInt(document.getElementById('sysGasC').value),
        confirm_duration_ms: parseInt(document.getElementById('sysConfMs').value)
      };
      try {
        const res = await apiFetch('/system-config/thresholds', { method: 'PUT', body: JSON.stringify(body) });
        const data = await res.json();
        if (data.success) toast('? System configuration saved successfully');
        else toast('Failed to save configuration', 'error');
      } catch (e) { toast('Error saving config', 'error'); }
    }

    async function loadAuditLogs() {
      if (authToken === 'demo-token') return;
      try {
        const res = await apiFetch('/audit-logs');
        const data = await res.json();
        if (data.success) {
          document.getElementById('auditTbody').innerHTML = data.logs.map(log =>
            `<tr>
          <td style="font-size:12px">${new Date(log.created_at).toLocaleString()}</td>
          <td>${log.user_name || 'System'}</td>
          <td><span class="mono">${log.action}</span></td>
          <td style="font-size:12px">${log.details ? (typeof log.details === 'object' ? JSON.stringify(log.details) : log.details) : ''}</td>
          <td style="font-size:12px;color:var(--text-muted)">${log.ip_address || ''}</td>
        </tr>`
          ).join('');
        }
      } catch (e) { }
    }

    const originalGoTo = goTo;
    goTo = function (page, btn) {
      originalGoTo(page, btn);
      if (page === 'system') loadSystemConfig();
      if (page === 'audit') loadAuditLogs();
    };

    function openDeviceConfig(id) {
      toast('Device configuration API routes not yet exposed in backend UI. Available via endpoints.', 'warn');
    }

    // Periodically refresh data
    setInterval(() => { if (authToken) { loadDashboard(); loadDevices(); } }, 30000);
    setInterval(() => { if (authToken) loadIncidents(); }, 60000);
  
