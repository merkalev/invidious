-- Table: public.whitelisted_channels

CREATE TABLE IF NOT EXISTS public.whitelisted_channels
(
  ucid text NOT NULL,
  name text NOT NULL,
  handle text DEFAULT '',
  thumbnail_url text DEFAULT '',
  added_by text DEFAULT 'admin',
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT whitelisted_channels_ucid_key UNIQUE (ucid)
);

GRANT ALL ON TABLE public.whitelisted_channels TO current_user;

CREATE INDEX IF NOT EXISTS whitelisted_channels_ucid_idx
  ON public.whitelisted_channels
  USING btree
  (ucid COLLATE pg_catalog."default");
