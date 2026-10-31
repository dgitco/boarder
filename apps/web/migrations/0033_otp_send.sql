create table if not exists otp_send (email text not null, at integer not null);
create index if not exists otp_send_email_at on otp_send(email, at);
create index if not exists otp_send_at on otp_send(at);
