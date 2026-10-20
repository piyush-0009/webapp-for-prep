// js/sync.js — Verified Real-Time Cloud Sync Engine (Google Sheets Web App + GitHub Gist)
(function (window) {
  function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  const SYNC_CONFIG_KEY = 'recon_ledger_sync_config_v2';
  const TOMBSTONE_KEY = 'recon_ledger_deleted_ids_v2';

  let appHooks = {
    getState: null,
    setStateAndRender: null
  };

  let pushTimer = null;
  let isSyncing = false;
  let diagnosticLogs = [];

  function logDiag(msg, isError = false) {
    const time = new Date().toLocaleTimeString();
    const entry = `[${time}] ${isError ? 'ERROR: ' : ''}${msg}`;
    diagnosticLogs.unshift(entry);
    if (diagnosticLogs.length > 30) diagnosticLogs.pop();
    const logEl = document.getElementById('sync-diagnostic-log');
    if (logEl) {
      logEl.textContent = diagnosticLogs.join('\n');
    }
    if (isError) console.error(entry);
    else console.log(entry);
  }

  function getConfig() {
    try {
      const raw = localStorage.getItem(SYNC_CONFIG_KEY);
      return raw ? JSON.parse(raw) : {
        provider: 'sheets', // 'sheets' | 'gist'
        scriptUrl: '',
        pin: '',
        gistToken: '',
        gistId: '',
        autoSync: true
      };
    } catch (e) {
      return { provider: 'sheets', scriptUrl: '', pin: '', gistToken: '', gistId: '', autoSync: true };
    }
  }

  function saveConfig(cfg) {
    localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(cfg));
    renderPairingQR(cfg);
    updateHeaderIndicator('idle', 'Config Saved');
  }

  function isConfigured(cfg = getConfig()) {
    if (cfg.provider === 'sheets') return Boolean(cfg.scriptUrl && cfg.scriptUrl.startsWith('https://script.google.com/'));
    if (cfg.provider === 'gist') return Boolean(cfg.gistToken && cfg.gistId);
    return false;
  }

  function updateHeaderIndicator(status, detail = '') {
    const pill = document.getElementById('sync-status-pill');
    if (!pill) return;
    pill.className = `sync-pill sync-${status}`;
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (status === 'synced') {
      pill.innerHTML = `<span class="sync-dot">●</span> Synced · ${escapeHTML(detail) || timeStr}`;
    } else if (status === 'syncing') {
      pill.innerHTML = `<span class="sync-dot">◐</span> Syncing... ${escapeHTML(detail)}`;
    } else if (status === 'error') {
      pill.innerHTML = `<span class="sync-dot">✕</span> Sync Failed (${escapeHTML(detail)})`;
    } else {
      pill.innerHTML = `<span class="sync-dot">○</span> ${isConfigured() ? 'Ready to Sync' : 'Sync Not Configured'}`;
    }
  }

  // Count total checked Recon steps across all topics for verification logging
  function countCompletedSteps(state) {
    if (!state || !Array.isArray(state.topics)) return 0;
    return state.topics.reduce((acc, t) => {
      const s = Array.isArray(t.steps) ? t.steps.filter(Boolean).length : 0;
      return acc + s;
    }, 0);
  }

  // Deterministic Per-Item Merge (Fixes Seed Timestamp Trap)
  function mergeStates(local, remote) {
    if (!remote || !Array.isArray(remote.topics)) return local;
    if (!local || !Array.isArray(local.topics)) return remote;

    const deletedIds = new Set([
      ...(local.deletedTopicIds || []),
      ...(remote.deletedTopicIds || []),
      ...JSON.parse(localStorage.getItem(TOMBSTONE_KEY) || '[]')
    ]);

    const merged = JSON.parse(JSON.stringify(local));
    merged.deletedTopicIds = Array.from(deletedIds);

    // 1. Merge Topics by ID (or normalized Subject::Topic fallback)
    const makeKey = (t) => t.id || `${String(t.subject).toLowerCase().trim()}::${String(t.topic).toLowerCase().trim()}`;
    const topicMap = new Map();

    for (const t of local.topics) {
      const k = makeKey(t);
      if (!deletedIds.has(k) && !deletedIds.has(t.id)) {
        topicMap.set(k, { ...t, updatedAt: Number(t.updatedAt) || 0 });
      }
    }

    for (const rt of remote.topics) {
      const k = makeKey(rt);
      if (deletedIds.has(k) || deletedIds.has(rt.id)) continue;
      const lt = topicMap.get(k);
      const rTime = Number(rt.updatedAt) || 0;
      const lTime = lt ? (Number(lt.updatedAt) || 0) : -1;

      if (!lt) {
        topicMap.set(k, { ...rt, updatedAt: rTime });
      } else if (rTime > lTime) {
        topicMap.set(k, { ...rt, updatedAt: rTime });
      } else if (rTime === lTime && rTime === 0) {
        // Both are at seed timestamp 0, but check if one actually has checked steps
        const rSteps = (rt.steps || []).filter(Boolean).length;
        const lSteps = (lt.steps || []).filter(Boolean).length;
        if (rSteps > lSteps) topicMap.set(k, { ...rt, updatedAt: Date.now() });
      }
    }
    merged.topics = Array.from(topicMap.values());

    // 2. Merge Exams by ID
    if (Array.isArray(remote.exams)) {
      const examMap = new Map((local.exams || []).map(e => [e.id, e]));
      for (const re of remote.exams) {
        const le = examMap.get(re.id);
        if (!le || (Number(re.updatedAt) || 0) > (Number(le.updatedAt) || 0)) {
          examMap.set(re.id, re);
        }
      }
      merged.exams = Array.from(examMap.values());
    }

    // 3. Merge Habit Logs / History (Union by date + habitId with timestamp priority)
    if (remote.habitLogs || remote.habits) {
      // Support both dictionary habitLogs[date][habitId] and habits array with history[date]
      if (remote.habitLogs && typeof remote.habitLogs === 'object') {
        merged.habitLogs = merged.habitLogs || {};
        for (const [dateKey, dayObj] of Object.entries(remote.habitLogs)) {
          merged.habitLogs[dateKey] = { ...(merged.habitLogs[dateKey] || {}), ...dayObj };
        }
      }
      if (Array.isArray(remote.habits) && Array.isArray(local.habits)) {
        const hMap = new Map(local.habits.map(h => [h.id || h.name, h]));
        for (const rh of remote.habits) {
          const key = rh.id || rh.name;
          const lh = hMap.get(key);
          if (!lh) {
            hMap.set(key, rh);
          } else {
            const mergedHistory = { ...(lh.history || {}), ...(rh.history || {}) };
            const winner = (Number(rh.updatedAt) || 0) > (Number(lh.updatedAt) || 0) ? rh : lh;
            hMap.set(key, { ...winner, history: mergedHistory });
          }
        }
        merged.habits = Array.from(hMap.values());
      }
    }

    // 4. Active Phase
    if ((Number(remote.phaseUpdatedAt) || 0) > (Number(local.phaseUpdatedAt) || 0)) {
      merged.activePhaseId = remote.activePhaseId;
      merged.phaseUpdatedAt = remote.phaseUpdatedAt;
    }

    merged.lastSyncedRevision = Date.now();
    return merged;
  }

  // --- CLOUD ADAPTER 1: GOOGLE SHEETS WEB APP ---
  async function pullFromSheets(cfg) {
    const url = new URL(cfg.scriptUrl.trim());
    if (url.pathname.endsWith('/dev')) {
      throw new Error('URL ends in /dev. You must use the /exec Web App URL from Deploy -> Manage Deployments.');
    }
    url.searchParams.set('pin', cfg.pin || '');
    url.searchParams.set('t', String(Date.now())); // Crucial cache-buster for mobile Safari/Chrome

    logDiag(`GET Google Sheets Relay...`);
    const res = await fetch(url.toString(), {
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store'
    });

    const text = await res.text();
    if (text.trim().startsWith('<!DOCTYPE html>') || text.includes('<html')) {
      throw new Error('Google returned an HTML login page. In Apps Script -> Deploy, set "Who has access" to "Anyone".');
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      throw new Error(`Invalid JSON from Google Sheet: ${text.slice(0, 80)}`);
    }

    if (data.error) throw new Error(data.error);
    return data.state || null;
  }

  async function pushToSheets(cfg, stateObj) {
    const url = cfg.scriptUrl.trim();
    logDiag(`POST Google Sheets (${stateObj.topics?.length || 0} topics, ${countCompletedSteps(stateObj)} steps done)...`);

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // MUST be text/plain to avoid CORS OPTIONS preflight failure
      body: JSON.stringify({
        pin: cfg.pin || '',
        state: stateObj,
        pushedAt: Date.now()
      }),
      redirect: 'follow',
      cache: 'no-store'
    });

    const text = await res.text();
    if (text.trim().startsWith('<!DOCTYPE html>') || text.includes('<html')) {
      throw new Error('Google returned HTML instead of JSON. Ensure Web App deployment access is set to "Anyone".');
    }

    const data = JSON.parse(text);
    if (data.error) throw new Error(data.error);
    return data;
  }

  // --- CLOUD ADAPTER 2: GITHUB SECRET GIST ---
  async function pullFromGist(cfg) {
    logDiag(`GET GitHub Gist (${cfg.gistId.slice(0, 8)}...)...`);
    const res = await fetch(`https://api.github.com/gists/${cfg.gistId.trim()}?t=${Date.now()}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${cfg.gistToken.trim()}`
      },
      cache: 'no-store'
    });
    if (!res.ok) throw new Error(`GitHub Gist GET HTTP ${res.status}`);
    const gist = await res.json();
    const file = gist.files && (gist.files['recon-ledger-state.json'] || Object.values(gist.files)[0]);
    if (!file || !file.content) return null;
    return JSON.parse(file.content);
  }

  async function pushToGist(cfg, stateObj) {
    logDiag(`PATCH GitHub Gist (${countCompletedSteps(stateObj)} steps done)...`);
    const res = await fetch(`https://api.github.com/gists/${cfg.gistId.trim()}`, {
      method: 'PATCH',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${cfg.gistToken.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        description: `The Recon Ledger State (Updated ${new Date().toISOString()})`,
        files: {
          'recon-ledger-state.json': {
            content: JSON.stringify(stateObj, null, 2)
          }
        }
      })
    });
    if (!res.ok) throw new Error(`GitHub Gist PATCH HTTP ${res.status}`);
    return await res.json();
  }

  async function createNewGist(token, initialState) {
    logDiag('Creating new Secret GitHub Gist...');
    const res = await fetch('https://api.github.com/gists', {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${token.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        description: 'The Recon Ledger — Live Exam Sync Database',
        public: false,
        files: {
          'recon-ledger-state.json': {
            content: JSON.stringify(initialState, null, 2)
          }
        }
      })
    });
    if (!res.ok) throw new Error(`Failed to create Gist (HTTP ${res.status}). Check token has 'gist' permission.`);
    const data = await res.json();
    logDiag(`Created Secret Gist ID: ${data.id}`);
    return data.id;
  }

  // --- CORE SYNC OPERATIONS ---
  async function syncNow(mode = 'merge') {
    // mode: 'merge' | 'force-push' | 'force-pull'
    const cfg = getConfig();
    if (!isConfigured(cfg)) {
      updateHeaderIndicator('idle');
      return false;
    }
    if (isSyncing) return false;

    isSyncing = true;
    updateHeaderIndicator('syncing', mode === 'merge' ? '' : mode);

    try {
      const localState = appHooks.getState ? appHooks.getState() : null;
      if (!localState) throw new Error('App state hook not connected.');

      const pullFn = cfg.provider === 'gist' ? pullFromGist : pullFromSheets;
      const pushFn = cfg.provider === 'gist' ? pushToGist : pushToSheets;

      if (mode === 'force-push') {
        await pushFn(cfg, localState);
        logDiag(`Force Push succeeded (${countCompletedSteps(localState)} steps).`);
        updateHeaderIndicator('synced');
        isSyncing = false;
        return true;
      }

      const remoteState = await pullFn(cfg);

      if (mode === 'force-pull') {
        if (!remoteState) throw new Error('Cloud database is currently empty; nothing to force-pull.');
        appHooks.setStateAndRender(remoteState);
        logDiag(`Force Pull applied (${countCompletedSteps(remoteState)} steps loaded).`);
        updateHeaderIndicator('synced');
        isSyncing = false;
        return true;
      }

      // Standard 2-Way Timestamp Merge
      if (!remoteState) {
        logDiag('Cloud is empty. Pushing initial local state to cloud...');
        await pushFn(cfg, localState);
      } else {
        const localSteps = countCompletedSteps(localState);
        const remoteSteps = countCompletedSteps(remoteState);
        logDiag(`Pulled remote (${remoteSteps} steps) vs local (${localSteps} steps). Merging...`);

        const merged = mergeStates(localState, remoteState);
        appHooks.setStateAndRender(merged);
        await pushFn(cfg, merged);
        logDiag(`Sync & Merge complete. Total steps active: ${countCompletedSteps(merged)}.`);
      }

      updateHeaderIndicator('synced');
      isSyncing = false;
      return true;
    } catch (err) {
      logDiag(err.message || String(err), true);
      updateHeaderIndicator('error', 'Click for details');
      isSyncing = false;
      return false;
    }
  }

  // Called by app.js on EVERY checkbox click, note edit, habit toggle, or exam edit
  function recordMutation(mutatedEntity) {
    if (mutatedEntity && typeof mutatedEntity === 'object') {
      mutatedEntity.updatedAt = Date.now();
    }
    const cfg = getConfig();
    if (!isConfigured(cfg) || !cfg.autoSync) return;

    updateHeaderIndicator('syncing', 'queued');
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      syncNow('merge');
    }, 1000);
  }

  // --- QR CODE & MAGIC LINK PAIRING ---
  function checkUrlPairingOnLoad() {
    if (window.location.hash && window.location.hash.startsWith('#pair=')) {
      try {
        const b64 = window.location.hash.replace('#pair=', '');
        const decoded = JSON.parse(atob(decodeURIComponent(b64)));
        saveConfig(decoded);
        history.replaceState(null, '', window.location.pathname + window.location.search);
        logDiag('Device paired via Magic Link / QR Code! Running initial sync...');
        setTimeout(() => syncNow('merge'), 300);
      } catch (e) {
        logDiag('Failed to parse pairing link: ' + e.message, true);
      }
    }
  }

  function renderPairingQR(cfg = getConfig()) {
    const qrContainer = document.getElementById('sync-pairing-qr');
    const linkInput = document.getElementById('sync-pairing-link');
    if (!qrContainer || !isConfigured(cfg)) return;

    const payload = encodeURIComponent(btoa(JSON.stringify(cfg)));
    const magicUrl = `${window.location.origin}${window.location.pathname}#pair=${payload}`;
    if (linkInput) linkInput.value = magicUrl;
    qrContainer.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(magicUrl)}" alt="Scan on Phone to Pair" style="border: 4px solid #FAF8F3; border-radius: 4px;" />`;
  }

  function init(hooks) {
    appHooks = hooks;
    checkUrlPairingOnLoad();
    const cfg = getConfig();
    renderPairingQR(cfg);

    if (isConfigured(cfg)) {
      syncNow('merge');
    } else {
      updateHeaderIndicator('idle');
    }

    // Auto-pull whenever switching back to tab or unlocking phone
    window.addEventListener('focus', () => {
      if (isConfigured()) syncNow('merge');
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && isConfigured()) syncNow('merge');
    });
    window.addEventListener('online', () => {
      if (isConfigured()) syncNow('merge');
    });
  }

  window.SyncEngine = {
    init,
    syncNow,
    recordMutation,
    getConfig,
    saveConfig,
    createNewGist,
    logDiag
  };
})(window);
