import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { Metadata } from 'next';

const require = createRequire(import.meta.url);
const { parseChangelog } =
  require('../../../../scripts/changelog-policy.cjs') as typeof import('../../../../scripts/changelog-policy.cjs');

export const metadata: Metadata = {
  title: 'What’s New',
  description: 'Explore Portcn releases, improvements, and fixes in the published release history.',
  alternates: { canonical: '/whats-new' },
  openGraph: {
    title: 'What’s New in Portcn',
    description: 'Explore Portcn releases, improvements, and fixes.',
    type: 'website',
  },
};

const repo = 'https://github.com/jayantrohila57/portcn';

function Entry({ text }: { text: string }) {
  const tokens = text.split(/(\[#\d+\]\([^)]*\)|\[[^\]]+\]\([^)]*\)|`[^`]+`)/g).filter(Boolean);
  return (
    <>
      {tokens.map((token) => {
        const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
        if (link)
          return (
            <a
              className="font-medium text-primary underline underline-offset-4"
              href={link[2]}
              key={`${link[2]}-${link[1]}`}
            >
              {link[1]}
            </a>
          );
        if (token.startsWith('`') && token.endsWith('`'))
          return (
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm" key={token}>
              {token.slice(1, -1)}
            </code>
          );
        return token;
      })}
    </>
  );
}

function publishedRelease(release: ReturnType<typeof parseChangelog>['releases'][number]) {
  return {
    ...release,
    summary: release.categories
      .flatMap(({ entries }) => entries)
      .map((entry) => entry.replace(/^-\s+/, '').replace(/\s*<!-- task:[^>]+ -->$/, ''))
      .join(' '),
  };
}

export default async function WhatsNewPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const changelog = readFileSync(join(process.cwd(), '../../CHANGELOG.md'), 'utf8');
  const { releases: parsedReleases } = parseChangelog(changelog);
  const releases = parsedReleases.map(publishedRelease);
  const [latest, ...history] = releases;
  const years = [...new Set(releases.map((release) => release.date.slice(0, 4)))];
  const { year: requestedYear } = await searchParams;
  const selectedYear = years.includes(requestedYear ?? '') ? requestedYear : undefined;
  const visibleReleases = selectedYear
    ? releases.filter((release) => release.date.startsWith(`${selectedYear}-`))
    : releases;
  const releasesByYear = new Map<string, typeof releases>();
  for (const release of visibleReleases)
    releasesByYear.set(release.date.slice(0, 4), [...(releasesByYear.get(release.date.slice(0, 4)) ?? []), release]);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-12 sm:px-8 sm:py-16">
      <header className="mb-14 border-b pb-10">
        <p className="mb-4 font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">Release notes · IST</p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">What’s new in Portcn</h1>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
          A chronological record of improvements, fixes, and features that have shipped.
        </p>
      </header>

      {latest ? (
        <section
          aria-labelledby={`release-${latest.anchor}`}
          className="mb-16 rounded-2xl border bg-card p-6 shadow-sm sm:p-9"
        >
          <div className="mb-7 flex flex-wrap items-center gap-3">
            <span className="rounded-full bg-primary px-3 py-1 font-mono text-xs font-semibold text-primary-foreground">
              Latest release
            </span>
            <time className="font-mono text-sm text-muted-foreground" dateTime={latest.date}>
              {latest.date}
            </time>
            <a
              className="font-mono text-sm font-semibold text-primary underline underline-offset-4"
              href={`${repo}/releases/tag/v${latest.version}`}
            >
              v{latest.version} on GitHub
            </a>
          </div>
          <h2 id={`release-${latest.anchor}`} className="text-3xl font-semibold tracking-tight">
            {latest.title}
          </h2>
          <p className="mt-2 font-mono text-sm text-muted-foreground">Portcn {latest.version}</p>
          <div className="mt-8 grid gap-7 md:grid-cols-2">
            {latest.categories.map(({ name, entries }) => (
              <section aria-label={name} className="min-w-0" key={name}>
                <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{name}</h3>
                <ul className="space-y-3">
                  {entries.map((item) => (
                    <li className="leading-7" key={item}>
                      <Entry text={item.replace(/^-\s+/, '').replace(/\s*<!-- task:[^>]+ -->$/, '')} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2 border-t pt-5 text-sm">
            <a
              className="text-primary underline underline-offset-4"
              href={`${repo}/compare/v${history[0]?.version ?? '0.0.1'}...v${latest.version}`}
            >
              Compare changes
            </a>
            <a className="text-primary underline underline-offset-4" href={`${repo}/releases/tag/v${latest.version}`}>
              Release details
            </a>
            <a className="text-primary underline underline-offset-4" href={`#release-${latest.anchor}`}>
              Link to this release
            </a>
          </div>
          {latest.demo ? <TerminalDemo demo={latest.demo} /> : null}
        </section>
      ) : (
        <p className="rounded-lg border p-6 text-muted-foreground">No published releases are listed yet.</p>
      )}

      <div className="grid gap-10 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <nav aria-label="Release versions" className="h-fit rounded-xl border bg-card p-5 lg:sticky lg:top-8">
          <h2 className="font-semibold">Browse releases</h2>
          <form action="/whats-new" className="mt-4 space-y-2" method="get">
            <label className="block text-xs font-medium text-muted-foreground" htmlFor="release-year">
              Filter by year
            </label>
            <select
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              defaultValue={selectedYear ?? 'all'}
              id="release-year"
              name="year"
            >
              <option value="all">All years</option>
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
            <button className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted" type="submit">
              Apply filter
            </button>
          </form>
          <ul className="mt-4 flex flex-wrap gap-2">
            {[...releasesByYear.keys()].map((year) => (
              <li key={year}>
                <a className="rounded border px-2 py-1 text-xs hover:bg-muted" href={`#year-${year}`}>
                  {year}
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs font-medium text-muted-foreground">Version navigation</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {[...releasesByYear.keys()].map((year) => (
              <li key={year}>
                <a className="rounded border px-2 py-1 text-xs hover:bg-muted" href={`#year-${year}`}>
                  {year}
                </a>
              </li>
            ))}
          </ul>
          <ul className="mt-4 max-h-[55vh] space-y-2 overflow-auto">
            {visibleReleases.map((release) => (
              <li key={release.version}>
                <a
                  className="flex justify-between gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                  href={`#release-${release.anchor}`}
                >
                  <span>v{release.version}</span>
                  <time className="text-muted-foreground" dateTime={release.date}>
                    {release.date}
                  </time>
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 space-y-12">
          {[...releasesByYear.entries()].map(([year, yearReleases]) => (
            <section aria-label={`Releases in ${year}`} id={`year-${year}`} key={year}>
              <h2 className="mb-5 font-mono text-sm text-muted-foreground">{year}</h2>
              <ol className="space-y-5 border-l pl-5 sm:pl-7">
                {yearReleases
                  .filter((release) => release.version !== latest?.version)
                  .map((release) => (
                    <li
                      className="relative rounded-xl border bg-card p-5 sm:p-7"
                      id={`release-${release.anchor}`}
                      key={release.version}
                    >
                      <span
                        aria-hidden="true"
                        className="absolute -left-[1.72rem] top-7 h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-background sm:-left-[2.22rem]"
                      />
                      <div className="flex flex-wrap items-center gap-3">
                        <time className="font-mono text-sm text-muted-foreground" dateTime={release.date}>
                          {release.date}
                        </time>
                        <a
                          className="font-mono text-sm font-semibold text-primary"
                          href={`${repo}/releases/tag/v${release.version}`}
                        >
                          v{release.version}
                        </a>
                      </div>
                      <h3 className="mt-3 text-xl font-semibold">{release.title}</h3>
                      <p className="mt-1 font-mono text-xs text-muted-foreground">Portcn {release.version}</p>
                      <div className="mt-5 grid gap-6 md:grid-cols-2">
                        {release.categories.map(({ name, entries }) => (
                          <section aria-label={name} key={name}>
                            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              {name}
                            </h4>
                            <ul className="space-y-2 text-sm leading-6">
                              {entries.map((item) => (
                                <li key={item}>
                                  <Entry text={item.replace(/^-\s+/, '').replace(/\s*<!-- task:[^>]+ -->$/, '')} />
                                </li>
                              ))}
                            </ul>
                          </section>
                        ))}
                      </div>
                      <div className="mt-6 flex flex-wrap gap-4 border-t pt-4 text-sm">
                        <a className="text-primary underline underline-offset-4" href={`#release-${release.anchor}`}>
                          Link to this release
                        </a>
                        <a
                          className="text-primary underline underline-offset-4"
                          href={`${repo}/releases/tag/v${release.version}`}
                        >
                          GitHub Release
                        </a>
                        <a
                          className="text-primary underline underline-offset-4"
                          href={`${repo}/compare/v${releases[releases.indexOf(release) + 1]?.version ?? release.version}...v${release.version}`}
                        >
                          Compare changes
                        </a>
                      </div>
                      {release.demo ? <TerminalDemo demo={release.demo} /> : null}
                    </li>
                  ))}
              </ol>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}

function TerminalDemo({ demo }: { demo: string }) {
  return (
    <details className="mt-6 rounded-lg border bg-muted/40 p-4">
      <summary className="cursor-pointer text-sm font-medium">Terminal demo</summary>
      <pre className="mt-3 overflow-x-auto rounded-md bg-background p-4 text-xs leading-6">
        <code>{demo.split(' · ').join('\n')}</code>
      </pre>
    </details>
  );
}
