FROM node:24-bookworm-slim AS pnpm-base

ENV COREPACK_HOME=/corepack \
  HUSKY=0 \
  PATH=/pnpm:$PATH \
  PNPM_HOME=/pnpm

RUN corepack enable && corepack prepare pnpm@12.3.4 --activate

FROM pnpm-base AS cli-builder

WORKDIR /workspace
COPY . .

RUN pnpm install --frozen-lockfile --filter portcn...
RUN pnpm --filter @portcn/core build \
  && pnpm --filter portcn build \
  && mkdir -p /artifact

WORKDIR /workspace/apps/cli
RUN npm pack --pack-destination /artifact

FROM node:24-bookworm-slim AS cli-runtime

ENV NODE_ENV=production
COPY --from=cli-builder /artifact/ /tmp/portcn-artifact/

RUN npm install --global --omit=dev --no-audit --no-fund /tmp/portcn-artifact/*.tgz \
  && rm -rf /tmp/portcn-artifact /root/.npm

ENTRYPOINT ["portcn"]
CMD []

FROM pnpm-base AS monorepo-test

WORKDIR /workspace
COPY . .

RUN pnpm install --frozen-lockfile

CMD ["sh", "-lc", "pnpm branch-policy:check && pnpm lint && pnpm format:check && pnpm check-types && pnpm test && pnpm build && pnpm package:check && pnpm boundaries:check && pnpm release:check && pnpm docs:check && if [ -n \"$PR_BASE_SHA\" ] && [ -n \"$PR_HEAD_SHA\" ]; then pnpm exec commitlint --from \"$PR_BASE_SHA\" --to \"$PR_HEAD_SHA\"; fi"]
