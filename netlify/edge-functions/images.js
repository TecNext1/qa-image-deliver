const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?|heic|heif|pdf)$/i;

export default async (request, context) => {
  const url = new URL(request.url);
  if (!IMAGE.test(url.pathname)) return context.next();

  let upstream;
  try {
    const encodedPath = await resolvePath(url.pathname);
    upstream = await fetch(
      "https://cdn.jsdelivr.net/gh/TecNext1/qa-image-deliver@main" + encodedPath
    );
  } catch {
    return notFound(url.pathname);
  }

  const type = upstream.headers.get("content-type") || "";
  if (!upstream.ok || /text\/html/i.test(type)) return notFound(url.pathname);

  const headers = new Headers();
  for (const key of ["content-type", "cache-control", "etag", "content-length"]) {
    const value = upstream.headers.get(key);
    if (value) headers.set(key, value);
  }
  headers.set("access-control-allow-origin", "*");
  return new Response(upstream.body, { status: 200, headers });
};

async function resolvePath(pathname) {
  const decoded = pathname.split("/").map((part) => {
    try { return decodeURIComponent(part); } catch { return part; }
  }).join("/").replace(/^\//, "");
  const map = await loadRedirects();
  let next = map[decoded];
  const seen = new Set([decoded]);
  while (next && !seen.has(next)) {
    seen.add(next);
    if (!map[next]) break;
    next = map[next];
  }
  const target = next || decoded;
  return `/${target.split("/").map((part) => encodeURIComponent(part)).join("/")}`;
}

async function loadRedirects() {
  const cacheKey = new Request("https://image-deliver.netlify.app/__redirects.json");
  const hit = await caches.default.match(cacheKey);
  if (hit) return hit.json();
  const response = await fetch("https://raw.githubusercontent.com/TecNext1/qa-image-deliver/main/redirects.json");
  const map = response.ok ? await response.json() : {};
  await caches.default.put(cacheKey, new Response(JSON.stringify(map), {
    headers: { "content-type": "application/json", "cache-control": "public, max-age=30" },
  }));
  return map;
}

function notFound(pathname) {
  const name = escapeHtml(decodeURIComponent(pathname.split("/").pop() || "This file"));
  return new Response(
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>File not found</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f3efe7; color: #1e1a16; font-family: Georgia, serif; }
    main { text-align: center; padding: 24px; }
    p { font-family: system-ui, sans-serif; color: #6f675e; }
  </style>
</head>
<body>
  <main>
    <h1>File not found</h1>
    <p>${name} isn’t available.</p>
  </main>
</body>
</html>`,
    {
      status: 404,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    }
  );
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}
