
-- Sites table
CREATE TABLE public.sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  domain text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.sites TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sites TO authenticated;
GRANT ALL ON public.sites TO service_role;

ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon read sites" ON public.sites FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "agents manage sites" ON public.sites FOR ALL TO authenticated
  USING (public.is_agent(auth.uid())) WITH CHECK (public.is_agent(auth.uid()));

-- Seed default site (wolvcapital)
INSERT INTO public.sites (slug, name, domain) VALUES ('wolvcapital', 'WolvCapital', 'wolvcapital.com')
ON CONFLICT (slug) DO NOTHING;

-- Add site_id columns
ALTER TABLE public.kb_chunks ADD COLUMN site_id uuid REFERENCES public.sites(id) ON DELETE CASCADE;
ALTER TABLE public.visitors ADD COLUMN site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL;
ALTER TABLE public.conversations ADD COLUMN site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL;

-- Backfill existing rows to default site
UPDATE public.kb_chunks SET site_id = (SELECT id FROM public.sites WHERE slug = 'wolvcapital') WHERE site_id IS NULL;
UPDATE public.visitors SET site_id = (SELECT id FROM public.sites WHERE slug = 'wolvcapital') WHERE site_id IS NULL;
UPDATE public.conversations SET site_id = (SELECT id FROM public.sites WHERE slug = 'wolvcapital') WHERE site_id IS NULL;

CREATE INDEX IF NOT EXISTS kb_chunks_site_id_idx ON public.kb_chunks(site_id);
CREATE INDEX IF NOT EXISTS visitors_site_id_idx ON public.visitors(site_id);
CREATE INDEX IF NOT EXISTS conversations_site_id_idx ON public.conversations(site_id);

-- Replace match_kb to filter by site
DROP FUNCTION IF EXISTS public.match_kb(vector, integer);
CREATE OR REPLACE FUNCTION public.match_kb(
  query_embedding vector,
  match_count integer DEFAULT 5,
  _site_id uuid DEFAULT NULL
)
RETURNS TABLE(id uuid, url text, title text, content text, similarity double precision)
LANGUAGE sql STABLE
AS $$
  SELECT id, url, title, content, 1 - (embedding <=> query_embedding) AS similarity
  FROM public.kb_chunks
  WHERE embedding IS NOT NULL
    AND (_site_id IS NULL OR site_id = _site_id)
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;
