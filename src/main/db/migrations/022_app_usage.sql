-- 2.66: day timeline. Seconds per app window per local day, sampled once a minute while the
-- setting is on; rows older than 30 days are deleted. Titles are cut to 120 characters and are
-- empty for private windows.
CREATE TABLE app_usage (
  day TEXT NOT NULL,
  process TEXT NOT NULL,
  title TEXT NOT NULL,
  seconds INTEGER NOT NULL,
  last_seen TEXT NOT NULL,
  PRIMARY KEY (day, process, title)
);
