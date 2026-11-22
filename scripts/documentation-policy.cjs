function checkDocumentation({ files, body, base, head }) {
  if (base !== 'dev' || head === 'main-to-dev-sync') return { allowed: true };
  const changes = files.filter((file) =>
    /^(apps\/(cli|docs)\/|packages\/|scripts\/|\.github\/|infra\/|[^/]+\.(?:json|ya?ml|mjs|cjs))/.test(file),
  );
  if (!changes.length) return { allowed: true };
  if (files.some((file) => /^apps\/docs\/content\/docs\/.*\.mdx$/.test(file))) return { allowed: true };
  const explanation = (body ?? '').match(/no documentation change required\s*[:—-]\s*([^\n]+)/i)?.[1]?.trim();
  if (explanation && explanation.length >= 20 && !explanation.startsWith('<!--')) return { allowed: true };
  return {
    allowed: false,
    reason:
      'Update a Fumadocs page or provide No documentation change required: followed by a specific explanation (at least 20 characters).',
  };
}
module.exports = { checkDocumentation };
