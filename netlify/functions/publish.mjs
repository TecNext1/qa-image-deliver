import { timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";

const OWNER = "TecNext1";
const REPO = "qa-image-deliver";
const BRANCH = "main";
const MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "ico", "bmp", "tif", "tiff", "heic", "heif", "pdf"]);
const BLOCKED = new Set(["readme.md", "upload", ".gitignore", ".gitattributes", "netlify.toml"]);

export default async (request) => {
  if (request.method !== "POST") return json(405, { error: "Use POST." });
  if (!authorized(request)) return json(401, { error: "That password didn't work." });

  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Upload was incomplete. Try again." });
  }

  try {
    if (body.action === "chunk") return json(200, await saveChunk(body));
    if (body.action === "finish") return json(200, await finish(body));
    if (body.action === "delete") return json(200, await remove(body.path));
    if (body.action === "rename") return json(200, await rename(body.from, body.to));
    if (body.action === "add-brand") return json(200, await addBrand(body.name));
    return json(400, { error: "Unknown action." });
  } catch (error) {
    return json(400, { error: error.message || "Upload failed." });
  }
};

export const config = { path: "/api/publish" };

function authorized(request) {
  const expected = process.env.UPLOAD_PASSWORD || "";
  const given = request.headers.get("x-upload-password") || "";
  if (!expected || !given || expected.length > 512 || given.length > 512) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function store() {
  return getStore({ name: "uploads", consistency: "strong" });
}

function uploadId(id) {
  if (!/^[0-9a-f-]{36}$/i.test(id || "")) throw new Error("Upload was incomplete. Try again.");
  return id;
}

async function saveChunk(body) {
  const id = uploadId(body.id);
  const index = Number(body.index);
  if (!Number.isInteger(index) || index < 0 || index > 20) throw new Error("Upload was incomplete. Try again.");
  if (typeof body.data !== "string" || body.data.length > 4_000_000) throw new Error("That piece of the file is too large.");
  await store().set(`${id}/${index}`, body.data);
  return { ok: true };
}

async function finish(body) {
  const id = uploadId(body.id);
  const path = cleanName(body.path, await loadBrands());
  const total = Number(body.total);
  if (!Number.isInteger(total) || total < 1 || total > 21) throw new Error("Upload was incomplete. Try again.");

  const parts = [];
  for (let index = 0; index < total; index += 1) {
    const data = await store().get(`${id}/${index}`, { type: "text" });
    if (!data) throw new Error("Upload expired. Try again.");
    parts.push(Buffer.from(data, "base64"));
  }
  const bytes = Buffer.concat(parts);
  if (bytes.length > MAX_BYTES) throw new Error("That file is over 20 MB.");
  const blob = await gh(`/repos/${OWNER}/${REPO}/git/blobs`, {
    method: "POST",
    body: { content: bytes.toString("base64"), encoding: "base64" },
  });
  await commit([{ path, sha: blob.sha }], `Publish ${path}`);
  await clearChunks(id, total);
  return { ok: true, path };
}

async function clearChunks(id, total) {
  const bucket = store();
  await Promise.all(Array.from({ length: total }, (_, index) => bucket.delete(`${id}/${index}`).catch(() => {})));
}

async function remove(path) {
  const name = cleanName(path, await loadBrands());
  await commit([{ path: name, sha: null }], `Remove ${name}`);
  return { ok: true };
}

async function rename(from, to) {
  const brands = await loadBrands();
  const source = cleanName(from, brands);
  const target = cleanName(to, brands);
  if (source === target) return { ok: true, path: target };
  const tree = await gh(`/repos/${OWNER}/${REPO}/git/trees/${encodeURIComponent(BRANCH)}?recursive=1`);
  const entries = tree.tree || [];
  const file = entries.find((entry) => entry.type === "blob" && entry.path === source);
  if (!file) throw new Error("That file is no longer there.");
  if (entries.some((entry) => entry.path === target)) throw new Error("That filename is already used.");

  const redirects = await readRedirects(entries);
  for (const [oldPath, dest] of Object.entries(redirects)) {
    if (dest === source) redirects[oldPath] = target;
  }
  redirects[source] = target;
  const redirectBlob = await gh(`/repos/${OWNER}/${REPO}/git/blobs`, {
    method: "POST",
    body: { content: Buffer.from(JSON.stringify(redirects, null, 2)).toString("base64"), encoding: "base64" },
  });
  await commit([
    { path: target, sha: file.sha },
    { path: source, sha: null },
    { path: "redirects.json", sha: redirectBlob.sha },
  ], `Rename ${source} to ${target}`);
  return { ok: true, path: target };
}

async function readRedirects(entries) {
  const entry = entries.find((item) => item.path === "redirects.json");
  if (!entry) return {};
  const blob = await gh(`/repos/${OWNER}/${REPO}/git/blobs/${entry.sha}`);
  const text = Buffer.from(blob.content, "base64").toString("utf8");
  const parsed = JSON.parse(text);
  return parsed && typeof parsed === "object" ? parsed : {};
}

const RESERVED = ["site", "netlify", "scripts", ".github"];

function cleanName(name, brands) {
  if (typeof name !== "string" || !name || name.includes("\\") || name.includes("..")) {
    throw new Error("Use a plain filename.");
  }
  const parts = name.split("/").filter(Boolean);
  if (parts.length < 1 || parts.length > 3 || parts.some((part) => part === "." || part === "..")) {
    throw new Error("Use one folder, or none.");
  }
  const file = parts[parts.length - 1];
  const ext = file.includes(".") ? file.slice(file.lastIndexOf(".") + 1).toLowerCase() : "";
  if (!ALLOWED.has(ext) || BLOCKED.has(file.toLowerCase())) throw new Error("That file type is not allowed.");
  if (RESERVED.includes(parts[0].toLowerCase())) throw new Error("Pick another folder name.");
  if (parts.length === 3) {
    const brand = (brands || []).find((item) => item === parts[0]);
    if (!brand || brand.toLowerCase() === "hyundai") throw new Error("That brand is not available.");
    if (RESERVED.includes(parts[1].toLowerCase())) throw new Error("Pick another folder name.");
  }
  return parts.join("/");
}

function cleanBrand(value) {
  const name = typeof value === "string" ? value.trim().replace(/^\/+|\/+$/g, "") : "";
  if (!name || name.length > 40 || /[\\/]/.test(name) || name.includes("..") || name === ".") {
    throw new Error("Use a short brand name, with no slashes.");
  }
  if (RESERVED.includes(name.toLowerCase()) || name.toLowerCase() === "hyundai") {
    throw new Error("Pick another brand name.");
  }
  return name;
}

function normalizeBrands(list) {
  const names = [];
  for (const item of Array.isArray(list) ? list : []) {
    if (typeof item !== "string") continue;
    const name = item.trim();
    if (!name || names.some((brand) => brand.toLowerCase() === name.toLowerCase())) continue;
    names.push(name);
  }
  if (!names.some((brand) => brand.toLowerCase() === "hyundai")) names.unshift("Hyundai");
  return names.length ? names : ["Hyundai", "Geely"];
}

async function loadBrands() {
  try {
    const file = await gh(`/repos/${OWNER}/${REPO}/contents/brands.json?ref=${encodeURIComponent(BRANCH)}`);
    const parsed = JSON.parse(Buffer.from(file.content, "base64").toString("utf8"));
    return normalizeBrands(parsed.brands);
  } catch {
    return ["Hyundai", "Geely"];
  }
}

async function addBrand(raw) {
  const name = cleanBrand(raw);
  const tree = await gh(`/repos/${OWNER}/${REPO}/git/trees/${encodeURIComponent(BRANCH)}?recursive=1`);
  const entries = tree.tree || [];
  const current = await loadBrands();
  if (current.some((brand) => brand.toLowerCase() === name.toLowerCase())) return { ok: true, brands: current };
  const taken = entries.some((entry) => entry.type === "blob" && entry.path.split("/")[0].toLowerCase() === name.toLowerCase());
  if (taken) throw new Error("A folder already uses that name.");
  const brands = [...current, name];
  const blob = await gh(`/repos/${OWNER}/${REPO}/git/blobs`, {
    method: "POST",
    body: { content: Buffer.from(JSON.stringify({ brands }, null, 2) + "\n").toString("base64"), encoding: "base64" },
  });
  await commit([{ path: "brands.json", sha: blob.sha }], `Add brand ${name}`);
  return { ok: true, brands };
}

async function commit(treeItems, message, attempt = 0) {
  const head = await gh(`/repos/${OWNER}/${REPO}/commits/${encodeURIComponent(BRANCH)}`);
  const tree = await gh(`/repos/${OWNER}/${REPO}/git/trees`, {
    method: "POST",
    body: {
      base_tree: head.commit.tree.sha,
      tree: treeItems.map((item) => ({
        path: item.path,
        mode: "100644",
        type: "blob",
        sha: item.sha,
      })),
    },
  });
  const created = await gh(`/repos/${OWNER}/${REPO}/git/commits`, {
    method: "POST",
    body: { message, tree: tree.sha, parents: [head.sha] },
  });
  try {
    await gh(`/repos/${OWNER}/${REPO}/git/refs/heads/${encodeURIComponent(BRANCH)}`, {
      method: "PATCH",
      body: { sha: created.sha },
    });
  } catch (error) {
    if (attempt < 3 && /fast-forward|not a fast forward/i.test(error.message)) {
      return commit(treeItems, message, attempt + 1);
    }
    throw error;
  }
  await getStore({ name: "library", consistency: "strong" }).delete("index").catch(() => {});
}

async function gh(path, options = {}) {
  const token = process.env.GITHUB_TOKEN || "";
  if (!token) throw new Error("Uploads are not set up yet.");
  const response = await fetch(`https://api.github.com${path}`, {
    method: options.method || "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error((data && data.message) || "GitHub refused the upload.");
    throw error;
  }
  return data;
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
