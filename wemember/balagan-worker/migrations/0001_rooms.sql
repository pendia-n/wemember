CREATE TABLE rooms (
 id TEXT PRIMARY KEY, host TEXT NOT NULL, name TEXT NOT NULL, scenario INTEGER NOT NULL,
 phase TEXT NOT NULL DEFAULT 'lobby', created_at INTEGER NOT NULL, started_at INTEGER
);
CREATE INDEX room_age ON rooms(created_at);
CREATE TABLE players (
 room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, user_id TEXT NOT NULL, username TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'player', cost INTEGER, opened_at INTEGER, answer TEXT, followup TEXT,
 score INTEGER, submitted_at INTEGER, PRIMARY KEY(room_id,user_id)
);
CREATE TABLE votes (
 room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, user_id TEXT NOT NULL,
 choice TEXT NOT NULL, PRIMARY KEY(room_id,user_id)
);
