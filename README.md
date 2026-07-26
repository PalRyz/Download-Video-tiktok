# TikSaver Pro — TikTok & Instagram Downloader

Downloader sederhana untuk media TikTok dan post publik Instagram. Selain video, foto, dan carousel, foto slide TikTok dapat dipilih untuk dibuat menjadi video WebM dengan musik asli bila audio tersedia.

## Menjalankan aplikasi

```bash
npm install
npm start
```

Buka `http://localhost:3000`. Server Node diperlukan untuk Instagram karena browser tidak dapat meminta endpoint Instagram secara langsung akibat CORS.

## Catatan Instagram

- Mendukung URL publik `instagram.com/p/...`, `instagram.com/reel/...`, dan `instagram.com/tv/...`.
- Endpoint Instagram dapat berubah atau membatasi request tanpa autentikasi. Post privat tidak didukung.
- Unduh hanya konten yang Anda miliki atau yang Anda memiliki izin untuk mengunduh.

## Fallback Instagram yang lebih stabil (Apify)

Aplikasi mencoba endpoint publik Instagram terlebih dahulu. Jika Instagram membatasi request, aktifkan fallback Apify dengan token akunmu sendiri:

```bash
APIFY_API_TOKEN=apify_api_token_kamu npm start
```

Buat token dari akun Apify lalu gunakan actor `crawlerbros/instagram-downloader-api`. Token tidak disimpan di HTML atau Git.
