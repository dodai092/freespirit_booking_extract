# Bookings Extract — Chrome Extension

A Chrome extension that scrapes tour booking data from free tour platforms and copies it as TSV, ready to paste into Google Sheets or Excel.

## Supported Platforms

Freetour.com · Guruwalk.com

## Extracted Fields

Date · Time · Tour type · City · Language · Platform · Pax · Capacity

## Installation

1. Clone or download this repo.
2. Go to `chrome://extensions` in Chrome.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the project folder.

## Usage

1. Navigate to your bookings or calendar page on a supported platform.
2. Click the **Bookings Extract** icon in your toolbar.
3. Click the button for the current platform.
4. When **"Copied to Clipboard!"** appears, paste into your spreadsheet.

## Project Structure

```
manifest.json   Extension config and permissions
popup.html      Popup UI
freetour.js     freetour scraping logic and clipboard handling
guruwalk.js     guruwalk scraping logic and clipboard handling
logo.png        Extension icon
```

Built with Manifest V3 and vanilla JS — no external dependencies.
