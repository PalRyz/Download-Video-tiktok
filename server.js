const path = require('path');
const express = require('express');
const axios = require('axios');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname)));

function getInstagramShortcode(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (hostname !== 'instagram.com') return null;

  const match = parsed.pathname.match(/^\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : null;
}

function normalizeInstagramMedia(payload) {
  const media = payload?.graphql?.shortcode_media
    || payload?.data?.xdt_shortcode_media
    || payload?.items?.[0]
    || payload?.xdt_shortcode_media;

  if (!media) return null;

  const isCarousel = media.edge_sidecar_to_children?.edges?.length || media.carousel_media?.length;
  const carousel = media.edge_sidecar_to_children?.edges?.map(({ node }) => node) || media.carousel_media || [];
  const getImage = (item) => item.display_url || item.image_versions2?.candidates?.[0]?.url || item.thumbnail_src || '';
  const getVideo = (item) => item.video_url || item.video_versions?.[0]?.url || '';
  const images = (isCarousel ? carousel : [media])
    .filter((item) => !item.is_video && item.media_type !== 2)
    .map(getImage)
    .filter(Boolean);
  const video = getVideo(media);
  const owner = media.owner || media.user || {};
  const caption = media.edge_media_to_caption?.edges?.[0]?.node?.text || media.caption?.text || '';

  return {
    platform: 'instagram',
    id: media.id || media.pk || media.shortcode || '',
    title: caption,
    cover: getImage(media) || getImage(carousel[0]),
    avatar: owner.profile_pic_url || '',
    username: owner.username || '',
    nickname: owner.full_name || owner.username || '',
    is_image: Boolean(isCarousel || (!video && images.length)),
    images,
    video_hd: video,
    video_sd: video,
    video_nowm: video,
    video_wm: video,
    mp3: '',
    music: '',
    music_author: '',
    duration: media.video_duration || 0,
    views: media.video_view_count || media.play_count || 0,
    likes: media.edge_media_preview_like?.count || media.like_count || 0,
    comments: media.edge_media_to_parent_comment?.count || media.comment_count || 0,
    shares: 0,
    create_time: media.taken_at_timestamp || media.taken_at || 0,
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
    avatar: '',
    username: first.username || '',
    nickname: first.username || '',
    is_image: images.length > 0 && videos.length === 0,
    images,
    video_hd: videos[0] || '',
    video_sd: videos[0] || '',
    video_nowm: videos[0] || '',
    video_wm: videos[0] || '',
    mp3: '', music: '', music_author: '',
    duration: videos[0]?.media_meta_data?.duration || 0,
    views: 0, likes: 0, comments: 0, shares: 0, create_time: 0,
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
  const shortcode = getInstagramShortcode(req.query.url || '');
  if (!shortcode) {
    return res.status(400).json({ error: 'Gunakan URL post, reel, atau TV Instagram yang valid.' });
  }

  try {
    // Fast path: Instagram's public response. This avoids requiring an external key.
    const response = await axios.get(`https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
        Accept: '*/*',
        'X-IG-App-ID': '936619743392459',
      },
      timeout: 15000,
    });
    const data = normalizeInstagramMedia(response.data);
    if (!data) throw new Error('Media tidak ditemukan pada respons Instagram.');
    return res.json(data);
  } catch (directError) {
    // Reliable fallback: enabled only when the app owner supplies APIFY_API_TOKEN.
    try {
      const apifyData = await fetchWithApify(req.query.url);
      if (apifyData) return res.json(apifyData);
    } catch (apifyError) {
      console.error('Apify Instagram fallback error:', apifyError.response?.status || apifyError.message);
    }
    console.error('Instagram download error:', directError.response?.status || directError.message);
    return res.status(502).json({
      error: 'Instagram tidak dapat mengambil media ini. Pastikan post publik dan coba lagi.',
    });
  }
});

app.listen(port, () => console.log(`TikSaver Pro berjalan di http://localhost:${port}`));
