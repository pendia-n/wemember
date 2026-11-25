CREATE TABLE challenges (
 id TEXT PRIMARY KEY, code TEXT UNIQUE, host TEXT, name TEXT NOT NULL, prompt_id TEXT NOT NULL REFERENCES prompt_deck(id),
 prompt TEXT NOT NULL, answers TEXT NOT NULL, state TEXT NOT NULL, created_ms INTEGER NOT NULL,
 start_ms INTEGER, submit_until INTEGER, vote_until INTEGER, finalized_ms INTEGER,
 audio_key TEXT, audio_ms INTEGER, audio_delete_at INTEGER, reward_users TEXT, reward_sent INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX challenges_cleanup ON challenges(audio_delete_at) WHERE audio_key IS NOT NULL;
CREATE INDEX challenges_rewards ON challenges(reward_sent,finalized_ms);
CREATE INDEX challenges_voluntary ON challenges(state,submit_until,vote_until);

CREATE TABLE challenge_players (
 challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE, user_id TEXT NOT NULL, username TEXT NOT NULL,
 role TEXT NOT NULL, cost INTEGER, listen_ms INTEGER, reply TEXT, score INTEGER, elapsed_ms INTEGER, tie_key TEXT NOT NULL,
 PRIMARY KEY(challenge_id,user_id)
);
CREATE INDEX challenge_players_role ON challenge_players(challenge_id,role);
CREATE TABLE challenge_turns (
 challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
 turn_number INTEGER NOT NULL, user_id TEXT NOT NULL, body TEXT NOT NULL, created_ms INTEGER NOT NULL,
 PRIMARY KEY(challenge_id,turn_number)
);
CREATE TABLE challenge_votes (
 challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
 voter TEXT NOT NULL, choice TEXT NOT NULL, PRIMARY KEY(challenge_id,voter)
);
