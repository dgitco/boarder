#!/usr/bin/env python3
"""F7 장부 쓰기 전환: wl_<표> 마다 D1 트리거 셋(wl_web_<표>_i · u · d)을 ledger-schema.ts 에서 뽑아 마이그레이션 글로.
트리거는 Worker(쓰기 길 /api/relay/write · owner-write)가 바꾼 줄 키를 wl_change(origin web)에 — 릴레이가 올리는 batch 는 wl_mute 로 안 적음.
표가 새로 생기면(ledger-schema.ts 고침) 이것으로 그 표 몫만 새 마이그레이션에: python3 scripts/ledger-triggers.py [표 …] > migrations/00NN_….sql"""
import json, re, sys
from pathlib import Path

src = (Path(__file__).resolve().parent.parent / 'worker/ledger-schema.ts').read_text()
spec = json.loads(re.search(r'export default (\{.*\}) as Record', src, re.S).group(1))
only = set(sys.argv[1:])
AT = "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)"
W = 'WHEN NOT EXISTS (SELECT 1 FROM wl_mute)'
out = []
for t, s in spec.items():
    if only and t not in only:
        continue
    key = lambda r: 'json_array(' + ', '.join(f'{r}."{k}"' for k in s['pk']) + ')'
    ins = lambda e: f"INSERT INTO wl_change(tbl, pk, op, at, origin, tx) VALUES ('{t}', {e}, 'up', {AT}, 'web', (SELECT tx FROM wl_tx LIMIT 1));"
    out.append(f'CREATE TRIGGER wl_web_{t}_i AFTER INSERT ON wl_{t} {W} BEGIN {ins(key("NEW"))} END;')
    # 키가 바뀌는 고침(talk.rekey 등)이면 옛 키(→ 줄 없음 = 사본에서 지움)도
    out.append(f'CREATE TRIGGER wl_web_{t}_u AFTER UPDATE ON wl_{t} {W} BEGIN {ins(key("OLD"))} '
               f"INSERT INTO wl_change(tbl, pk, op, at, origin, tx) SELECT '{t}', {key('NEW')}, 'up', {AT}, 'web', (SELECT tx FROM wl_tx LIMIT 1) "
               f"WHERE {key('NEW')} IS NOT {key('OLD')}; END;")
    out.append(f"CREATE TRIGGER wl_web_{t}_d AFTER DELETE ON wl_{t} {W} BEGIN {ins(key('OLD')).replace(chr(39) + 'up' + chr(39), chr(39) + 'del' + chr(39))} END;")
print('\n'.join(out))
