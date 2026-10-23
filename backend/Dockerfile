# Stage 1: Install all dependencies and build TypeScript
FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build


# Stage 2: Install production dependencies only
FROM node:22-alpine AS production-deps

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev


# Stage 3: Production API
FROM node:22-alpine AS production

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

COPY --from=production-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/dist ./dist

# Allow the non-root node user to write uploaded files
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads

USER node

EXPOSE 4000

CMD ["node", "dist/index.js"]