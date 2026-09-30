const CFG = Object.assign(
  { owner: "TecNext1", repo: "qa-image-deliver", branch: "main", token: "" },
  window.CDN_CONFIG || {}
);

const MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED = ["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "ico", "bmp", "tif", "tiff", "heic", "heif"];
const BLOCKED = new Set(["readme.md", "upload", ".gitignore", ".gitattributes", "netlify.toml"]);

const fileInput = document.querySelector("#file-input");
const drop = document.querySelector("#drop");
const queueEl = document.querySelector("#queue");
const publishBtn = document.querySelector("#publish");
const statusEl = document.querySelector("#status");
const grid = document.querySelector("#grid");
const search = document.querySelector("#search");
const countEl = document.querySelector("#count");
const uploadNote = document.querySelector("#upload-note");

let library = [];
let queue = [];
let publishing = false;

uploadNote.textContent = CFG.token
  ? "The link uses the exact filename."
  : "Uploads are off until GITHUB_TOKEN is set on Netlify. The library still works.";

function extOf(name) {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

function cdnUrl(name) {
  return `https://image-deliver.netlify.app/${encodeURIComponent(name)}`;
}

function previewUrl(name, sha) {
  const url = `https://raw.githubusercontent.com/${CFG.owner}/${CFG.repo}/${CFG.branch}/${encodeURIComponent(name)}`;
  return sha ? `${url}?v=${sha}` : url;
}

function targetName(original, typed) {
  const custom = (typed || "").trim();
  const name = custom || original;
  if (!name || name === "." || name === ".." || /[\\/]/.test(name)) {
    throw new Error("Use a plain filename.");
  }
  const withExt = name.includes(".") ? name : `${name}${original.includes(".") ? original.slice(original.lastIndexOf(".")) : ""}`;
  if (!ALLOWED.includes(extOf(withExt)) || BLOCKED.has(withExt.toLowerCase())) {
    throw new Error(`${withExt} needs an image extension such as .png or .jpg.`);
  }
  return withExt;
}

async function gh(path, options = {}) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (CFG.token) headers.Authorization = `Bearer ${CFG.token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`https://api.github.com${path}`, {
    method: options.method || "GET",
    headers,
    cache: "no-store",
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error((data && data.message) || response.statusText);
    error.status = response.status;
    throw error;
  }
  return data;
}

function bytesToBase64(bytes) {
  let binary = "";
  const size = 8192;
  for (let i = 0; i < bytes.length; i += size) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + size));
  }
  return btoa(binary);
}

async function loadLibrary() {
  grid.innerHTML = `<p class="empty">Loading images…</p>`;
  try {
    const entries = await gh(`/repos/${CFG.owner}/${CFG.repo}/contents/?ref=${encodeURIComponent(CFG.branch)}`);
    library = (Array.isArray(entries) ? entries : [])
      .filter((entry) => entry.type === "file" && ALLOWED.includes(extOf(entry.name)))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  } catch (error) {
    library = [];
    grid.innerHTML = `<p class="empty">Could not load the library. ${error.message}</p>`;
    return;
  }
  renderLibrary();
}

function renderLibrary() {
  const query = search.value.trim().toLowerCase();
  const shown = library.filter((file) => file.name.toLowerCase().includes(query));
  countEl.textContent = `${library.length} image${library.length === 1 ? "" : "s"}`;
  if (!shown.length) {
    grid.innerHTML = `<p class="empty">${library.length ? "No filenames match." : "No images yet. Add one on the left."}</p>`;
    return;
  }
  grid.innerHTML = shown.map((file) => `
    <article class="card" data-name="${escapeAttr(file.name)}">
      <img alt="" src="${escapeAttr(previewUrl(file.name, file.sha))}">
      <div class="card-body">
        <h3>${escapeHtml(file.name)}</h3>
        <p class="url-preview">${escapeHtml(cdnUrl(file.name))}</p>
        <div class="card-actions">
          <button class="copy" type="button" data-copy="${escapeAttr(cdnUrl(file.name))}">Copy link</button>
          ${CFG.token ? `<button class="linkish" type="button" data-remove="${escapeAttr(file.name)}" data-sha="${escapeAttr(file.sha)}">Remove</button>` : ""}
        </div>
      </div>
    </article>
  `).join("");
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function renderQueue() {
  queueEl.innerHTML = queue.map((item) => {
    let name = item.original;
    let nameError = "";
    try { name = targetName(item.original, item.typed); }
    catch (error) { nameError = error.message; }
    const exists = library.some((file) => file.name === name);
    const url = nameError ? "" : cdnUrl(name);
    return `
      <li>
        <img alt="" src="${item.preview}">
        <div>
          <div class="row-actions">
            <label for="name-${item.id}">Filename</label>
            <button class="linkish" type="button" data-drop-queue="${item.id}">Remove</button>
          </div>
          <input id="name-${item.id}" data-id="${item.id}" type="text" value="${escapeAttr(item.typed)}" placeholder="${escapeAttr(item.original)}">
          <p class="file-meta">${escapeHtml(item.original)} · ${formatSize(item.size)}</p>
          ${nameError ? `<p class="warn">${escapeHtml(nameError)}</p>` : `<p class="url-preview">${escapeHtml(url)}</p>`}
          ${exists ? `<p class="warn">This filename is already in the library. The public link can show the old image for up to 12 hours.</p>` : ""}
        </div>
      </li>
    `;
  }).join("");
  const ready = queue.length && queue.every((item) => {
    try { targetName(item.original, item.typed); return item.size <= MAX_BYTES; }
    catch { return false; }
  });
  publishBtn.disabled = publishing || !CFG.token || !ready;
  publishBtn.textContent = queue.length > 1 ? `Publish ${queue.length} images` : "Publish";
}

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function addFiles(fileList) {
  for (const file of fileList) {
    if (file.size > MAX_BYTES) {
      statusEl.textContent = `${file.name} is over 20 MB. jsDelivr will not serve it.`;
      continue;
    }
    if (!ALLOWED.includes(extOf(file.name))) {
      statusEl.textContent = `${file.name} is not an image type this page accepts.`;
      continue;
    }
    queue.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      file,
      original: file.name,
      typed: "",
      size: file.size,
      preview: URL.createObjectURL(file),
    });
  }
  statusEl.textContent = "";
  renderQueue();
}

fileInput.addEventListener("change", () => {
  addFiles(fileInput.files);
  fileInput.value = "";
});

["dragenter", "dragover"].forEach((eventName) => {
  drop.addEventListener(eventName, (event) => {
    event.preventDefault();
    drop.classList.add("hot");
  });
});

drop.addEventListener("dragleave", () => drop.classList.remove("hot"));
drop.addEventListener("drop", (event) => {
  event.preventDefault();
  drop.classList.remove("hot");
  addFiles(event.dataTransfer.files);
});

queueEl.addEventListener("input", (event) => {
  const item = queue.find((entry) => entry.id === event.target.dataset.id);
  if (!item) return;
  const start = event.target.selectionStart;
  const end = event.target.selectionEnd;
  item.typed = event.target.value;
  renderQueue();
  const field = queueEl.querySelector(`[data-id="${CSS.escape(item.id)}"]`);
  if (field) {
    field.focus();
    field.setSelectionRange(start, end);
  }
});

queueEl.addEventListener("click", (event) => {
  const button = event.target.closest("[data-drop-queue]");
  if (!button) return;
  queue = queue.filter((item) => item.id !== button.dataset.dropQueue);
  renderQueue();
});

publishBtn.addEventListener("click", publish);

async function publish() {
  if (!CFG.token) return;
  publishing = true;
  renderQueue();
  statusEl.textContent = "Publishing…";
  try {
    const files = queue.map((item) => ({
      path: targetName(item.original, item.typed),
      file: item.file,
    }));
    const names = new Set(files.map((file) => file.path));
    if (names.size !== files.length) throw new Error("Two files would get the same filename.");
    await commitFiles(files);
    statusEl.textContent = files.length === 1 ? `Published ${files[0].path}` : `Published ${files.length} images`;
    queue.forEach((item) => URL.revokeObjectURL(item.preview));
    queue = [];
    renderQueue();
    await loadLibrary();
  } catch (error) {
    statusEl.textContent = error.message;
  } finally {
    publishing = false;
    renderQueue();
  }
}

async function commitFiles(files, attempt = 0) {
  const blobs = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.file.arrayBuffer());
    const blob = await gh(`/repos/${CFG.owner}/${CFG.repo}/git/blobs`, {
      method: "POST",
      body: { content: bytesToBase64(bytes), encoding: "base64" },
    });
    blobs.push({ path: file.path, sha: blob.sha });
  }
  const head = await gh(`/repos/${CFG.owner}/${CFG.repo}/commits/${encodeURIComponent(CFG.branch)}`);
  const tree = await gh(`/repos/${CFG.owner}/${CFG.repo}/git/trees`, {
    method: "POST",
    body: {
      base_tree: head.commit.tree.sha,
      tree: blobs.map((blob) => ({ path: blob.path, mode: "100644", type: "blob", sha: blob.sha })),
    },
  });
  const message = files.length === 1
    ? `Publish ${files[0].path}`
    : `Publish ${files.length} images\n\n${files.map((file) => file.path).join("\n")}`;
  const commit = await gh(`/repos/${CFG.owner}/${CFG.repo}/git/commits`, {
    method: "POST",
    body: { message, tree: tree.sha, parents: [head.sha] },
  });
  try {
    await gh(`/repos/${CFG.owner}/${CFG.repo}/git/refs/heads/${encodeURIComponent(CFG.branch)}`, {
      method: "PATCH",
      body: { sha: commit.sha },
    });
  } catch (error) {
    if (attempt < 3 && /fast-forward|Update is not a fast forward/i.test(error.message)) {
      return commitFiles(files, attempt + 1);
    }
    throw error;
  }
}

grid.addEventListener("click", async (event) => {
  const copy = event.target.closest("[data-copy]");
  if (copy) {
    const ok = await copyText(copy.dataset.copy);
    const previous = copy.textContent;
    copy.textContent = ok ? "Copied" : "Copy failed";
    setTimeout(() => { copy.textContent = previous; }, 1600);
    return;
  }
  const remove = event.target.closest("[data-remove]");
  if (!remove) return;
  if (remove.dataset.armed !== "1") {
    remove.dataset.armed = "1";
    remove.textContent = "Confirm remove";
    return;
  }
  statusEl.textContent = `Removing ${remove.dataset.remove}…`;
  try {
    await deleteFile(remove.dataset.remove);
    statusEl.textContent = `Removed ${remove.dataset.remove}`;
    await loadLibrary();
  } catch (error) {
    statusEl.textContent = error.message;
  }
});

async function deleteFile(path, attempt = 0) {
  const head = await gh(`/repos/${CFG.owner}/${CFG.repo}/commits/${encodeURIComponent(CFG.branch)}`);
  const tree = await gh(`/repos/${CFG.owner}/${CFG.repo}/git/trees`, {
    method: "POST",
    body: { base_tree: head.commit.tree.sha, tree: [{ path, mode: "100644", type: "blob", sha: null }] },
  });
  const commit = await gh(`/repos/${CFG.owner}/${CFG.repo}/git/commits`, {
    method: "POST",
    body: { message: `Remove ${path}`, tree: tree.sha, parents: [head.sha] },
  });
  try {
    await gh(`/repos/${CFG.owner}/${CFG.repo}/git/refs/heads/${encodeURIComponent(CFG.branch)}`, {
      method: "PATCH",
      body: { sha: commit.sha },
    });
  } catch (error) {
    if (attempt < 3 && /fast-forward|Update is not a fast forward/i.test(error.message)) {
      return deleteFile(path, attempt + 1);
    }
    throw error;
  }
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    area.remove();
    return ok;
  }
}

search.addEventListener("input", renderLibrary);
loadLibrary();
