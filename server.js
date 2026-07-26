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

app.get('/api/instagram/download', async (req, res) => {
  const shortcode = getInstagramShortcode(req.query.url || '');
  if (!shortcode) {
    return res.status(400).json({ error: 'Gunakan URL post, reel, atau TV Instagram yang valid.' });
  }

  try {
    // Request server-side avoids browser CORS restrictions. Instagram can still
    // require authentication or change this undocumented response at any time.
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
  } catch (error) {
    console.error('Instagram download error:', error.response?.status || error.message);
    return res.status(502).json({
      error: 'Instagram tidak dapat mengambil media ini. Pastikan post publik dan coba lagi.',
    });
  }
});

app.listen(port, () => console.log(`TikSaver Pro berjalan di http://localhost:${port}`));
