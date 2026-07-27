# TikSaver Pro — TikTok & Instagram Downloader

Downloader sederhana untuk media TikTok dan post publik Instagram. Selain video, foto, dan carousel, foto slide TikTok dapat dipilih untuk dibuat menjadi **video MP4 (H.264 + AAC)** dengan musik asli bila audio tersedia.

## Menjalankan aplikasi

```bash
npm install
npm start
```

Buka `http://localhost:3000`.

### Video foto + musik (MP4)

- Render utama dilakukan di server memakai FFmpeg sehingga hasilnya benar-benar **MP4** (H.264 + AAC), bukan WebM.
- FFmpeg dicari berurutan: `FFMPEG_PATH` → paket opsional `ffmpeg-static` → `ffmpeg` yang terpasang di sistem.
- Jika FFmpeg tidak ada, aplikasi otomatis fallback merekam di browser dan tetap meminta wadah MP4.
- Musik **tidak lagi diputar ke speaker** saat proses render (audio hanya dialirkan ke rekaman).
- Foto/audio/video diambil lewat endpoint proxy `/api/proxy` agar tidak diblokir CORS TikTok/Instagram. Server Node diperlukan untuk Instagram karena browser tidak dapat meminta endpoint Instagram secara langsung akibat CORS.

## Catatan Instagram

- Mendukung URL publik `instagram.com/p/...`, `/reel/...`, `/reels/...`, `/tv/...`, termasuk bentuk `instagram.com/<username>/reel/...`.
- Server mencoba 5 strategi berurutan: embed → web API → GraphQL → endpoint lama `?__a=1` → Apify (opsional).
- Endpoint Instagram dapat berubah atau membatasi request tanpa autentikasi. Post privat tidak didukung.
- Unduh hanya konten yang Anda miliki atau yang Anda memiliki izin untuk mengunduh.

## Fallback Instagram yang lebih stabil (Apify)

Aplikasi mencoba endpoint publik Instagram terlebih dahulu. Jika Instagram membatasi request, aktifkan fallback Apify dengan token akunmu sendiri:

```bash
APIFY_API_TOKEN=apify_api_token_kamu npm start
```

Buat token dari akun Apify lalu gunakan actor `crawlerbros/instagram-downloader-api`. Token tidak disimpan di HTML atau Git.
