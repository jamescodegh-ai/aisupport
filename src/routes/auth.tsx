import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Agent Sign In — WolvCapital Chat" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard" });
    });
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password, options: { data: { display_name: name }, emailRedirectTo: window.location.origin + "/dashboard" } });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      navigate({ to: "/dashboard" });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Auth failed");
    } finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#06101f] text-white p-6">
      <div className="w-full max-w-md bg-[#0a1628] border border-[#1e3a5f] rounded-2xl p-8 shadow-2xl">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-[#d4af37] flex items-center justify-center text-[#0a1628] font-bold text-lg">W</div>
          <div>
            <h1 className="font-semibold">WolvCapital Chat</h1>
            <p className="text-xs text-[#8aa0c0]">Agent dashboard</p>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-3">
          {mode === "signup" && (
            <input className="w-full bg-[#162846] border border-[#1e3a5f] rounded-lg px-3 py-2 text-sm" placeholder="Display name" value={name} onChange={(e) => setName(e.target.value)} required />
          )}
          <input type="email" className="w-full bg-[#162846] border border-[#1e3a5f] rounded-lg px-3 py-2 text-sm" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input type="password" className="w-full bg-[#162846] border border-[#1e3a5f] rounded-lg px-3 py-2 text-sm" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
          {err && <div className="text-xs text-red-400">{err}</div>}
          <button disabled={loading} className="w-full bg-[#d4af37] text-[#0a1628] font-semibold rounded-lg py-2 text-sm disabled:opacity-50">
            {loading ? "..." : mode === "signin" ? "Sign in" : "Create agent account"}
          </button>
        </form>
        <button onClick={() => setMode(mode === "signin" ? "signup" : "signin")} className="mt-4 text-xs text-[#8aa0c0] hover:text-[#d4af37] underline w-full text-center">
          {mode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in"}
        </button>
        <p className="text-[10px] text-[#6b7d99] text-center mt-4">First user becomes admin. Subsequent users are agents.</p>
      </div>
    </div>
  );
}
