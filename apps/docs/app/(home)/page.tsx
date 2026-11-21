import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <p className="mb-4 font-mono text-sm uppercase tracking-[0.24em] text-primary">Know what's running.</p>
      <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-6xl">Your ports. Under control.</h1>
      <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">
        An open-source, developer-first CLI for discovering, inspecting, monitoring, and managing application ports and
        local services.
      </p>

      <Link href="/docs" className="mt-8 rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground">
        Read the project notes
      </Link>
    </div>
  );
}
