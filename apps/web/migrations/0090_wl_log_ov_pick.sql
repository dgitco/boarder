CREATE INDEX IF NOT EXISTS wl_log_ov_pick ON wl_log(at, id) WHERE (kind = '결정' AND handled IS NULL) OR msg LIKE '%창 이름 바꿈 「%' OR msg LIKE '합침 → 「%';
