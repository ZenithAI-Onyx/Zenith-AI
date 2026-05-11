/**
 * sw.js — Zenith AI Service Worker
 * ─────────────────────────────────────────────────────────────
 * Onyx Corporation · Estrategia: Cache-First para assets
 * estáticos, Network-First para peticiones a la API.
 *
 * ESTRATEGIA POR TIPO DE RECURSO:
 *   · Archivos del shell (HTML, CSS, fuentes) → Cache-First
 *   · API /api/chat                           → Network-Only (nunca cachear respuestas IA)
 *   · Firebase / Google APIs                  → Network-Only
 *   · Todo lo demás                           → Stale-While-Revalidate
 * ─────────────────────────────────────────────────────────────
 */

'use strict';

/* ── Versión del caché — cambia este número cada vez que hagas
      un deploy con cambios en los archivos del shell. ── */
const CACHE_VERSION  = 'zenith-v1.0.0';
const CACHE_STATIC   = `${CACHE_VERSION}-static`;
const CACHE_DYNAMIC  = `${CACHE_VERSION}-dynamic`;

/* ── Archivos del App Shell — se instalan en el primer arranque.
      Si cualquiera falla, la instalación se cancela. ── */
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/chat.html',
  '/voice.html',
  '/language.html',
  '/login.html',
  '/zenith-core.css',
  '/ai_connector.js',
  '/manifest.json',
];

/* ── Dominios que NUNCA se cachean (siempre red) ── */
const NETWORK_ONLY_ORIGINS = [
  'firebaseapp.com',
  'googleapis.com',
  'gstatic.com',
  'firebase.google.com',
];

/* ── Prefijos de rutas que NUNCA se cachean ── */
const NETWORK_ONLY_PATHS = [
  '/api/',
];

/* ══════════════════════════════════════════════════════════════
   INSTALL — precachea el App Shell completo
══════════════════════════════════════════════════════════════ */
self.addEventListener('install', event => {
  console.log('[Zenith SW] Instalando versión:', CACHE_VERSION);

  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then(cache => {
        console.log('[Zenith SW] Cacheando App Shell…');
        return cache.addAll(SHELL_ASSETS);
      })
      .then(() => {
        console.log('[Zenith SW] App Shell cacheado correctamente.');
        /* Activa el nuevo SW inmediatamente sin esperar
           a que se cierren las pestañas abiertas. */
        return self.skipWaiting();
      })
      .catch(err => {
        console.error('[Zenith SW] Error al cachear App Shell:', err);
      })
  );
});

/* ══════════════════════════════════════════════════════════════
   ACTIVATE — limpia cachés de versiones anteriores
══════════════════════════════════════════════════════════════ */
self.addEventListener('activate', event => {
  console.log('[Zenith SW] Activando versión:', CACHE_VERSION);

  event.waitUntil(
    caches.keys()
      .then(keys => {
        const deletions = keys
          .filter(key => key !== CACHE_STATIC && key !== CACHE_DYNAMIC)
          .map(key => {
            console.log('[Zenith SW] Eliminando caché antiguo:', key);
            return caches.delete(key);
          });
        return Promise.all(deletions);
      })
      .then(() => {
        console.log('[Zenith SW] Limpieza completa. SW activo.');
        /* Toma el control de todas las pestañas abiertas
           sin requerir recarga manual. */
        return self.clients.claim();
      })
  );
});

/* ══════════════════════════════════════════════════════════════
   FETCH — intercepta todas las peticiones de red
══════════════════════════════════════════════════════════════ */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  /* ── 1. Ignora peticiones que no son GET ── */
  if (request.method !== 'GET') return;

  /* ── 2. Ignora extensiones de Chrome y protocolos especiales ── */
  if (!url.protocol.startsWith('http')) return;

  /* ── 3. Network-Only: Firebase, Google APIs, ruta /api/ ── */
  const isNetworkOnly =
    NETWORK_ONLY_ORIGINS.some(origin => url.hostname.includes(origin)) ||
    NETWORK_ONLY_PATHS.some(path => url.pathname.startsWith(path));

  if (isNetworkOnly) {
    /* Deja pasar sin tocar — nunca cachear respuestas de IA
       ni tokens de autenticación. */
    return;
  }

  /* ── 4. Cache-First: archivos del App Shell ── */
  const isShellAsset = SHELL_ASSETS.some(asset => {
    if (asset === '/') return url.pathname === '/' || url.pathname === '/index.html';
    return url.pathname === asset;
  });

  if (isShellAsset) {
    event.respondWith(cacheFirst(request));
    return;
  }

  /* ── 5. Fuentes de Google — Cache-First con caché dinámico ── */
  if (url.hostname.includes('fonts.googleapis.com') ||
      url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(cacheFirstDynamic(request));
    return;
  }

  /* ── 6. Resto de peticiones del mismo origen — Stale-While-Revalidate ── */
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  /* ── 7. Cualquier otra cosa — deja pasar ── */
});

/* ══════════════════════════════════════════════════════════════
   ESTRATEGIAS DE CACHÉ
══════════════════════════════════════════════════════════════ */

/**
 * Cache-First (caché estático del shell).
 * Sirve desde caché si existe. Si no, va a la red y NO lo guarda
 * (el shell solo se actualiza en el evento install).
 */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const networkResponse = await fetch(request);
    return networkResponse;
  } catch {
    return offlineFallback(request);
  }
}

/**
 * Cache-First con caché dinámico (para fuentes, imágenes externas).
 * Si no está en caché, va a la red y lo guarda para la próxima.
 */
async function cacheFirstDynamic(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_DYNAMIC);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    return offlineFallback(request);
  }
}

/**
 * Stale-While-Revalidate.
 * Sirve desde caché inmediatamente (sin esperar la red),
 * y en paralelo actualiza el caché con la respuesta más reciente.
 * Combina velocidad de caché con datos siempre actualizados.
 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_DYNAMIC);
  const cached = await cache.match(request);

  const networkFetch = fetch(request)
    .then(networkResponse => {
      if (networkResponse.ok) {
        cache.put(request, networkResponse.clone());
      }
      return networkResponse;
    })
    .catch(() => null);

  return cached || await networkFetch || offlineFallback(request);
}

/**
 * Respuesta de fallback cuando no hay red ni caché.
 * Devuelve index.html para rutas de navegación (SPA fallback),
 * o una respuesta vacía para assets.
 */
async function offlineFallback(request) {
  const url = new URL(request.url);
  const isNavigation = request.mode === 'navigate' ||
    (request.method === 'GET' && request.headers.get('accept')?.includes('text/html'));

  if (isNavigation) {
    const cachedIndex = await caches.match('/index.html');
    if (cachedIndex) return cachedIndex;
  }

  /* Respuesta mínima offline para evitar errores de red en consola */
  return new Response('', {
    status: 503,
    statusText: 'Zenith AI — Sin conexión',
    headers: { 'Content-Type': 'text/plain' },
  });
}

/* ══════════════════════════════════════════════════════════════
   MENSAJE ENTRE SW Y CLIENTE
   El cliente puede enviar { type: 'SKIP_WAITING' } para forzar
   la activación del nuevo SW sin cerrar pestañas.
══════════════════════════════════════════════════════════════ */
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    console.log('[Zenith SW] SKIP_WAITING recibido — activando nuevo SW.');
    self.skipWaiting();
  }
});
