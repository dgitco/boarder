-- 주인 서버 받은편지함 기기: 관리 토큰으로만 지정하며 자기 신고 machine 값과 분리한다. 줄이 없으면 회원 길.
CREATE TABLE IF NOT EXISTS owner_inbox_device (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  device_id TEXT NOT NULL
);
