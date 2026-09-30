const CFG = Object.assign(
  { owner: "TecNext1", repo: "qa-image-deliver", branch: "main" },
  window.CDN_CONFIG || {}
);

const MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED = ["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "ico", "bmp", "tif", "tiff", "heic", "heif", "pdf"];
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
const passwordInput = document.querySelector("#password");

let library = [];
let queue = [];
let publishing = false;

uploadNote.textContent = "The link uses the exact filename.";
passwordInput.value = sessionStorage.getItem("deliver-password") || "";
passwordInput.addEventListener("change", () => {
  sessionStorage.setItem("deliver-password", passwordInput.value);
});

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
    throw new Error(`${withExt} needs a file extension such as .png, .jpg, or .pdf.`);
  }
  return withExt;
}

async function gh(path, options = {}) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
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
  countEl.textContent = `${library.length} file${library.length === 1 ? "" : "s"}`;
  if (!shown.length) {
    grid.innerHTML = `<p class="empty">${library.length ? "No filenames match." : "No files yet. Add one on the left."}</p>`;
    return;
  }
  grid.innerHTML = shown.map((file) => `
    <article class="card" data-name="${escapeAttr(file.name)}">
      ${fileThumb(file.name, previewUrl(file.name, file.sha))}
      <div class="card-body">
        <h3>${escapeHtml(file.name)}</h3>
        <p class="url-preview">${escapeHtml(cdnUrl(file.name))}</p>
        <div class="card-actions">
          <button class="copy" type="button" data-copy="${escapeAttr(cdnUrl(file.name))}">Copy link</button>
          <button class="linkish" type="button" data-remove="${escapeAttr(file.name)}">Remove</button>
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
        ${item.preview ? `<img alt="" src="${item.preview}">` : `<div class="file-tile">PDF</div>`}
        <div>
          <div class="row-actions">
            <label for="name-${item.id}">Filename</label>
            <button class="linkish" type="button" data-drop-queue="${item.id}">Remove</button>
          </div>
          <input id="name-${item.id}" data-id="${item.id}" type="text" value="${escapeAttr(item.typed)}" placeholder="${escapeAttr(item.original)}">
          <p class="file-meta">${escapeHtml(item.original)} · ${formatSize(item.size)}</p>
          ${nameError ? `<p class="warn">${escapeHtml(nameError)}</p>` : `<p class="url-preview">${escapeHtml(url)}</p>`}
          ${exists ? `<p class="warn">This filename is already in the library. The public link can show the old file for up to 12 hours.</p>` : ""}
        </div>
      </li>
    `;
  }).join("");
  const ready = queue.length && queue.every((item) => {
    try { targetName(item.original, item.typed); return item.size <= MAX_BYTES; }
    catch { return false; }
  });
  publishBtn.disabled = publishing || !ready;
  publishBtn.textContent = queue.length > 1 ? `Publish ${queue.length} files` : "Publish";
}

function fileThumb(name, src) {
  if (extOf(name) === "pdf") return `<div class="file-tile">PDF</div>`;
  return `<img alt="" src="${escapeAttr(src)}">`;
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
      statusEl.textContent = `${file.name} is not a file type this page accepts.`;
      continue;
    }
    queue.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      file,
      original: file.name,
      typed: "",
      size: file.size,
      preview: extOf(file.name) === "pdf" ? "" : URL.createObjectURL(file),
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
  if (!passwordInput.value) {
    statusEl.textContent = "Enter the team password.";
    return;
  }
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
    for (const file of files) await uploadFile(file.path, file.file);
    statusEl.textContent = files.length === 1 ? `Published ${files[0].path}` : `Published ${files.length} files`;
    queue.forEach((item) => { if (item.preview) URL.revokeObjectURL(item.preview); });
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

async function api(body) {
  sessionStorage.setItem("deliver-password", passwordInput.value);
  const response = await fetch("/api/publish", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-upload-password": passwordInput.value,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Upload failed.");
  return data;
}

async function uploadFile(path, file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const chunkSize = 2 * 1024 * 1024;
  const total = Math.max(1, Math.ceil(bytes.length / chunkSize));
  const id = crypto.randomUUID();
  for (let index = 0; index < total; index += 1) {
    const slice = bytes.subarray(index * chunkSize, (index + 1) * chunkSize);
    await api({ action: "chunk", id, index, data: bytesToBase64(slice) });
  }
  await api({ action: "finish", id, path, total });
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
  if (!passwordInput.value) {
    statusEl.textContent = "Enter the team password.";
    return;
  }
  statusEl.textContent = `Removing ${remove.dataset.remove}…`;
  try {
    await api({ action: "delete", path: remove.dataset.remove });
    statusEl.textContent = `Removed ${remove.dataset.remove}`;
    await loadLibrary();
  } catch (error) {
    statusEl.textContent = error.message;
  }
});

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
