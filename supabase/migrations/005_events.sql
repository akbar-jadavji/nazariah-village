-- Social events: gatherings, parties, meetups that agents can organise,
-- gossip about, and collectively attend.

CREATE TABLE IF NOT EXISTS events (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id          UUID        REFERENCES agents(id) ON DELETE CASCADE,
  title                 TEXT        NOT NULL,
  description           TEXT,
  location              TEXT        NOT NULL,   -- building key: inn, plaza, bakery…
  scheduled_day         INTEGER     NOT NULL,
  scheduled_time_of_day TEXT        NOT NULL,   -- morning/midday/afternoon/evening
  status                TEXT        NOT NULL DEFAULT 'upcoming',  -- upcoming/active/ended
  created_at_tick       INTEGER     NOT NULL
);

CREATE INDEX IF NOT EXISTS events_status_day ON events (status, scheduled_day);
CREATE INDEX IF NOT EXISTS events_organizer  ON events (organizer_id);
