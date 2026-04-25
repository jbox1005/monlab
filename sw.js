// 서비스 워커 — cache-as-you-go 전략 (첫 로드 후 모든 에셋 오프라인 사용 가능)
const CACHE = 'monlab-v1';
const CORE = ['./', './index.html', './editor.html', './manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  // 네트워크 없을 때 캐시 폴백, 새로 받은 자원은 캐시에 추가
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) {
        // 백그라운드에서 갱신 시도
        fetch(e.request).then((res) => {
          if (res && res.status === 200) {
            caches.open(CACHE).then((c) => c.put(e.request, res));
          }
        }).catch(() => {});
        return cached;
      }
      return fetch(e.request).then((res) => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
