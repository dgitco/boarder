-- 사람별 화면 덧씌우기 · 래퍼 화면 값 · 프롬프트 칸. 더하기만.
-- 값 우선순위: 그 사람이 고친 값(css · js) > 래퍼 값(wcss · wjs · wside) > 코드 기본값.
-- wjs 는 받는 사람이 켜기에 동의한 해시(wjs_sha)와 함께 올라온 것만 든다.
create table if not exists person_custom (
  owner text primary key,
  css text,
  js text,
  wcss text,
  wjs text,
  wjs_sha text,
  wside text,
  p_main text,
  p_roles text,
  at integer not null
);
