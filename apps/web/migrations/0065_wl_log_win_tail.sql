create index wl_log_win_tail on wl_log(ltrim(win, '0123456789 '), id);
