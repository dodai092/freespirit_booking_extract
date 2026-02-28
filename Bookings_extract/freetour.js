// ==========================================
// SHARED HELPERS
// (used by both freetour.js and guruwalk.js)
// ==========================================

function setStatus(msg, color) {
  const el = document.getElementById("status");
  el.innerText = msg;
  el.style.color = color || '#555';
}

async function runScript(scriptFunction) {
  setStatus("Extracting...", "#555");
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    function: scriptFunction,
  }, (results) => {
    if (chrome.runtime.lastError) {
      setStatus("Error: " + chrome.runtime.lastError.message, "red");
      return;
    }
    if (results && results[0] && results[0].result) {
      navigator.clipboard.writeText(results[0].result).then(() => {
        setStatus("Copied to Clipboard!", "green");
      }).catch(err => {
        setStatus("Copy failed: " + err, "red");
      });
    } else {
      setStatus("No data found (Check Console)", "red");
    }
  });
}

async function cancelBatch() {
  await chrome.storage.local.remove('freetourBatch');
  document.getElementById("btnCancel").style.display = "none";
  setStatus("Batch cancelled.", "#555");
}

// ==========================================
// FREETOUR EVENT LISTENERS
// ==========================================

document.getElementById("btnFreetour").addEventListener("click", async () => {
  runScript(scrapeFreetourLogic);
});

document.getElementById("btnFreetourMonth").addEventListener("click", startFreetourBatch);
document.getElementById("btnCancel").addEventListener("click", cancelBatch);

// On popup open, check if a Freetour batch is already running and update the UI
chrome.storage.local.get('freetourBatch', (data) => {
  const batch = data.freetourBatch;
  if (batch && batch.active) {
    const monthLabel = `${batch.year}-${String(batch.month).padStart(2, '0')}`;
    setStatus(`Running: Day ${batch.currentDay} of ${batch.totalDays} (${monthLabel})`, '#555');
    document.getElementById("btnCancel").style.display = "inline-block";
  }
});

// ==========================================
// FREETOUR BATCH - START
// ==========================================

async function startFreetourBatch() {
  const monthInput = document.getElementById("monthPickerFreetour");
  if (!monthInput.value) {
    setStatus("Please select a month first.", "orange");
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const [year, month] = monthInput.value.split('-').map(Number);

  // Days in month: new Date(year, month, 0) uses the 1-indexed month
  // as "day 0 of the next 0-indexed month" — correctly handles all months
  const totalDays = new Date(year, month, 0).getDate();
  const delaySeconds = parseInt(document.getElementById("delaySecondsFreetour").value) || 3;

  await chrome.storage.local.set({
    freetourBatch: {
      active: true,
      year,
      month,       // 1-indexed (1 = January … 12 = December)
      totalDays,
      currentDay: 1,
      delaySeconds,
      rows: []
    }
  });

  const day1Str = `${year}-${String(month).padStart(2, '0')}-01`;

  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (dateStr) => {
      const input = document.querySelector('#dater');
      const form = document.querySelector('form.booking-calendar');
      if (!input || !form) return;
      input.removeAttribute('readonly');
      input.value = dateStr;
      form.submit();
    },
    args: [day1Str]
  }, (results) => {
    if (chrome.runtime.lastError) {
      setStatus("Error: " + chrome.runtime.lastError.message, "red");
      return;
    }
    const monthLabel = `${year}-${String(month).padStart(2, '0')}`;
    setStatus(`Running: ${monthLabel} (${totalDays} days)`, '#555');
    document.getElementById("btnCancel").style.display = "inline-block";
  });
}

// ==========================================
// FREETOUR SCRAPE LOGIC (injected into page)
// ==========================================

function scrapeFreetourLogic() {
  const rawDate = document.querySelector('#dater')?.value || '';
  if (!rawDate && !document.querySelector('.booking-tourcard')) return null;

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
    if (!t) return '';
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