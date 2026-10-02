FROM node:22-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && corepack prepare pnpm@10.17.1 --activate && pnpm install --frozen-lockfile
COPY . .
RUN node tools/vendor.mjs
ENV HOST=0.0.0.0
ENV PORT=10000
EXPOSE 10000
CMD ["node", "tools/server.mjs"]
