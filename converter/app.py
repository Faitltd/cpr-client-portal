"""CAD converter service.

Wraps GNU LibreDWG's ``dwg2dxf``. The portal holds the designer session and
does its own validation; this service only trusts a shared token and converts.
Nothing is stored: every job runs in a temp directory removed in a finally block.
"""

from __future__ import annotations

import hmac
import logging
import os
import re
import secrets
import shutil
import subprocess
import tempfile
import time

from flask import Flask, jsonify, request

app = Flask(__name__)

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format='{"level":"%(levelname)s","module":"converter","message":"%(message)s"}',
)
log = logging.getLogger("converter")

# LibreDWG 0.13.3 lists r2018 under "Planned versions" and rejects --as r2018.
# Its r2013 DXF *writer* is also broken: it emits a file with no ENTITIES
# section and no EOF (verified against 0.13.3). r2000 is the newest target
# whose writer produces a structurally complete DXF, so it is the default.
SUPPORTED_DXF_VERSIONS = ("r12", "r14", "r2000", "r2004", "r2007", "r2010", "r2013")
DEFAULT_DXF_VERSION = "r2000"

DWG2DXF = os.environ.get("DWG2DXF_PATH") or "/usr/local/bin/dwg2dxf"

# DWG files open with a 6-byte ASCII version marker: AC1015, AC1032, and so on.
DWG_MARKER = re.compile(rb"^AC(10\d{2}|1\.\d{2}|2\.\d{2})")

ERROR_STATUS = {
    "invalid_extension": 400,
    "empty_file": 400,
    "too_large": 413,
    "invalid_dwg": 422,
    "conversion_failed": 422,
    "timeout": 504,
    "server_error": 500,
}


def dxf_version() -> str:
    requested = (os.environ.get("DXF_VERSION") or "").strip().lower()
    if not requested:
        return DEFAULT_DXF_VERSION
    if requested in SUPPORTED_DXF_VERSIONS:
        return requested
    log.warning("unsupported DXF_VERSION %s, using %s", requested, DEFAULT_DXF_VERSION)
    return DEFAULT_DXF_VERSION


# LibreDWG's DXF writer stamps the DWG "uninitialized double" sentinel (1e20)
# into every extent field it never computed: the header EXTMIN/EXTMAX and
# PEXTMIN/PEXTMAX, plus the stored extents on each LAYOUT object. Chief
# Architect's Teigha importer then tries to fit an infinite bounding box on
# load and hangs. 1e20 drawing units is not a plausible coordinate, so any
# value at that magnitude is the sentinel and is safe to zero. Only numeric
# *value* lines are touched (group codes are integers and never match); entity
# geometry, handles, and CRLF endings are left byte-for-byte intact.
_SENTINEL_MAGNITUDE = 1e19  # anything this large is LibreDWG's ~1e20 marker


def neutralize_extents(data: bytes) -> tuple[bytes, int]:
    """Zero LibreDWG's 1e20 extent sentinels. Returns (dxf, values_patched)."""
    eol = b"\r\n" if b"\r\n" in data else b"\n"
    lines = data.split(eol)
    patched = 0
    for i, line in enumerate(lines):
        stripped = line.strip()
        # Scientific notation is the only way a magnitude this big is written,
        # so gate on "E+" to skip float-parsing ordinary coordinates.
        if b"E+" not in stripped and b"e+" not in stripped:
            continue
        try:
            value = float(stripped)
        except ValueError:
            continue
        if abs(value) >= _SENTINEL_MAGNITUDE:
            lines[i] = b"0.0"
            patched += 1
    return eol.join(lines), patched


def max_upload_bytes() -> int:
    try:
        megabytes = float(os.environ.get("MAX_UPLOAD_MB") or 25)
    except ValueError:
        megabytes = 25
    if megabytes <= 0:
        megabytes = 25
    return int(megabytes * 1024 * 1024)


def conversion_timeout() -> int:
    try:
        seconds = int(float(os.environ.get("CONVERSION_TIMEOUT_SECONDS") or 60))
    except ValueError:
        seconds = 60
    return seconds if seconds > 0 else 60


def authorized() -> bool:
    """Constant-time shared-token check. An unset token blocks every request."""
    expected = os.environ.get("CONVERTER_TOKEN") or ""
    if not expected:
        log.error("CONVERTER_TOKEN is not set; refusing all conversions")
        return False
    supplied = request.headers.get("X-Converter-Token", "")
    return hmac.compare_digest(expected, supplied)


def fail(code: str, job_id: str):
    return jsonify({"code": code, "jobId": job_id}), ERROR_STATUS.get(code, 500)


def converter_version() -> str | None:
    try:
        result = subprocess.run(
            [DWG2DXF, "--version"], capture_output=True, timeout=5, check=True
        )
        line = (result.stdout or result.stderr).decode("utf-8", "replace").strip()
        return line.splitlines()[0][:120] if line else None
    except Exception as err:  # noqa: BLE001 - health probe must never raise
        log.error("version probe failed: %s", err)
        return None


@app.get("/health")
def health():
    version = converter_version()
    available = version is not None
    return (
        jsonify(
            {
                "status": "ok" if available else "unavailable",
                "converter": "available" if available else "unavailable",
                "version": version,
                "dxfVersion": dxf_version(),
                "maxUploadMb": round(max_upload_bytes() / (1024 * 1024)),
            }
        ),
        200 if available else 503,
    )


@app.post("/convert")
def convert():
    job_id = request.headers.get("X-Job-Id") or f"CAD-{secrets.token_hex(4).upper()}"

    if not authorized():
        return jsonify({"code": "unauthorized", "jobId": job_id}), 401

    uploaded = request.files.get("file")
    if uploaded is None or not uploaded.filename:
        return fail("invalid_extension", job_id)
    if not uploaded.filename.lower().endswith(".dwg"):
        return fail("invalid_extension", job_id)

    payload = uploaded.read()
    if len(payload) == 0:
        return fail("empty_file", job_id)
    if len(payload) > max_upload_bytes():
        return fail("too_large", job_id)
    if not DWG_MARKER.match(payload[:6]):
        return fail("invalid_dwg", job_id)

    version = dxf_version()
    started = time.monotonic()
    # The uploaded filename never touches a path; the portal names the download.
    workdir = tempfile.mkdtemp(prefix="cad-")
    input_path = os.path.join(workdir, "input.dwg")
    output_path = os.path.join(workdir, "output.dxf")

    log.info(
        "job %s started bytes=%d marker=%s target=%s",
        job_id,
        len(payload),
        payload[:6].decode("latin1", "replace"),
        version,
    )

    try:
        with open(input_path, "wb") as handle:
            handle.write(payload)

        try:
            # Argument list, never a shell string.
            result = subprocess.run(
                [DWG2DXF, "--as", version, "-y", "-o", output_path, input_path],
                capture_output=True,
                timeout=conversion_timeout(),
            )
        except subprocess.TimeoutExpired:
            log.error("job %s timed out after %ss", job_id, conversion_timeout())
            return fail("timeout", job_id)
        except FileNotFoundError:
            log.error("job %s: %s not found", job_id, DWG2DXF)
            return fail("server_error", job_id)

        if result.returncode != 0:
            log.error(
                "job %s dwg2dxf exit=%s stderr=%s",
                job_id,
                result.returncode,
                result.stderr[:2000].decode("utf-8", "replace"),
            )
            return fail("conversion_failed", job_id)

        # Exit code 0 does not guarantee a usable file.
        if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
            log.error("job %s produced no output", job_id)
            return fail("conversion_failed", job_id)

        with open(output_path, "rb") as handle:
            dxf = handle.read()

        # Repair LibreDWG's poisoned drawing extents before the file leaves the
        # service, or Chief Architect hangs fitting an infinite box on import.
        dxf, patched = neutralize_extents(dxf)

        log.info(
            "job %s succeeded bytes=%d extents_patched=%d duration=%.1fs",
            job_id,
            len(dxf),
            patched,
            time.monotonic() - started,
        )

        response = app.response_class(dxf, mimetype="application/dxf")
        response.headers["Content-Length"] = str(len(dxf))
        response.headers["X-Job-Id"] = job_id
        response.headers["Cache-Control"] = "no-store"
        return response

    except Exception as err:  # noqa: BLE001 - never leak a traceback to the caller
        log.error("job %s unexpected error: %s", job_id, err)
        return fail("server_error", job_id)

    finally:
        shutil.rmtree(workdir, ignore_errors=True)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8080)))
