-- Schema only. Apply once with Wrangler migrations or the Cloudflare D1 console.
PRAGMA foreign_keys = ON;

CREATE TABLE authors (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  nickname TEXT NOT NULL CHECK(length(nickname) BETWEEN 2 AND 24),
  created_at TEXT NOT NULL
);

CREATE TABLE reviews (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL,
  author_id TEXT NOT NULL REFERENCES authors(id),
  stars INTEGER NOT NULL CHECK(stars BETWEEN 1 AND 5),
  text TEXT NOT NULL CHECK(length(text) BETWEEN 10 AND 2000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  hidden_at TEXT,
  UNIQUE(author_id, place_id)
);
CREATE INDEX reviews_by_place ON reviews(place_id, created_at DESC) WHERE deleted_at IS NULL AND hidden_at IS NULL;

CREATE TABLE guides (
  id TEXT PRIMARY KEY,
  place_id TEXT,
  author_id TEXT NOT NULL REFERENCES authors(id),
  city TEXT NOT NULL CHECK(length(city) BETWEEN 2 AND 30),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 4 AND 100),
  body TEXT NOT NULL CHECK(length(body) BETWEEN 40 AND 10000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  hidden_at TEXT
);
CREATE INDEX guides_by_place ON guides(place_id, created_at DESC) WHERE deleted_at IS NULL AND hidden_at IS NULL;
CREATE INDEX guides_by_city ON guides(city, created_at DESC) WHERE deleted_at IS NULL AND hidden_at IS NULL;

CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL REFERENCES authors(id),
  target_type TEXT NOT NULL CHECK(target_type IN ('review', 'guide')),
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 5 AND 500),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  UNIQUE(author_id, target_type, target_id)
);
CREATE INDEX reports_unresolved ON reports(created_at DESC) WHERE resolved_at IS NULL;

CREATE TABLE rate_limits (
  key TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(key, day)
);
