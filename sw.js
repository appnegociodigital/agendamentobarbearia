// =====================================================
//  SERVICE WORKER — Barbearia PWA
//  Compatível com index.html (barbearia-sw / supabase-keepalive)
// =====================================================

const CACHE_NAME = 'barbearia-v1';
const SUPABASE_URL = 'https://ymrgjbveanbkcqifytal.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InltcmdqYnZlYW5ia2NxaWZ5dGFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MDczNTYsImV4cCI6MjA5MzQ4MzM1Nn0.UJNPMP_Iv85856U0SeZr76LlzlOcCSZ_0AUuGtztgj8';
const PING_INTERVAL = 5 * 24 * 60 * 60 * 1000; // 5 dias em ms

// Arquivos que serão armazenados em cache para funcionamento offline
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192x192.png',
  './icon-512x512.png'
];

// ── INSTALL: faz cache dos arquivos estáticos ─────────────────────────────────
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(ASSETS);
    }).then(function() {
      return self.skipWaiting(); // ativa imediatamente sem esperar aba fechar
    })
  );
});

// ── ACTIVATE: remove caches antigos ──────────────────────────────────────────
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) { return key !== CACHE_NAME; })
            .map(function(key) { return caches.delete(key); })
      );
    }).then(function() {
      return self.clients.claim(); // assume controle de todas as abas abertas
    }).then(function() {
      // Faz o primeiro ping ao Supabase logo na ativação
      return _pingSupabase();
    })
  );
});

// ── FETCH: serve do cache quando offline, rede quando online ─────────────────
self.addEventListener('fetch', function(event) {
  // Deixa passar requisições ao Supabase e a APIs externas (não cachear)
  if (event.request.url.includes('supabase.co') ||
      event.request.url.includes('mercadopago') ||
      event.request.url.includes('api.whatsapp') ||
      event.request.url.includes('googleapis')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(function(cached) {
      if (cached) return cached;
      return fetch(event.request).then(function(response) {
        // Armazena no cache apenas respostas válidas de arquivos locais
        if (response && response.status === 200 && response.type === 'basic') {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, clone);
          });
        }
        return response;
      });
    }).catch(function() {
      // Fallback offline: devolve o index.html para navegação
      return caches.match('./index.html');
    })
  );
});

// ── PERIODIC BACKGROUND SYNC: keepalive do Supabase ─────────────────────────
// Disparado pelo Chrome Android quando registrado com 'supabase-keepalive'
self.addEventListener('periodicsync', function(event) {
  if (event.tag === 'supabase-keepalive') {
    event.waitUntil(_pingSupabase());
  }
});

// ── SYNC: fallback para Background Sync comum ────────────────────────────────
self.addEventListener('sync', function(event) {
  if (event.tag === 'supabase-keepalive') {
    event.waitUntil(_pingSupabase());
  }
});

// ── PING: acessa o Supabase e salva timestamp no IndexedDB ───────────────────
function _pingSupabase() {
  return fetch(SUPABASE_URL + '/rest/v1/barbershops?select=id&limit=1', {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY
    }
  }).then(function(r) {
    if (r.ok) {
      return _saveLastPing(Date.now());
    }
  }).catch(function() {
    // Silencioso — sem internet, tenta na próxima vez
  });
}

// ── IndexedDB: salva o timestamp do último ping ───────────────────────────────
function _saveLastPing(ts) {
  return new Promise(function(resolve) {
    var req = indexedDB.open('barbearia-sw', 1);
    req.onupgradeneeded = function(e) {
      e.target.result.createObjectStore('meta');
    };
    req.onsuccess = function(e) {
      var db = e.target.result;
      var tx = db.transaction('meta', 'readwrite');
      tx.objectStore('meta').put(ts, 'lastPing');
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    };
    req.onerror = resolve;
  });
}
