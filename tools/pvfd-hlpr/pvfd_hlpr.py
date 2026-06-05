#!/usr/bin/env python3
"""PioneerVFD HLPR — Linux PipeWire audio bridge for the PVFD Spicetify theme.

Background
----------
On Linux, ``navigator.mediaDevices.getDisplayMedia()`` is mediated by
xdg-desktop-portal. Two real users (Arch + EndeavourOS / KDE Wayland) report
that the portal either (a) doesn't list Spotify or any usable source, or
(b) lists sources but omits the "Share system audio" checkbox. Even when
Spotify can be picked, the resulting audio track is silent because
Spotify's playback goes to the OS audio graph (PipeWire) rather than the
Chromium renderer's media element.

This helper bypasses the portal entirely: it taps Spotify's PipeWire output
through ``pw-record``, runs an FFT, and streams ``getByteFrequencyData``-shaped
frequency bins to PVFD over a localhost WebSocket. PVFD's theme JS includes
a small WebSocket client that feeds those bins into the existing analyser
pipeline.

Wire protocol (v1)
------------------
Endpoint: ``ws://127.0.0.1:17455`` (override with ``--port``).

On connect, helper sends one text frame::

    {
      "type": "hello",
      "version": "0.1.0",
      "protocol": 1,
      "sampleRate": 48000,
      "fftSize": 2048,
      "binCount": 1024,
      "minDb": -100.0,
      "maxDb": -30.0
    }

Then each frame: 1024 raw bytes, one byte per FFT bin. The byte value
follows the Web Audio ``getByteFrequencyData`` convention::

    byte = clamp(((dB - minDb) / (maxDb - minDb)) * 255, 0, 255)

Frame rate is 30 Hz to match PVFD's ``LOGO_LIVE_AUDIO_SCHEDULER_MS = 33``.

Requirements
------------
* Linux with PipeWire (``pw-record`` available — package
  ``pipewire-utils`` on Arch / ``pipewire-pulse`` on most distros).
* Python 3.10+.
* ``pip install websockets numpy`` (only for running from source; the
  released binary bundles these).

Usage
-----
::

    pvfd-hlpr                    # default: auto-detect Spotify monitor, port 17455
    pvfd-hlpr --probe            # one-shot: list PipeWire sinks/monitors and exit
    pvfd-hlpr --version
    pvfd-hlpr --port 17455
    pvfd-hlpr --target <name>    # force a specific monitor source
    pvfd-hlpr --verbose
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import re
import shutil
import signal
import subprocess
import sys
from typing import Optional

try:
    import numpy as np
except ImportError:  # pragma: no cover
    sys.stderr.write("pvfd-hlpr requires numpy. Install with: pip install numpy websockets\n")
    sys.exit(1)

try:
    import websockets
    from websockets.server import WebSocketServerProtocol
except ImportError:  # pragma: no cover
    sys.stderr.write("pvfd-hlpr requires websockets. Install with: pip install websockets numpy\n")
    sys.exit(1)


__version__ = "0.1.0"
PROTOCOL_VERSION = 1
ALLOWED_ORIGINS = [
    None,
    "https://xpui.app.spotify.com",
    "https://open.spotify.com",
]

SAMPLE_RATE = 48000
CHANNELS = 2
FFT_SIZE = 2048
BIN_COUNT = FFT_SIZE // 2
HOP_SAMPLES = SAMPLE_RATE // 30  # ~33 ms per frame, matches PVFD scheduler
MIN_DB = -100.0
MAX_DB = -30.0
DB_RANGE = MAX_DB - MIN_DB

_HANN = np.hanning(FFT_SIZE).astype(np.float32)
_MAG_NORM = float(FFT_SIZE)

logger = logging.getLogger("pvfd-hlpr")


# ---------- target detection ----------

def list_pactl_sinks() -> list[dict[str, str]]:
    """Return a list of {id, name, monitor_source, description} for each
    PulseAudio/PipeWire sink visible via pactl. Empty list if pactl is missing
    or the call fails."""
    if not shutil.which("pactl"):
        return []
    try:
        out = subprocess.run(
            ["pactl", "list", "sinks"],
            check=True, capture_output=True, text=True, timeout=4,
        ).stdout
    except (subprocess.SubprocessError, OSError) as exc:
        logger.debug("pactl list sinks failed: %s", exc)
        return []
    sinks = []
    for block in out.split("Sink #")[1:]:
        m_id = re.match(r"\s*(\d+)", block)
        m_name = re.search(r"^\s*Name:\s*(\S+)", block, re.MULTILINE)
        m_monitor = re.search(r"^\s*Monitor Source:\s*(\S+)", block, re.MULTILINE)
        m_desc = re.search(r"^\s*Description:\s*(.+)$", block, re.MULTILINE)
        if not (m_id and m_name):
            continue
        sinks.append({
            "id": m_id.group(1),
            "name": m_name.group(1),
            "monitor": (m_monitor.group(1) if m_monitor else f"{m_name.group(1)}.monitor"),
            "description": (m_desc.group(1).strip() if m_desc else ""),
        })
    return sinks


def find_spotify_sink_id() -> Optional[str]:
    """Walk sink-inputs and return the Sink ID Spotify is currently playing
    into, or None if Spotify isn't playing right now."""
    if not shutil.which("pactl"):
        return None
    try:
        out = subprocess.run(
            ["pactl", "list", "sink-inputs"],
            check=True, capture_output=True, text=True, timeout=4,
        ).stdout
    except (subprocess.SubprocessError, OSError) as exc:
        logger.debug("pactl list sink-inputs failed: %s", exc)
        return None
    for block in out.split("Sink Input #"):
        if "application.name" in block and "Spotify" in block:
            m = re.search(r"^\s*Sink:\s*(\d+)", block, re.MULTILINE)
            if m:
                return m.group(1)
    return None


def find_default_monitor() -> Optional[str]:
    if not shutil.which("pactl"):
        return None
    try:
        default_sink = subprocess.run(
            ["pactl", "get-default-sink"],
            check=True, capture_output=True, text=True, timeout=4,
        ).stdout.strip()
    except (subprocess.SubprocessError, OSError):
        return None
    return f"{default_sink}.monitor" if default_sink else None


def auto_detect_target() -> Optional[str]:
    """Return the best guess for which monitor source to record from."""
    spotify_sink_id = find_spotify_sink_id()
    sinks = list_pactl_sinks()
    if spotify_sink_id is not None:
        for sink in sinks:
            if sink["id"] == spotify_sink_id:
                return sink["monitor"]
    return find_default_monitor()


# ---------- capture subprocess ----------

async def spawn_pw_record(target: Optional[str]) -> asyncio.subprocess.Process:
    if shutil.which("pw-record"):
        cmd = [
            "pw-record",
            "--rate", str(SAMPLE_RATE),
            "--channels", str(CHANNELS),
            "--format", "s16",
        ]
        if target:
            cmd += ["--target", target]
        cmd += ["-"]
    elif shutil.which("parec"):
        cmd = [
            "parec",
            "--rate", str(SAMPLE_RATE),
            "--channels", str(CHANNELS),
            "--format", "s16le",
            "--raw",
        ]
        if target:
            cmd += ["-d", target]
    else:
        raise RuntimeError(
            "neither pw-record nor parec found on PATH — install pipewire-utils "
            "(Arch) or pulseaudio-utils"
        )
    logger.info("starting capture: %s", " ".join(cmd))
    return await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )


class FrameProducer:
    """Captures audio, computes FFT bins, fans frames out to all WS clients."""

    def __init__(self, target: Optional[str]):
        self.target = target
        self._proc: Optional[asyncio.subprocess.Process] = None
        self._consumers: list[asyncio.Queue[bytes]] = []
        self._task: Optional[asyncio.Task[None]] = None
        self._stopping = asyncio.Event()

    def subscribe(self) -> asyncio.Queue[bytes]:
        q: asyncio.Queue[bytes] = asyncio.Queue(maxsize=4)
        self._consumers.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[bytes]) -> None:
        if q in self._consumers:
            self._consumers.remove(q)

    async def start(self) -> None:
        if self._task is not None:
            return
        self._proc = await spawn_pw_record(self.target)
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        self._stopping.set()
        if self._proc and self._proc.returncode is None:
            try:
                self._proc.terminate()
            except ProcessLookupError:
                pass
            try:
                await asyncio.wait_for(self._proc.wait(), timeout=2.0)
            except asyncio.TimeoutError:
                self._proc.kill()
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _read_chunk(self, n_bytes: int) -> Optional[bytes]:
        assert self._proc and self._proc.stdout
        buf = bytearray()
        while len(buf) < n_bytes:
            chunk = await self._proc.stdout.read(n_bytes - len(buf))
            if not chunk:
                return None
            buf.extend(chunk)
        return bytes(buf)

    async def _run(self) -> None:
        assert self._proc is not None
        bytes_per_frame = FFT_SIZE * CHANNELS * 2
        hop_bytes = HOP_SAMPLES * CHANNELS * 2
        ring = bytearray()
        try:
            while not self._stopping.is_set():
                chunk = await self._read_chunk(hop_bytes)
                if chunk is None:
                    err = ""
                    if self._proc.stderr:
                        try:
                            err = (await self._proc.stderr.read(4096)).decode(errors="replace")
                        except Exception:
                            pass
                    logger.warning("capture stream ended (stderr: %s)", err.strip() or "<empty>")
                    break
                ring.extend(chunk)
                if len(ring) < bytes_per_frame:
                    continue
                window_bytes = ring[-bytes_per_frame:]
                del ring[:-bytes_per_frame]
                samples = np.frombuffer(window_bytes, dtype=np.int16).astype(np.float32)
                samples = samples.reshape(-1, CHANNELS).mean(axis=1) / 32768.0
                samples *= _HANN
                spectrum = np.fft.rfft(samples)[:BIN_COUNT]
                mag = np.abs(spectrum) / _MAG_NORM
                db = 20.0 * np.log10(np.maximum(mag, 1e-10))
                norm = np.clip((db - MIN_DB) / DB_RANGE, 0.0, 1.0)
                bins = (norm * 255.0).astype(np.uint8).tobytes()
                if not self._consumers:
                    continue
                for q in list(self._consumers):
                    if q.full():
                        try:
                            q.get_nowait()
                        except asyncio.QueueEmpty:
                            pass
                    try:
                        q.put_nowait(bins)
                    except asyncio.QueueFull:
                        pass
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("FrameProducer loop crashed")


# ---------- WebSocket server ----------

HELLO_PAYLOAD = json.dumps({
    "type": "hello",
    "version": __version__,
    "protocol": PROTOCOL_VERSION,
    "sampleRate": SAMPLE_RATE,
    "fftSize": FFT_SIZE,
    "binCount": BIN_COUNT,
    "minDb": MIN_DB,
    "maxDb": MAX_DB,
})


async def serve_client(producer: FrameProducer, ws: WebSocketServerProtocol) -> None:
    peer = ws.remote_address
    logger.info("client connected: %s", peer)
    queue = producer.subscribe()
    try:
        await ws.send(HELLO_PAYLOAD)
        while True:
            frame = await queue.get()
            await ws.send(frame)
    except websockets.ConnectionClosed:
        pass
    finally:
        producer.unsubscribe(queue)
        logger.info("client disconnected: %s", peer)


# ---------- probe mode ----------

def cmd_probe() -> int:
    print(f"pvfd-hlpr {__version__} — probe mode\n")
    pw_record = shutil.which("pw-record")
    parec = shutil.which("parec")
    pactl = shutil.which("pactl")
    print("Capture tools:")
    print(f"  pw-record: {pw_record or '(not found)'}")
    print(f"  parec:     {parec or '(not found)'}")
    print(f"  pactl:     {pactl or '(not found)'}")
    if not (pw_record or parec):
        print("\nFATAL: no capture backend found. Install pipewire-utils (Arch) or pulseaudio-utils.")
        return 2
    sinks = list_pactl_sinks()
    print(f"\nSinks ({len(sinks)}):")
    for sink in sinks:
        print(f"  [{sink['id']}] {sink['name']}")
        if sink["description"]:
            print(f"        description: {sink['description']}")
        print(f"        monitor:     {sink['monitor']}")
    spotify_sink_id = find_spotify_sink_id()
    print()
    if spotify_sink_id is not None:
        print(f"Spotify is currently routed to sink #{spotify_sink_id}.")
    else:
        print("Spotify isn't currently playing (no sink-input matching application.name=Spotify).")
    default_monitor = find_default_monitor()
    if default_monitor:
        print(f"Default sink's monitor: {default_monitor}")
    auto = auto_detect_target()
    print(f"\nAuto-detected target for capture: {auto or '(none — pw-record will use its default)'}")
    return 0


# ---------- main ----------

async def main_async(args: argparse.Namespace) -> int:
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )

    target = args.target
    if not target:
        target = auto_detect_target()
        if target:
            logger.info("auto-detected target: %s", target)
        else:
            logger.warning("could not auto-detect a target — pw-record will pick its default")

    producer = FrameProducer(target=target)
    try:
        await producer.start()
    except RuntimeError as exc:
        logger.error("%s", exc)
        return 2

    stop_event = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig_name in ("SIGINT", "SIGTERM"):
        try:
            loop.add_signal_handler(getattr(signal, sig_name), stop_event.set)
        except (NotImplementedError, AttributeError):
            pass

    async def handler(ws: WebSocketServerProtocol, _path: str = "/") -> None:
        await serve_client(producer, ws)

    logger.info(
        "pvfd-hlpr %s — listening on ws://127.0.0.1:%d (protocol v%d)",
        __version__, args.port, PROTOCOL_VERSION,
    )
    async with websockets.serve(
        handler,
        "127.0.0.1",
        args.port,
        max_size=None,
        origins=ALLOWED_ORIGINS,
    ):
        await stop_event.wait()

    logger.info("shutting down")
    await producer.stop()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="pvfd-hlpr",
        description="PioneerVFD Linux audio helper — streams FFT bins to the PVFD theme over a localhost WebSocket.",
    )
    parser.add_argument("--port", type=int, default=int(os.environ.get("PVFD_HLPR_PORT", 17455)))
    parser.add_argument("--target", type=str, default=None,
                        help="PipeWire/Pulse monitor source (e.g. <sink>.monitor). Auto-detected if omitted.")
    parser.add_argument("--probe", action="store_true",
                        help="List PipeWire sinks/monitors and exit without binding the WS.")
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--version", action="version", version=f"pvfd-hlpr {__version__} (protocol v{PROTOCOL_VERSION})")
    args = parser.parse_args()
    if args.probe:
        return cmd_probe()
    try:
        return asyncio.run(main_async(args))
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
