-- 회원 웹 푸시 구독 주소(endpoint) → 지금 그 브라우저를 쓰는 회원(더하기만). 회원 구독은 회원마다 Pusher 칸(DO)에 따로 있어,
-- 로그아웃 없이 다른 계정으로 들어와 알림을 켜면 옛 회원 칸에도 같은 주소가 남아 옛 회원 알림이 이 기기로 왔음 — 새 회원이 켤 때 옛 칸 구독을 지우려고 적어 둠
create table member_push_ep (
  endpoint text primary key,
  owner text not null,
  at integer not null
);
create index member_push_ep_owner on member_push_ep(owner);
