// State initialization and helper functions
function escapeHTML(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

let STATE = {
  phases: [],
  exams: [],
  habits: [],
  topics: [],
  habitLog: {},
  deletedTopicIds: []
};

function initApp() {
  const savedState = localStorage.getItem('reconLedgerState');
  if (savedState) {
    try {
      STATE = JSON.parse(savedState);
      // Migrate missing keys if needed
      if (!STATE.habitLog) STATE.habitLog = {};
      if (!STATE.deletedTopicIds) STATE.deletedTopicIds = [];
    } catch (e) {
      console.error("Error parsing local state, falling back to seed", e);
      STATE = JSON.parse(JSON.stringify(SEED_DATA));
    }
  } else {
    STATE = JSON.parse(JSON.stringify(SEED_DATA));
  }

  setupEventListeners();
  renderApp();

  if (window.SyncEngine) {
    SyncEngine.init({
      getState: () => STATE,
      setStateAndRender: (newState) => {
        STATE = newState;
        saveState();
        renderApp();
      }
    });
  }
}

function saveState() {
  localStorage.setItem('reconLedgerState', JSON.stringify(STATE));
  }

function updateItemTimestamp(item) {
  if (window.SyncEngine) {
    SyncEngine.recordMutation(item);
  } else if (item) {
    item.updatedAt = Date.now();
  }
}

function getLogicalDateString(dateObj = new Date()) {
  const d = new Date(dateObj.getTime());
  d.setHours(d.getHours() - 4); // 4:00 AM reset
  return d.toISOString().split('T')[0];
}

function toggleTheme() {
  const body = document.body;
  if (body.classList.contains('theme-day')) {
    body.classList.replace('theme-day', 'theme-night');
    localStorage.setItem('theme', 'theme-night');
  } else {
    body.classList.replace('theme-night', 'theme-day');
    localStorage.setItem('theme', 'theme-day');
  }
}

// Initial theme setup
const savedTheme = localStorage.getItem('theme') || 'theme-day';
document.body.className = savedTheme;

// Placeholders for rendering functions to allow sequential plan execution
function setupEventListeners() {
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
}

function renderApp() {
  renderCommandCenter();
  renderTodaysDesk(); // placeholder logic until queue implemented
  renderFranklinGrid(); // placeholder logic until grid implemented
  renderMasterLedger();
}

// --- MODULE 1: Command Center & Campaign Bar ---
function renderCommandCenter() {
  const phaseSelector = document.getElementById('campaign-phase-selector');
  phaseSelector.innerHTML = '';
  STATE.phases.forEach(phase => {
    const option = document.createElement('option');
    option.value = phase.id;
    option.textContent = `[${phase.dates}] ${phase.name}`;
    option.selected = phase.isActive;
    phaseSelector.appendChild(option);
  });

  const subtitleEl = document.querySelector('.title-section .subtitle');
  const activePhase = STATE.phases.find(p => p.isActive) || STATE.phases[0];
  if(activePhase) subtitleEl.textContent = activePhase.motto;

  const strip = document.getElementById('exam-countdown-strip');
  strip.innerHTML = '';
  STATE.exams.forEach(exam => {
    const target = new Date(exam.targetDate);
    const today = new Date();
    const diffTime = target - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    const card = document.createElement('div');
    card.className = `exam-card mode-${exam.mode.toLowerCase()}`;

    // Calculate progress
    let totalSteps = 0;
    let completedSteps = 0;
    STATE.topics.forEach(t => {
      if(t.examTags.includes(exam.id)) {
        totalSteps += 6;
        completedSteps += t.steps.filter(Boolean).length;
      }
    });
    const progressPercent = totalSteps === 0 ? 0 : Math.round((completedSteps / totalSteps) * 100);

    card.innerHTML = `
      <div class="exam-header">
        <span contenteditable="true" data-id="${escapeHTML(exam.id)}" class="editable-exam-name">${escapeHTML(exam.name)}</span>
        <span class="mode-pill" data-id="${escapeHTML(exam.id)}">${escapeHTML(exam.mode)}</span>
      </div>
      <div>
        <input type="date" class="editable-exam-date" data-id="${escapeHTML(exam.id)}" value="${escapeHTML(exam.targetDate)}" style="background:transparent; border:none; color:inherit; font-family:inherit; font-size:0.8rem;">
        <span class="exam-days tabular-nums">${diffDays > 0 ? diffDays : 0}</span> days
      </div>
      <div class="exam-progress">
        <div class="exam-progress-bar" style="width: ${progressPercent}%"></div>
      </div>
      <div style="font-size: 0.75rem" class="tabular-nums">${progressPercent}% Recon</div>
    `;
    strip.appendChild(card);
  });

  // Attach mode toggle event
  document.querySelectorAll('.mode-pill').forEach(pill => {
    pill.addEventListener('click', (e) => {
      const id = e.target.getAttribute('data-id');
      const exam = STATE.exams.find(ex => ex.id === id);
      if(exam.mode === "Active") exam.mode = "Drip";
      else if(exam.mode === "Drip") exam.mode = "Standby";
      else exam.mode = "Active";
      updateItemTimestamp(exam);
      saveState();
      renderApp();
    });
  });

  phaseSelector.addEventListener('change', (e) => {
    STATE.phases.forEach(p => {
      if (p.id === e.target.value) { p.isActive = true; updateItemTimestamp(p); }
      else if (p.isActive) { p.isActive = false; updateItemTimestamp(p); }
    });
    saveState();
    renderApp();
  });

  document.querySelectorAll('.editable-exam-name').forEach(el => {
    el.addEventListener('blur', (e) => {
      const exam = STATE.exams.find(ex => ex.id === e.target.getAttribute('data-id'));
      exam.name = e.target.textContent;
      updateItemTimestamp(exam);
      saveState();
      renderApp();
    });
  });

  document.querySelectorAll('.editable-exam-date').forEach(el => {
    el.addEventListener('change', (e) => {
      const exam = STATE.exams.find(ex => ex.id === e.target.getAttribute('data-id'));
      exam.targetDate = e.target.value;
      updateItemTimestamp(exam);
      saveState();
      renderApp();
    });
  });
}

// --- MODULE 4 & 5: Master Syllabus Ledger & Dossier ---
let currentDossierTopicId = null;

function renderMasterLedger() {
  const tableBody = document.querySelector('#master-ledger-table tbody');
  tableBody.innerHTML = '';

  const filterExam = document.getElementById('filter-exam').value;
  const filterLayer = document.getElementById('filter-layer').value;
  const filterStatus = document.getElementById('filter-status').value;
  const searchQ = document.getElementById('search-topic').value.toLowerCase();

  let filtered = STATE.topics.filter(t => {
    if (filterExam !== 'All' && !t.examTags.includes(filterExam)) return false;
    if (filterLayer !== 'All' && t.priority !== filterLayer) return false;
    if (filterStatus !== 'All' && t.status !== filterStatus) return false;
    if (searchQ && !t.subject.toLowerCase().includes(searchQ) && !t.topic.toLowerCase().includes(searchQ)) return false;
    return true;
  });

  filtered.forEach(topic => {
    const tr = document.createElement('tr');
    const hasUnresolvedAB = topic.failureLog.some(log => (log.cat === 'A' || log.cat === 'B') && !log.resolved);
    const repairDot = hasUnresolvedAB ? `<span style="color:var(--accent-alert)"> 🔴 48h</span>` : '';
    const sixStemCount = topic.sixStems ? topic.sixStems.filter(Boolean).length : 0;

    tr.innerHTML = `
      <td class="pin-btn" data-id="${escapeHTML(topic.id)}">${topic.pinned ? '★' : '☆'}</td>
      <td class="topic-cell" data-id="${escapeHTML(topic.id)}">
        <strong>${escapeHTML(topic.subject)}</strong>: ${escapeHTML(topic.topic)} ${repairDot}
        <br><span style="font-size:0.75rem; color:var(--text-secondary)">${escapeHTML(topic.examTags.join(', '))}</span>
      </td>
      ${topic.steps.map((s, idx) => `
        <td><input type="checkbox" class="step-check" data-id="${escapeHTML(topic.id)}" data-idx="${idx}" ${s ? 'checked' : ''}></td>
      `).join('')}
      <td>${sixStemCount}/6</td>
      <td><button class="btn-icon open-dossier" data-id="${escapeHTML(topic.id)}">🗂️</button></td>
    `;
    tableBody.appendChild(tr);
  });

  document.querySelectorAll('.pin-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const topic = STATE.topics.find(t => t.id === e.target.getAttribute('data-id'));
      topic.pinned = !topic.pinned;
      updateItemTimestamp(topic);
      saveState();
      renderApp();
    });
  });

  document.querySelectorAll('.step-check').forEach(chk => {
    chk.addEventListener('change', (e) => {
      const id = e.target.getAttribute('data-id');
      const idx = parseInt(e.target.getAttribute('data-idx'));
      const topic = STATE.topics.find(t => t.id === id);
      topic.steps[idx] = e.target.checked;
      updateItemTimestamp(topic);

      // Auto-mark Habit 1 if any step is checked
      if (e.target.checked) {
        markHabit1();
      }

      if (idx === 5 && e.target.checked) {
        handleStep6Completion(topic);
      } else {
        saveState();
        renderApp();
      }
    });
  });

  document.querySelectorAll('.open-dossier, .topic-cell').forEach(el => {
    el.addEventListener('click', (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      openDossier(id);
    });
  });
}

function handleStep6Completion(topic, cardElement = null) {
  if (cardElement) {
    cardElement.innerHTML = `
      <div style="padding:1rem; border: 1px solid var(--border-hairline); background: var(--bg-elevated);">
        <p style="margin-bottom:0.5rem; font-weight:bold;">Step 6 Complete: "${escapeHTML(topic.topic)}"</p>
        <button class="btn-primary btn-master-topic" style="margin-right:0.5rem;">[Locked In (Mastered)]</button>
        <button class="btn btn-cooldown-topic">[Needs Another Pass (7d Cooldown)]</button>
      </div>
    `;

    cardElement.querySelector('.btn-master-topic').addEventListener('click', () => {
      topic.status = "Mastered";
      updateItemTimestamp(topic);
      saveState();
      renderApp();
    });

    cardElement.querySelector('.btn-cooldown-topic').addEventListener('click', () => {
      topic.steps[5] = false;
      const d = new Date();
      d.setDate(d.getDate() + 7);
      topic.cooldownUntil = d.toISOString().split('T')[0];
      topic.status = "Cooldown";
      updateItemTimestamp(topic);
      saveState();
      renderApp();
    });
  } else {
    // Fallback for Master Ledger clicks where we don't pass the cardElement easily
    const choice = confirm(`Topic "${topic.topic}" Step 6 completed. \n\nClick OK for [Locked In (Mastered)]\nClick Cancel for [Needs Another Pass (7d Cooldown)]`);
    if (choice) {
      topic.status = "Mastered";
    } else {
      topic.steps[5] = false;
      const d = new Date();
      d.setDate(d.getDate() + 7);
      topic.cooldownUntil = d.toISOString().split('T')[0];
      topic.status = "Cooldown";
    }
    updateItemTimestamp(topic);
    saveState();
    renderApp();
  }
}

function markHabit1() {
  const today = getLogicalDateString();
  if (!STATE.habitLog[today]) STATE.habitLog[today] = {};
  STATE.habitLog[today]['habit-1'] = true;
  STATE.habitLog[today]['_updatedAt'] = Date.now();
  saveState();
  renderApp();
}

function openDossier(id) {
  currentDossierTopicId = id;
  const topic = STATE.topics.find(t => t.id === id);
  const drawer = document.getElementById('dossier-drawer');
  const body = document.getElementById('dossier-body');

  if(!topic.sixStems) topic.sixStems = [false,false,false,false,false,false];

  const sixStemCount = topic.sixStems.filter(Boolean).length;
  let verdict = '0-3/6: Repair Required';
  if(sixStemCount === 6) verdict = '6/6 Blind: Mastered';
  else if(sixStemCount >= 4) verdict = '4-5/6: Unstable (Repair Missed Operations)';

  body.innerHTML = `
    <div class="dossier-section">
      <label>Notes & Target Map:</label>
      <textarea id="dossier-notes-input" rows="6">${topic.dossierNotes}</textarea>
      <span id="save-indicator" style="font-size: 0.75rem; color: var(--text-secondary); margin-left: 10px;"></span>
    </div>

    <div class="dossier-section">
      <h3>Six-Stem Mastery Test</h3>
      <div style="font-size:0.85rem; margin-bottom:0.5rem">Verdict: <strong>${verdict}</strong></div>
      ${['Identify', 'Match', 'Order', 'Calculate', 'Interpret', 'Perturb → Infer'].map((label, idx) => `
        <label style="display:block; margin-bottom:0.3rem">
          <input type="checkbox" class="six-stem-check" data-idx="${idx}" ${topic.sixStems[idx] ? 'checked' : ''}>
          ${idx+1}. ${label}
        </label>
      `).join('')}
    </div>

    <div class="dossier-section">
      <h3>Failure Ledger</h3>
      <div class="failure-log-form">
        <input type="text" id="new-fail-id" placeholder="PYQ ID / Stem">
        <select id="new-fail-cat">
          <option value="A">A - Conceptual (48h Repair)</option>
          <option value="B">B - Misinterpretation (48h Repair)</option>
          <option value="C">C - Careless</option>
          <option value="D">D - Calculation</option>
        </select>
        <input type="text" id="new-fail-note" placeholder="Trap / Repair Note">
        <button class="btn" id="add-failure-btn">Log Error</button>
      </div>
      <div>
        ${topic.failureLog.map((log, idx) => `
          <div class="failure-item ${log.resolved ? 'resolved' : ''}">
            <label>
              <input type="checkbox" class="resolve-fail-check" data-idx="${idx}" ${log.resolved ? 'checked' : ''}>
              [${escapeHTML(log.cat)}] ${escapeHTML(log.id)} - ${escapeHTML(log.note)}
            </label>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  drawer.classList.remove('hidden');

  let saveTimeout;
  document.getElementById('dossier-notes-input').addEventListener('input', (e) => {
    clearTimeout(saveTimeout);
    document.getElementById('save-indicator').textContent = 'Saving...';
    saveTimeout = setTimeout(() => {
      topic.dossierNotes = e.target.value;
      updateItemTimestamp(topic);
      saveState();
      document.getElementById('save-indicator').textContent = 'Saved';
      setTimeout(() => document.getElementById('save-indicator').textContent = '', 2000);
    }, 1000);
  });

  document.querySelectorAll('.six-stem-check').forEach(chk => {
    chk.addEventListener('change', (e) => {
      const idx = parseInt(e.target.getAttribute('data-idx'));
      topic.sixStems[idx] = e.target.checked;
      updateItemTimestamp(topic);
      saveState();
      openDossier(id); // refresh verdict
      renderApp();
    });
  });

  document.getElementById('add-failure-btn').addEventListener('click', () => {
    topic.failureLog.push({
      id: document.getElementById('new-fail-id').value,
      cat: document.getElementById('new-fail-cat').value,
      note: document.getElementById('new-fail-note').value,
      resolved: false
    });
    updateItemTimestamp(topic);
    saveState();
    openDossier(id);
    renderApp();
  });

  document.querySelectorAll('.resolve-fail-check').forEach(chk => {
    chk.addEventListener('change', (e) => {
      const idx = parseInt(e.target.getAttribute('data-idx'));
      topic.failureLog[idx].resolved = e.target.checked;
      updateItemTimestamp(topic);
      saveState();
      openDossier(id);
      renderApp();
    });
  });
}

function setupExtraEvents() {
  document.getElementById('close-dossier').addEventListener('click', () => {
    document.getElementById('dossier-drawer').classList.add('hidden');
    currentDossierTopicId = null;
  });

  document.getElementById('btn-quick-add').addEventListener('click', () => {
    const subject = document.getElementById('add-subject').value;
    const tName = document.getElementById('add-topic').value;
    const prio = document.getElementById('add-priority').value;
    if(!subject || !tName) return alert("Subject and Topic required");

    const newTopic = {
      id: 't' + Date.now(),
      subject,
      topic: tName,
      priority: prio,
      pyqWeight: 0,
      examTags: [],
      pinned: false,
      dossierNotes: "",
      steps: [false,false,false,false,false,false],
      sixStems: [false,false,false,false,false,false],
      failureLog: [],
      cooldownUntil: null,
      status: "In Progress",
      updatedAt: Date.now()
    };
    STATE.topics.push(newTopic);

    document.getElementById('add-subject').value = '';
    document.getElementById('add-topic').value = '';
    saveState();
    renderApp();
  });

  // Populate filter exams
  const examFilter = document.getElementById('filter-exam');
  examFilter.innerHTML = '<option value="All">All Exams</option>';
  STATE.exams.forEach(ex => {
    examFilter.innerHTML += `<option value="${escapeHTML(ex.id)}">${escapeHTML(ex.name)}</option>`;
  });

  // Attach live filter events
  document.getElementById('filter-exam').addEventListener('change', renderMasterLedger);
  document.getElementById('filter-layer').addEventListener('change', renderMasterLedger);
  document.getElementById('filter-status').addEventListener('change', renderMasterLedger);
  document.getElementById('search-topic').addEventListener('input', renderMasterLedger);
}

// To be overridden by queue/grid implementations
function renderTodaysDesk() {
  const container = document.getElementById('todays-desk-container');
  container.innerHTML = '';

  const activeExams = STATE.exams.filter(e => e.mode === 'Active').map(e => e.id);
  const dripExams = STATE.exams.filter(e => e.mode === 'Drip').map(e => e.id);
  const today = getLogicalDateString();

  // Algorithm:
  // 1. 48-Hour Failure Repairs
  // 2. Pinned
  // 3. Cooldowns ready
  // 4. Auto-Stepping Priority (Active Exams) sorted by Layer & PYQ weight
  // 5. 1 Drip slot

  let queue = [];

  STATE.topics.forEach(t => {
    if (t.status === 'Mastered') return;

    let isRepair = t.failureLog.some(l => (l.cat === 'A' || l.cat === 'B') && !l.resolved);
    let isCooldownReady = t.status === 'Cooldown' && t.cooldownUntil && t.cooldownUntil <= today;
    let isActive = t.examTags.some(tag => activeExams.includes(tag));
    let isDrip = t.examTags.some(tag => dripExams.includes(tag));

    if (t.status === 'Cooldown' && !isCooldownReady && !isRepair && !t.pinned) return;

    let score = 0;
    if (isRepair) score += 10000;
    if (t.pinned) score += 5000;
    if (isCooldownReady) score += 2000;
    if (t.priority.includes('Layer A')) score += 400;
    else if (t.priority.includes('Layer B')) score += 300;
    else if (t.priority.includes('Layer C')) score += 200;
    else if (t.priority.includes('Layer D')) score += 100;

    score += (t.pyqWeight || 0);

    // Only include if it belongs to active/drip or is explicitly pinned/repair
    if (isActive || isDrip || isRepair || t.pinned || isCooldownReady) {
      queue.push({ topic: t, score, isDrip, isRepair });
    }
  });

  queue.sort((a, b) => b.score - a.score);

  // Take top 6. Ensure max 1 drip unless overridden by pinned/repair
  let finalQueue = [];
  let dripCount = 0;
  for (let item of queue) {
    if (finalQueue.length >= 6) break;
    if (item.isDrip && !item.isRepair && !item.topic.pinned && dripCount >= 1) continue;

    finalQueue.push(item);
    if (item.isDrip) dripCount++;
  }

  if (finalQueue.length === 0) {
    container.innerHTML = `<div style="padding:1rem; color:var(--text-secondary)">Queue empty. Good work.</div>`;
    return;
  }

  finalQueue.forEach(item => {
    const t = item.topic;
    const card = document.createElement('div');
    card.className = `topic-card ${item.isRepair ? 'repair-required' : ''}`;

    const nextStepIdx = t.steps.findIndex(s => s === false);
    const stepNames = [
      "Deepen Topic", "Every PYQ", "Failure-Point Map",
      "PYQ Blind-Spot / High-Prob Map", "Exhaustive Question-Gen Table", "New Rigorous Practice Cycle"
    ];

    const stepText = nextStepIdx === -1 ? "All Steps Complete" : `Step ${nextStepIdx + 1}: ${stepNames[nextStepIdx]}`;
    const repairBadge = item.isRepair ? `<span style="color:var(--accent-alert); font-weight:bold; font-size:0.75rem;">🔴 48H REPAIR REQUIRED (Cat A/B)</span>` : '';

    card.innerHTML = `
      <div class="card-header">
        <div>
          <div class="card-subject">${escapeHTML(t.subject)}</div>
          <div class="card-title">${escapeHTML(t.topic)}</div>
        </div>
        <button class="btn-icon open-dossier" data-id="${escapeHTML(t.id)}">🗂️</button>
      </div>
      ${repairBadge}
      <div class="card-tags">
        ${t.examTags.map(tag => `<span class="tag-pill">${escapeHTML(tag)}</span>`).join('')}
        <span class="tag-pill" style="background:var(--bg-elevated); border:1px solid var(--border-hairline)">${escapeHTML(t.priority.split(' ')[0])}</span>
      </div>
      <div class="card-action">
        ${nextStepIdx !== -1 ? `
          <input type="checkbox" class="desk-step-check" data-id="${escapeHTML(t.id)}" data-idx="${nextStepIdx}">
          <label> [ ] ${stepText}</label>
        ` : `<label>All steps complete. Ready for Mastery.</label>`}
      </div>
    `;
    container.appendChild(card);
  });

  document.querySelectorAll('.desk-step-check').forEach(chk => {
    chk.addEventListener('change', (e) => {
      if(e.target.checked) {
        const id = e.target.getAttribute('data-id');
        const idx = parseInt(e.target.getAttribute('data-idx'));
        const topic = STATE.topics.find(t => t.id === id);

        topic.steps[idx] = true;
        updateItemTimestamp(topic);
        markHabit1();

        if (idx === 5) {
          // Pass the card element to render the inline prompt
          handleStep6Completion(topic, e.target.closest('.topic-card'));
        } else {
          saveState();
          renderApp(); // re-sorts and auto-steps
        }
      }
    });
  });

  // Re-attach dossier events for desk cards
  document.querySelectorAll('.todays-desk-section .open-dossier').forEach(el => {
    el.addEventListener('click', (e) => openDossier(e.currentTarget.getAttribute('data-id')));
  });
}

function renderFranklinGrid() {
  const container = document.getElementById('franklin-matrix-container');
  const todayStr = getLogicalDateString();
  const d = new Date();
  d.setHours(d.getHours() - 4);
  const currentDayOfWeek = d.getDay(); // 0 is Sunday

  // Calculate the dates for the current week (Monday to Sunday)
  const weekDates = [];
  const mondayOffset = currentDayOfWeek === 0 ? -6 : 1 - currentDayOfWeek;
  const startOfWeek = new Date(d);
  startOfWeek.setDate(d.getDate() + mondayOffset);

  for (let i = 0; i < 7; i++) {
    const day = new Date(startOfWeek);
    day.setDate(startOfWeek.getDate() + i);
    weekDates.push(day.toISOString().split('T')[0]);
  }

  const dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  let html = `<table><thead><tr><th>Habit</th>`;
  dayLabels.forEach(lbl => html += `<th>${lbl}</th>`);
  html += `</tr></thead><tbody>`;

  STATE.habits.forEach(habit => {
    html += `<tr><td class="habit-name">${escapeHTML(habit.name)}</td>`;
    weekDates.forEach(dateStr => {
      const isDone = STATE.habitLog[dateStr] && STATE.habitLog[dateStr][habit.id];
      html += `<td class="habit-dot" data-date="${dateStr}" data-habit="${escapeHTML(habit.id)}">
                 ${isDone ? '●' : '&nbsp;'}
               </td>`;
    });
    html += `</tr>`;
  });
  html += `</tbody></table>`;
  container.innerHTML = html;

  document.querySelectorAll('.habit-dot').forEach(dot => {
    dot.addEventListener('click', (e) => {
      const date = e.target.getAttribute('data-date');
      const habitId = e.target.getAttribute('data-habit');
      if (!STATE.habitLog[date]) STATE.habitLog[date] = {};
      STATE.habitLog[date][habitId] = !STATE.habitLog[date][habitId];
      STATE.habitLog[date]['_updatedAt'] = Date.now();
      saveState();
      renderApp();
    });
  });

  // Render Heatmap
  const heatmapContainer = document.getElementById('heatmap-container');
  heatmapContainer.innerHTML = '';
  // 12 weeks * 7 days = 84 days
  const heatStart = new Date(d);
  heatStart.setDate(d.getDate() - 83);

  for(let i=0; i<84; i++) {
    const heatDate = new Date(heatStart);
    heatDate.setDate(heatStart.getDate() + i);
    const dateStr = heatDate.toISOString().split('T')[0];

    let count = 0;
    if(STATE.habitLog[dateStr]) {
      count = Object.values(STATE.habitLog[dateStr]).filter(Boolean).length;
    }

    const cell = document.createElement('div');
    cell.className = 'heat-cell';
    cell.title = `${dateStr}: ${count} habits`;
    if(count > 0) {
      const intensity = Math.min(count / 4, 1);
      cell.style.backgroundColor = `rgba(45, 106, 79, ${intensity})`; // using green hue
    }
    heatmapContainer.appendChild(cell);
  }
}

// Enhance setupEventListeners to call setupExtraEvents
const originalSetup = setupEventListeners;
setupEventListeners = function() {
  originalSetup();
  setupExtraEvents();
  setupMergeEvents();
  setupCloudSyncEvents();
};

document.addEventListener('DOMContentLoaded', () => {
  initApp();

});


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




function setupCloudSyncEvents() {
  const modal = document.getElementById('github-sync-modal');
  const btnOpen = document.getElementById('github-sync-btn');
  const btnClose = document.getElementById('close-sync-modal');

  // Tabs
  const tabSheets = document.getElementById('tab-sheets');
  const tabGist = document.getElementById('tab-gist');
  const paneSheets = document.getElementById('pane-sheets');
  const paneGist = document.getElementById('pane-gist');

  if (btnOpen) btnOpen.addEventListener('click', () => {
    modal.classList.remove('hidden');

    if (window.SyncEngine) {
      const config = SyncEngine.getConfig();
      if (config.provider === 'gist') {
        tabGist.click();
      } else {
        tabSheets.click();
      }
      if (config.scriptUrl) document.getElementById('gs-url').value = config.scriptUrl;
      if (config.pin) document.getElementById('gs-pin').value = config.pin;
      if (config.gistToken) document.getElementById('gh-pat').value = config.gistToken;
      if (config.gistId) document.getElementById('gh-gist-id').value = config.gistId;
    }
  });

  if (btnClose) btnClose.addEventListener('click', () => modal.classList.add('hidden'));

  // Tab switching
  if (tabSheets) {
    tabSheets.addEventListener('click', () => {
      tabSheets.classList.add('active');
      tabGist.classList.remove('active');
      paneSheets.classList.remove('hidden');
      paneGist.classList.add('hidden');
    });
  }
  if (tabGist) {
    tabGist.addEventListener('click', () => {
      tabGist.classList.add('active');
      tabSheets.classList.remove('active');
      paneGist.classList.remove('hidden');
      paneSheets.classList.add('hidden');
    });
  }

  // Save Config Option A (Sheets)
  const btnGsSave = document.getElementById('btn-gs-save');
  if (btnGsSave) {
    btnGsSave.addEventListener('click', () => {
      const newConfig = {
        provider: 'sheets',
        scriptUrl: document.getElementById('gs-url').value.trim(),
        pin: document.getElementById('gs-pin').value.trim(),
        autoSync: true
      };
      if (!newConfig.scriptUrl) return alert("Web App URL is required.");
      if (window.SyncEngine) {
        SyncEngine.saveConfig(newConfig);
        alert('Google Sheets Config Saved!');
        SyncEngine.syncNow('merge');
      }
    });
  }

  // Save Config Option B (Gist)
  const btnGhSave = document.getElementById('btn-gh-save');
  if (btnGhSave) {
    btnGhSave.addEventListener('click', () => {
      const newConfig = {
        provider: 'gist',
        gistToken: document.getElementById('gh-pat').value.trim(),
        gistId: document.getElementById('gh-gist-id').value.trim(),
        autoSync: true
      };
      if (!newConfig.gistToken || !newConfig.gistId) return alert("PAT and Gist ID required.");
      if (window.SyncEngine) {
        SyncEngine.saveConfig(newConfig);
        alert('GitHub Gist Config Saved!');
        SyncEngine.syncNow('merge');
      }
    });
  }

  // Create Secret Gist
  const btnGhCreate = document.getElementById('btn-gh-create');
  if (btnGhCreate) {
    btnGhCreate.addEventListener('click', async () => {
      const pat = document.getElementById('gh-pat').value.trim();
      if (!pat) return alert("PAT required to create gist.");
      if (window.SyncEngine) {
        try {
           const id = await SyncEngine.createNewGist(pat, STATE);
           document.getElementById('gh-gist-id').value = id;
           document.getElementById('btn-gh-save').click();
        } catch(e) {
           alert(e.message);
        }
      }
    });
  }

  const btnGsCopyCode = document.getElementById('btn-gs-copy-code');
  if (btnGsCopyCode) {
    btnGsCopyCode.addEventListener('click', () => {
        const code = `function doGet(e) {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("_RAW_STATE");
    if (!sheet) sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet("_RAW_STATE");
    return ContentService.createTextOutput(sheet.getRange("A1").getValue() || "{}").setMimeType(ContentService.MimeType.JSON);
  }

  function doPost(e) {
    try {
      var payload = JSON.parse(e.postData.contents);
      var ss = SpreadsheetApp.getActiveSpreadsheet();

      var rawSheet = ss.getSheetByName("_RAW_STATE");
      if (!rawSheet) rawSheet = ss.insertSheet("_RAW_STATE");
      rawSheet.getRange("A1").setValue(JSON.stringify(payload));

      return ContentService.createTextOutput(JSON.stringify({success: true})).setMimeType(ContentService.MimeType.JSON);
    } catch(err) {
      return ContentService.createTextOutput(JSON.stringify({error: err.toString()})).setMimeType(ContentService.MimeType.JSON);
    }
  }`;
      navigator.clipboard.writeText(code).then(() => alert('Apps Script Copied to Clipboard!'));
    });
  }

  const btnCopyMagicLink = document.getElementById('btn-copy-magic-link');
  if (btnCopyMagicLink) {
    btnCopyMagicLink.addEventListener('click', () => {
       const linkInput = document.getElementById('sync-pairing-link');
       if (linkInput && linkInput.value) {
         navigator.clipboard.writeText(linkInput.value).then(() => alert('Magic Link Copied!'));
       } else {
         if (window.SyncEngine) {
           const cfg = SyncEngine.getConfig();
           const payload = encodeURIComponent(btoa(JSON.stringify(cfg)));
           const magicUrl = `${window.location.origin}${window.location.pathname}#pair=${payload}`;
           navigator.clipboard.writeText(magicUrl).then(() => alert('Magic Link Copied!'));
         }
       }
    });
  }

  // New sync buttons
  const btnSyncMergeNow = document.getElementById('btn-sync-merge-now');
  if (btnSyncMergeNow) {
    btnSyncMergeNow.addEventListener('click', () => {
      if (window.SyncEngine) SyncEngine.syncNow('merge');
    });
  }

  const btnForcePush = document.getElementById('btn-force-push');
  if (btnForcePush) {
    btnForcePush.addEventListener('click', () => {
      if (window.SyncEngine) {
        if (confirm("Are you sure you want to overwrite cloud data with your local data?")) {
           SyncEngine.syncNow('force-push');
        }
      }
    });
  }

  const btnForcePull = document.getElementById('btn-force-pull');
  if (btnForcePull) {
    btnForcePull.addEventListener('click', () => {
      if (window.SyncEngine) {
        if (confirm("Are you sure you want to overwrite local data with cloud data?")) {
           SyncEngine.syncNow('force-pull');
        }
      }
    });
  }
}
