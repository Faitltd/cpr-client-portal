# CAD converter service: GNU LibreDWG dwg2dxf behind a tiny HTTP API.
# Deployed as its own Render service (Docker runtime) because the portal
# service runs on Render's Node runtime and cannot execute a Dockerfile.

# --- LibreDWG ---------------------------------------------------------------
FROM python:3.12-slim-bookworm AS libredwg

ARG LIBREDWG_VERSION=0.13.3

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential curl xz-utils ca-certificates \
    && rm -rf /var/lib/apt/lists/*

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

# --- Service ----------------------------------------------------------------
FROM python:3.12-slim-bookworm

WORKDIR /app

COPY --from=libredwg /usr/local/bin/dwg2dxf /usr/local/bin/dwg2dxf

# Runs the binary in the final image so a broken copy or a missing shared
# library fails the build instead of shipping a dead converter.
RUN /usr/local/bin/dwg2dxf --version

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py ./

# Drawings are written to a temp dir owned by this user, never as root.
RUN useradd --create-home --shell /usr/sbin/nologin converter
USER converter

ENV PORT=8080
EXPOSE 8080

CMD exec gunicorn --bind "0.0.0.0:${PORT}" --workers 2 --threads 2 --timeout 180 app:app
