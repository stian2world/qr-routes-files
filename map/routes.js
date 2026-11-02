// Real routes from home (Grove St PATH) to the five card areas, used by
// "Arrange my day" for stops inside those areas. Legs:
//   walk   — minutes on foot
//   path   — PATH train, timetable in config.js (TIMETABLES)
//   subway — subway train, real MTA departures in subway.js (SUBWAY_LEGS)
// `back` starts from `backStation`; `home` (if set) replaces BACK_TO_HOME.

const HOME_TO_GROVE_MIN = 4;

// ---------------------------------------------------------------------------
// The four place cards (QR text = id). `go` / `back` are the trip legs:
//   walk   — minutes on foot
//   path   — PATH train, using a TIMETABLES entry (config.js)
//   subway — subway train, using real departures in SUBWAY_LEGS (subway.js);
//            `every` is used when there's no schedule for that day (est.)
// `back` starts with a walk from wherever you are to `backStation`.
const DESTINATIONS = [
  {
    id: 'times-square', label: 'Times Square', icon: '🎭', side: 'right',
    lat: 40.7580, lng: -73.9855, visit: 30,
    go: [
      { type: 'walk', minutes: HOME_TO_GROVE_MIN, text: 'Walk to Grove St PATH' },
      { type: 'path', timetable: 'GROVE_TO_33RD', ride: 17, from: 'Grove St', to: '33rd St' },
      { type: 'walk', minutes: 3, text: 'Walk to 34 St–Herald Sq' },
      { type: 'subway', leg: 'times-square-go', lines: 'N/Q/R/W', from: '34 St–Herald Sq', to: 'Times Sq–42 St', every: 5, ride: 2 },
      { type: 'walk', minutes: 2, text: 'Walk to Times Square' },
    ],
    backStation: { name: 'Times Sq–42 St', lat: 40.7547, lng: -73.9868 },
    back: [
      { type: 'subway', leg: 'times-square-back', lines: 'N/Q/R/W', from: 'Times Sq–42 St', to: '34 St–Herald Sq', every: 5, ride: 2 },
      { type: 'walk', minutes: 3, text: 'Walk to 33rd St PATH' },
    ],
  },
  {
    id: '23rd-st', label: '23rd St', spoken: 'Twenty-third Street', icon: '🎨', side: 'top',
    lat: 40.7429, lng: -73.9928, visit: 60, // 23rd St PATH, 6th Ave (by SVA)
    go: [
      { type: 'walk', minutes: HOME_TO_GROVE_MIN, text: 'Walk to Grove St PATH' },
      { type: 'path', timetable: 'GROVE_TO_33RD', ride: 14, from: 'Grove St', to: '23rd St' },
    ],
    backStation: { name: '23rd St PATH', lat: 40.7429, lng: -73.9928 },
    back: [],
    // Straight home from 23rd St (no change to 33rd St).
    home: [
      { type: 'path', timetable: 'TWENTY_THIRD_TO_GROVE', ride: 14, from: '23rd St', to: 'Grove St' },
      { type: 'walk', minutes: HOME_TO_GROVE_MIN, text: 'Walk home' },
    ],
  },
  {
    id: 'moma', label: 'MoMA', spoken: 'Moma', icon: '🖼️', side: 'left',
    lat: 40.7614, lng: -73.9776, visit: 90,
    go: [
      { type: 'walk', minutes: HOME_TO_GROVE_MIN, text: 'Walk to Grove St PATH' },
      { type: 'path', timetable: 'GROVE_TO_33RD', ride: 17, from: 'Grove St', to: '33rd St' },
      { type: 'walk', minutes: 2, text: 'Walk to 34 St–Herald Sq' },
      { type: 'subway', leg: 'moma-go', lines: 'F/M', from: '34 St–Herald Sq', to: '5 Av/53 St', every: 8, ride: 6 },
      { type: 'walk', minutes: 3, text: 'Walk to MoMA' },
    ],
    backStation: { name: '5 Av/53 St', lat: 40.7602, lng: -73.9752 },
    back: [
      { type: 'subway', leg: 'moma-back', lines: 'F/M', from: '5 Av/53 St', to: '34 St–Herald Sq', every: 8, ride: 6 },
      { type: 'walk', minutes: 2, text: 'Walk to 33rd St PATH' },
    ],
  },
  {
    id: 'the-met', label: 'The Met', icon: '🏛️', side: 'bottom',
    lat: 40.7794, lng: -73.9632, visit: 120,
    go: [
      { type: 'walk', minutes: HOME_TO_GROVE_MIN, text: 'Walk to Grove St PATH' },
      { type: 'path', timetable: 'GROVE_TO_33RD', ride: 17, from: 'Grove St', to: '33rd St' },
      { type: 'walk', minutes: 8, text: 'Walk to 33 St (Park Ave)' },
      { type: 'subway', leg: 'met-go', lines: '6', from: '33 St', to: '86 St', every: 6, ride: 11 },
      { type: 'walk', minutes: 9, text: 'Walk to The Met' },
    ],
    backStation: { name: '86 St (Lexington Ave)', lat: 40.7795, lng: -73.9556 },
    back: [
      { type: 'subway', leg: 'met-back', lines: '6', from: '86 St', to: '33 St', every: 6, ride: 11 },
      { type: 'walk', minutes: 8, text: 'Walk to 33rd St PATH' },
    ],
  },
  {
    id: 'flushing', label: 'Flushing', spoken: 'Flushing', icon: '🥟', side: 'right',
    lat: 40.7596, lng: -73.8300, visit: 120, // Flushing–Main St (7)
    go: [
      { type: 'walk', minutes: HOME_TO_GROVE_MIN, text: 'Walk to Grove St PATH' },
      { type: 'path', timetable: 'GROVE_TO_33RD', ride: 17, from: 'Grove St', to: '33rd St' },
      { type: 'walk', minutes: 3, text: 'Walk to 34 St–Herald Sq' },
      { type: 'subway', leg: 'times-square-go', lines: 'N/Q/R/W', from: '34 St–Herald Sq', to: 'Times Sq–42 St', every: 5, ride: 2 },
      { type: 'walk', minutes: 4, text: 'Change to the 7 at Times Sq' },
      { type: 'subway', leg: 'flushing-go', lines: '7', from: 'Times Sq–42 St', to: 'Flushing–Main St', every: 6, ride: 35 },
    ],
    backStation: { name: 'Flushing–Main St', lat: 40.7596, lng: -73.8300 },
    back: [
      { type: 'subway', leg: 'flushing-back', lines: '7', from: 'Flushing–Main St', to: 'Times Sq–42 St', every: 6, ride: 35 },
      { type: 'walk', minutes: 4, text: 'Change to the N/Q/R/W at Times Sq' },
      { type: 'subway', leg: 'times-square-back', lines: 'N/Q/R/W', from: 'Times Sq–42 St', to: '34 St–Herald Sq', every: 5, ride: 2 },
      { type: 'walk', minutes: 3, text: 'Walk to 33rd St PATH' },
    ],
  },
];

// Last part of every trip home.
const BACK_TO_HOME = [
  { type: 'path', timetable: 'TWENTY_THIRD_TO_GROVE', ride: 17, from: '33rd St', to: 'Grove St' },
  { type: 'walk', minutes: HOME_TO_GROVE_MIN, text: 'Walk home' },
];

// Places to eat near each place — checked notes, not live data. `meals`
// says when it makes sense. Verify hours / bookings before you go.
// `price` is a rough per-person guess for one meal (food + a drink, before
// tip) — check the menu before you go.
