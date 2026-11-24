export type ChangelogCategory = {
  name: 'Added' | 'Changed' | 'Fixed' | 'Deprecated' | 'Removed' | 'Security';
  entries: string[];
};

export type PublishedRelease = {
  version: string;
  date: string;
  anchor: string;
  title: string | null;
  demo: string | null;
  content: string;
  categories: ChangelogCategory[];
};

export type ParsedChangelog = {
  releases: PublishedRelease[];
  unreleased: { content: string; categories: ChangelogCategory[] } | null;
};

export const categories: readonly ChangelogCategory['name'][];
export function parseChangelog(source: string): ParsedChangelog;
export function parseCategories(content: string): ChangelogCategory[];
export function validateRelease(source: string, version: string): { allowed: boolean; reason?: string };
export function reconcileRelease(source: string, version: string): string;
export function releaseBlock(source: string, version: string): string;
export function update(source: string, title: string, branch: string, issue?: string): string;
export function validate(
  base: string,
  head: string,
  title: string,
  branch: string,
  issue?: string,
): { allowed: boolean; reason?: string };
