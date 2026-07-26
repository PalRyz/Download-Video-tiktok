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
