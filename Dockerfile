# One image for every environment: SITE_URL is read at runtime, so the artifact
# tested on staging is the one released.
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The build statically renders pages that touch the database; ensureDatabase()
# creates a throwaway one at the default file:./data path.
RUN mkdir -p data && npm run build

FROM node:24-slim AS run
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
