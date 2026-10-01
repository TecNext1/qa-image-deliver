import { getStore } from "@netlify/blobs";

const OWNER = "TecNext1";
const REPO = "qa-image-deliver";
const BRANCH = "main";
const ALLOWED = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "ico", "bmp", "tif", "tiff", "heic", "heif", "pdf"]);

export default async () => {
  try {
    const files = await loadFiles();
    return json(200, files);
  } catch (error) {
    return json(500, { error: error.message || "Could not load the library." });
  }
};

export const config = { path: "/api/library" };

async function loadFiles() {
  const bucket = getStore({ name: "library", consistency: "strong" });
  const cachedText = await bucket.get("index", { type: "text" }).catch(() => null);
  if (cachedText) {
    const cached = JSON.parse(cachedText);
    if (Date.now() - cached.at < 60_000) return cached.files;
  }

  const tree = await gh(`/repos/${OWNER}/${REPO}/git/trees/${encodeURIComponent(BRANCH)}?recursive=1`);
  const files = (tree.tree || [])
    .filter((entry) => entry.type === "blob" && allowed(entry.path))
    .map((entry) => ({ path: entry.path, sha: entry.sha, size: entry.size || 0, date: "" }));

  const dates = await fileDates();
  for (const file of files) file.date = dates[file.path] || "";

  await bucket.set("index", JSON.stringify({ at: Date.now(), files })).catch(() => {});
  return files;
}

function allowed(path) {
  if (/^(site|netlify|scripts)\//.test(path) || path === "redirects.json") return false;
  const ext = path.includes(".") ? path.slice(path.lastIndexOf(".") + 1).toLowerCase() : "";
  return ALLOWED.has(ext);
}

async function fileDates() {
  const listed = await gh(`/repos/${OWNER}/${REPO}/commits?sha=${encodeURIComponent(BRANCH)}&per_page=100`);
  const dates = {};
  const commits = Array.isArray(listed) ? listed : [];
  for (let i = 0; i < commits.length; i += 8) {
    const slice = commits.slice(i, i + 8);
    await Promise.all(slice.map(async (commit) => {
      const when = commit.commit.committer.date;
      const detail = await gh(`/repos/${OWNER}/${REPO}/commits/${commit.sha}`);
      for (const file of detail.files || []) {
        if (!dates[file.filename]) dates[file.filename] = when;
      }
    }));
  }
  return dates;
}

async function gh(path) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetch(`https://api.github.com${path}`, { headers });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "GitHub did not return the library.");
  return data;
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
