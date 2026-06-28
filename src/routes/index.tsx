import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

export const Route = createFileRoute('/')({
  head: () => ({
    meta: [
      { title: 'AI Support — Intelligent AI Chat Platform' },
      { name: 'description', content: 'AI-powered support platform with agent dashboard, visitor tracking, and knowledge management.' },
    ],
  }),
  component: Landing,
})

function Landing() {
  const [origin, setOrigin] = useState('')
  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])

  return (
    <div className="min-h-screen bg-background">
      <main className="page-wrap px-4 pb-8 pt-14">
        <section className="island-shell rise-in relative overflow-hidden rounded-[2rem] px-6 py-10 sm:px-10 sm:py-14">
          <div className="pointer-events-none absolute -left-20 -top-24 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(79,184,178,0.32),transparent_66%)]" />
          <div className="pointer-events-none absolute -bottom-20 -right-20 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(47,106,74,0.18),transparent_66%)]" />
          <p className="island-kicker mb-3">AI-Powered Support</p>
          <h1 className="display-title mb-5 max-w-3xl text-4xl leading-[1.02] font-bold tracking-tight text-[var(--sea-ink)] sm:text-6xl">
            Intelligent support, powered by AI
          </h1>
          <p className="mb-8 max-w-2xl text-base text-[var(--sea-ink-soft)] sm:text-lg">
            Deliver 24/7 support with an AI chat widget, real-time agent dashboard, and intelligent knowledge management. Replace traditional support tools.
          </p>
          <div className="flex flex-wrap gap-3">
            <a
              href="/dashboard"
              className="rounded-full border border-[rgba(50,143,151,0.3)] bg-[rgba(79,184,178,0.14)] px-5 py-2.5 text-sm font-semibold text-[var(--lagoon-deep)] no-underline transition hover:-translate-y-0.5 hover:bg-[rgba(79,184,178,0.24)]"
            >
              Open Dashboard
            </a>
            <a
              href="/knowledge"
              className="rounded-full border border-[rgba(23,58,64,0.2)] bg-white/50 px-5 py-2.5 text-sm font-semibold text-[var(--sea-ink)] no-underline transition hover:-translate-y-0.5 hover:border-[rgba(23,58,64,0.35)]"
            >
              Knowledge Base
            </a>
            <a
              href="/auth"
              className="rounded-full border border-[rgba(23,58,64,0.2)] bg-white/50 px-5 py-2.5 text-sm font-semibold text-[var(--sea-ink)] no-underline transition hover:-translate-y-0.5 hover:border-[rgba(23,58,64,0.35)]"
            >
              Sign In
            </a>
          </div>
        </section>

        <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ['AI Auto-Responder', 'Instant responses 24/7 with intelligent routing to human agents when needed.'],
            ['Visitor Tracking', 'Real-time location, browser, OS detection, and page navigation timeline.'],
            ['Live Agent Dashboard', 'Monitor conversations, take over from AI, and manage support in real-time.'],
            ['Knowledge Management', 'Curate your knowledge base and let AI learn from your docs.'],
            ['Seamless Handoff', 'Agents take control instantly while maintaining conversation context.'],
            ['Full History & Search', 'Every conversation searchable with complete visitor profiles.'],
          ].map(([title, desc], index) => (
            <article
              key={title}
              className="island-shell feature-card rise-in rounded-2xl p-5"
              style={{ animationDelay: `${index * 90 + 80}ms` }}
            >
              <h2 className="mb-2 text-base font-semibold text-[var(--sea-ink)]">
                {title}
              </h2>
              <p className="m-0 text-sm text-[var(--sea-ink-soft)]">{desc}</p>
            </article>
          ))}
        </section>

        <section className="island-shell mt-8 rounded-2xl p-6">
          <p className="island-kicker mb-2">Getting Started</p>
          <ul className="m-0 list-disc space-y-2 pl-5 text-sm text-[var(--sea-ink-soft)]">
            <li>
              Go to <code>Dashboard</code> to configure your AI support settings.
            </li>
            <li>
              Add content to your <code>Knowledge Base</code> for the AI to reference.
            </li>
            <li>
              Integrate the chat widget on your website using the provided snippet.
            </li>
            <li>
              Monitor conversations and take over from AI agents as needed.
            </li>
          </ul>
        </section>
      </main>
    </div>
  )
}
