# Usage: python3 tools/extract_subway_legs.py <unzipped gtfs dir> legs.json
# Then paste the JSON into subway.js as SUBWAY_LEGS.
import csv, sys, json, collections
d = sys.argv[1]
LEGS = {'R17N>R16N': 'times-square-go', 'R16S>R17S': 'times-square-back',
        'D17N>F12N': 'moma-go', 'F12S>D17S': 'moma-back',
        '632N>626N': 'met-go', '626S>632S': 'met-back',
        '725N>701N': 'flushing-go', '701S>725S': 'flushing-back'}
want = set()
for k in LEGS:
    a, b = k.split('>'); want |= {a, b}
trips = {}
for r in csv.DictReader(open(f'{d}/trips.txt')):
    trips[r['trip_id']] = (r['route_id'], r['service_id'].split('-')[0])
def mins(t):
    h, m, s = map(int, t.split(':')); return h * 60 + m + s / 60
per = collections.defaultdict(dict)
for r in csv.DictReader(open(f'{d}/stop_times.txt')):
    if r['stop_id'] in want:
        per[r['trip_id']][r['stop_id']] = mins(r['departure_time'])
out = {}
for k, name in LEGS.items():
    a, b = k.split('>')
    res = collections.defaultdict(list)
    for t, st in per.items():
        if a in st and b in st and st[b] > st[a]:
            route, svc = trips[t]
            res[svc].append([round(st[a]) % 1440, round(st[b] - st[a]), route])
    out[name] = {svc: sorted(v) for svc, v in res.items()}
    print(name, {s: len(v) for s, v in out[name].items()}, 'routes', sorted({x[2] for v in out[name].values() for x in v}),
          'ride', sorted({x[1] for v in out[name].values() for x in v})[:6])
json.dump(out, open(sys.argv[2], 'w'), separators=(',', ':'))
