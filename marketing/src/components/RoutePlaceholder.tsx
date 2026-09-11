import { Link } from '@tanstack/react-router'

export function RoutePlaceholder({ title }: { title: string }) {
  return (
    <main className="min-h-screen bg-black px-6 py-24 text-white sm:px-10">
      <div className="mx-auto max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-white/60">
          Marketing route
        </p>
        <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-6xl">
          {title}
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-8 text-white/70">
          This public route is ready for its marketing page implementation.
        </p>
        <Link
          to="/"
          className="mt-8 inline-flex text-sm font-semibold text-white underline underline-offset-4"
        >
          Back to home
        </Link>
      </div>
    </main>
  )
}
