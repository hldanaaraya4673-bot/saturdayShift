/* ==========================================================================
   SATURNSHIFT PREMIUM WEB APP LOGIC
   Queue-based Round-Robin Scheduler with LocalStorage, Overrides & Analytics
   ========================================================================== */

// 1. STATE MANAGEMENT
const STATE_KEY = 'saturnshift_state_v1';

let state = {
  employees: [],
  exclusions: [],
  overrides: {},
  swaps: [],
  startDate: '',
  duration: 52,
  shiftSize: 2
};

// Default setup as per the user's screenshot
const DEFAULT_EMPLOYEES = [
  { id: 'emp-1', name: 'Kuku', gradient: 1, active: true },
  { id: 'emp-2', name: 'Dagi', gradient: 2, active: true },
  { id: 'emp-3', name: 'Nesti', gradient: 3, active: true },
  { id: 'emp-4', name: 'Tame', gradient: 4, active: true },
  { id: 'emp-5', name: 'Mel', gradient: 5, active: true }
];

// Helper: Local Date Parse & Format (Avoids UTC shift issues)
function parseLocalDate(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Find next Saturday from a given date (or the date itself if it is Saturday)
function getNextSaturday(date) {
  const resultDate = new Date(date);
  const day = resultDate.getDay();
  const diff = (6 - day + 7) % 7;
  resultDate.setDate(resultDate.getDate() + diff);
  return resultDate;
}

// Toast Notification popup function
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let iconSvg = '';
  if (type === 'success') {
    iconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
  } else if (type === 'danger') {
    iconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
  } else if (type === 'warning') {
    iconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
  } else {
    iconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
  }
  
  toast.innerHTML = `
    <div class="toast-icon">${iconSvg}</div>
    <div class="toast-message">${message}</div>
  `;
  
  container.appendChild(toast);
  
  // Trigger transition
  setTimeout(() => toast.classList.add('show'), 20);
  
  // Auto dismiss
  setTimeout(() => {
    toast.classList.remove('show');
    toast.addEventListener('transitionend', () => toast.remove());
  }, 4000);
}

// Initialize state
function initState() {
  const savedState = localStorage.getItem(STATE_KEY);
  if (savedState) {
    try {
      state = JSON.parse(savedState);
      // Ensure all fields exist
      if (!state.employees) state.employees = [...DEFAULT_EMPLOYEES];
      if (!state.exclusions) state.exclusions = [];
      if (!state.overrides) state.overrides = {};
      if (!state.swaps) state.swaps = [];
      if (!state.startDate) state.startDate = formatDateString(getNextSaturday(new Date()));
      if (!state.duration) state.duration = 52;
      if (!state.shiftSize) state.shiftSize = 2;
    } catch (e) {
      console.error("Failed to parse saved state, resetting...", e);
      resetToDefault();
    }
  } else {
    resetToDefault(false); // don't save yet, will save in saveState()
  }
}

function saveState() {
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

function resetToDefault(shouldReload = true) {
  state.employees = JSON.parse(JSON.stringify(DEFAULT_EMPLOYEES)); // deep copy
  state.exclusions = [];
  state.overrides = {};
  state.swaps = [];
  state.startDate = formatDateString(getNextSaturday(new Date()));
  state.duration = 52;
  state.shiftSize = 2;
  saveState();
  if (shouldReload) {
    initUI();
    renderAll();
  }
}

// 2. SCHEDULING ALGORITHM (Queue-based Fair Rotation)
function generateSchedule() {
  const schedule = [];
  let currentDate = parseLocalDate(state.startDate);
  
  // Align start date to the next Saturday
  currentDate = getNextSaturday(currentDate);
  
  const activeEmployees = state.employees.filter(e => e.active);
  if (activeEmployees.length === 0) return [];
  
  // Fair Queue: initialized with active employees in their defined order
  let queue = [...activeEmployees];
  
  for (let w = 0; w < state.duration; w++) {
    const dateStr = formatDateString(currentDate);
    let assigned = [];
    let isOverride = false;
    let isAdjusted = false;
    
    // A. CHECK FOR MANUAL OVERRIDES FOR THIS SATURDAY
    if (state.overrides[dateStr] && state.overrides[dateStr].length > 0) {
      assigned = state.overrides[dateStr].map(name => {
        const found = state.employees.find(e => e.name.toLowerCase() === name.toLowerCase());
        return found || { id: 'temp-' + name, name: name, gradient: 7, active: false, isPlaceholder: true };
      });
      isOverride = true;
      
      // Fairness Rule: Move any active assigned employees to the back of the queue
      // so they don't get selected again immediately in the normal cycle
      assigned.forEach(emp => {
        if (!emp.isPlaceholder && emp.active) {
          const idx = queue.findIndex(q => q.id === emp.id);
          if (idx !== -1) {
            queue.splice(idx, 1);
            queue.push(emp);
          }
        }
      });
    } 
    // B. RUN THE FAIR ROTATION
    else {
      const selected = [];
      const skippedCandidates = [];
      const slotsNeeded = parseInt(state.shiftSize) || 2;
      
      // Pass 1: Try to pick from front of queue, skipping excluded people (vacation)
      for (let i = 0; i < queue.length; i++) {
        if (selected.length >= slotsNeeded) break;
        
        const emp = queue[i];
        const isExcluded = state.exclusions.some(exc => exc.employeeId === emp.id && exc.date === dateStr);
        
        if (!isExcluded) {
          selected.push(emp);
        } else {
          skippedCandidates.push(emp);
          isAdjusted = true;
        }
      }
      
      // Pass 2 (Fallback): If we couldn't fill all slots due to exclusions, fill with excluded people
      if (selected.length < slotsNeeded) {
        for (const emp of skippedCandidates) {
          if (selected.length >= slotsNeeded) break;
          selected.push(emp);
        }
        
        // Pass 3 (Fallback): If still short, fill with duplicates from active pool
        if (selected.length < slotsNeeded) {
          for (const emp of activeEmployees) {
            if (selected.length >= slotsNeeded) break;
            if (!selected.some(s => s.id === emp.id)) {
              selected.push(emp);
            }
          }
        }
      }
      
      assigned = selected;
      
      // Update Queue: Move the worked employees to the back of the queue
      assigned.forEach(emp => {
        const idx = queue.findIndex(q => q.id === emp.id);
        if (idx !== -1) {
          queue.splice(idx, 1);
          queue.push(emp);
        }
      });
    }
    
    schedule.push({
      weekIndex: w,
      date: dateStr,
      dateFormatted: currentDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }),
      employees: assigned,
      isOverride: isOverride,
      isAdjusted: isAdjusted,
      isSwap: false
    });
    
    // Advance 7 days to next Saturday
    currentDate.setDate(currentDate.getDate() + 7);
  }
  
  // Apply Shift Swaps (Exchanges)
  if (state.swaps && state.swaps.length > 0) {
    state.swaps.forEach(swap => {
      const week1 = schedule.find(w => w.date === swap.date1);
      const week2 = schedule.find(w => w.date === swap.date2);
      
      if (week1 && week2) {
        const emp1Idx = week1.employees.findIndex(e => e.name.toLowerCase() === swap.empName1.toLowerCase());
        const emp2Idx = week2.employees.findIndex(e => e.name.toLowerCase() === swap.empName2.toLowerCase());
        
        if (emp1Idx !== -1 && emp2Idx !== -1) {
          const tempEmp = week1.employees[emp1Idx];
          week1.employees[emp1Idx] = week2.employees[emp2Idx];
          week2.employees[emp2Idx] = tempEmp;
          
          const formatted1 = parseLocalDate(swap.date1).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
          const formatted2 = parseLocalDate(swap.date2).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
          
          week1.isSwap = true;
          week2.isSwap = true;
          
          week1.swapDetail = `Swapped: ${swap.empName1} &harr; ${swap.empName2} with week of ${formatted2}`;
          week2.swapDetail = `Swapped: ${swap.empName2} &harr; ${swap.empName1} with week of ${formatted1}`;
        }
      }
    });
  }
  
  return schedule;
}

// 3. UI CONTROLLER & RENDERERS
let calculatedSchedule = [];
let calendarYear = new Date().getFullYear();
let calendarMonth = new Date().getMonth();
let activeTab = 'timeline';
let searchFilter = '';

// DOM Elements cache
const els = {
  nextShiftText: document.getElementById('next-shift-text'),
  employeeList: document.getElementById('employee-list-container'),
  employeeCountBadge: document.getElementById('employee-count-badge'),
  newEmployeeName: document.getElementById('new-employee-name'),
  addEmployeeForm: document.getElementById('add-employee-form'),
  exclusionEmployeeSelect: document.getElementById('exclusion-employee'),
  exclusionDateInput: document.getElementById('exclusion-date'),
  addExclusionForm: document.getElementById('add-exclusion-form'),
  exclusionsList: document.getElementById('exclusions-list-container'),
  
  startDateInput: document.getElementById('start-date-input'),
  durationSelect: document.getElementById('duration-select'),
  shiftSizeInput: document.getElementById('shift-size-input'),
  btnExportCsv: document.getElementById('btn-export-csv'),
  btnPrint: document.getElementById('btn-print'),
  btnReset: document.getElementById('btn-reset'),
  
  tabBtns: document.querySelectorAll('.tab-btn'),
  tabPanels: document.querySelectorAll('.tab-panel'),
  employeeFilterInput: document.getElementById('employee-filter-input'),
  
  timelineGrid: document.getElementById('timeline-grid-container'),
  timelineCountText: document.getElementById('timeline-count-text'),
  
  calPrevMonth: document.getElementById('cal-prev-month'),
  calNextMonth: document.getElementById('cal-next-month'),
  calendarMonthYearText: document.getElementById('calendar-current-month-year'),
  calendarDays: document.getElementById('calendar-days-container'),
  
  metricTotalShifts: document.getElementById('metric-total-shifts'),
  metricFairnessScore: document.getElementById('metric-fairness-score'),
  metricAvgSpacing: document.getElementById('metric-avg-spacing'),
  chartContainer: document.getElementById('chart-container'),
  analyticsTableBody: document.getElementById('analytics-table-body'),
  
  btnShowHelp: document.getElementById('btn-show-help'),
  helpDialog: document.getElementById('help-dialog'),
  btnCloseHelp: document.getElementById('btn-close-help'),
  btnCloseHelpOk: document.getElementById('btn-close-help-ok'),
  
  overrideDialog: document.getElementById('override-dialog'),
  overrideForm: document.getElementById('override-form'),
  overrideDialogDate: document.getElementById('override-dialog-date'),
  overrideDialogWeekNum: document.getElementById('override-dialog-week-num'),
  overrideWeekIndex: document.getElementById('override-week-index'),
  overrideSelectors: document.getElementById('override-selectors-container'),
  btnSaveOverride: document.getElementById('btn-save-override'),
  btnClearOverride: document.getElementById('btn-clear-override'),
  btnCloseOverride: document.getElementById('btn-close-override'),
  
  swapDialog: document.getElementById('swap-dialog'),
  swapForm: document.getElementById('swap-form'),
  swapDialogSourceDate: document.getElementById('swap-dialog-source-date'),
  swapDialogSourceWeek: document.getElementById('swap-dialog-source-week'),
  swapSourceDate: document.getElementById('swap-source-date'),
  swapSourceEmployee: document.getElementById('swap-source-employee'),
  swapTargetDate: document.getElementById('swap-target-date'),
  swapTargetEmployee: document.getElementById('swap-target-employee'),
  btnCancelSwap: document.getElementById('btn-cancel-swap'),
  btnCloseSwap: document.getElementById('btn-close-swap'),
  swapsList: document.getElementById('swaps-list-container')
};

// Initial Setup
function initUI() {
  els.startDateInput.value = state.startDate;
  els.durationSelect.value = state.duration;
  els.shiftSizeInput.value = state.shiftSize;
  
  // Set default exclusion date to upcoming Saturday
  els.exclusionDateInput.value = formatDateString(getNextSaturday(new Date()));
  
  // Align Calendar Tab View Month to the start date
  const startD = parseLocalDate(state.startDate);
  calendarYear = startD.getFullYear();
  calendarMonth = startD.getMonth();
}

function renderAll() {
  calculatedSchedule = generateSchedule();
  
  renderHeaderStatus();
  renderEmployeeList();
  renderExclusionsList();
  renderSwapsList();
  renderTimelineView();
  renderCalendarView();
  renderAnalytics();
}

// 3a. Header Status
function renderHeaderStatus() {
  if (calculatedSchedule.length > 0) {
    const nextShift = calculatedSchedule[0];
    const names = nextShift.employees.map(e => e.name).join(' & ');
    els.nextShiftText.textContent = `${nextShift.dateFormatted} (${names})`;
  } else {
    els.nextShiftText.textContent = "No active employees";
  }
}

// 3b. Employee Management Sidebar
function renderEmployeeList() {
  els.employeeList.innerHTML = '';
  els.employeeCountBadge.textContent = state.employees.length;
  
  // Populate Exclusions Dropdown while drawing employees
  els.exclusionEmployeeSelect.innerHTML = '';
  
  state.employees.forEach((emp, index) => {
    // Add to Exclusions select list if active
    if (emp.active) {
      const opt = document.createElement('option');
      opt.value = emp.id;
      opt.textContent = emp.name;
      els.exclusionEmployeeSelect.appendChild(opt);
    }
    
    // Draw list item
    const div = document.createElement('div');
    div.className = `employee-item ${emp.active ? '' : 'inactive'}`;
    div.setAttribute('role', 'listitem');
    
    const gradClass = `var(--grad-${emp.gradient || 1})`;
    
    div.innerHTML = `
      <div class="employee-info-wrapper">
        <div class="employee-avatar" style="background: ${gradClass}">
          ${emp.name.substring(0, 2).toUpperCase()}
        </div>
        <span class="employee-name">${emp.name}</span>
      </div>
      <div class="employee-actions">
        <!-- Reorder buttons -->
        <button class="btn-list-action move-up" data-index="${index}" title="Move Up">
          &uarr;
        </button>
        <button class="btn-list-action move-down" data-index="${index}" title="Move Down">
          &darr;
        </button>
        <!-- Toggle Active Status -->
        <button class="btn-list-action toggle-active" data-index="${index}" title="${emp.active ? 'Disable' : 'Enable'}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="opacity: ${emp.active ? 1 : 0.35}">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </button>
        <!-- Delete -->
        <button class="btn-list-action delete" data-index="${index}" title="Delete Employee">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>
    `;
    els.employeeList.appendChild(div);
  });
  
  // Attach listeners to employee action buttons
  document.querySelectorAll('.btn-list-action.move-up').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.currentTarget.dataset.index);
      if (idx > 0) {
        // Swap positions
        const temp = state.employees[idx];
        state.employees[idx] = state.employees[idx - 1];
        state.employees[idx - 1] = temp;
        saveState();
        renderAll();
      }
    });
  });
  
  document.querySelectorAll('.btn-list-action.move-down').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.currentTarget.dataset.index);
      if (idx < state.employees.length - 1) {
        // Swap positions
        const temp = state.employees[idx];
        state.employees[idx] = state.employees[idx + 1];
        state.employees[idx + 1] = temp;
        saveState();
        renderAll();
      }
    });
  });
  
  document.querySelectorAll('.btn-list-action.toggle-active').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.currentTarget.dataset.index);
      state.employees[idx].active = !state.employees[idx].active;
      showToast(`${state.employees[idx].name} is now ${state.employees[idx].active ? 'active' : 'inactive'}.`, 'info');
      saveState();
      renderAll();
    });
  });

  document.querySelectorAll('.btn-list-action.delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.currentTarget.dataset.index);
      const emp = state.employees[idx];
      const empId = emp.id;
      const name = emp.name;
      
      // Remove from employees pool
      state.employees.splice(idx, 1);
      
      // Clean up exclusions linked to this employee
      state.exclusions = state.exclusions.filter(exc => exc.employeeId !== empId);
      
      showToast(`Removed ${name} from employee pool.`, 'danger');
      saveState();
      renderAll();
    });
  });
}

// 3c. Exclusions / Leave Sidebar
function renderExclusionsList() {
  els.exclusionsList.innerHTML = '';
  
  if (state.exclusions.length === 0) {
    els.exclusionsList.innerHTML = '<p class="empty-text">No active exclusions.</p>';
    return;
  }
  
  // Sort exclusions by date
  const sortedExclusions = [...state.exclusions].sort((a,b) => parseLocalDate(a.date) - parseLocalDate(b.date));
  
  sortedExclusions.forEach(exc => {
    const emp = state.employees.find(e => e.id === exc.employeeId);
    if (!emp) return; // dangling reference safeguard
    
    const item = document.createElement('div');
    item.className = 'exclusion-item';
    
    const formatted = parseLocalDate(exc.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    
    item.innerHTML = `
      <div class="exclusion-details">
        <strong>${emp.name}</strong>
        <span class="exclusion-date">on ${formatted}</span>
      </div>
      <button class="btn-list-action delete exclusion-delete" data-emp-id="${exc.employeeId}" data-date="${exc.date}" title="Remove Exclusion">
        &times;
      </button>
    `;
    els.exclusionsList.appendChild(item);
  });
  
  document.querySelectorAll('.exclusion-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const empId = e.currentTarget.dataset.empId;
      const date = e.currentTarget.dataset.date;
      
      state.exclusions = state.exclusions.filter(exc => !(exc.employeeId === empId && exc.date === date));
      showToast(`Removed vacation exclusion for ${date}.`, 'info');
      saveState();
      renderAll();
    });
  });
}

function renderSwapsList() {
  els.swapsList.innerHTML = '';
  
  if (!state.swaps || state.swaps.length === 0) {
    els.swapsList.innerHTML = '<p class="empty-text">No active exchanges.</p>';
    return;
  }
  
  state.swaps.forEach(swap => {
    const item = document.createElement('div');
    item.className = 'exclusion-item';
    item.style.borderColor = 'rgba(0, 230, 118, 0.15)';
    item.style.background = 'rgba(0, 230, 118, 0.03)';
    
    const formatted1 = parseLocalDate(swap.date1).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const formatted2 = parseLocalDate(swap.date2).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    
    item.innerHTML = `
      <div class="exclusion-details" style="color: var(--text-primary)">
        <strong>${swap.empName1}</strong> (${formatted1}) &harr; <strong>${swap.empName2}</strong> (${formatted2})
      </div>
      <button class="btn-list-action delete swap-delete" data-id="${swap.id}" title="Remove Exchange">
        &times;
      </button>
    `;
    els.swapsList.appendChild(item);
  });
  
  document.querySelectorAll('.swap-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.dataset.id;
      state.swaps = state.swaps.filter(s => s.id !== id);
      showToast("Shift exchange cancelled.", 'info');
      saveState();
      renderAll();
    });
  });
}

// 3d. Timeline View Grid
function renderTimelineView() {
  els.timelineGrid.innerHTML = '';
  
  // Filter the schedule list if user entered a filter string
  const filtered = calculatedSchedule.filter(w => {
    if (!searchFilter) return true;
    return w.employees.some(emp => emp.name.toLowerCase().includes(searchFilter.toLowerCase())) ||
           w.dateFormatted.toLowerCase().includes(searchFilter.toLowerCase());
  });
  
  els.timelineCountText.textContent = `Showing ${filtered.length} Saturdays`;
  
  if (filtered.length === 0) {
    els.timelineGrid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: var(--spacing-xxl); color: var(--text-muted)">
        <p>No shifts matched the search filter "${searchFilter}"</p>
      </div>
    `;
    return;
  }
  
  const todayStr = formatDateString(new Date());
  
  filtered.forEach(week => {
    const card = document.createElement('article');
    
    // Determine if this is the "Current" Saturday shift (closest future or today)
    const isCurrent = (week.date >= todayStr) && 
      (week.weekIndex === 0 || calculatedSchedule[week.weekIndex - 1].date < todayStr);
      
    card.className = `card timeline-card ${isCurrent ? 'current-week' : ''}`;
    
    let badging = '';
    if (week.isOverride) {
      badging += `<span class="badge-override">Locked</span>`;
    }
    if (week.isAdjusted) {
      badging += `<span class="badge-adjusted">Vacation Adj.</span>`;
    }
    
    const employeesHtml = week.employees.map(emp => {
      const bgStyle = emp.gradient ? `background: var(--grad-${emp.gradient})` : 'background: var(--text-muted)';
      const avatarLabel = emp.name.substring(0, 2).toUpperCase();
      return `
        <div class="employee-info-wrapper" title="${emp.name} ${emp.active ? '' : '(Inactive)'}">
          <div class="employee-avatar" style="${bgStyle}">
            ${avatarLabel}
          </div>
          <span class="employee-name">${emp.name}</span>
        </div>
      `;
    }).join('');
    
    card.innerHTML = `
      <div class="timeline-card-header">
        <span class="week-num">Week ${week.weekIndex + 1}</span>
        ${badging}
      </div>
      <time class="week-date" datetime="${week.date}">${week.dateFormatted}</time>
      <div class="timeline-card-body">
        ${employeesHtml}
      </div>
      <div class="timeline-card-footer">
        <button class="btn-card-edit btn-override" data-date="${week.date}" data-week="${week.weekIndex}">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polygon points="16 3 21 8 8 21 3 21 3 16 16 3"></polygon>
          </svg>
          Override
        </button>
        <button class="btn-card-edit btn-swap" data-date="${week.date}" data-week="${week.weekIndex}" style="background: rgba(0, 230, 118, 0.04); color: #a5d6a7;">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="17 1 21 5 17 9"></polyline>
            <path d="M3 11V9a4 4 0 0 1 4-4h14"></path>
            <polyline points="7 23 3 19 7 15"></polyline>
            <path d="M21 13v2a4 4 0 0 1-4 4H3"></path>
          </svg>
          Swap
        </button>
      </div>
    `;
    
    els.timelineGrid.appendChild(card);
  });
  
  // Attach listeners to Timeline Card Override buttons
  document.querySelectorAll('.btn-override').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const date = e.currentTarget.dataset.date;
      const week = parseInt(e.currentTarget.dataset.week);
      openOverrideDialog(date, week);
    });
  });
  
  // Attach listeners to Timeline Card Swap buttons
  document.querySelectorAll('.btn-swap').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const date = e.currentTarget.dataset.date;
      const week = parseInt(e.currentTarget.dataset.week);
      openSwapDialog(date, week);
    });
  });
}

// 3e. Calendar Tab Grid
function renderCalendarView() {
  els.calendarDays.innerHTML = '';
  
  // Calculate Calendar Month Info
  const firstDayIndex = new Date(calendarYear, calendarMonth, 1).getDay();
  const totalDays = new Date(calendarYear, calendarMonth + 1, 0).getDate();
  const prevMonthTotalDays = new Date(calendarYear, calendarMonth, 0).getDate();
  
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  els.calendarMonthYearText.textContent = `${monthNames[calendarMonth]} ${calendarYear}`;
  
  // 1. Render days of previous month (filler)
  for (let i = firstDayIndex - 1; i >= 0; i--) {
    const day = prevMonthTotalDays - i;
    const cell = document.createElement('div');
    cell.className = 'calendar-cell other-month';
    cell.innerHTML = `<span class="calendar-cell-num">${day}</span>`;
    els.calendarDays.appendChild(cell);
  }
  
  // 2. Render days of current month
  const today = new Date();
  const todayYear = today.getFullYear();
  const todayMonth = today.getMonth();
  const todayDate = today.getDate();
  
  for (let d = 1; d <= totalDays; d++) {
    const cell = document.createElement('div');
    const cellDate = new Date(calendarYear, calendarMonth, d);
    const dateStr = formatDateString(cellDate);
    
    const isCurrentDay = (calendarYear === todayYear && calendarMonth === todayMonth && d === todayDate);
    const isSaturday = (cellDate.getDay() === 6);
    
    cell.className = `calendar-cell ${isCurrentDay ? 'current-day' : ''}`;
    
    let contentHtml = `<span class="calendar-cell-num">${d}</span>`;
    
    if (isSaturday) {
      // Find shift info for this date
      const shift = calculatedSchedule.find(w => w.date === dateStr);
      if (shift) {
        const names = shift.employees.map(e => e.name).join(' & ');
        contentHtml += `
          <div class="calendar-cell-shifts">
            <span class="calendar-shift-badge ${shift.isOverride ? 'overridden' : ''}" 
                  data-date="${dateStr}" 
                  data-week="${shift.weekIndex}" 
                  title="Week ${shift.weekIndex + 1}: ${names} (Click to Override)">
              ${names}
            </span>
          </div>
        `;
      }
    }
    
    cell.innerHTML = contentHtml;
    els.calendarDays.appendChild(cell);
  }
  
  // 3. Render days of next month (filler to finish row)
  const totalCellsSoFar = firstDayIndex + totalDays;
  const remainingCells = (7 - (totalCellsSoFar % 7)) % 7;
  for (let i = 1; i <= remainingCells; i++) {
    const cell = document.createElement('div');
    cell.className = 'calendar-cell other-month';
    cell.innerHTML = `<span class="calendar-cell-num">${i}</span>`;
    els.calendarDays.appendChild(cell);
  }
  
  // Attach listeners to calendar shift badges
  document.querySelectorAll('.calendar-shift-badge').forEach(badge => {
    badge.addEventListener('click', (e) => {
      e.stopPropagation(); // prevent calendar-cell click if any
      const date = e.currentTarget.dataset.date;
      const week = parseInt(e.currentTarget.dataset.week);
      openOverrideDialog(date, week);
    });
  });
}

// 3f. Fairness Analytics & Charting
function renderAnalytics() {
  if (calculatedSchedule.length === 0) {
    els.metricTotalShifts.textContent = "0";
    els.metricFairnessScore.textContent = "-";
    els.metricAvgSpacing.textContent = "-";
    els.chartContainer.innerHTML = '<p class="empty-text">No data to display. Add employees first.</p>';
    els.analyticsTableBody.innerHTML = '';
    return;
  }
  
  // Calculate counts per employee
  const counts = {};
  const spacingData = {}; // maps empName -> array of weekIndices worked
  const firstShift = {};
  const nextShift = {};
  
  // Initialize
  state.employees.forEach(emp => {
    counts[emp.name] = 0;
    spacingData[emp.name] = [];
    firstShift[emp.name] = '';
    nextShift[emp.name] = '';
  });
  
  let totalWorkAssignments = 0;
  const todayStr = formatDateString(new Date());
  
  calculatedSchedule.forEach(week => {
    week.employees.forEach(emp => {
      if (!counts[emp.name] && counts[emp.name] !== 0) {
        counts[emp.name] = 0; // fallback for temporary names in overrides
        spacingData[emp.name] = [];
      }
      counts[emp.name]++;
      totalWorkAssignments++;
      
      spacingData[emp.name].push(week.weekIndex);
      
      // Track first shift
      if (!firstShift[emp.name]) {
        firstShift[emp.name] = week.dateFormatted;
      }
      
      // Track next upcoming shift (closest future or today)
      if (week.date >= todayStr && !nextShift[emp.name]) {
        nextShift[emp.name] = week.dateFormatted;
      }
    });
  });
  
  // METRIC A: Total shifts
  els.metricTotalShifts.textContent = calculatedSchedule.length;
  
  // METRIC B: Fairness Score (Using Gini Coefficient / Coeff of Variation of shift distributions)
  // We want to calculate Gini of shifts counts among active employees
  const activeEmpNames = state.employees.filter(e => e.active).map(e => e.name);
  const activeCounts = activeEmpNames.map(name => counts[name] || 0);
  
  let fairnessScoreText = "Perfect";
  let fairnessColor = "var(--color-success)";
  
  if (activeCounts.length > 1) {
    // Standard Gini Coefficient
    // Gini = sum_i sum_j |x_i - x_j| / (2 * n^2 * mean)
    const n = activeCounts.length;
    const mean = activeCounts.reduce((a,b) => a+b, 0) / n;
    
    if (mean > 0) {
      let sumDiffs = 0;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          sumDiffs += Math.abs(activeCounts[i] - activeCounts[j]);
        }
      }
      const gini = sumDiffs / (2 * n * n * mean);
      
      // Gini ranges from 0 (perfect equity) to ~1 (extreme inequality)
      if (gini === 0) {
        fairnessScoreText = "Perfect (0.0)";
      } else if (gini < 0.1) {
        fairnessScoreText = `Excellent (${gini.toFixed(2)})`;
      } else if (gini < 0.2) {
        fairnessScoreText = `Fair (${gini.toFixed(2)})`;
        fairnessColor = "var(--color-warning)";
      } else {
        fairnessScoreText = `Imbalanced (${gini.toFixed(2)})`;
        fairnessColor = "var(--color-danger)";
      }
    }
  }
  els.metricFairnessScore.textContent = fairnessScoreText;
  els.metricFairnessScore.style.color = fairnessColor;
  
  // METRIC C: Average spacing between shifts
  let totalSpacingWeeks = 0;
  let spacingCount = 0;
  
  Object.keys(spacingData).forEach(name => {
    const indices = spacingData[name];
    if (indices.length > 1) {
      for (let i = 1; i < indices.length; i++) {
        totalSpacingWeeks += (indices[i] - indices[i-1]);
        spacingCount++;
      }
    }
  });
  
  const avgSpacing = spacingCount > 0 ? (totalSpacingWeeks / spacingCount).toFixed(1) : "-";
  els.metricAvgSpacing.textContent = avgSpacing === "-" ? "-" : `${avgSpacing} Weeks`;
  
  // BUILD CHART (Premium Dashboard Responsive Flex Layout)
  els.chartContainer.innerHTML = '';
  const maxCount = Math.max(...Object.values(counts), 1);
  
  state.employees.forEach(emp => {
    const cnt = counts[emp.name] || 0;
    const pctStr = totalWorkAssignments > 0 ? `${((cnt / totalWorkAssignments) * 100).toFixed(0)}%` : '0%';
    const pctOfMax = (cnt / maxCount) * 100;
    
    const gradClass = `var(--grad-${emp.gradient || 1})`;
    
    const row = document.createElement('div');
    row.style.cssText = `
      display: flex;
      align-items: center;
      margin-bottom: var(--spacing-md);
      gap: var(--spacing-md);
    `;
    
    row.innerHTML = `
      <div style="width: 110px; display: flex; align-items: center; gap: var(--spacing-sm);">
        <div class="employee-avatar" style="background: ${gradClass}; width: 24px; height: 24px; font-size: 0.6rem;">
          ${emp.name.substring(0, 2).toUpperCase()}
        </div>
        <span style="font-size: 0.8rem; font-weight: 500; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${emp.name}</span>
      </div>
      <div style="flex: 1; height: 16px; background: rgba(255,255,255,0.03); border-radius: var(--radius-sm); position: relative; overflow: hidden; border: 1px solid var(--border-color);">
        <div class="chart-progress-bar" style="width: 0%; height: 100%; background: ${gradClass}; border-radius: var(--radius-sm); transition: width 1s cubic-bezier(0.1, 1, 0.1, 1); box-shadow: 0 0 8px rgba(140,82,255,0.15)"></div>
      </div>
      <div style="width: 100px; text-align: right; font-size: 0.75rem; color: var(--text-secondary); font-weight: 600;">
        ${cnt} shifts <span style="color: var(--text-muted); font-weight: 400; font-size: 0.65rem;">(${pctStr})</span>
      </div>
    `;
    
    els.chartContainer.appendChild(row);
    
    // Trigger progress animation on next frame
    requestAnimationFrame(() => {
      const bar = row.querySelector('.chart-progress-bar');
      if (bar) bar.style.width = `${pctOfMax}%`;
    });
  });
  
  // POPULATE DETAIL TABLE
  els.analyticsTableBody.innerHTML = '';
  
  state.employees.forEach(emp => {
    const cnt = counts[emp.name] || 0;
    const pct = totalWorkAssignments > 0 ? ((cnt / totalWorkAssignments) * 100).toFixed(1) : "0.0";
    const startShift = firstShift[emp.name] || "None Scheduled";
    const nextUp = nextShift[emp.name] || (emp.active ? "None Upcoming" : "Inactive");
    
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div style="display: flex; align-items: center; gap: 8px;">
          <div class="employee-avatar" style="background: var(--grad-${emp.gradient}); width: 20px; height: 20px; font-size: 0.55rem;">
            ${emp.name.substring(0, 2).toUpperCase()}
          </div>
          <strong>${emp.name}</strong> ${emp.active ? '' : '<span style="font-size: 0.65rem; color: var(--color-danger)">[Inactive]</span>'}
        </div>
      </td>
      <td>${cnt}</td>
      <td>${pct}%</td>
      <td>${startShift}</td>
      <td>${nextUp}</td>
    `;
    els.analyticsTableBody.appendChild(tr);
  });
}

// 4. MODALS & FORMS HANDLERS
function openOverrideDialog(dateStr, weekIndex) {
  els.overrideDialogDate.textContent = parseLocalDate(dateStr).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  els.overrideDialogWeekNum.textContent = weekIndex + 1;
  els.overrideWeekIndex.value = dateStr;
  
  // Render selectors for override
  els.overrideSelectors.innerHTML = '';
  const shift = calculatedSchedule.find(w => w.date === dateStr);
  const currentAssigned = shift ? shift.employees.map(e => e.name) : [];
  
  const size = parseInt(state.shiftSize) || 2;
  
  for (let i = 0; i < size; i++) {
    const formGroup = document.createElement('div');
    formGroup.className = 'form-group';
    formGroup.style.marginBottom = 'var(--spacing-sm)';
    formGroup.innerHTML = `
      <label for="override-select-${i}">Person ${i + 1}</label>
      <select id="override-select-${i}" required>
        <!-- Options populated dynamically -->
      </select>
    `;
    els.overrideSelectors.appendChild(formGroup);
    
    // Populate select element options
    const select = document.getElementById(`override-select-${i}`);
    state.employees.forEach(emp => {
      const opt = document.createElement('option');
      opt.value = emp.name;
      opt.textContent = emp.name + (emp.active ? '' : ' (Inactive)');
      select.appendChild(opt);
    });
    
    // Pre-select current employee if available
    if (currentAssigned[i]) {
      select.value = currentAssigned[i];
    }
  }
  
  els.overrideDialog.showModal();
}

function openSwapDialog(sourceDate, sourceWeekIndex) {
  const shift = calculatedSchedule.find(w => w.date === sourceDate);
  if (!shift) return;
  
  els.swapDialogSourceDate.textContent = parseLocalDate(sourceDate).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  els.swapDialogSourceWeek.textContent = sourceWeekIndex + 1;
  els.swapSourceDate.value = sourceDate;
  
  // 1. Populate source employee dropdown (workers of this week)
  els.swapSourceEmployee.innerHTML = '';
  shift.employees.forEach(emp => {
    const opt = document.createElement('option');
    opt.value = emp.name;
    opt.textContent = emp.name;
    els.swapSourceEmployee.appendChild(opt);
  });
  
  // 2. Populate target dates dropdown (all other Saturdays)
  els.swapTargetDate.innerHTML = '';
  calculatedSchedule.forEach(week => {
    if (week.date !== sourceDate) {
      const opt = document.createElement('option');
      opt.value = week.date;
      const names = week.employees.map(e => e.name).join(' & ');
      opt.textContent = `${week.dateFormatted} (${names})`;
      els.swapTargetDate.appendChild(opt);
    }
  });
  
  // Populate target employees dropdown based on selected date
  updateTargetEmployeesDropdown();
  
  els.swapDialog.showModal();
}

function updateTargetEmployeesDropdown() {
  const targetDateVal = els.swapTargetDate.value;
  const targetShift = calculatedSchedule.find(w => w.date === targetDateVal);
  els.swapTargetEmployee.innerHTML = '';
  
  if (targetShift) {
    targetShift.employees.forEach(emp => {
      const opt = document.createElement('option');
      opt.value = emp.name;
      opt.textContent = emp.name;
      els.swapTargetEmployee.appendChild(opt);
    });
  }
}

// Export schedule to CSV file
function exportToCSV() {
  if (calculatedSchedule.length === 0) return;
  
  let csvContent = "data:text/csv;charset=utf-8,";
  
  // Headers
  csvContent += "Week,Saturday Date,Employees Assigned,Status\n";
  
  calculatedSchedule.forEach(week => {
    const names = week.employees.map(e => e.name).join(' & ');
    let status = "Regular Rotation";
    if (week.isOverride) status = "Locked/Override";
    else if (week.isAdjusted) status = "Vacation Adjusted";
    
    csvContent += `Week ${week.weekIndex + 1},${week.date},"${names}",${status}\n`;
  });
  
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `Saturday_Shift_Schedule_${state.startDate}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// 5. EVENT LISTENERS SETUP
function setupEventListeners() {
  // A. Employee Forms
  els.addEmployeeForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = els.newEmployeeName.value.trim();
    if (!name) return;
    
    // Prevent duplicate names
    if (state.employees.some(e => e.name.toLowerCase() === name.toLowerCase())) {
      alert("An employee with this name already exists.");
      return;
    }
    
    // Cycle gradients 1-7
    const nextGradIndex = (state.employees.length % 7) + 1;
    const newId = 'emp-' + Date.now();
    
    state.employees.push({
      id: newId,
      name: name,
      gradient: nextGradIndex,
      active: true
    });
    
    showToast(`Added ${name} to employee pool!`, 'success');
    els.newEmployeeName.value = '';
    saveState();
    renderAll();
  });
  
  // B. Exclusions Forms
  els.addExclusionForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const empId = els.exclusionEmployeeSelect.value;
    const dateVal = els.exclusionDateInput.value;
    if (!empId || !dateVal) return;
    
    // Excluded date must be a Saturday
    const dateObj = parseLocalDate(dateVal);
    if (dateObj.getDay() !== 6) {
      alert("Exclusion dates must be Saturdays. Bypassing non-Saturday inputs helps protect rotation structures.");
      return;
    }
    
    // Check duplicate exclusion
    if (state.exclusions.some(exc => exc.employeeId === empId && exc.date === dateVal)) {
      alert("This employee is already excluded for this Saturday.");
      return;
    }
    
    state.exclusions.push({
      employeeId: empId,
      date: dateVal
    });
    
    const emp = state.employees.find(e => e.id === empId);
    const name = emp ? emp.name : "Employee";
    showToast(`Vacation mode activated for ${name} on ${dateVal}.`, 'success');
    
    saveState();
    renderAll();
  });
  
  // C. Schedule Setting Controls
  els.startDateInput.addEventListener('change', (e) => {
    const val = e.target.value;
    if (val) {
      // Auto-align input to next Saturday
      const SaturdayDate = getNextSaturday(parseLocalDate(val));
      const SaturdayStr = formatDateString(SaturdayDate);
      state.startDate = SaturdayStr;
      els.startDateInput.value = SaturdayStr;
      
      // Sync Calendar View
      calendarYear = SaturdayDate.getFullYear();
      calendarMonth = SaturdayDate.getMonth();
      
      saveState();
      renderAll();
    }
  });
  
  els.durationSelect.addEventListener('change', (e) => {
    state.duration = parseInt(e.target.value) || 52;
    saveState();
    renderAll();
  });
  
  els.shiftSizeInput.addEventListener('change', (e) => {
    const val = Math.max(1, Math.min(5, parseInt(e.target.value) || 2));
    state.shiftSize = val;
    els.shiftSizeInput.value = val;
    saveState();
    renderAll();
  });
  
  // Reset Button
  els.btnReset.addEventListener('click', () => {
    if (confirm("Are you sure you want to reset all data (employees list, overrides, vacations) back to the default schedule shown in the screenshot?")) {
      resetToDefault();
      showToast("App reset to original 5-week rotation.", "warning");
    }
  });
  
  // Export & Print
  els.btnExportCsv.addEventListener('click', exportToCSV);
  els.btnPrint.addEventListener('click', () => window.print());
  
  // D. Tab Buttons Navigation
  els.tabBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tab = e.currentTarget.dataset.tab;
      
      // Update tab button classes
      els.tabBtns.forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
      
      // Update panels visibility
      els.tabPanels.forEach(p => p.classList.remove('active'));
      const activePanel = document.getElementById(`panel-${tab}`);
      if (activePanel) activePanel.classList.add('active');
      
      activeTab = tab;
      
      // Render components if relevant
      if (tab === 'calendar') {
        renderCalendarView();
      } else if (tab === 'analytics') {
        renderAnalytics();
      }
    });
  });
  
  // Filter search input
  els.employeeFilterInput.addEventListener('input', (e) => {
    searchFilter = e.target.value.trim();
    if (activeTab === 'timeline') {
      renderTimelineView();
    } else if (activeTab === 'calendar') {
      // (Calendar view isn't filtered but could highlight cells. We keep it to timeline filters.)
    }
  });
  
  // E. Month Navigation (Calendar Tab)
  els.calPrevMonth.addEventListener('click', () => {
    calendarMonth--;
    if (calendarMonth < 0) {
      calendarMonth = 11;
      calendarYear--;
    }
    renderCalendarView();
  });
  
  els.calNextMonth.addEventListener('click', () => {
    calendarMonth++;
    if (calendarMonth > 11) {
      calendarMonth = 0;
      calendarYear++;
    }
    renderCalendarView();
  });
  
  // F. Modals Control: Help Modal
  els.btnShowHelp.addEventListener('click', () => els.helpDialog.showModal());
  els.btnCloseHelp.addEventListener('click', () => els.helpDialog.close());
  els.btnCloseHelpOk.addEventListener('click', () => els.helpDialog.close());
  
  // G. Override Modal Control
  els.btnCloseOverride.addEventListener('click', () => els.overrideDialog.close());
  
  els.btnClearOverride.addEventListener('click', () => {
    const dateStr = els.overrideWeekIndex.value;
    if (dateStr && state.overrides[dateStr]) {
      delete state.overrides[dateStr];
      saveState();
      renderAll();
      showToast(`Removed override lock for ${dateStr}.`, 'info');
    }
    els.overrideDialog.close();
  });
  
  els.overrideForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const dateStr = els.overrideWeekIndex.value;
    const size = parseInt(state.shiftSize) || 2;
    const names = [];
    
    for (let i = 0; i < size; i++) {
      const selectVal = document.getElementById(`override-select-${i}`).value;
      names.push(selectVal);
    }
    
    // Save override
    state.overrides[dateStr] = names;
    saveState();
    renderAll();
    showToast(`Locked shift on ${dateStr} for: ${names.join(', ')}.`, 'info');
    els.overrideDialog.close();
  });
  
  // H. Swap/Exchange Modal Control
  els.swapTargetDate.addEventListener('change', updateTargetEmployeesDropdown);
  
  els.btnCloseSwap.addEventListener('click', () => els.swapDialog.close());
  els.btnCancelSwap.addEventListener('click', () => els.swapDialog.close());
  
  els.swapForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const sourceDate = els.swapSourceDate.value;
    const empName1 = els.swapSourceEmployee.value;
    const targetDate = els.swapTargetDate.value;
    const empName2 = els.swapTargetEmployee.value;
    
    if (!sourceDate || !empName1 || !targetDate || !empName2) return;
    
    state.swaps.push({
      id: 'swap-' + Date.now(),
      date1: sourceDate,
      empName1: empName1,
      date2: targetDate,
      empName2: empName2
    });
    
    saveState();
    renderAll();
    showToast(`Exchanged shift: ${empName1} (${sourceDate}) &harr; ${empName2} (${targetDate})!`, 'success');
    els.swapDialog.close();
  });
}

// 6. APP RUNTIME INITIALIZATION
document.addEventListener('DOMContentLoaded', () => {
  initState();
  initUI();
  setupEventListeners();
  renderAll();
});
