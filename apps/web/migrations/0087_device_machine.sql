ALTER TABLE device ADD COLUMN machine TEXT;
CREATE INDEX IF NOT EXISTS device_owner_machine ON device(owner, machine) WHERE machine IS NOT NULL;
