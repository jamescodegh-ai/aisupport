
-- Extensions
CREATE EXTENSION IF NOT EXISTS vector;

-- Enums
CREATE TYPE public.app_role AS ENUM ('admin', 'agent');
CREATE TYPE public.conversation_status AS ENUM ('ai', 'human', 'closed');
CREATE TYPE public.message_role AS ENUM ('visitor', 'ai', 'agent', 'system');

-- user_roles
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.is_agent(_user_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('admin','agent'))
$$;

CREATE POLICY "users see own roles" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

-- agents (profile)
CREATE TABLE public.agents (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  online BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.agents TO authenticated;
GRANT ALL ON public.agents TO service_role;
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agents read all" ON public.agents FOR SELECT TO authenticated USING (public.is_agent(auth.uid()));
CREATE POLICY "agents update self" ON public.agents FOR UPDATE TO authenticated USING (id = auth.uid());
CREATE POLICY "agents insert self" ON public.agents FOR INSERT TO authenticated WITH CHECK (id = auth.uid());

-- visitors
CREATE TABLE public.visitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL UNIQUE,
  name TEXT,
  email TEXT,
  ip TEXT,
  country TEXT,
  city TEXT,
  region TEXT,
  user_agent TEXT,
  browser TEXT,
  os TEXT,
  current_page TEXT,
  referrer TEXT,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.visitors TO anon, authenticated;
GRANT ALL ON public.visitors TO service_role;
ALTER TABLE public.visitors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon insert visitors" ON public.visitors FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon read own visitor by session" ON public.visitors FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon update visitors" ON public.visitors FOR UPDATE TO anon, authenticated USING (true);

-- conversations
CREATE TABLE public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id UUID NOT NULL REFERENCES public.visitors(id) ON DELETE CASCADE,
  status public.conversation_status NOT NULL DEFAULT 'ai',
  assigned_agent_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  unread_agent_count INT NOT NULL DEFAULT 0,
  unread_visitor_count INT NOT NULL DEFAULT 0,
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_preview TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.conversations(visitor_id);
CREATE INDEX ON public.conversations(last_message_at DESC);
GRANT SELECT, INSERT, UPDATE ON public.conversations TO anon, authenticated;
GRANT ALL ON public.conversations TO service_role;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open access conversations" ON public.conversations FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- messages
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  role public.message_role NOT NULL,
  agent_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.messages(conversation_id, created_at);
GRANT SELECT, INSERT ON public.messages TO anon, authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open access messages" ON public.messages FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- page_views
CREATE TABLE public.page_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id UUID NOT NULL REFERENCES public.visitors(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  title TEXT,
  referrer TEXT,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.page_views(visitor_id, viewed_at DESC);
GRANT SELECT, INSERT ON public.page_views TO anon, authenticated;
GRANT ALL ON public.page_views TO service_role;
ALTER TABLE public.page_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open access page_views" ON public.page_views FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- knowledge base chunks
CREATE TABLE public.kb_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  embedding vector(768),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.kb_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
GRANT SELECT ON public.kb_chunks TO anon, authenticated;
GRANT ALL ON public.kb_chunks TO service_role;
ALTER TABLE public.kb_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read kb" ON public.kb_chunks FOR SELECT TO anon, authenticated USING (true);

-- match_kb function
CREATE OR REPLACE FUNCTION public.match_kb(query_embedding vector(768), match_count INT DEFAULT 5)
RETURNS TABLE (id UUID, url TEXT, title TEXT, content TEXT, similarity FLOAT)
LANGUAGE SQL STABLE AS $$
  SELECT id, url, title, content, 1 - (embedding <=> query_embedding) AS similarity
  FROM public.kb_chunks
  WHERE embedding IS NOT NULL
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Auto-create agent profile + role on signup
CREATE OR REPLACE FUNCTION public.handle_new_agent_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.agents (id, display_name) VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email,'@',1)));
  -- First user becomes admin, rest are agents
  IF (SELECT COUNT(*) FROM public.user_roles) = 0 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'agent');
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_agent_user();

-- Update conversation on new message
CREATE OR REPLACE FUNCTION public.bump_conversation_on_message()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.conversations
  SET last_message_at = NEW.created_at,
      last_message_preview = LEFT(NEW.content, 140),
      unread_agent_count = CASE WHEN NEW.role = 'visitor' THEN unread_agent_count + 1 ELSE unread_agent_count END,
      unread_visitor_count = CASE WHEN NEW.role IN ('ai','agent') THEN unread_visitor_count + 1 ELSE unread_visitor_count END
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END; $$;

CREATE TRIGGER messages_bump_conversation
AFTER INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.bump_conversation_on_message();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.visitors;
ALTER PUBLICATION supabase_realtime ADD TABLE public.page_views;
