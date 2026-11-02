-- 새 기기 허용을 보드 카드 · 승인된 기기로(온보딩 2층, 더하기만 — 옛 코드는 새 칸을 안 읽어도 됨)
-- card_id · card_owner: 새 기기 setup 이 메일을 주면 그 회원 보드에 「새 기기 ○○ 허용?」 카드(board_card.id) — 답은 그 회원 세션만, 맞는 코드를 골라야 허용
-- approved_by: 누가 허용했나 — browser(옛 /device 화면) · card(보드 카드) · device:<기기 id>(승인된 기기의 boarder device approve)
alter table device_code add column card_id text;
alter table device_code add column card_owner text;
alter table device_code add column approved_by text;
create index device_code_card on device_code(card_id);
create index device_code_card_owner on device_code(card_owner, created_at);
create table device_card_event (email text not null, kind text not null, at integer not null);
create index device_card_event_email on device_card_event(email, kind, at);
