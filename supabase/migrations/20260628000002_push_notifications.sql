-- Push notification subscriptions table
CREATE TABLE public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(agent_id, endpoint)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agents manage own subscriptions" ON public.push_subscriptions
  FOR ALL TO authenticated USING (agent_id = auth.uid()) WITH CHECK (agent_id = auth.uid());

-- Notification log (so agents can see missed notifications)
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL, -- 'new_visitor' | 'new_message' | 'escalation'
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data JSONB,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE,
  visitor_id UUID REFERENCES public.visitors(id) ON DELETE CASCADE,
  read_by UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agents read notifications" ON public.notifications
  FOR SELECT TO authenticated USING (public.is_agent(auth.uid()));
CREATE POLICY "agents update notifications" ON public.notifications
  FOR UPDATE TO authenticated USING (public.is_agent(auth.uid()));
CREATE POLICY "service insert notifications" ON public.notifications
  FOR INSERT TO service_role WITH CHECK (true);

CREATE INDEX ON public.notifications(created_at DESC);
CREATE INDEX ON public.notifications(conversation_id);

-- Realtime for notifications
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
