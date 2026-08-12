# GNU LibreDWG supplies dwg2dxf for the designer CAD converter. Alpine has no
# libredwg package, so it is compiled from the pinned GNU release. Same base as
# the runtime image so the musl the binary links against matches. The build
# fails loudly if the compile or the version check fails.
FROM node:20-alpine AS libredwg

ARG LIBREDWG_VERSION=0.13.3

RUN apk add --no-cache build-base curl perl xz

RUN set -eux; \
    curl -fsSL "https://ftp.gnu.org/gnu/libredwg/libredwg-${LIBREDWG_VERSION}.tar.xz" \
        -o /tmp/libredwg.tar.xz; \
    mkdir -p /tmp/libredwg; \
    tar -xJf /tmp/libredwg.tar.xz -C /tmp/libredwg --strip-components=1; \
    cd /tmp/libredwg; \
    ./configure \
        --disable-shared \
        --disable-bindings \
        --disable-python \
        --disable-docs \
        --disable-dependency-tracking; \
    make -j2; \
    make install; \
    strip /usr/local/bin/dwg2dxf; \
    /usr/local/bin/dwg2dxf --version

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

# dwg2dxf is statically linked against libredwg, so the single binary is enough.
# The version call runs it here, in the runtime image, so a missing shared
# library or a bad copy fails the build instead of shipping a dead converter.
COPY --from=libredwg /usr/local/bin/dwg2dxf /usr/local/bin/dwg2dxf
RUN /usr/local/bin/dwg2dxf --version

COPY --from=builder /app/build ./build
COPY --from=builder /app/worker ./worker
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "build"]
