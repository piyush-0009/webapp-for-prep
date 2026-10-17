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

// -- MODULE 5B: GitHub Sync Logic --

function setupGitHubSyncEvents() {
  const modal = document.getElementById('github-sync-modal');
  const btnOpen = document.getElementById('github-sync-btn');
  const btnClose = document.getElementById('close-sync-modal');
  const btnSaveConfig = document.getElementById('btn-gh-save');
  const btnPull = document.getElementById('btn-gh-pull');
  const btnPush = document.getElementById('btn-gh-push');

  // Load saved config
  const config = JSON.parse(localStorage.getItem('ghSyncConfig') || '{}');
  if (config.pat) document.getElementById('gh-pat').value = config.pat;
  if (config.repo) document.getElementById('gh-repo').value = config.repo;
  if (config.branch) document.getElementById('gh-branch').value = config.branch;
  if (config.path) document.getElementById('gh-path').value = config.path;
  if (config.autoSync) document.getElementById('gh-auto-sync').checked = true;

  if (btnOpen) btnOpen.addEventListener('click', () => modal.classList.remove('hidden'));
  if (btnClose) btnClose.addEventListener('click', () => modal.classList.add('hidden'));

  if (btnSaveConfig) {
    btnSaveConfig.addEventListener('click', () => {
      const newConfig = {
        pat: document.getElementById('gh-pat').value.trim(),
        repo: document.getElementById('gh-repo').value.trim(),
        branch: document.getElementById('gh-branch').value.trim() || 'main',
        path: document.getElementById('gh-path').value.trim() || 'data/recon-ledger-state.json',
        autoSync: document.getElementById('gh-auto-sync').checked
      };
      localStorage.setItem('ghSyncConfig', JSON.stringify(newConfig));
      alert('GitHub Sync Configuration Saved');
    });
  }

  if (btnPull) btnPull.addEventListener('click', pullFromGitHub);
  if (btnPush) btnPush.addEventListener('click', () => pushToGitHub(false));
}

async function getGitHubFile(config) {
  const url = `https://api.github.com/repos/${config.repo}/contents/${config.path}?ref=${config.branch}`;
  const response = await fetch(url, {
    headers: {
      'Authorization': `token ${config.pat}`,
      'Accept': 'application/vnd.github.v3+json'
    }
  });
  if (response.status === 404) return null; // File doesn't exist yet
  if (!response.ok) throw new Error(`GitHub API Error: ${response.statusText}`);
  return response.json();
}

async function pullFromGitHub() {
  const config = JSON.parse(localStorage.getItem('ghSyncConfig') || '{}');
  if (!config.pat || !config.repo) return alert('Configure PAT and Repo first.');

  try {
    updateSyncStatus('Pulling...');
    const fileData = await getGitHubFile(config);
    if (!fileData) {
      updateSyncStatus('No file found');
      return alert('File not found in repository.');
    }

    const content = decodeURIComponent(escape(atob(fileData.content)));
    const importedState = JSON.parse(content);

    // We replace the entire state when pulling from sync (differs from merge)
    STATE = importedState;
    saveState();
    renderApp();

    const now = new Date();
    updateSyncStatus(`Pulled ${now.getHours()}:${String(now.getMinutes()).padStart(2,'0')}`);
    alert('Successfully pulled state from GitHub.');
  } catch (e) {
    updateSyncStatus('Error');
    alert('Pull failed: ' + e.message);
  }
}

async function pushToGitHub(isAuto = false) {
  const config = JSON.parse(localStorage.getItem('ghSyncConfig') || '{}');
  if (!config.pat || !config.repo) {
    if (!isAuto) alert('Configure PAT and Repo first.');
    return;
  }

  try {
    updateSyncStatus(isAuto ? 'Auto-syncing...' : 'Pushing...');

    // 1. Get sha if file exists
    let sha = undefined;
    const fileData = await getGitHubFile(config);
    if (fileData) sha = fileData.sha;

    // 2. Prepare payload
    const contentStr = JSON.stringify(STATE, null, 2);
    // Base64 encode supporting utf-8
    const base64Content = btoa(unescape(encodeURIComponent(contentStr)));

    const url = `https://api.github.com/repos/${config.repo}/contents/${config.path}`;
    const payload = {
      message: `Recon Ledger Sync: ${new Date().toISOString()}`,
      content: base64Content,
      branch: config.branch
    };
    if (sha) payload.sha = sha;

    // 3. Push
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${config.pat}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) throw new Error(`Push failed: ${response.statusText}`);

    const now = new Date();
    updateSyncStatus(`Synced ${now.getHours()}:${String(now.getMinutes()).padStart(2,'0')}`);
    if (!isAuto) alert('Successfully pushed state to GitHub.');
  } catch (e) {
    updateSyncStatus('Sync Error');
    if (!isAuto) alert('Push failed: ' + e.message);
    else console.error('Auto-sync failed', e);
  }
}

function updateSyncStatus(msg) {
  const el = document.getElementById('sync-status');
  if (el) el.textContent = msg;
}

// Debounced Auto-sync
let autoSyncTimer = null;
window.triggerAutoSync = function() {
  const config = JSON.parse(localStorage.getItem('ghSyncConfig') || '{}');
  if (config.pat && config.repo && config.autoSync) {
    if (autoSyncTimer) clearTimeout(autoSyncTimer);
    updateSyncStatus('Pending...');
    autoSyncTimer = setTimeout(() => {
      pushToGitHub(true);
    }, 1500); // Debounce 1.5s
  }
};

document.addEventListener('DOMContentLoaded', () => {
  setupMergeEvents();
  setupGitHubSyncEvents();
});
