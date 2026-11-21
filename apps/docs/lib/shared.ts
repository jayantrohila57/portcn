import { createGetUrl } from 'fumadocs-core/source';

export const appName = 'portcn';
export const docsRoute = '/docs';
export const docsImageRoute = '/og/docs';

export const gitConfig = {
  owner: 'jayantrohila57',
  repo: 'portcn',
  branch: 'main',
  get repositoryUrl() {
    return `https://github.com/${this.owner}/${this.repo}`;
  },
};

const getImageUrl = createGetUrl(docsImageRoute);

export function getPageImageUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs, 'image.png'];

  return { segments, url: getImageUrl(segments, page.locale) };
}
