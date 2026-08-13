# CAD converter service: ODA File Converter behind a tiny HTTP API.
# Deployed as its own Render service (Docker runtime) because the portal
# service runs on Render's Node runtime and cannot execute a Dockerfile.
#
# ODA File Converter reads every DWG version (including the AutoCAD 2018 / AC1032
# files ProKitchen exports, which LibreDWG could not) and writes clean DXF that
# Chief Architect imports natively.
#
# The converter binary is NOT downloadable without accepting ODA's licence, so
# it is vendored into this folder rather than fetched at build time:
#   1. Go to https://www.opendesign.com/guestfiles/oda_file_converter
#   2. Download the Linux, X64, ".deb" build (accept the licence).
#   3. Save it into this folder as  converter/ODAFileConverter.deb
#   4. Commit it, then deploy.
# The .deb bundles its own Qt6; it declares no apt dependencies, so the runtime
# libraries its bundled Qt "xcb" platform plugin needs are installed explicitly
# below (derived from the plugin's NEEDED entries). Override the filename with
#   --build-arg ODA_DEB=<name>.deb

FROM python:3.12-slim-bookworm

ARG ODA_DEB=ODAFileConverter.deb

WORKDIR /app

# xvfb: ODA File Converter is a headless Qt GUI app and needs a display.
# The lib* set: exactly what the bundled Qt6 xcb platform plugin links against,
# plus fonts. libxcb-cursor0 is required by Qt 6.5+ at runtime.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        xvfb \
        ca-certificates \
        fontconfig \
        fonts-dejavu-core \
        libgl1 \
        libglx-mesa0 \
        libegl1 \
        libglu1-mesa \
        libx11-6 \
        libx11-xcb1 \
        libxcb1 \
        libxcb-icccm4 \
        libxcb-image0 \
        libxcb-keysyms1 \
        libxcb-randr0 \
        libxcb-render0 \
        libxcb-render-util0 \
        libxcb-shape0 \
        libxcb-shm0 \
        libxcb-sync1 \
        libxcb-xfixes0 \
        libxcb-xkb1 \
        libxcb-cursor0 \
        libxkbcommon0 \
        libxkbcommon-x11-0 \
        libfontconfig1 \
        libfreetype6 \
        libpng16-16 \
        libdbus-1-3 \
        zlib1g \
    && rm -rf /var/lib/apt/lists/*

# Install ODA File Converter from the vendored .deb (no declared deps to
# resolve). The test line fails the build if the binary is missing, so a bad
# deb never ships as a dead converter.
COPY ${ODA_DEB} /tmp/oda.deb
RUN dpkg -i /tmp/oda.deb \
    && rm -f /tmp/oda.deb \
    && test -x /usr/bin/ODAFileConverter

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py ./

# Drawings are written to a temp dir owned by this user, never as root.
# A real home dir is required: xvfb-run and ODA both write settings under $HOME.
RUN useradd --create-home --shell /usr/sbin/nologin converter
USER converter
ENV HOME=/home/converter

ENV PORT=8080
EXPOSE 8080

CMD exec gunicorn --bind "0.0.0.0:${PORT}" --workers 2 --threads 2 --timeout 180 app:app
