#!/usr/bin/env python3
"""
Usage:  transcribe.py <url> <output_json_path>

Downloads audio for <url> via yt-dlp, transcribes with faster-whisper,
writes {"segments":[{"start","end","text"}], "raw_text":"...", "language":"..."}
as JSON to <output_json_path>. Emits errors to stderr with non-zero exit code.

Model: faster-whisper "base" (multilingual). CPU-only, int8 quantized.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

YTDLP = os.environ.get(
    "YTDLP_PATH", "/Users/rohanmote/Library/Python/3.9/bin/yt-dlp"
)

def main():
    if len(sys.argv) < 3:
        print("usage: transcribe.py <url> <output_json>", file=sys.stderr)
        sys.exit(2)
    url, out_path = sys.argv[1], sys.argv[2]

    import imageio_ffmpeg
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()

    tmp = tempfile.mkdtemp(prefix="tg-wh-")
    audio_out = os.path.join(tmp, "audio.%(ext)s")
    try:
        # 1) Download the smallest audio (m4a/webm/etc) via yt-dlp, then re-encode
        #    to a whisper-friendly 16kHz mono wav with ffmpeg.
        ytdlp_cmd = [
            YTDLP,
            "-f", "bestaudio/best",
            "--no-playlist",
            "--no-warnings",
            "--extractor-args", "youtube:player_client=android,ios,tv",
            "--ffmpeg-location", ffmpeg,
            "-x", "--audio-format", "wav", "--audio-quality", "0",
            "-o", audio_out,
            url,
        ]
        r = subprocess.run(ytdlp_cmd, capture_output=True, text=True, timeout=300)
        if r.returncode != 0:
            print("yt-dlp failed:", r.stderr[-1500:], file=sys.stderr)
            sys.exit(3)

        # locate the produced audio file
        files = [os.path.join(tmp, f) for f in os.listdir(tmp)]
        audio = next((f for f in files if f.endswith(".wav")), None)
        if not audio:
            audio = next((f for f in files if not f.endswith(".json")), None)
        if not audio:
            print("audio not found in tmp", file=sys.stderr)
            sys.exit(4)

        # 2) Convert to 16k mono wav for whisper
        wav16 = os.path.join(tmp, "audio16k.wav")
        rr = subprocess.run(
            [ffmpeg, "-y", "-i", audio, "-ac", "1", "-ar", "16000", "-vn", wav16],
            capture_output=True, text=True, timeout=300,
        )
        if rr.returncode != 0:
            print("ffmpeg failed:", rr.stderr[-1500:], file=sys.stderr)
            sys.exit(5)

        # 3) Transcribe
        from faster_whisper import WhisperModel
        model_size = os.environ.get("WHISPER_MODEL", "base")
        model = WhisperModel(model_size, device="cpu", compute_type="int8")
        segments, info = model.transcribe(
            wav16,
            vad_filter=True,
            word_timestamps=False,
            beam_size=1,
        )
        out_segments = []
        raw = []
        for seg in segments:
            text = (seg.text or "").strip()
            if not text:
                continue
            out_segments.append({
                "start": round(float(seg.start or 0.0), 3),
                "end": round(float(seg.end or 0.0), 3),
                "text": text,
            })
            raw.append(text)
        result = {
            "segments": out_segments,
            "raw_text": " ".join(raw),
            "language": getattr(info, "language", None),
        }
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

if __name__ == "__main__":
    main()
