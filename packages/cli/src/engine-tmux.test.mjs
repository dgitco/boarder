import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { wrapsMine } from './engine/index.mjs';

test('wrapsMine: 보더 자리를 부르는 감싸기는 참, 다른 tmux · 보더 자리 자체 · 없는 파일은 거짓', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-tmux-')), mine = path.join(d, 'cfg', 'bin', 'tmux');
  fs.mkdirSync(path.dirname(mine), { recursive: true }); fs.writeFileSync(mine, '\x7fELF real tmux');
  const wrap = path.join(d, 'wrap'); fs.writeFileSync(wrap, `#!/bin/sh\nREAL="${mine}"\nexec "$REAL" -L boarder "$@"\n`);
  const other = path.join(d, 'other'); fs.writeFileSync(other, '#!/bin/sh\nexec /usr/local/bin/tmux "$@"\n');
  const link = path.join(d, 'link'); fs.symlinkSync(mine, link);
  try {
    assert.equal(wrapsMine(wrap, mine), true);
    assert.equal(wrapsMine(other, mine), false);
    assert.equal(wrapsMine(link, mine), false, '보더 자리 링크는 진짜');
    assert.equal(wrapsMine(path.join(d, 'nope'), mine), false);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
