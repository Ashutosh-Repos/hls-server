# syntax=docker.io/docker/dockerfile:1

FROM node:21-alpine AS base

RUN apk update && apk upgrade

WORKDIR /app
FROM base AS deps

COPY package.json package-lock.json ./
RUN npm ci
FROM base AS builder

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner

RUN apk add --no-cache \
    ffmpeg \
    libc6-compat \
    bash

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./


EXPOSE 8080

CMD ["npm", "start"]
