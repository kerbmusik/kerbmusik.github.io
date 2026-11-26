"use strict";

const CACHE = "notenpult";
const SHELL = ["./", "index.html", "musicstand.js", "editor.js", "manifest.webmanifest",
               "images/icon.svg", "images/icon-32.png", "images/logo-180.png", "images/logo-192.png"];
const FOREVER = /\.[0-9a-f]{10,12}\.(svg|mp3|json|pdf)$|\/scores\/x\/[A-Za-z0-9_-]{22}\.bin$/;
const scope = () => self.registration.scope;

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => Promise.all(
    SHELL.map(file => cache.add(new Request(file, { cache: "reload" })).catch(() => {})))));
  self.skipWaiting();
});

self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

function network(request, ms = 3000) {
  return Promise.race([fetch(request), new Promise((_, no) => setTimeout(() => no(new Error("timeout")), ms))]);
}


async function report(state) {
  for (const client of await self.clients.matchAll({ type: "window" })) client.postMessage({ type: "offline", ...state });
}

let wanted = null, running = null;
function keep(files) {
  wanted = files.map(file => new URL(file, scope()).href);
  running ||= (async () => {
    const cache = await caches.open(CACHE);
    while (wanted) {
      const list = wanted;
      wanted = null;
      let done = 0, offline = false, last = 0;
      for (const url of list) {
        if (wanted) break;
        let there = Boolean(await cache.match(url));
        if (!there && !offline) {
          try {
            const response = await network(url, 30000);
            if (response.status === 200) { await cache.put(url, response); there = true; }
          } catch { offline = true; }
        }
        if (there) done++;
        if (Date.now() - last > 400) { last = Date.now(); report({ done, total: list.length, loading: !offline }); }
      }
      if (wanted) continue;
      report({ done, total: list.length, loading: false });
      const keepSet = new Set(list);
      for (const request of await cache.keys())
        if (new URL(request.url).pathname.includes("/scores/") && FOREVER.test(request.url) && !keepSet.has(request.url))
          await cache.delete(request);
    }
  })().finally(() => { running = null; });
  return running;
}

self.addEventListener("message", event => {
  if (event.data?.type === "keep" && Array.isArray(event.data.files)) event.waitUntil(keep(event.data.files));
});


async function shellFirst(event, key) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(key, { ignoreSearch: true });
  const fresh = fetch(event.request, { cache: "no-cache" }).then(response => {
    if (response.ok) cache.put(key, response.clone());
    return response;
  });
  if (cached) { event.waitUntil(fresh.catch(() => {})); return cached; }
  return fresh;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await network(new Request(request, { cache: "no-cache" }));
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    throw new Error("offline");
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.status === 200) cache.put(request, response.clone());
  return response;
}

async function ranged(request) {
  const cached = await caches.match(request.url);
  if (!cached) return fetch(request);
  const body = await cached.arrayBuffer();
  const match = /bytes=(\d*)-(\d*)/.exec(request.headers.get("range") || "");
  const start = match && match[1] ? Number(match[1]) : 0;
  const end = Math.min(match && match[2] ? Number(match[2]) : body.byteLength - 1, body.byteLength - 1);
  return new Response(body.slice(start, end + 1), { status: 206, headers: {
    "Content-Type": cached.headers.get("Content-Type") || "audio/mpeg", "Content-Length": String(end - start + 1),
    "Content-Range": `bytes ${start}-${end}/${body.byteLength}`, "Accept-Ranges": "bytes" } });
}

self.addEventListener("fetch", event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== location.origin || url.pathname.endsWith("/state.json")) return;
  if (request.mode === "navigate") return event.respondWith(shellFirst(event, scope()));
  if (FOREVER.test(url.pathname)) {
    if (request.headers.has("range")) return event.respondWith(ranged(request));
    return event.respondWith(cacheFirst(request));
  }
  if (/\/scores\/(catalog\.(json|bin)|edit\.bin|editor\.txt)$/.test(url.pathname)) return event.respondWith(networkFirst(request));
  event.respondWith(shellFirst(event, request.url));
});
