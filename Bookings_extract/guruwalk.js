// ==========================================
// GURUWALK EVENT LISTENERS
// ==========================================
// Note: setStatus() and runScript() are defined in freetour.js
// Make sure freetour.js is loaded before guruwalk.js in popup.html

document.getElementById("btnGuru").addEventListener("click", async () => {
  runScript(scrapeGuruwalkLogic);
});

document.getElementById("btnGuruMonth").addEventListener("click", startGuruBatch);

// ==========================================
// GURUWALK BATCH - START
// ==========================================

async function startGuruBatch() {
  const monthInput = document.getElementById("monthPickerGuru");
  if (!monthInput.value) {
    setStatus("Please select a month first.", "orange");
    return;
  }

  const [year, month] = monthInput.value.split('-').map(Number);
  const targetMonth0 = month - 1;
  const delayMs = (parseInt(document.getElementById("delaySecondsGuru").value) || 3) * 1000;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  setStatus(`Batch Guruwalk: ${monthInput.value}…`, "#555");

  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: guruBatchLogic,
    args: [year, targetMonth0, delayMs]
  }, (results) => {
    if (chrome.runtime.lastError) {
      setStatus("Error: " + chrome.runtime.lastError.message, "red");
      return;
    }

    const result = results?.[0]?.result;

    if (!result) {
      setStatus("No result returned (Check Console)", "red");
      return;
    }

    if (result.error) {
      setStatus("Error: " + result.error, "red");
      return;
    }

    navigator.clipboard.writeText(result.tsv).then(() => {
      setStatus("Guruwalk month copied to Clipboard!", "green");
    }).catch(err => {
      setStatus("Copy failed: " + err, "red");
    });
  });
}

// ==========================================
// GURUWALK BATCH LOGIC (injected into page)
// ==========================================
// This function runs inside the page context.
// args: targetYear (number), targetMonth0 (0-indexed month), delayMs (ms between navigations)

async function guruBatchLogic(targetYear, targetMonth0, delayMs) {

  // --- Shared lookup tables ---
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const monthAbbr  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dayNames   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const langMap    = { en: 'eng', es: 'esp', fr: 'fra', de: 'deu', it: 'ita', pt: 'por', hr: 'hrv' };
  const cityMap    = { zagreb: 'zg', zadar: 'zd', split: 'st', dubrovnik: 'du', pula: 'pu', rovinj: 'rv' };

  const targetMonthStart = new Date(targetYear, targetMonth0, 1);
  const targetMonthEnd   = new Date(targetYear, targetMonth0 + 1, 0); // last day of target month

  // --- Parse the calendar header h2 into { month1, year1, month2, year2 } ---
  // Header is either "February 2026" or "Jan 27 - Feb 2026" style
  function parseHeaderMonths() {
    const headerEl  = document.querySelector('[data-testid="calendar-header"] h2');
    const headerText = headerEl?.textContent.trim() || '';

    function parseMonthIndex(str) {
      if (!str) return -1;
      let idx = monthNames.findIndex(m => m.toLowerCase() === str.toLowerCase());
      if (idx >= 0) return idx;
      return monthAbbr.findIndex(m => m.toLowerCase() === str.toLowerCase());
    }

    let month1, year1, month2, year2;

    if (headerText.includes('-')) {
      const parts       = headerText.split('-').map(s => s.trim());
      const rightTokens = parts[1].split(/\s+/);
      const leftTokens  = parts[0].split(/\s+/);
      month2 = parseMonthIndex(rightTokens[0]);
      year2  = parseInt(rightTokens[1]);
      month1 = parseMonthIndex(leftTokens[0]);
      year1  = leftTokens.length > 1 ? parseInt(leftTokens[1]) : year2;
      if (month1 > month2 && year1 === year2) year1 = year2 - 1;
    } else {
      const tokens = headerText.split(/\s+/);
      month1 = parseMonthIndex(tokens[0]);
      year1  = parseInt(tokens[1]);
      month2 = month1;
      year2  = year1;
    }

    return { month1, year1, month2, year2 };
  }

  // --- Get the rendered Date object for a specific column (0–6) ---
  function getColDate(colIndex) {
    const grid  = document.querySelector('[data-testid="time-grid"]');
    const cells = grid?.querySelectorAll('.sticky div.flex > div.flex-1');
    if (!cells || colIndex >= cells.length) return null;

    const allNums = Array.from(cells).map(c => parseInt(c.querySelector('.text-lg')?.textContent.trim() || '0'));
    let boundaryIndex = -1;
    for (let i = 1; i < allNums.length; i++) {
      if (allNums[i] < allNums[i - 1]) { boundaryIndex = i; break; }
    }

    const { month1, year1, month2, year2 } = parseHeaderMonths();
    const month = (boundaryIndex === -1 || colIndex < boundaryIndex) ? month1 : month2;
    const year  = (boundaryIndex === -1 || colIndex < boundaryIndex) ? year1  : year2;
    return new Date(year, month, allNums[colIndex]);
  }

  // --- Wait for the header h2 text to change (MutationObserver + timeout fallback) ---
  function waitForHeaderChange(oldText, timeout = 8000) {
    return new Promise((resolve) => {
      const headerEl = document.querySelector('[data-testid="calendar-header"] h2');
      if (!headerEl) return resolve();
      if (headerEl.textContent.trim() !== oldText) return resolve(); // already changed

      const observer = new MutationObserver(() => {
        if (headerEl.textContent.trim() !== oldText) {
          observer.disconnect();
          resolve();
        }
      });
      // Observe the parent so we catch React re-renders that replace child nodes
      observer.observe(headerEl.parentElement, { childList: true, subtree: true, characterData: true });
      setTimeout(() => { observer.disconnect(); resolve(); }, timeout);
    });
  }

  // --- Scrape the visible week and return only rows that belong to the target month ---
  function scrapeCurrentWeek() {
    const grid = document.querySelector('[data-testid="time-grid"]');
    if (!grid) return [];

    const { month1, year1, month2, year2 } = parseHeaderMonths();
    const headerCells = grid.querySelectorAll('.sticky div.flex > div.flex-1');
    const days = [];
    headerCells.forEach(cell => {
      const dayName = cell.querySelector('.text-xs')?.textContent.trim();
      const dayNum  = parseInt(cell.querySelector('.text-lg')?.textContent.trim() || '0');
      if (dayName && dayNum) days.push({ dayName, dayNum });
    });

    let boundaryIndex = -1;
    for (let i = 1; i < days.length; i++) {
      if (days[i].dayNum < days[i - 1].dayNum) { boundaryIndex = i; break; }
    }

    const rows = [];
    days.forEach((day, colIndex) => {
      const month = (boundaryIndex === -1 || colIndex < boundaryIndex) ? month1 : month2;
      const year  = (boundaryIndex === -1 || colIndex < boundaryIndex) ? year1  : year2;

      // Skip days outside the target month
      if (month !== targetMonth0 || year !== targetYear) return;

      const column = grid.querySelector(`[data-testid="day-column-${colIndex}"]`);
      if (!column) return;

      const date    = new Date(year, month, day.dayNum);
      const dateStr = `${dayNames[date.getDay()]}, ${day.dayNum} ${monthNames[month]} ${year}`;

      column.querySelectorAll('[data-testid="event-card"]').forEach(card => {
        const flagImg     = card.querySelector('img[alt]');
        const langCode    = flagImg ? flagImg.alt.trim() : '';
        const language    = langMap[langCode] || langCode;
        const timeText    = card.querySelector('span.font-medium')?.textContent.trim().replace(/\s*-.*/, '') || '';
        const capText     = card.querySelector('.font-semibold span')?.textContent.trim() || '';
        const [guests, cap] = capText.split('/');
        const rawCity     = (card.querySelector('p')?.textContent.trim() || '').split(' ').pop().toLowerCase().replace(/[^a-z]/g, '');
        const city        = cityMap[rawCity] || rawCity;

        rows.push(`${dateStr}\t${timeText}\tfree\t${city}\t${language}\tGuruwalk\t${parseInt(guests)||0}\t${parseInt(cap)||0}`);
      });
    });

    return rows;
  }

  // --- Locate navigation buttons ---
  const prevBtn = document.querySelector('[data-testid="calendar-header"] .lucide-chevron-left')?.closest('button');
  const nextBtn = document.querySelector('[data-testid="calendar-header"] .lucide-chevron-right')?.closest('button');
  if (!prevBtn || !nextBtn) return { error: 'Navigation buttons not found' };

  // --- Step 1: Navigate backward until first column is at or before targetMonthStart ---
  // This ensures we catch any partial first week (e.g. Mon 27 Jan – Sun 2 Feb)
  for (let i = 0; i < 8; i++) {
    const firstDate = getColDate(0);
    if (!firstDate || firstDate <= targetMonthStart) break;
    const oldHeader = document.querySelector('[data-testid="calendar-header"] h2')?.textContent.trim();
    prevBtn.click();
    await waitForHeaderChange(oldHeader);
    await new Promise(r => setTimeout(r, delayMs));
  }

  // --- Step 2: Navigate forward if we overshot into a month before the target ---
  // e.g. user was in January and we went too far back
  for (let i = 0; i < 8; i++) {
    const lastDate = getColDate(6);
    if (!lastDate || lastDate >= targetMonthStart) break;
    const oldHeader = document.querySelector('[data-testid="calendar-header"] h2')?.textContent.trim();
    nextBtn.click();
    await waitForHeaderChange(oldHeader);
    await new Promise(r => setTimeout(r, delayMs));
  }

  // --- Step 3: Scrape week by week until the first column is past the target month ---
  const allRows = [];

  for (let i = 0; i < 8; i++) {
    const firstDate = getColDate(0);
    if (!firstDate || firstDate > targetMonthEnd) break; // gone past target month entirely

    const weekRows = scrapeCurrentWeek();
    allRows.push(...weekRows);

    // Advance to next week
    const oldHeader = document.querySelector('[data-testid="calendar-header"] h2')?.textContent.trim();
    nextBtn.click();
    await waitForHeaderChange(oldHeader);
    await new Promise(r => setTimeout(r, delayMs));
  }

  if (allRows.length === 0) return { error: 'No data found for target month' };

  const header = 'Date\tTime\tTour\tCity\tLanguage\tPlatform\tPax\tCapacity';
  return { tsv: [header, ...allRows].join('\n') };
}

// ==========================================
// GURUWALK SINGLE-WEEK SCRAPE LOGIC (injected into page)
// ==========================================

function scrapeGuruwalkLogic() {
  const langMap = { en: 'eng', es: 'esp', fr: 'fra', de: 'deu', it: 'ita', pt: 'por', hr: 'hrv' };

  const cityMap = {
    'zagreb': 'zg', 'zadar': 'zd', 'split': 'st',
    'dubrovnik': 'du', 'pula': 'pu', 'rovinj': 'rv'
  };

  const dayNames   = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const monthAbbr  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function parseMonthIndex(str) {
    if (!str) return -1;
    let idx = monthNames.findIndex(m => m.toLowerCase() === str.toLowerCase());
    if (idx >= 0) return idx;
    idx = monthAbbr.findIndex(m => m.toLowerCase() === str.toLowerCase());
    return idx;
  }

  const headerEl   = document.querySelector('[data-testid="calendar-header"] h2');
  const headerText = headerEl?.textContent.trim();

  if (!headerText) {
    console.error('Could not find calendar header');
    return null;
  }

  let month1, month2, year1, year2;

  if (headerText.includes('-')) {
    const parts       = headerText.split('-').map(s => s.trim());
    const rightTokens = parts[1].split(/\s+/);
    if (rightTokens.length < 2) return null;

    month2 = parseMonthIndex(rightTokens[0]);
    year2  = parseInt(rightTokens[1]);
    const leftTokens = parts[0].split(/\s+/);
    month1 = parseMonthIndex(leftTokens[0]);
    year1  = leftTokens.length > 1 ? parseInt(leftTokens[1]) : year2;
    if (month1 > month2 && year1 === year2) year1 = year2 - 1;
  } else {
    const tokens = headerText.split(/\s+/);
    if (tokens.length < 2) return null;
    month1 = parseMonthIndex(tokens[0]);
    year1  = parseInt(tokens[1]);
    month2 = month1;
    year2  = year1;
  }

  const grid = document.querySelector('[data-testid="time-grid"]');
  if (!grid) return null;

  const headerCells = grid.querySelectorAll('.sticky div.flex > div.flex-1');
  const days = [];
  headerCells.forEach(cell => {
    const dayName = cell.querySelector('.text-xs')?.textContent.trim();
    const dayNum  = cell.querySelector('.text-lg')?.textContent.trim();
    if (dayName && dayNum) days.push({ dayName, dayNum: parseInt(dayNum) });
  });

  let boundaryIndex = -1;
  for (let i = 1; i < days.length; i++) {
    if (days[i].dayNum < days[i - 1].dayNum) { boundaryIndex = i; break; }
  }

  const results = [];

  days.forEach((day, colIndex) => {
    const column = grid.querySelector(`[data-testid="day-column-${colIndex}"]`);
    if (!column) return;

    const month = (boundaryIndex === -1 || colIndex < boundaryIndex) ? month1 : month2;
    const year  = (boundaryIndex === -1 || colIndex < boundaryIndex) ? year1  : year2;

    const date        = new Date(year, month, day.dayNum);
    const fullDayName = dayNames[date.getDay()];
    const dateStr     = `${fullDayName}, ${day.dayNum} ${monthNames[month]} ${year}`;

    const cards = column.querySelectorAll('[data-testid="event-card"]');
    cards.forEach(card => {
      const flagImg   = card.querySelector('img[alt]');
      const langCode  = flagImg ? flagImg.alt.trim() : '';
      const language  = langMap[langCode] || langCode;

      const timeSpan = card.querySelector('span.font-medium');
      const timeText = timeSpan?.textContent.trim().replace(/\s*-.*/, '') || '';

      const capacitySpan = card.querySelector('.font-semibold span');
      const capacityText = capacitySpan?.textContent.trim() || '';
      const [guests, capacity] = capacityText.split('/');

      const tourP       = card.querySelector('p');
      const rawTourName = tourP?.textContent.trim() || '';
      const rawCity     = rawTourName.split(' ').pop().toLowerCase().replace(/[^a-z]/g, '');
      const city        = cityMap[rawCity] || rawCity;

      results.push({
        Date: dateStr, Time: timeText, Tour: 'free', City: city,
        Language: language, Platform: 'Guruwalk',
        Pax: parseInt(guests) || 0, Capacity: parseInt(capacity) || 0
      });
    });
  });

  const firstDayNum   = days.length > 0 ? days[0].dayNum : null;
  const includeHeader = firstDayNum === 1;

  const rows = results.map(r =>
    `${r.Date}\t${r.Time}\t${r.Tour}\t${r.City}\t${r.Language}\t${r.Platform}\t${r.Pax}\t${r.Capacity}`
  );

  return includeHeader
    ? ['Date\tTime\tTour\tCity\tLanguage\tPlatform\tPax\tCapacity', ...rows].join('\n')
    : rows.join('\n');
}