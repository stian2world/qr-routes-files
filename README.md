# NYC Planner

A see-through map of NYC and Jersey City over your webcam. Five printed QR cards fly the map to five areas, your Google Maps saved places show up by category, and the page arranges a day trip from home with real PATH and subway times.

Open `index.html` (GitHub Pages: https://stian2world.github.io/qrcode-tracking/).

## How it works

- **Cards and zones:** the small camera picture on the left is split in two. The **dock** is the left 30 % and the **table** is the rest. Slide a card from the dock onto the table and the map flies to its area (the last one slid out wins). A card back in the dock for 2.5 s → whole city again. Untick **Mirror** for a camera that looks down at a table.

  | Card (QR text) | Area |
  | --- | --- |
  | Vanila Creme Brulee | Midtown West (Times Square) |
  | Matcha | Chelsea · Flatiron (SVA) |
  | yogurt | Midtown East (MoMA) |
  | Grapes | Upper East Side (The Met) |
  | Kimbap | Flushing |

- **Saved places:** ⬇️ Import takes a Google Takeout .zip (tick "Saved") or a places .json. Places stay in this browser only (localStorage). They're grouped into Food, Café & Dessert, Market, Park, Shopping and Other; the list under the map shows the places inside the current area.
- **Plan my day:** ◯ Circle places on the map (or tap +), then ✨ Arrange my day. Every order is tried (up to 7 stops) and the one with the least travelling wins, nudged so restaurants land at lunch (11:30–2) or dinner (5:30–8:30) and cafés in the afternoon. Real PATH timetable; for stops inside a card area, the real home ↔ area route (PATH + MTA schedule). Hops between places are estimates (walk under 20 min, else ~10 min + 3 min a mile), marked "est.". Set "Leave at", or leave it empty to leave now. Drag a stop to use your own order.
- **Look:** the camera is the page background (dimmed); the map is see-through with white shorelines. ArUco-free, single page, vanilla JS. MapLibre GL draws the map; streets and names come from OpenFreeMap when online.

## Files

- `index.html` — the page
- `config.js` — QR card → area, PATH timetables
- `map/map-geo.js` — shorelines (NYC DCP boroughs + US Census ZCTAs for NJ), the five areas, home (Grove St)
- `map/routes.js` — real routes from home to the five areas
- `subway.js` — MTA departures for those routes (from the static GTFS; rebuild with `tools/extract_subway_legs.py`)
- `map/map-qr.js` — camera, reading the cards, dock / table
- `map/map-app.js` — map, markers, list by category, plan list
- `map/map-day.js` — arranging and timing the day, circling places
- `map/map-import.js` — Takeout / .json import
- `map/map.css` — styles
