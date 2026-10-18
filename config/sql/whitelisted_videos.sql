-- Table: public.whitelisted_videos

CREATE TABLE IF NOT EXISTS public.whitelisted_videos
(
  id text NOT NULL,
  title text NOT NULL,
  ucid text DEFAULT '',
  author text DEFAULT '',
  thumbnail_url text DEFAULT '',
  added_by text DEFAULT 'admin',
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT whitelisted_videos_id_key UNIQUE (id)
);

GRANT ALL ON TABLE public.whitelisted_videos TO current_user;

CREATE INDEX IF NOT EXISTS whitelisted_videos_id_idx
  ON public.whitelisted_videos
  USING btree
  (id COLLATE pg_catalog."default");
