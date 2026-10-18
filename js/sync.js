// js/sync.js

// -- MODULE 5A: Smart Merge Logic --

function setupMergeEvents() {
  const modal = document.getElementById('smart-merge-modal');
  const btnOpen = document.getElementById('smart-merge-btn');
  const btnClose = document.getElementById('close-merge-modal');
  const btnImport = document.getElementById('btn-import-merge');
  const btnExportCsv = document.getElementById('btn-export-csv');
  const btnExportJson = document.getElementById('btn-export-json');
  const inputArea = document.getElementById('merge-data-input');

  if(btnOpen) btnOpen.addEventListener('click', () => modal.classList.remove('hidden'));
  if(btnClose) btnClose.addEventListener('click', () => modal.classList.add('hidden'));

  if(btnImport) btnImport.addEventListener('click', () => {
    const dataStr = inputArea.value.trim();
    if (!dataStr) return;

    try {
      if (dataStr.startsWith('{') || dataStr.startsWith('[')) {
        handleJSONMerge(JSON.parse(dataStr));
      } else {
        handleCSVMerge(dataStr);
      }
      saveState();
      renderApp();
      alert('Merge Import Successful');
      modal.classList.add('hidden');
      inputArea.value = '';
    } catch (e) {
      alert('Error parsing data: ' + e.message);
    }
  });

  if(btnExportCsv) btnExportCsv.addEventListener('click', () => {
    let csv = "Subject|Topic|Priority|ExamTags|DossierNotes\n";
    STATE.topics.forEach(t => {
      // Escape pipes in notes if any
      const safeNotes = (t.dossierNotes || '').replace(/\|/g, '-');
      csv += `${t.subject}|${t.topic}|${t.priority}|${t.examTags.join(',')}|${safeNotes}\n`;
    });
    downloadFile(csv, 'recon-ledger-export.csv', 'text/csv');
  });

  if(btnExportJson) btnExportJson.addEventListener('click', () => {
    downloadFile(JSON.stringify(STATE, null, 2), 'recon-ledger-state.json', 'application/json');
  });
}

function handleJSONMerge(importedState) {
  if (importedState.topics && Array.isArray(importedState.topics)) {
    importedState.topics.forEach(incoming => {
      mergeSingleTopic(incoming);
    });
  }
}

function handleCSVMerge(csvStr) {
  const lines = csvStr.split('\n');
  if (lines.length < 2) return; // Need header + data
  const headers = lines[0].split('|').map(h => h.trim().toLowerCase());

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = lines[i].split('|');
    let incoming = { subject: "Uncategorized", topic: "", priority: "Layer C (Compression)", examTags: [], dossierNotes: "" };

    headers.forEach((h, idx) => {
      const val = (cols[idx] || '').trim();
      if (h === 'subject') incoming.subject = val;
      if (h === 'topic') incoming.topic = val;
      if (h === 'priority') incoming.priority = val;
      if (h === 'examtags') incoming.examTags = val.split(',').map(s=>s.trim()).filter(Boolean);
      if (h === 'dossiernotes' || h === 'notes_link') incoming.dossierNotes = val;
    });

    if (incoming.topic) mergeSingleTopic(incoming);
  }
}

function mergeSingleTopic(incoming) {
  const keyMatch = t => t.subject.toLowerCase() === incoming.subject.toLowerCase() && t.topic.toLowerCase() === incoming.topic.toLowerCase();
  let existing = STATE.topics.find(keyMatch);

  if (existing) {
    // Non-destructive update
    if (incoming.priority) existing.priority = incoming.priority;
    if (incoming.examTags) {
      incoming.examTags.forEach(tag => {
        if (!existing.examTags.includes(tag)) existing.examTags.push(tag);
      });
    }
    if (incoming.dossierNotes && !existing.dossierNotes.includes(incoming.dossierNotes)) {
      existing.dossierNotes += `\n${incoming.dossierNotes}`;
    }
  } else {
    // New topic
    STATE.topics.push({
      id: 't' + Date.now() + Math.floor(Math.random()*1000),
      subject: incoming.subject,
      topic: incoming.topic,
      priority: incoming.priority || "Layer C (Compression)",
      pyqWeight: incoming.pyqWeight || 0,
      examTags: incoming.examTags || [],
      pinned: false,
      dossierNotes: incoming.dossierNotes || "",
      steps: [false,false,false,false,false,false],
      sixStems: [false,false,false,false,false,false],
      failureLog: [],
      cooldownUntil: null,
      status: "In Progress"
    });
  }
}

function downloadFile(content, filename, contentType) {
  const blob = new Blob([content], { type: contentType });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

// -- MODULE 5B: Cloud Sync & Timestamp Merge Engine --

function setupCloudSyncEvents() {
  const modal = document.getElementById('github-sync-modal');
  const btnOpen = document.getElementById('github-sync-btn');
  const btnClose = document.getElementById('close-sync-modal');

  // Tabs
  const tabSheets = document.getElementById('tab-sheets');
  const tabGist = document.getElementById('tab-gist');
  const paneSheets = document.getElementById('pane-sheets');
  const paneGist = document.getElementById('pane-gist');

  // Load config
  const config = JSON.parse(localStorage.getItem('cloudSyncConfig') || '{"provider": "none"}');

  if (config.gsUrl) document.getElementById('gs-url').value = config.gsUrl;
  if (config.gsPin) document.getElementById('gs-pin').value = config.gsPin;
  if (config.ghPat) document.getElementById('gh-pat').value = config.ghPat;
  if (config.ghGistId) document.getElementById('gh-gist-id').value = config.ghGistId;

  if (config.provider === 'gist') {
    tabGist.click();
    paneSheets.classList.add('hidden');
    paneGist.classList.remove('hidden');
    tabGist.classList.add('active');
    tabSheets.classList.remove('active');
  }

  if (btnOpen) btnOpen.addEventListener('click', () => {
    modal.classList.remove('hidden');
    renderPairingSection();
  });
  if (btnClose) btnClose.addEventListener('click', () => modal.classList.add('hidden'));

  // Tab switching
  tabSheets.addEventListener('click', () => {
    tabSheets.classList.add('active');
    tabGist.classList.remove('active');
    paneSheets.classList.remove('hidden');
    paneGist.classList.add('hidden');
  });
  tabGist.addEventListener('click', () => {
    tabGist.classList.add('active');
    tabSheets.classList.remove('active');
    paneGist.classList.remove('hidden');
    paneSheets.classList.add('hidden');
  });

  // Save Config Option A (Sheets)
  document.getElementById('btn-gs-save').addEventListener('click', () => {
    const newConfig = {
      provider: 'sheets',
      gsUrl: document.getElementById('gs-url').value.trim(),
      gsPin: document.getElementById('gs-pin').value.trim()
    };
    if (!newConfig.gsUrl) return alert("Web App URL is required.");
    localStorage.setItem('cloudSyncConfig', JSON.stringify(newConfig));
    alert('Google Sheets Config Saved!');
    renderPairingSection();
    triggerPullSync();
  });

  // Save Config Option B (Gist)
  document.getElementById('btn-gh-save').addEventListener('click', () => {
    const newConfig = {
      provider: 'gist',
      ghPat: document.getElementById('gh-pat').value.trim(),
      ghGistId: document.getElementById('gh-gist-id').value.trim()
    };
    if (!newConfig.ghPat || !newConfig.ghGistId) return alert("PAT and Gist ID required.");
    localStorage.setItem('cloudSyncConfig', JSON.stringify(newConfig));
    alert('GitHub Gist Config Saved!');
    renderPairingSection();
    triggerPullSync();
  });

  // Create Secret Gist
  document.getElementById('btn-gh-create').addEventListener('click', async () => {
    const pat = document.getElementById('gh-pat').value.trim();
    if (!pat) return alert("PAT required to create gist.");
    try {
      const response = await fetch('https://api.github.com/gists', {
        method: 'POST',
        headers: { 'Authorization': `token ${pat}`, 'Accept': 'application/vnd.github.v3+json' },
        body: JSON.stringify({
          description: "The Recon Ledger State",
          public: false,
          files: { "recon-ledger-state.json": { content: JSON.stringify(STATE, null, 2) } }
        })
      });
      if (!response.ok) throw new Error("Failed to create Gist");
      const data = await response.json();
      document.getElementById('gh-gist-id').value = data.id;
      document.getElementById('btn-gh-save').click();
    } catch (e) {
      alert("Error: " + e.message);
    }
  });

  document.getElementById('btn-gs-copy-code').addEventListener('click', () => {
    const code = `function doGet(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("_RAW_STATE");
  if (!sheet) sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet("_RAW_STATE");
  return ContentService.createTextOutput(sheet.getRange("A1").getValue() || "{}").setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // Save raw state
    var rawSheet = ss.getSheetByName("_RAW_STATE");
    if (!rawSheet) rawSheet = ss.insertSheet("_RAW_STATE");
    rawSheet.getRange("A1").setValue(JSON.stringify(payload.state));

    // Populate human-readable syllabus ledger
    if (payload.state && payload.state.topics) {
      var ledgerSheet = ss.getSheetByName("Syllabus_Ledger");
      if (!ledgerSheet) ledgerSheet = ss.insertSheet("Syllabus_Ledger");
      ledgerSheet.clear();

      var rows = [["Subject", "Topic", "Priority", "Steps (1-6)", "Failures"]];
      payload.state.topics.forEach(function(t) {
        var stepCount = t.steps.filter(Boolean).length;
        var failCount = t.failureLog ? t.failureLog.length : 0;
        rows.push([t.subject, t.topic, t.priority, stepCount + "/6", failCount]);
      });
      ledgerSheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
    }

    return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
  } catch(err) {
    return ContentService.createTextOutput("Error").setMimeType(ContentService.MimeType.TEXT);
  }
}`;
    navigator.clipboard.writeText(code).then(() => alert('Apps Script Copied to Clipboard!'));
  });

  document.getElementById('btn-copy-magic-link').addEventListener('click', () => {
    const configStr = localStorage.getItem('cloudSyncConfig');
    if (!configStr) return;
    const magicUrl = `${window.location.origin}${window.location.pathname}#pair=${btoa(unescape(encodeURIComponent(configStr)))}`;
    navigator.clipboard.writeText(magicUrl).then(() => alert('Magic Link Copied!'));
  });
}

function renderPairingSection() {
  const configStr = localStorage.getItem('cloudSyncConfig');
  if (!configStr || configStr === '{"provider": "none"}') return;

  const section = document.getElementById('pairing-section');
  section.classList.remove('hidden');

  const b64 = btoa(unescape(encodeURIComponent(configStr)));
  const magicUrl = `${window.location.origin}${window.location.pathname}#pair=${b64}`;

  // Use public QR api to render image
  const qrContainer = document.getElementById('qr-container');
  qrContainer.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(magicUrl)}" alt="Pairing QR" style="width:100%; height:100%;">`;
}

// --- Sync Core Engine ---

async function fetchRemoteState(config) {
  if (config.provider === 'sheets') {
    const url = config.gsPin ? `${config.gsUrl}?pin=${encodeURIComponent(config.gsPin)}` : config.gsUrl;
    const response = await fetch(url, { method: 'GET', redirect: 'follow' });
    if (!response.ok) throw new Error("Sheets GET failed");
    return await response.json();
  } else if (config.provider === 'gist') {
    const response = await fetch(`https://api.github.com/gists/${config.ghGistId}`, {
      method: 'GET',
      headers: { 'Authorization': `token ${config.ghPat}`, 'Accept': 'application/vnd.github.v3+json' }
    });
    if (!response.ok) throw new Error("Gist GET failed");
    const data = await response.json();
    return JSON.parse(data.files['recon-ledger-state.json'].content);
  }
  return null;
}

async function pushRemoteState(config, state) {
  if (config.provider === 'sheets') {
    const response = await fetch(config.gsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ pin: config.gsPin, state }),
      redirect: 'follow'
    });
    if (!response.ok) throw new Error("Sheets POST failed");
  } else if (config.provider === 'gist') {
    const response = await fetch(`https://api.github.com/gists/${config.ghGistId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `token ${config.ghPat}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ files: { 'recon-ledger-state.json': { content: JSON.stringify(state, null, 2) } } })
    });
    if (!response.ok) throw new Error("Gist PATCH failed");
  }
}

// Conflict-Free Per-Item Timestamp Merge
function mergeStates(local, remote) {
  if (!remote || !remote.topics) return local;

  const merged = JSON.parse(JSON.stringify(local));

  // Merge Topics
  const remoteTopicMap = new Map(remote.topics.map(t => [t.id, t]));

  merged.topics = merged.topics.map(localT => {
    if (remoteTopicMap.has(localT.id)) {
      const remoteT = remoteTopicMap.get(localT.id);
      remoteTopicMap.delete(localT.id); // done with it
      // if remote is newer, use remote
      if ((remoteT.updatedAt || 0) > (localT.updatedAt || 0)) {
        return remoteT;
      }
    }
    return localT;
  });

  // Append new remote topics that weren't in local (and not deleted)
  for (const remoteT of remoteTopicMap.values()) {
    if (!merged.deletedTopicIds.includes(remoteT.id)) {
      merged.topics.push(remoteT);
    }
  }

  // Merge Exams & Phases (simple timestamp array merge)
  // Assuming exams and phases are static sets, we just match by ID and take latest.
  merged.exams = merged.exams.map(lEx => {
    const rEx = remote.exams?.find(r => r.id === lEx.id);
    if (rEx && (rEx.updatedAt || 0) > (lEx.updatedAt || 0)) return rEx;
    return lEx;
  });

  merged.phases = merged.phases.map(lPh => {
    const rPh = remote.phases?.find(r => r.id === lPh.id);
    if (rPh && (rPh.updatedAt || 0) > (lPh.updatedAt || 0)) return rPh;
    return lPh;
  });

  // Merge Habit Logs (Date key + habit OR)
  if (remote.habitLog) {
    for (const [date, remoteLog] of Object.entries(remote.habitLog)) {
      if (!merged.habitLog[date]) {
        merged.habitLog[date] = remoteLog;
      } else {
        const localLog = merged.habitLog[date];
        if ((remoteLog._updatedAt || 0) > (localLog._updatedAt || 0)) {
           // Remote is newer snapshot, merge missing keys
           for (const [hId, val] of Object.entries(remoteLog)) {
             if (hId === '_updatedAt') continue;
             if (val === true) localLog[hId] = true; // logical OR check
           }
           localLog._updatedAt = remoteLog._updatedAt;
        } else {
           // Local is newer snapshot, merge remote trues in case they were checked elsewhere
           for (const [hId, val] of Object.entries(remoteLog)) {
             if (hId === '_updatedAt') continue;
             if (val === true) localLog[hId] = true;
           }
        }
      }
    }
  }

  return merged;
}

function updateSyncStatus(status) {
  const el = document.getElementById('sync-status');
  if (!el) return;
  el.className = '';

  if (status === 'offline') {
    el.innerHTML = '○ Offline';
    el.classList.add('offline');
  } else if (status === 'syncing') {
    el.innerHTML = '◐ Syncing...';
    el.classList.add('syncing');
  } else {
    const now = new Date();
    el.innerHTML = `● Synced · ${now.getHours()}:${String(now.getMinutes()).padStart(2,'0')}`;
    el.classList.add('online');
  }
}

// Exposed triggers for app.js
window.triggerPullSync = async function() {
  if (!navigator.onLine) { updateSyncStatus('offline'); return; }

  const config = JSON.parse(localStorage.getItem('cloudSyncConfig') || '{"provider": "none"}');
  if (config.provider === 'none') return;

  try {
    updateSyncStatus('syncing');
    const remoteState = await fetchRemoteState(config);
    if (remoteState) {
      STATE = mergeStates(STATE, remoteState);
      localStorage.setItem('reconLedgerState', JSON.stringify(STATE));
      renderApp();
    }
    updateSyncStatus('synced');
  } catch (e) {
    console.error("Pull Sync Error:", e);
    updateSyncStatus('offline');
  }
};

window.triggerInitialSync = function() {
  window.triggerPullSync();
};

let autoSyncTimer = null;
window.triggerAutoSync = function() {
  const config = JSON.parse(localStorage.getItem('cloudSyncConfig') || '{"provider": "none"}');
  if (config.provider === 'none') return;
  if (!navigator.onLine) { updateSyncStatus('offline'); return; }

  updateSyncStatus('syncing');
  if (autoSyncTimer) clearTimeout(autoSyncTimer);

  autoSyncTimer = setTimeout(async () => {
    try {
      // Always pull & merge right before push to avoid overwriting interleaving edits
      const remoteState = await fetchRemoteState(config);
      if (remoteState) {
        STATE = mergeStates(STATE, remoteState);
        localStorage.setItem('reconLedgerState', JSON.stringify(STATE));
        renderApp(); // visually update with anything pulled
      }
      // Push merged state
      await pushRemoteState(config, STATE);
      updateSyncStatus('synced');
    } catch (e) {
      console.error("Push Sync Error:", e);
      updateSyncStatus('offline');
    }
  }, 1200); // 1.2s debounce
};

document.addEventListener('DOMContentLoaded', () => {
  setupMergeEvents();
  setupCloudSyncEvents();
  setTimeout(() => window.triggerInitialSync(), 500); // Initial sync on load
});
