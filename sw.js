/**
 * sw.js — Service Worker da Barbearia
 *
 * Funções:
 *  1. Satisfaz o requisito obrigatório de PWA instalável no Android/Chrome
 *  2. Mantém o Supabase (plano gratuito) ativo fazendo um ping leve a cada 5 dias
 *
 * ⚠️  IMPORTANTE: Se você alterar a URL/KEY do Supabase no HTML principal,
 *     atualize também as constantes abaixo.
 */

// ─── Configurações ────────────────────────────────────────────────
const SUPABASE_URL  = 'https://ymrgjbveanbkcqifytal.supabase.co';
const SUPABASE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InltcmdqYnZlYW5ia2NxaWZ5dGFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MDczNTYsImV4cCI6MjA5MzQ4MzM1Nn0.UJNPMP_Iv85856U0SeZr76LlzlOcCSZ_0AUuGtztgj8';

// 5 dias em milissegundos
const PING_INTERVAL_MS = 5 * 24 * 60 * 60 * 1000;

// Chave usada no IndexedDB para guardar o timestamp do último ping
const DB_NAME    = 'barbearia-sw';
const STORE_NAME = 'meta';
const KEY_LAST   = 'lastPing';

// ─── Ciclo de vida do SW ──────────────────────────────────────────

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    self.clients.claim().then(() => pingSupabaseIfDue())
  );
});

/**
 * Fetch passivo — não interceptamos nada.
 * Todas as requisições passam direto pela rede.
 * Isso evita qualquer problema de cache ou bloqueio de requests.
 */
// (sem listener de fetch — comportamento 100% transparente)

// ─── Background Sync via periodic check ──────────────────────────

/**
 * O evento 'periodicsync' é suportado no Chrome Android (flag experimental).
 * Serve como camada extra; a lógica principal roda no activate.
 */
self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'supabase-keepalive') {
    e.waitUntil(pingSupabaseIfDue());
  }
});

/**
 * Quando a página envia uma mensagem pedindo ping manual.
 */
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'PING_SUPABASE') {
    pingSupabase().then(() => {
      if (e.source) e.source.postMessage({ type: 'PING_DONE' });
    });
  }
});

// ─── Lógica de Keep-alive ─────────────────────────────────────────

/**
 * Abre (ou cria) o IndexedDB para persistir o timestamp do último ping.
 */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

function getLastPing(db) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(KEY_LAST);
    req.onsuccess = () => resolve(req.result || 0);
    req.onerror   = () => resolve(0);
  });
}

function setLastPing(db, ts) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).put(ts, KEY_LAST);
    req.onsuccess = () => resolve();
    req.onerror   = () => resolve();
  });
}

/**
 * Faz um GET leve na tabela `barbershops` (limit 1).
 * Basta devolver 200 — só precisamos acordar o banco.
 */
async function pingSupabase() {
  try {
    const url = `${SUPABASE_URL}/rest/v1/barbershops?select=id&limit=1`;
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'apikey':        SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type':  'application/json'
      }
    });
    console.log('[SW Keep-alive] Supabase ping:', resp.status);
    return resp.ok;
  } catch (err) {
    console.warn('[SW Keep-alive] Ping falhou (sem rede):', err.message);
    return false;
  }
}

/**
 * Só pinga se já passaram 5 dias desde o último ping.
 */
async function pingSupabaseIfDue() {
  try {
    const db      = await openDB();
    const last    = await getLastPing(db);
    const now     = Date.now();
    const elapsed = now - last;

    if (elapsed >= PING_INTERVAL_MS) {
      const ok = await pingSupabase();
      if (ok) {
        await setLastPing(db, now);
        console.log('[SW Keep-alive] Ping gravado em', new Date(now).toLocaleString('pt-BR'));
      }
    } else {
      const horas = Math.round((PING_INTERVAL_MS - elapsed) / 3600000);
      console.log(`[SW Keep-alive] Próximo ping em ~${horas}h`);
    }
  } catch (err) {
    console.warn('[SW Keep-alive] Erro no ciclo de ping:', err);
  }
}
