-- 사람별 봉투 암호화(기본 모드: 서버가 키를 쥐되 DB · R2 · DO 덤프는 암호문) — worker/vault/.
-- 한 줄 = 그 사람(owner, '' = 워크스페이스 주인 — 다른 표와 같은 약속)의 데이터 키(DEK) 한 판. DEK 원문은 어디에도 안 남고
-- wrapped = KEK(Worker 비밀 DATA_KEK_<kek>)로 감싼 것("k1." + base64url(iv | 암호문), AAD = "boarder dek v1|" + owner + "|" + ver).
-- mode 'e2e' 줄은 wrapped 를 사람의 계정 키로 화면에서 감쌈 — 서버는 못 풂(kek = 0). KEK 돌려 바꾸기 = 이 표 줄만 다시 감쌈(rewrapAll).
-- retired_at 이 찬 판은 새로 봉하는 데 안 씀(열기는 됨 — 그 판으로 봉한 칸이 남아 있음).
-- 스위치 f7_flag envelope: 꺼져 있으면 아무 길도 이 표를 안 읽고 안 씀.
create table if not exists dek (
  owner text not null,
  ver integer not null,
  wrapped text not null,
  kek integer not null,
  mode text not null default 'server',
  created_at integer not null,
  retired_at integer,
  primary key (owner, ver)
);
insert or ignore into f7_flag(name, on_at, note) values ('envelope', null, '사람별 DEK 봉함(worker/vault) — 켜면 sealField 가 봉함, 끄면 평문 그대로');
