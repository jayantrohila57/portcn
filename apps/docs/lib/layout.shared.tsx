import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import Link from 'next/link';
import { appName, gitConfig } from './shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <>
          {appName}
          <Link href="/whats-new" className="ml-3 text-xs text-muted-foreground hover:text-foreground">
            What’s new
          </Link>
        </>
      ),
    },
    githubUrl: gitConfig.repositoryUrl,
  };
}
