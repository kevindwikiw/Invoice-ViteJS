import { createFileRoute } from '@tanstack/react-router'
import { LANDING_CONFIG } from '../config/landing'

export const Route = createFileRoute('/')({
  component: HomePage,
})

function HomePage() {
  return (
    <main className="min-h-screen bg-black px-6 py-24 text-white sm:px-10">
      <div className="mx-auto max-w-3xl">
        <p className="mb-6 text-xs font-semibold uppercase tracking-[0.3em] text-white/60">
          {LANDING_CONFIG.businessName}
        </p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">
          Stories in motion.
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-8 text-white/70">
          Marketing workspace foundation is ready for the next chapter.
        </p>
      </div>
    </main>
  )
}
