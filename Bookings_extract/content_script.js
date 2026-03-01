// ==========================================
// FREETOUR BATCH SCRAPER - CONTENT SCRIPT
// Runs on every page load on admin.freetour.com.
// Checks chrome.storage.local for an active
// batch session and advances the date loop.
// ==========================================

(function () {
  // Only activate on the bookings page (URL contains /bookings)
  if (!location.pathname.includes('/bookings')) return;

  // Give the page 1.5s to finish rendering
  setTimeout(runBatchStep, 1500);

  async function runBatchStep() {
    const data = await chrome.storage.local.get('freetourBatch');
    const batch = data.freetourBatch;

    // No active batch — do nothing
    if (!batch || !batch.active) return;

    // Read the current date from the URL query param (?date=YYYY-MM-DD)
    const params = new URLSearchParams(location.search);
    const currentDateVal = params.get('date') || '';

    // Build the date string we expect to be on right now
    const expectedDate = buildDateStr(batch.year, batch.month, batch.currentDay);

    // If we're on the wrong date (e.g. user navigated mid-batch),
    // just navigate to the correct date and wait for the next load.
    if (currentDateVal !== expectedDate) {
      navigateToDate(expectedDate);
      return;
    }

    // Scrape current page — returns an array of TSV row strings
    const newRows = scrapeFreetourRows(currentDateVal);
    const updatedRows = [...batch.rows, ...newRows];

    if (batch.currentDay < batch.totalDays) {
      // Save progress and advance to the next day after a throttle delay
      const nextDay = batch.currentDay + 1;
      await chrome.storage.local.set({
        freetourBatch: {
          ...batch,
          currentDay: nextDay,
          rows: updatedRows
        }
      });
      // Wait between days to avoid triggering rate-limit warnings
      setTimeout(() => {
        navigateToDate(buildDateStr(batch.year, batch.month, nextDay));
      }, (batch.delaySeconds || 3) * 1000);

    } else {
      // All days done — compile and copy to clipboard
      const headers = 'Date\tTime\tTour\tCity\tLanguage\tPlatform\tPax\tCapacity';
      const tsvContent = [headers, ...updatedRows].join('\n');

      await chrome.storage.local.remove('freetourBatch');

      navigator.clipboard.writeText(tsvContent).then(() => {
        alert('Freetour batch complete — data copied to clipboard!');
      }).catch(() => {
        // Fallback: copy via textarea if clipboard API is blocked
        const ta = document.createElement('textarea');
        ta.value = tsvContent;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        alert('Freetour batch complete — data copied to clipboard!');
      });
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  function buildDateStr(year, month, day) {
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  // Navigate by updating the URL query param — works on admin.freetour.com
  function navigateToDate(dateStr) {
    const url = new URL(location.href);
    url.searchParams.set('date', dateStr);
    location.href = url.toString();
  }

  function scrapeFreetourRows(rawDate) {
    if (!rawDate) return [];

    const dateObj = new Date(rawDate + 'T00:00:00');
    const formattedDate = dateObj.toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });

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

    const rows = [];
    const cards = document.querySelectorAll('.booking-tourcard');

    cards.forEach(card => {
      if (card.offsetParent === null) return;

      const tourName = card.querySelector('.booking-tourcard__title span')?.textContent.trim() || '';
      const time24 = to24h(card.querySelector('.booking-tourcard__time div')?.textContent.trim());

      const flagStyle = card.querySelector('.booking-tourcard__flag')?.style.backgroundImage || '';
      const flagCode = (flagStyle.match(/\/([a-z]{2})\.svg/) || [])[1] || '';
      const language = flagToLang[flagCode] || flagCode;

      const rawCity = (tourName.split(' ').pop() || '').toLowerCase();
      const city = cityAbbr[rawCity] || rawCity;

      const limitVal = card.querySelector('.booking-tourcard__limit-value');
      const pax = limitVal?.querySelector('span')?.textContent.trim() || '0';
      const capacity = limitVal?.querySelector('.booking-tourcard__limit-const')?.textContent.trim() || '0';

      rows.push([formattedDate, time24, 'free', city, language, 'freetour', pax, capacity].join('\t'));
    });

    return rows;
  }

})();