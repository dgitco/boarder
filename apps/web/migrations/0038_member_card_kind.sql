alter table board_card add column kind text not null default 'decision';
alter table board_card add column snooze_until integer;
create index board_card_kind on board_card(owner, kind, state, at);
-- 카드 스레드 줄(board_log.thread = 카드 id) 읽기 — 회원 스레드 답이 늘면 owner 줄 전체를 훑지 않게
create index board_log_thread on board_log(owner, thread, at);
