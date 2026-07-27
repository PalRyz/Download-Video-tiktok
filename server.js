const path = require('path');
const os = require('os');
const fs = require('fs');
const fsp = require('fs/promises');
const { spawn, spawnSync } = require('child_process');
const express = require('express');
const axios = require('axios');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname)));

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/* ============================================================
   FFMPEG RESOLVER
   Urutan: env FFMPEG_PATH -> paket ffmpeg-static (opsional) -> ffmpeg sistem
   ============================================================ */
function resolveFfmpeg() {
  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) return process.env.FFMPEG_PATH;
  try {
    const staticPath = require('ffmpeg-static');
    if (staticPath && fs.existsSync(staticPath)) return staticPath;
  } catch {}
  const probe = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  if (!probe.error && probe.status === 0) return 'ffmpeg';
  return null;
}
const FFMPEG = resolveFfmpeg();

/* ============================================================
   MEDIA PROXY — supaya foto/audio/video TikTok & Instagram
   tidak diblokir CORS saat di-download atau dipakai di canvas.
   ============================================================ */
function isAllowedMediaHost(hostname) {
  const host = hostname.toLowerCase();
  return /(^|\.)(tiktokcdn(-\w+)?\.com|tiktokv\.com|tiktokcdn-us\.com|ibyteimg\.com|byteoversea\.com|muscdn\.com|tikwm\.com|cdninstagram\.com|fbcdn\.net|instagram\.com)$/.test(host);
}

async function fetchMediaStream(rawUrl) {
  const parsed = new URL(rawUrl);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error('Protokol tidak didukung');
  if (!isAllowedMediaHost(parsed.hostname)) throw new Error('Host tidak diizinkan');
  return axios.get(rawUrl, {
    responseType: 'stream',
    timeout: 30000,
    maxRedirects: 5,
    headers: {
      'User-Agent': UA,
      Referer: parsed.hostname.includes('instagram') || parsed.hostname.includes('cdninstagram') || parsed.hostname.includes('fbcdn')
        ? 'https://www.instagram.com/'
        : 'https://www.tiktok.com/',
      Accept: '*/*',
    },
  });
}

app.get('/api/proxy', async (req, res) => {
  const url = req.query.url || '';
  try {
    const upstream = await fetchMediaStream(url);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    if (upstream.headers['content-type']) res.setHeader('Content-Type', upstream.headers['content-type']);
    if (upstream.headers['content-length']) res.setHeader('Content-Length', upstream.headers['content-length']);
    if (req.query.download) {
      const name = String(req.query.download).replace(/[^\w.\-]/g, '_').slice(0, 80);
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    }
    upstream.data.pipe(res);
  } catch (error) {
    console.error('Proxy error:', error.message);
    res.status(502).json({ error: 'Media tidak dapat diambil.' });
  }
});

/* ============================================================
   SLIDESHOW FOTO + MUSIK  ->  MP4 (H.264 + AAC)
   ============================================================ */
async function downloadToFile(url, filePath) {
  const upstream = await fetchMediaStream(url);
  await new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(filePath);
    upstream.data.pipe(stream);
    stream.on('finish', resolve);
    stream.on('error', reject);
    upstream.data.on('error', reject);
  });
  return filePath;
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, args);
    let log = '';
    proc.stderr.on('data', (chunk) => { log += chunk.toString(); if (log.length > 8000) log = log.slice(-8000); });
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg gagal: ' + log.slice(-600)))));
  });
}

app.get('/api/slideshow/support', (req, res) => {
  res.json({ ffmpeg: Boolean(FFMPEG), format: 'mp4' });
});

app.post('/api/slideshow', async (req, res) => {
  if (!FFMPEG) {
    return res.status(501).json({ error: 'FFmpeg tidak tersedia di server. Fallback ke render browser.' });
  }
  const images = Array.isArray(req.body?.images) ? req.body.images.slice(0, 20) : [];
  const audioUrl = typeof req.body?.audio === 'string' ? req.body.audio : '';
  const perPhoto = Math.min(Math.max(Number(req.body?.perPhoto) || 3.5, 1), 15);
  if (!images.length) return res.status(400).json({ error: 'Minimal satu foto diperlukan.' });

  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'tiksaver-'));
  try {
    const files = [];
    for (let i = 0; i < images.length; i++) {
      files.push(await downloadToFile(images[i], path.join(work, `img_${String(i).padStart(3, '0')}.jpg`)));
    }
    let audioFile = '';
    if (audioUrl) {
      try { audioFile = await downloadToFile(audioUrl, path.join(work, 'audio.mp3')); } catch { audioFile = ''; }
    }

    // concat list: setiap foto tampil `perPhoto` detik (entri terakhir diulang, syarat demuxer concat)
    const listLines = [];
    files.forEach((file) => {
      listLines.push(`file '${file.replace(/'/g, "'\\''")}'`);
      listLines.push(`duration ${perPhoto}`);
    });
    listLines.push(`file '${files[files.length - 1].replace(/'/g, "'\\''")}'`);
    const listFile = path.join(work, 'list.txt');
    await fsp.writeFile(listFile, listLines.join('\n'));

    const output = path.join(work, 'slideshow.mp4');
    const args = ['-y', '-f', 'concat', '-safe', '0', '-i', listFile];
    if (audioFile) args.push('-i', audioFile);
    args.push(
      '-vf', 'scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p,fps=30',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'
    );
    if (audioFile) args.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
    args.push(output);

    await runFfmpeg(args);
    const buffer = await fsp.readFile(output);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="tiksaver_foto_musik_${Date.now()}.mp4"`);
    res.send(buffer);
  } catch (error) {
    console.error('Slideshow error:', error.message);
    res.status(500).json({ error: 'Gagal membuat video MP4 di server.' });
  } finally {
    fsp.rm(work, { recursive: true, force: true }).catch(() => {});
  }
});

/* ============================================================
   INSTAGRAM
   ============================================================ */
function getInstagramShortcode(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (hostname !== 'instagram.com' && hostname !== 'instagr.am') return null;

  const match = parsed.pathname.match(/^\/(?:[A-Za-z0-9_.]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : null;
}

function normalizeInstagramMedia(payload) {
  const media = payload?.graphql?.shortcode_media
    || payload?.data?.xdt_shortcode_media
    || payload?.items?.[0]
    || payload?.xdt_shortcode_media;

  if (!media) return null;

  const carousel = media.edge_sidecar_to_children?.edges?.map(({ node }) => node) || media.carousel_media || [];
  const isCarousel = carousel.length > 0;
  const getImage = (item) => (item && (item.display_url || item.image_versions2?.candidates?.[0]?.url || item.thumbnail_src)) || '';
  const getVideo = (item) => (item && (item.video_url || item.video_versions?.[0]?.url)) || '';
  const nodes = isCarousel ? carousel : [media];
  const images = nodes.filter((item) => !getVideo(item)).map(getImage).filter(Boolean);
  const videos = nodes.map(getVideo).filter(Boolean);
  const video = videos[0] || '';
  const owner = media.owner || media.user || {};
  const caption = media.edge_media_to_caption?.edges?.[0]?.node?.text || media.caption?.text || '';

  return {
    platform: 'instagram',
    id: media.id || media.pk || media.shortcode || '',
    title: caption,
    cover: getImage(media) || getImage(nodes[0]),
    cover_hd: getImage(media) || getImage(nodes[0]),
    avatar: owner.profile_pic_url || '',
    username: owner.username || '',
    nickname: owner.full_name || owner.username || '',
    is_image: images.length > 0 && videos.length === 0,
    images,
    videos,
    video_hd: video,
    video_sd: video,
    video_nowm: video,
    video_wm: '',
    mp3: '',
    music: '',
    music_author: '',
    music_url: '',
    duration: Math.round(media.video_duration || 0),
    views: media.video_view_count || media.play_count || 0,
    likes: media.edge_media_preview_like?.count || media.like_count || 0,
    comments: media.edge_media_to_parent_comment?.count || media.comment_count || 0,
    shares: 0,
    create_time: media.taken_at_timestamp || media.taken_at || 0,
  };
}

const IG_HEADERS = {
  'User-Agent': UA,
  Accept: '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'X-IG-App-ID': '936619743392459',
  'X-Requested-With': 'XMLHttpRequest',
  Referer: 'https://www.instagram.com/',
};

// 1) endpoint web_profile / media info publik
async function igViaWebApi(shortcode) {
  const { data } = await axios.get('https://www.instagram.com/api/v1/media/shortcode/' + shortcode + '/info/', {
    headers: IG_HEADERS, timeout: 15000,
  });
  return normalizeInstagramMedia(data);
}

// 2) endpoint ?__a=1 lama
async function igViaLegacy(shortcode) {
  const { data } = await axios.get(`https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`, {
    headers: IG_HEADERS, timeout: 15000,
  });
  return normalizeInstagramMedia(data);
}

// 3) GraphQL publik
async function igViaGraphql(shortcode) {
  const { data } = await axios.post(
    'https://www.instagram.com/graphql/query',
    new URLSearchParams({
      variables: JSON.stringify({ shortcode, fetch_comment_count: 0, parent_comment_count: 0, child_comment_count: 0, fetch_like_count: 10 }),
      doc_id: '10015901848480474',
      server_timestamps: 'true',
    }).toString(),
    {
      headers: { ...IG_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000,
    }
  );
  return normalizeInstagramMedia(data);
}

// 4) halaman embed (paling tahan banting untuk post publik)
async function igViaEmbed(shortcode) {
  const { data: html } = await axios.get(`https://www.instagram.com/p/${shortcode}/embed/captioned/`, {
    headers: { ...IG_HEADERS, Accept: 'text/html' },
    timeout: 15000,
  });

  const jsonMatch = html.match(/"gql_data"\s*:\s*({.+?})\s*,\s*"[a-z_]+"\s*:/s) || html.match(/window\.__additionalDataLoaded\s*\(\s*'[^']*'\s*,\s*({.+?})\s*\)\s*;/s);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
      const normalized = normalizeInstagramMedia(parsed);
      if (normalized && (normalized.images.length || normalized.video_hd)) return normalized;
    } catch {}
  }

  // fallback terakhir: ambil URL media langsung dari HTML embed
  const decode = (value) => value.replace(/\\u0026/g, '&').replace(/&amp;/g, '&').replace(/\\\//g, '/');
  const videoMatch = html.match(/"video_url"\s*:\s*"([^"]+)"/);
  const imageMatches = [...html.matchAll(/"display_url"\s*:\s*"([^"]+)"/g)].map((m) => decode(m[1]));
  const shots = [...html.matchAll(/class="EmbeddedMediaImage"[^>]+src="([^"]+)"/g)].map((m) => decode(m[1]));
  const usernameMatch = html.match(/"username"\s*:\s*"([^"]+)"/);
  const captionMatch = html.match(/<div class="Caption"[\s\S]*?<\/div>/);
  const images = [...new Set([...imageMatches, ...shots])];
  const video = videoMatch ? decode(videoMatch[1]) : '';
  if (!images.length && !video) return null;

  return {
    platform: 'instagram',
    id: shortcode,
    title: captionMatch ? captionMatch[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300) : '',
    cover: images[0] || '',
    cover_hd: images[0] || '',
    avatar: '',
    username: usernameMatch ? usernameMatch[1] : '',
    nickname: usernameMatch ? usernameMatch[1] : '',
    is_image: !video && images.length > 0,
    images,
    videos: video ? [video] : [],
    video_hd: video, video_sd: video, video_nowm: video, video_wm: '',
    mp3: '', music: '', music_author: '', music_url: '',
    duration: 0, views: 0, likes: 0, comments: 0, shares: 0, create_time: 0,
  };
}

function normalizeApifyMedia(records) {
  const completed = (Array.isArray(records) ? records : []).filter((item) => item.download_status === 'finished' && item.download_url);
  if (!completed.length) return null;

  const first = completed[0];
  const images = completed.filter((item) => item.type === 'image').map((item) => item.download_url);
  const videos = completed.filter((item) => item.type === 'video').map((item) => item.download_url);
  return {
    platform: 'instagram',
    id: first.post_url || '',
    title: '',
    cover: images[0] || videos[0] || '',
    cover_hd: images[0] || '',
    avatar: '',
    username: first.username || '',
    nickname: first.username || '',
    is_image: images.length > 0 && videos.length === 0,
    images,
    videos,
    video_hd: videos[0] || '',
    video_sd: videos[0] || '',
    video_nowm: videos[0] || '',
    video_wm: '',
    mp3: '', music: '', music_author: '', music_url: '',
    duration: 0, views: 0, likes: 0, comments: 0, shares: 0, create_time: 0,
  };
}

async function fetchWithApify(url) {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) return null;
  const response = await axios.post(
    'https://api.apify.com/v2/acts/crawlerbros~instagram-downloader-api/run-sync-get-dataset-items',
    { postUrls: [url] },
    { params: { token }, timeout: 120000 }
  );
  return normalizeApifyMedia(response.data);
}

app.get('/api/instagram/download', async (req, res) => {
  const rawUrl = req.query.url || '';
  const shortcode = getInstagramShortcode(rawUrl);
  if (!shortcode) {
    return res.status(400).json({ error: 'Gunakan URL post, reel, atau TV Instagram yang valid.' });
  }

  const strategies = [
    ['embed', () => igViaEmbed(shortcode)],
    ['web-api', () => igViaWebApi(shortcode)],
    ['graphql', () => igViaGraphql(shortcode)],
    ['legacy', () => igViaLegacy(shortcode)],
    ['apify', () => fetchWithApify(rawUrl)],
  ];

  const errors = [];
  for (const [name, run] of strategies) {
    try {
      const data = await run();
      if (data && (data.images?.length || data.video_hd)) {
        return res.json({ ...data, source: name });
      }
      errors.push(`${name}: kosong`);
    } catch (error) {
      errors.push(`${name}: ${error.response?.status || error.message}`);
    }
  }

  console.error('Instagram download gagal ->', errors.join(' | '));
  return res.status(502).json({
    error: 'Instagram tidak dapat mengambil media ini. Pastikan post publik dan coba lagi.',
    detail: errors,
  });
});

app.listen(port, () => {
  console.log(`TikSaver Pro berjalan di http://localhost:${port}`);
  console.log(FFMPEG ? `FFmpeg aktif (${FFMPEG}) — slideshow MP4 dirender di server.` : 'FFmpeg tidak ditemukan — slideshow memakai render browser (MP4 bila didukung).');
});
