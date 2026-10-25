// Simpan aplikasi untuk dipakai tanpa sinyal setelah dibuka sekali.
// Rekaman suara disimpan di cache tersendiri yang TIDAK dihapus saat aplikasi diperbarui.
// Nomor versi diisi otomatis oleh build.py dari file VERSION.
// Nama cache memuat jalur pemasangan (scope), supaya dua pemasangan Literasi di satu origin
// (misalnya /uji/ dan /resmi/) tidak saling menghapus cache.
const SCOPE = (() => { try { return new URL(self.registration.scope).pathname.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'root'; } catch (e) { return 'root'; } })();
const OLD = 'literasi-app-' + SCOPE + '-';
const APP = OLD + 'v0.9.6';
const AUDIO = 'literasi-audio-v1';
// Teks aplikasi (wajib), termasuk tiga halaman dokumen supaya bisa dibuka tanpa sinyal. index.html diunduh sekali lalu disimpan untuk './' dan 'index.html'.
const CORE = ['manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'sumber.html', 'tinjauan.html', 'sumber-foto.html'];
// Foto sampul: tidak wajib. Yang gagal atau macet tidak menahan pemasangan; halaman menghitung ulang dan melengkapinya.
const IMG = ['img/arfak-teluk.webp','img/senja-rouwor.webp','img/dermaga-sumano.webp','img/mama-puskesmas.webp','img/bermain-saga.webp','img/kader-benawa.webp','img/anak-arfak.webp','img/perahu-sumano.webp','img/posyandu-benawa.webp','img/noken.webp',
  'img/kusta-1.webp','img/kusta-2.webp','img/kaskado-1.webp','img/kaskado-2.webp','img/kudis-1.webp','img/frambusia-1.webp','img/frambusia-2.webp',
  'img/kusta-3.webp','img/kaskado-3.webp','img/frambusia-3.webp'];
const IMG_WAIT = 15000, IMG_PHASE = 15000;

const within = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('waktu habis')), ms))]);
// Respons hasil pengalihan tidak boleh dipakai untuk membuka halaman; disalin ulang tanpa tanda pengalihan.
const clean = r => r.redirected ? r.blob().then(b => new Response(b, { status: r.status, statusText: r.statusText, headers: r.headers })) : r;
// Alamat yang dipakai halaman pembuka ('./' atau 'index.html') yang mungkin sudah ada di cache peramban.
const pageUrl = () => self.clients.matchAll({ includeUncontrolled: true, type: 'window' })
  .then(cs => cs.some(c => /\/index\.html$/.test(new URL(c.url).pathname)) ? 'index.html' : './')
  .catch(() => './');

// Halaman: 'no-cache' artinya selalu dicek ke server (jawaban 304 murah bila tidak berubah), jadi versi baru
// tidak pernah menyimpan index.html lama dari cache peramban (GitHub Pages memberi max-age 10 menit).
function saveIndex(c) {
  return pageUrl().then(u => fetch(u, { cache: 'no-cache' })).then(res => {
    if (!res.ok) throw new Error('index.html ' + res.status);
    return clean(res);
  }).then(res => Promise.all([c.put('./', res.clone()), c.put('index.html', res)]));
}
// Foto: salin dari simpanan versi sebelumnya bila ada (tanpa unduh ulang; tetap diperbarui saat ditampilkan),
// selain itu unduh dengan batas waktu per foto.
function saveImgs(c) {
  return Promise.all(IMG.map(u => caches.match(u)
    .then(hit => hit ? c.put(u, hit) : within(fetch(u, { cache: 'no-cache' }).then(res => res.ok ? c.put(u, res) : null), IMG_WAIT))
    .catch(() => {})));
}

self.addEventListener('install', e => {
  e.waitUntil(caches.open(APP)
    .then(c => saveIndex(c)
      .then(() => c.addAll(CORE.map(u => new Request(u, { cache: 'no-cache' }))))
      .then(() => within(saveImgs(c), IMG_PHASE).catch(() => {})))
    .then(() => self.skipWaiting()));
});

// Yang dibersihkan: versi lama pada scope ini, dan nama lama tanpa scope (literasi-app-v…) dari rilis sebelum 0.8.1.
// Cache aplikasi lain, cache rekaman, dan cache Literasi pada scope lain dibiarkan.
// Sebelum dibersihkan, foto yang tersimpan di versi lama selama pemasangan (oleh halaman) dipindahkan dulu, supaya tidak hilang.
self.addEventListener('activate', e => {
  e.waitUntil(caches.open(APP)
    .then(c => Promise.all(IMG.map(u => c.match(u).then(h => h || caches.match(u).then(o => o && c.put(u, o))).catch(() => {}))))
    .then(() => caches.keys())
    // Nama versi wajib tepat setelah scope, supaya pemasangan bersarang (…-uji-v…) tidak ikut terhapus.
    .then(ks => Promise.all(ks.filter(k => k !== APP && ((k.indexOf(OLD) === 0 && /^v\d/.test(k.slice(OLD.length))) || /^literasi-app-v\d/.test(k))).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Pemutar audio meminta potongan file (header Range). Dari cache, kirim potongan yang diminta (206).
// Range yang tidak masuk akal (akhir sebelum awal, bentuk salah) ditolak dengan 416.
function ranged(req, res) {
  const range = req.headers.get('range');
  if (!range) return res;
  const copy = res.clone();
  return res.blob().catch(() => null).then(b => {
    if (!b) return copy;
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    const type = res.headers.get('Content-Type') || 'audio/mpeg';
    const bad = () => new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + b.size } });
    if (!m || (m[1] === '' && m[2] === '')) return bad();
    let start = m[1] === '' ? Math.max(0, b.size - Number(m[2])) : Number(m[1]);
    let end = m[1] !== '' && m[2] !== '' ? Math.min(Number(m[2]), b.size - 1) : b.size - 1;
    if (start >= b.size || end < start) return bad();
    const part = b.slice(start, end + 1);
    return new Response(part, { status: 206, statusText: 'Partial Content', headers: {
      'Content-Type': type, 'Accept-Ranges': 'bytes',
      'Content-Range': 'bytes ' + start + '-' + end + '/' + b.size, 'Content-Length': String(part.size) } });
  });
}

// Rekaman: kunci cache memakai alamat lengkap termasuk ?v=<sidik jari>, jadi rekaman baru dengan nama sama terunduh baru.
// Berkas baru DISIMPAN DULU; versi lama di jalur yang sama baru dibuang bila penyimpanan berhasil, dan hanya pada
// permintaan "simpan ulang" (cache no-cache/reload dari tombol Simpan semua rekaman, yang memakai daftar terbaru).
// Pemutaran biasa tidak pernah menghapus apa pun, supaya tab lama tidak menyingkirkan versi baru atau sebaliknya.
function audio(req) {
  const url = new URL(req.url), key = url.href, path = url.origin + url.pathname;
  const fresh = req.cache === 'no-cache' || req.cache === 'reload' || req.cache === 'no-store';
  return caches.open(AUDIO).then(c => {
    const fromNet = () => fetch(key).then(res => {
      if (res.status !== 200) return res;
      return c.put(key, res.clone())
        .then(() => fresh ? c.keys().then(ks => Promise.all(ks.filter(k => k.url.split('?')[0] === path && k.url !== key).map(k => c.delete(k)))) : null)
        .catch(() => {})
        .then(() => ranged(req, res));
    });
    if (fresh) return fromNet().catch(() => c.match(key).then(hit => hit ? ranged(req, hit) : Response.error()));
    return c.match(key).then(hit => hit ? ranged(req, hit) : fromNet());
  });
}

// Daftar rekaman: jaringan dulu (daftar baru langsung terlihat saat ada sinyal), cache bila tidak ada sinyal.
function manifestFirst(req) {
  return fetch(req).then(res => {
    if (res && res.status === 200) { const copy = res.clone(); caches.open(APP).then(c => c.put(req.url, copy)).catch(() => {}); }
    return res;
  }).catch(() => caches.match(req.url).then(hit => hit || Response.error()));
}

// Batas galat: bila jalur cache gagal (penyimpanan rusak/penuh), langsung ke jaringan; jangan biarkan halaman kosong.
const safe = (p, req) => Promise.resolve(p).then(r => r || fetch(req)).catch(() => fetch(req));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url; try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;
  // Pemeriksaan sinyal "Perbaiki aplikasi" (?cek=) dan permintaan no-store langsung ke jaringan: tidak dijawab dan tidak disimpan cache.
  if (req.cache === 'no-store' || /[?&]cek=/.test(url.search)) return;
  if (url.pathname.indexOf('/audio/') !== -1 && /\.mp3$/i.test(url.pathname)) { e.respondWith(safe(audio(req), req)); return; }
  if (/\/audio\/daftar\.json$/.test(url.pathname)) { e.respondWith(safe(manifestFirst(req), req)); return; }

  // Halaman dicocokkan tanpa parameter (?fbclid=… dari tautan yang dibagikan) dan selalu punya cadangan index.html.
  // Penyegaran halaman di latar belakang selalu dicek ke server ('no-cache', jawaban 304 murah), supaya salinan lama
  // dari cache peramban (max-age 10 menit) tidak pernah menimpa versi baru di simpanan luring.
  const nav = req.mode === 'navigate';
  const key = nav ? url.origin + url.pathname : req;
  const net = (nav ? fetch(url.href, { cache: 'no-cache' }).then(clean) : fetch(req)).then(res => {
    if (res && res.status === 200) {
      const copy = res.clone();
      return caches.open(APP).then(c => c.put(key, copy)).catch(() => {}).then(() => res);
    }
    return res;
  });
  e.waitUntil(net.catch(() => {}));
  const offline = () => nav ? caches.match('index.html').then(r => r || caches.match('./')).then(r => r || Response.error()).catch(() => Response.error()) : Response.error();
  e.respondWith(caches.match(key, { ignoreSearch: nav })
    .catch(() => null)
    .then(hit => hit || net.catch(offline))
    .catch(offline));
});
