FROM node:20-alpine

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod=false

COPY tsconfig.json ./
COPY src/ ./src/

RUN pnpm build

RUN pnpm prune --prod

EXPOSE 3000

CMD ["node", "dist/index.js"]
