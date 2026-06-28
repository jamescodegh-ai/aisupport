/**
 * AI Gateway — Groq (primary) → Ollama (local fallback)
 * Set env vars:
 *   GROQ_API_KEY      — get free at console.groq.com
 *   GROQ_MODEL        — default: llama-3.1-8b-instant
 *   OLLAMA_BASE_URL   — default: http://localhost:11434 (optional local fallback)
 *   OLLAMA_MODEL      — default: llama3.2
 *   EMBED_PROVIDER    — "groq" | "ollama" (default: ollama for embeddings)
 *   OLLAMA_EMBED_MODEL— default: nomic-embed-text
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

// ── Groq provider (OpenAI-compatible) ──────────────────────────────────────
export function createGroqProvider() {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("Missing GROQ_API_KEY — get one free at console.groq.com");
  return createOpenAICompatible({
    name: "groq",
    baseURL: "https://api.groq.com/openai/v1",
    headers: { Authorization: `Bearer ${key}` },
  });
}

// ── Ollama provider (local) ────────────────────────────────────────────────
export function createOllamaProvider() {
  const base = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  return createOpenAICompatible({
    name: "ollama",
    baseURL: `${base}/v1`,
  });
}

// ── Get the best available chat model ─────────────────────────────────────
export function getChatModel() {
  // Try Groq first (fast, free tier)
  if (process.env.GROQ_API_KEY) {
    const groq = createGroqProvider();
    const model = process.env.GROQ_MODEL || "llama-3.1-8b-instant";
    return { provider: "groq" as const, model: groq(model) };
  }
  // Fallback: local Ollama
  const ollama = createOllamaProvider();
  const model = process.env.OLLAMA_MODEL || "llama3.2";
  return { provider: "ollama" as const, model: ollama(model) };
}

// ── Embeddings ─────────────────────────────────────────────────────────────
// Groq doesn't support embeddings yet — use Ollama or OpenAI-compatible
export async function embedText(text: string): Promise<number[]> {
  try { return await _embedText(text); } catch(e) { console.warn('Embed failed, skipping RAG:', e instanceof Error ? e.message : e); return []; }
}
async function _embedText(text: string): Promise<number[]> {
  const provider = process.env.EMBED_PROVIDER || "ollama";

  if (provider === "openai" && process.env.OPENAI_API_KEY) {
    // Optional: use OpenAI embeddings if you have a key
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
    });
    if (!res.ok) throw new Error(`OpenAI embed failed: ${res.status}`);
    const j = await res.json();
    return j.data[0].embedding as number[];
  }

  // Default: Ollama local embeddings (free, no key needed)
  const base = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  const embedModel = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";
  const res = await fetch(`${base}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: embedModel, input: text }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Ollama embed failed: ${res.status} ${await res.text()}`);
  const j = await res.json();
  // Ollama returns embeddings array
  const embedding = j.embeddings?.[0] ?? j.embedding;
  if (!embedding) throw new Error("Ollama embed: no embedding in response");
  return embedding as number[];
}

