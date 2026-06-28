import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/test')({
  component: () => (
    <div>
      <h1>Widget Test</h1>
      <script src="/api/widgetjs" data-site="wolvcapital" async />
    </div>
  )
})
