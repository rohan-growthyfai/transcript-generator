const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 3000;
const YTDLP = process.env.YTDLP_PATH || '/Users/rohanmote/Library/Python/3.9/bin/yt-dlp';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- helpers ----------

function run(cmd, args, { timeoutMs = 120000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (_) {}
    }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: String(err) });
    });
  });
}

function tsFromSeconds(totalSec) {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

function parseVttTime(t) {
  // "HH:MM:SS.mmm" or "MM:SS.mmm"
  const parts = t.trim().split(':');
  let h = 0, m = 0, s = 0;
  if (parts.length === 3) { h = +parts[0]; m = +parts[1]; s = parseFloat(parts[2]); }
  else if (parts.length === 2) { m = +parts[0]; s = parseFloat(parts[1]); }
  else { s = parseFloat(parts[0]); }
  return h * 3600 + m * 60 + s;
}

function stripHtmlTags(s) {
  return s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
}

function parseVtt(content) {
  // Returns array of { start, end, text } seconds
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  // skip header
  while (i < lines.length && !/-->/.test(lines[i])) i++;
  let cur = null;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (/-->/.test(line)) {
      if (cur && cur.text) out.push(cur);
      const m = line.match(/([\d:.]+)\s*-->\s*([\d:.]+)/);
      cur = { start: m ? parseVttTime(m[1]) : 0, end: m ? parseVttTime(m[2]) : 0, text: '' };
    } else if (line.trim() === '') {
      if (cur && cur.text) { out.push(cur); cur = null; }
    } else if (cur) {
      const clean = stripHtmlTags(line).trim();
      if (clean) cur.text += (cur.text ? ' ' : '') + clean;
    }
  }
  if (cur && cur.text) out.push(cur);
  return dedupeCues(out);
}

function parseSrt(content) {
  const blocks = content.replace(/\r\n/g, '\n').split(/\n\n+/);
  const out = [];
  for (const blk of blocks) {
    const lines = blk.split('\n').filter(Boolean);
    if (lines.length < 2) continue;
    const timeLine = lines.find((l) => /-->/.test(l));
    if (!timeLine) continue;
    const m = timeLine.match(/([\d:,]+)\s*-->\s*([\d:,]+)/);
    if (!m) continue;
    const toSec = (t) => {
      const [hms, ms] = t.split(',');
      const [h, mn, s] = hms.split(':').map(Number);
      return h * 3600 + mn * 60 + s + (ms ? +ms / 1000 : 0);
    };
    const textLines = lines.slice(lines.indexOf(timeLine) + 1);
    const text = stripHtmlTags(textLines.join(' ')).trim();
    if (text) out.push({ start: toSec(m[1]), end: toSec(m[2]), text });
  }
  return dedupeCues(out);
}

function parseJson3(content) {
  // YouTube auto-caption json3 format
  try {
    const j = JSON.parse(content);
    const events = j.events || [];
    const out = [];
    for (const e of events) {
      if (!e.segs) continue;
      const start = (e.tStartMs || 0) / 1000;
      const dur = (e.dDurationMs || 0) / 1000;
      const text = e.segs.map((s) => s.utf8).join('').replace(/\n/g, ' ').trim();
      if (text) out.push({ start, end: start + dur, text });
    }
    return dedupeCues(out);
  } catch (_) {
    return [];
  }
}

function dedupeCues(cues) {
  // Auto-captions often contain rolling duplicates: merge so each phrase appears once
  const out = [];
  let lastText = '';
  for (const c of cues) {
    const t = c.text.trim();
    if (!t) continue;
    if (t === lastText) continue;
    // remove overlap: if new text starts with last text
    if (lastText && t.startsWith(lastText)) {
      const remainder = t.slice(lastText.length).trim();
      if (remainder) {
        out.push({ start: c.start, end: c.end, text: remainder });
        lastText = t;
      } else {
        // extend previous end
        if (out.length) out[out.length - 1].end = c.end;
      }
    } else {
      out.push({ ...c, text: t });
      lastText = t;
    }
  }
  return out;
}

function groupIntoSegments(cues, windowSec = 6) {
  const out = [];
  let cur = null;
  for (const c of cues) {
    if (!cur) { cur = { start: c.start, end: c.end, text: c.text }; continue; }
    if (c.start - cur.start < windowSec) {
      cur.end = c.end;
      cur.text += ' ' + c.text;
    } else {
      out.push(cur);
      cur = { start: c.start, end: c.end, text: c.text };
    }
  }
  if (cur) out.push(cur);
  return out.map((s) => ({
    start: s.start,
    end: s.end,
    timestamp: tsFromSeconds(s.start),
    text: s.text.replace(/\s+/g, ' ').trim(),
  }));
}

// ---------- platform detect ----------

function detectPlatform(url) {
  const u = url.toLowerCase();
  if (/youtube\.com|youtu\.be/.test(u)) return 'youtube';
  if (/instagram\.com/.test(u)) return 'instagram';
  if (/tiktok\.com/.test(u)) return 'tiktok';
  if (/twitter\.com|x\.com/.test(u)) return 'twitter';
  if (/facebook\.com|fb\.watch/.test(u)) return 'facebook';
  return 'generic';
}

// ---------- yt-dlp subtitle path ----------

async function fetchMetaAndSubsWithYtdlp(url) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-'));
  try {
    const args = [
      '--skip-download',
      '--write-subs',
      '--write-auto-subs',
      '--sub-langs', 'en.*,en,en-US,en-GB,en-auto,a.en',
      '--sub-format', 'vtt/srt/json3/best',
      '--no-warnings',
      '--no-playlist',
      // Android/iOS clients bypass current YouTube PO-token restrictions for subs
      '--extractor-args', 'youtube:player_client=android,ios,tv',
      '--no-simulate',
      '--print', '%(.{id,title,duration,uploader,channel,thumbnail,description,webpage_url})j',
      '-o', path.join(tmp, '%(id)s.%(ext)s'),
      url,
    ];
    const { code, stdout, stderr } = await run(YTDLP, args, { timeoutMs: 120000 });
    let meta = null;
    try {
      const firstLine = (stdout || '').split('\n').find((l) => l.trim().startsWith('{'));
      if (firstLine) meta = JSON.parse(firstLine);
    } catch (_) {}
    // List subtitle files written in tmp
    const files = fs.readdirSync(tmp).filter((f) => /\.(vtt|srt|json3|json)$/i.test(f));
    // prefer english
    const pick = (arr, pred) => arr.find(pred);
    const enVtt = pick(files, (f) => /en[^.]*\.vtt$/i.test(f)) || pick(files, (f) => /\.vtt$/i.test(f));
    const enSrt = pick(files, (f) => /en[^.]*\.srt$/i.test(f)) || pick(files, (f) => /\.srt$/i.test(f));
    const enJson = pick(files, (f) => /\.json3$/i.test(f)) || pick(files, (f) => /\.json$/i.test(f));
    let cues = null;
    let format = null;
    if (enVtt) { cues = parseVtt(fs.readFileSync(path.join(tmp, enVtt), 'utf8')); format = 'vtt'; }
    else if (enSrt) { cues = parseSrt(fs.readFileSync(path.join(tmp, enSrt), 'utf8')); format = 'srt'; }
    else if (enJson) { cues = parseJson3(fs.readFileSync(path.join(tmp, enJson), 'utf8')); format = 'json3'; }
    return { meta, cues, format, tmp, code, stderr };
  } finally {
    // cleanup
    try {
      for (const f of fs.readdirSync(tmp)) fs.unlinkSync(path.join(tmp, f));
      fs.rmdirSync(tmp);
    } catch (_) {}
  }
}

// ---------- whisper fallback ----------

async function transcribeWithWhisper(url) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-wh-'));
  const outPath = path.join(tmp, 'out.json');
  try {
    const script = path.join(__dirname, 'transcribe.py');
    const { code, stderr } = await run('python3', [script, url, outPath], { timeoutMs: 15 * 60 * 1000 });
    if (code !== 0) {
      return { ok: false, error: (stderr || '').slice(-1500) };
    }
    const data = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    const cues = (data.segments || []).map((s) => ({ start: s.start, end: s.end, text: s.text }));
    return { ok: true, cues, language: data.language };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  }
}

// ---------- main endpoint ----------

app.post('/api/transcript', async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Provide a "url" string in JSON body.' });
  }
  const platform = detectPlatform(url);
  const result = { url, platform, source: null, title: null, duration: null, uploader: null, thumbnail: null, segments: [], raw_text: '' };

  try {
    // yt-dlp subtitles (covers YouTube/Shorts + Instagram/TikTok/Twitter/Facebook/etc.)
    {
      const { meta, cues } = await fetchMetaAndSubsWithYtdlp(url);
      if (meta) {
        result.title = meta.title || meta.fulltitle || null;
        result.duration = typeof meta.duration === 'number' ? meta.duration : null;
        result.uploader = meta.uploader || meta.channel || meta.creator || null;
        result.thumbnail = meta.thumbnail || (meta.thumbnails && meta.thumbnails[0] && meta.thumbnails[0].url) || null;
      }
      if (cues && cues.length) {
        const segs = groupIntoSegments(cues);
        result.source = 'yt-dlp-captions';
        result.segments = segs;
        result.raw_text = segs.map((s) => s.text).join(' ');
      }
    }

    // 2) Whisper fallback — download audio + transcribe on CPU
    if (!result.segments.length) {
      const wh = await transcribeWithWhisper(url);
      if (wh.ok && wh.cues && wh.cues.length) {
        const segs = groupIntoSegments(wh.cues);
        result.source = 'whisper';
        result.language = wh.language || null;
        result.segments = segs;
        result.raw_text = segs.map((s) => s.text).join(' ');
      }
    }

    if (!result.segments.length) {
      return res.status(422).json({
        error: 'No transcript could be produced for this URL.',
        details: 'The URL either does not point to downloadable media, or the media could not be processed. Please verify the link is a public video.',
        platform,
      });
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Internal error', details: String(err && err.message || err) });
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[transcript-generator] listening on ${PORT}`);
});
