-- users & tiers (minimal)
CREATE TABLE
    IF NOT EXISTS users (
        user_id BIGINT PRIMARY KEY,
        username TEXT,
        tier TEXT NOT NULL DEFAULT 'free', -- free|lite|pro
        created_at timestamptz NOT NULL DEFAULT now ()
    );

-- canonical video registry (per platform + source video id)
CREATE TABLE
    IF NOT EXISTS videos (
        platform TEXT NOT NULL,
        video_id TEXT NOT NULL,
        title TEXT,
        duration_sec INT,
        thumb_url TEXT,
        created_at timestamptz NOT NULL DEFAULT now (),
        PRIMARY KEY (platform, video_id)
    );

-- per-format telegram cache
CREATE TABLE
    IF NOT EXISTS video_files (
        id BIGSERIAL PRIMARY KEY,
        platform TEXT NOT NULL,
        video_id TEXT NOT NULL,
        -- format key encodes important constraints (e.g., yt:itag, height, ext)
        format_key TEXT NOT NULL,
        height INT,
        width INT,
        ext TEXT,
        itag INT,
        abr_kbps INT, -- audio bitrate if audio-only/mp4
        filesize BIGINT,
        telegram_file_id TEXT NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now (),
        UNIQUE (platform, video_id, format_key)
    );

-- optional job audit
CREATE TABLE
    IF NOT EXISTS jobs (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT,
        url TEXT,
        platform TEXT,
        fmt TEXT,
        status TEXT, -- queued|running|done|failed
        bytes BIGINT,
        duration_sec INT,
        error TEXT,
        created_at timestamptz NOT NULL DEFAULT now ()
    );

-- old cache table from your earlier code (kept for compatibility)
CREATE TABLE
    IF NOT EXISTS video_records (
        platform text NOT NULL,
        video_id text NOT NULL,
        telegram_file_id text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now (),
        updated_at timestamptz NOT NULL DEFAULT now (),
        CONSTRAINT video_records_pk PRIMARY KEY (platform, video_id)
    );

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END$$;
DROP TRIGGER IF EXISTS trg_video_records_updated_at ON video_records;
CREATE TRIGGER trg_video_records_updated_at BEFORE UPDATE ON video_records
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- helpful index
CREATE INDEX IF NOT EXISTS idx_video_files_pid_fmt ON video_files (platform, video_id, format_key);


---------------------------------- Musica qismi ----------------------------------
-- 1) Qidiruv natijalari (kesh). iTunes trackId yoki ISRC saqlab qo'yamiz.
CREATE TABLE IF NOT EXISTS tracks (
  id BIGSERIAL PRIMARY KEY,
  source        VARCHAR(20) NOT NULL,   -- 'itunes' | 'acr' | 'manual'
  query         TEXT,                   -- matnli qidiruv / fingerprint
  external_id   TEXT,                   -- iTunes trackId yoki ISRC
  title         TEXT,
  artist        TEXT,
  album         TEXT,
  duration_sec  INT,
  thumb_url     TEXT,
  created_at    TIMESTAMP DEFAULT now()
);

-- 2) Tayyor MP3 fayllar (Telegram file_id orqali tez qaytarish)
CREATE TABLE IF NOT EXISTS track_files (
  id BIGSERIAL PRIMARY KEY,
  track_key       TEXT UNIQUE,          -- mas: sha1(lower(title)|lower(artist)|duration|kbps)
  filesize        BIGINT,
  bitrate_kbps    INT,
  telegram_file_id TEXT,
  created_at      TIMESTAMP DEFAULT now()
);
