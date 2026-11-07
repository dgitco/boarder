-- 커넥터 토큰 갱신 임차: 연결마다 한 isolate 만 갱신(돌려 쓰는 갱신 토큰을 동시에 보내면 서버가 줄 전체를 폐기함). 없어도 코드는 예전처럼 돎
CREATE TABLE IF NOT EXISTS connection_refresh_lease (id TEXT PRIMARY KEY, until INTEGER NOT NULL);
