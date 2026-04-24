# Transcript Generator

Paste any social-media URL (YouTube, YouTube Shorts, Instagram, TikTok, Twitter/X, Facebook, and many more) and get a timestamped transcript.

## How it works
1. **yt-dlp subtitles path** — pulls manual or auto-captions from the source platform (English-first, falls back to any available). Uses the Android/iOS player clients for YouTube to bypass current PO-token restrictions on captions.
2. **Whisper fallback** — if no captions are exposed, downloads the audio via yt-dlp, re-encodes with ffmpeg, and transcribes using `faster-whisper` (`base` model, CPU, int8).

Output is returned as JSON with timestamped segments plus plain-text. The UI lets you copy, download `.txt`, or download `.srt`.

## Run locally
Requires: Node.js, Python 3, yt-dlp, faster-whisper, imageio-ffmpeg, cloudflared (for tunnel).

```
npm install
./start.sh   # starts server on :5173 and a Cloudflare Quick Tunnel, prints the public URL
```

## API
`POST /api/transcript`  body: `{"url":"..."}`  returns `{title, platform, source, segments:[{timestamp,start,end,text}], raw_text, ...}`.
