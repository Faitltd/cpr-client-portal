FROM node:20-alpine AS builder

WORKDIR /app

# Build deps for native modules (canvas, via pdf-to-img). Alpine has no
# prebuilt canvas binaries, so node-gyp needs python + cairo/pango headers.
RUN apk add --no-cache python3 make g++ pkgconfig cairo-dev pango-dev libjpeg-turbo-dev giflib-dev librsvg-dev pixman-dev

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Drop dev dependencies; the compiled node_modules is copied into the final
# image instead of re-running npm ci (which would need the build deps again).
RUN npm prune --omit=dev

FROM node:20-alpine

WORKDIR /app

# FFmpeg is required by the transcoding worker; the cairo/pango set are the
# runtime libraries for the canvas native module.
RUN apk add --no-cache ffmpeg cairo pango libjpeg-turbo giflib librsvg pixman

COPY --from=builder /app/build ./build
COPY --from=builder /app/worker ./worker
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "build"]
