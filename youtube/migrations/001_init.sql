CREATE TABLE IF NOT EXISTS videos (
  id BIGSERIAL PRIMARY KEY,
  yt_video_id TEXT NOT NULL,
  title TEXT,
  channel TEXT,
  duration_seconds INT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (yt_video_id)
);

CREATE TYPE file_status AS ENUM ('pending','ready','failed');

CREATE TABLE IF NOT EXISTS video_files (
  id BIGSERIAL PRIMARY KEY,
  video_id BIGINT REFERENCES videos(id) ON DELETE CASCADE,
  itag INT,
  format_label TEXT,
  ext TEXT,
  width INT,
  height INT,
  filesize BIGINT,
  telegram_file_id TEXT,
  telegram_file_unique_id TEXT,
  telegram_type TEXT, -- 'video' yoki 'document'
  status file_status DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (video_id, itag)
);

CREATE INDEX IF NOT EXISTS idx_videos_yt ON videos(yt_video_id);
CREATE INDEX IF NOT EXISTS idx_video_files_vid ON video_files(video_id);
