// Settings for the NYC Planner.

// Printed QR cards. The text inside each code is on the left (matched
// without caring about upper/lower case or extra spaces).
// Your five printed cards, left to right:
//   Kimbap → Flushing · Vanila Creme Brulee → Times Square · Matcha → 23rd St
//   yogurt → MoMA · Grapes → The Met
// To swap which card means what, just swap the words on the left.
const QR_ROLES = {
  kimbap: 'dest:flushing',
  'vanila creme brulee': 'dest:times-square',
  matcha: 'dest:23rd-st',
  yogurt: 'dest:moma',
  grapes: 'dest:the-met',
  // Codes printed from poster.html also work:
  flushing: 'dest:flushing',
  home: 'home', // optional extra card: head home now
  'times-square': 'dest:times-square',
  '23rd-st': 'dest:23rd-st',
  moma: 'dest:moma',
  'the-met': 'dest:the-met',
};

// Turns the text read from a code into its QR_ROLES key.
function qrKey(text) {
  return String(text).replace(/\s+/g, ' ').trim().toLowerCase();
}

// Train timetables: [first departure, last departure, every N minutes].
// GROVE_TO_33RD is copied from the PATH app (Grove St -> 23rd St, 33rd St
// line). Rows marked "guess" weren't in the screenshots.
const TIMETABLES = {
  GROVE_TO_33RD: [
    ['07:08', '07:33', 5],
    ['07:37', '08:45', 4],
    ['08:51', '09:57', 6], // guess
    ['10:04', '15:04', 12],
    ['15:13', '15:53', 10],
    ['15:58', '18:58', 5], // 18:53 and 18:58 are a guess
    ['19:03', '19:53', 10],
    ['20:04', '22:16', 12],
    ['22:31', '22:31', 1],
    ['22:44', '22:44', 1],
    ['23:04', '23:04', 1],
  ],

  // 23rd St -> Grove St (going home). NOT from the PATH app yet — it reuses
  // the same frequencies as the other direction, so the popup marks it
  // "(est.)". Replace the rows with the real times and set estimated: false.
  TWENTY_THIRD_TO_GROVE: {
    estimated: true,
    rows: [
      ['07:08', '07:33', 5],
      ['07:37', '08:45', 4],
      ['08:51', '09:57', 6],
      ['10:04', '15:04', 12],
      ['15:13', '15:53', 10],
      ['15:58', '18:58', 5],
      ['19:03', '19:53', 10],
      ['20:04', '22:16', 12],
      ['22:31', '22:31', 1],
      ['22:44', '22:44', 1],
      ['23:04', '23:04', 1],
    ],
  },
};
