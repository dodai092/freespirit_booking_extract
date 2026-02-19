// ==========================================
// 1. EVENT LISTENERS
// ==========================================

document.getElementById("btnFreetour").addEventListener("click", async () => {
  runScript(scrapeFreetourLogic);
});

document.getElementById("btnGuru").addEventListener("click", async () => {
  runScript(scrapeGuruwalkLogic);
});

// ==========================================
// 2. HELPER FUNCTION (Runs the script & copies to clipboard)
// ==========================================

async function runScript(scriptFunction) {
  const statusDiv = document.getElementById("status");
  statusDiv.innerText = "Extracting...";
  statusDiv.style.color = "#555";

  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    function: scriptFunction,
  }, (results) => {
    if (chrome.runtime.lastError) {
      statusDiv.innerText = "Error: " + chrome.runtime.lastError.message;
      statusDiv.style.color = "red";
      return;
    }

    if (results && results[0] && results[0].result) {
      const tsvData = results[0].result;
      navigator.clipboard.writeText(tsvData).then(() => {
        statusDiv.innerText = "Copied to Clipboard!";
        statusDiv.style.color = "green";
      }).catch(err => {
        statusDiv.innerText = "❌ Copy failed: " + err;
        statusDiv.style.color = "red";
      });
    } else {
      statusDiv.innerText = "❌ No data found (Check Console)";
      statusDiv.style.color = "red";
    }
  });
}

// ==========================================
// 3. FREETOUR LOGIC
// ==========================================

function scrapeFreetourLogic() {
  const rawDate = document.querySelector('#dater')?.value || '';
  if(!rawDate && !document.querySelector('.booking-tourcard')) return null;

  const dateObj = new Date(rawDate + 'T00:00:00');
  const formattedDate = dateObj.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  const isFirstOfMonth = dateObj.getDate() === 1;

  const flagToLang = {
    'gb': 'eng', 'us': 'eng', 'es': 'esp', 'fr': 'fra',
    'de': 'deu', 'it': 'ita', 'pt': 'por', 'br': 'por',
    'hr': 'hrv', 'cn': 'zho', 'jp': 'jpn', 'kr': 'kor',
  };

  const cityAbbr = {
    'zagreb': 'zg', 'zadar': 'zd', 'split': 'st',
    'dubrovnik': 'du', 'pula': 'pu', 'rovinj': 'rv',
  };

  function to24h(t) {
    if(!t) return '';
    const m = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!m) return t;
    let h = parseInt(m[1]);
    if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12;
    if (m[3].toUpperCase() === 'AM' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${m[2]}`;
  }

  const results = [];
  const cards = document.querySelectorAll('.booking-tourcard');

  cards.forEach(card => {
    // Optional: Skip hidden cards if necessary
    if (card.offsetParent === null) return;

    const tourName = card.querySelector('.booking-tourcard__title span')?.textContent.trim();
    const time24 = to24h(card.querySelector('.booking-tourcard__time div')?.textContent.trim());

    const flagStyle = card.querySelector('.booking-tourcard__flag')?.style.backgroundImage || '';
    const flagCode = (flagStyle.match(/\/([a-z]{2})\.svg/) || [])[1] || '';
    const language = flagToLang[flagCode] || flagCode;

    const rawCity = (tourName.split(' ').pop() || '').toLowerCase();
    const city = cityAbbr[rawCity] || rawCity;

    const limitVal = card.querySelector('.booking-tourcard__limit-value');
    const pax = limitVal?.querySelector('span')?.textContent.trim() || '0';
    const capacity = limitVal?.querySelector('.booking-tourcard__limit-const')?.textContent.trim() || '0';

    results.push({ Date: formattedDate, Time: time24, Tour: 'free', City: city, Language: language, Platform: 'freetour', Pax: pax, Capacity: capacity });
  });

  const headers = ['Date', 'Time', 'Tour', 'City', 'Language', 'Platform', 'Pax', 'Capacity'];
  const dataRows = results.map(r => headers.map(h => r[h]).join('\t'));
  
  return isFirstOfMonth
    ? [headers.join('\t'), ...dataRows].join('\n')
    : dataRows.join('\n');
}

// ==========================================
// 4. GURUWALK LOGIC
// ==========================================

function scrapeGuruwalkLogic() {
  const langMap = { en: 'eng', es: 'esp', fr: 'fra', de: 'deu', it: 'ita', pt: 'por', hr: 'hrv' };

  const cityMap = {
    'zagreb': 'zg', 'zadar': 'zd', 'split': 'st',
    'dubrovnik': 'du', 'pula': 'pu', 'rovinj': 'rv'
  };

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const monthAbbr = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function parseMonthIndex(str) {
    if(!str) return -1;
    let idx = monthNames.findIndex(m => m.toLowerCase() === str.toLowerCase());
    if (idx >= 0) return idx;
    idx = monthAbbr.findIndex(m => m.toLowerCase() === str.toLowerCase());
    return idx;
  }

  // Find Header
  const headerEl = document.querySelector('[data-testid="calendar-header"] h2');
  const headerText = headerEl?.textContent.trim();
  
  if (!headerText) {
    console.error('❌ Could not find calendar header');
    return null; 
  }

  let month1, month2, year1, year2;

  if (headerText.includes('-')) {
    const parts = headerText.split('-').map(s => s.trim());
    const rightTokens = parts[1].split(/\s+/);
    if (rightTokens.length < 2) return null;

    month2 = parseMonthIndex(rightTokens[0]);
    year2 = parseInt(rightTokens[1]);
    const leftTokens = parts[0].split(/\s+/);
    month1 = parseMonthIndex(leftTokens[0]);
    year1 = leftTokens.length > 1 ? parseInt(leftTokens[1]) : year2;
    if (month1 > month2 && year1 === year2) {
      year1 = year2 - 1;
    }
  } else {
    const tokens = headerText.split(/\s+/);
    if(tokens.length < 2) return null;
    month1 = parseMonthIndex(tokens[0]);
    year1 = parseInt(tokens[1]);
    month2 = month1;
    year2 = year1;
  }

  const grid = document.querySelector('[data-testid="time-grid"]');
  if(!grid) return null;

  const headerCells = grid.querySelectorAll('.sticky div.flex > div.flex-1');
  const days = [];
  headerCells.forEach(cell => {
    const dayName = cell.querySelector('.text-xs')?.textContent.trim();
    const dayNum = cell.querySelector('.text-lg')?.textContent.trim();
    if (dayName && dayNum) days.push({ dayName, dayNum: parseInt(dayNum) });
  });

  let boundaryIndex = -1;
  for (let i = 1; i < days.length; i++) {
    if (days[i].dayNum < days[i - 1].dayNum) {
      boundaryIndex = i;
      break;
    }
  }

  const platform = 'Guruwalk';
  const results = [];

  days.forEach((day, colIndex) => {
    const column = grid.querySelector(`[data-testid="day-column-${colIndex}"]`);
    if (!column) return;

    let month, year;
    if (boundaryIndex === -1 || colIndex < boundaryIndex) {
      month = month1;
      year = year1;
    } else {
      month = month2;
      year = year2;
    }

    const date = new Date(year, month, day.dayNum);
    const fullDayName = dayNames[date.getDay()];
    const dateStr = `${fullDayName}, ${day.dayNum} ${monthNames[month]} ${year}`;

    const cards = column.querySelectorAll('[data-testid="event-card"]');
    cards.forEach(card => {
      const flagImg = card.querySelector('img[alt]');
      const langCode = flagImg ? flagImg.alt.trim() : '';
      const language = langMap[langCode] || langCode;

      const timeSpan = card.querySelector('span.font-medium');
      const timeText = timeSpan?.textContent.trim().replace(/\s*-.*/, '') || '';

      const capacitySpan = card.querySelector('.font-semibold span');
      const capacityText = capacitySpan?.textContent.trim() || '';
      const [guests, capacity] = capacityText.split('/');

      const tourP = card.querySelector('p');
      const rawTourName = tourP?.textContent.trim() || '';

      const rawCity = rawTourName.split(' ').pop().toLowerCase().replace(/[^a-z]/g, '');
      const city = cityMap[rawCity] || rawCity;

      results.push({
        Date: dateStr,
        Time: timeText,
        Tour: 'free',
        City: city,
        Language: language,
        Platform: platform,
        Pax: parseInt(guests) || 0,
        Capacity: parseInt(capacity) || 0
      });
    });
  });

  const firstDayNum = days.length > 0 ? days[0].dayNum : null;
  const includeHeader = firstDayNum === 1;

  const rows = results.map(r => `${r.Date}\t${r.Time}\t${r.Tour}\t${r.City}\t${r.Language}\t${r.Platform}\t${r.Pax}\t${r.Capacity}`);

  return includeHeader
    ? ['Date\tTime\tTour\tCity\tLanguage\tPlatform\tPax\tCapacity', ...rows].join('\n')
    : rows.join('\n');
}