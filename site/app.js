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
const folderInput = document.querySelector("#folder");
const foldersEl = document.querySelector("#folders");
const newFolderForm = document.querySelector("#new-folder");
const newFolderOpen = document.querySelector("#new-folder-open");
const newFolderName = document.querySelector("#new-folder-name");
const newFolderSave = document.querySelector("#new-folder-save");
const folderBack = document.querySelector("#folder-back");
const libraryTitle = document.querySelector("#library-title");
const sortSelect = document.querySelector("#sort-mode");
const filterToggle = document.querySelector("#filter-toggle");
const moveTo = document.querySelector("#move-to");
const menu = document.querySelector("#menu");

const libraryEl = document.querySelector(".library");
const selectMode = document.querySelector("#select-mode");
const selectShown = document.querySelector("#select-shown");
const copySelected = document.querySelector("#copy-selected");
const filtersEl = document.querySelector("#filters");

let library = [];
let queue = [];
let publishing = false;
let currentFolder = null;
let sortMode = "new";
let selecting = false;
let filtersOpen = false;
let modelFilter = "";
let typeFilter = "";
let languageFilter = "";
const selected = new Set();
const extraFolders = new Set(JSON.parse(sessionStorage.getItem("deliver-folders") || "[]"));

uploadNote.textContent = "Leave the folder blank and existing links stay the same.";
passwordInput.value = sessionStorage.getItem("deliver-password") || "";
passwordInput.addEventListener("change", () => {
  sessionStorage.setItem("deliver-password", passwordInput.value);
});

function extOf(name) {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function cdnUrl(path) {
  return `https://image-deliver.netlify.app/${encodePath(path)}`;
}

function previewUrl(path, sha) {
  const url = `https://raw.githubusercontent.com/${CFG.owner}/${CFG.repo}/${CFG.branch}/${encodePath(path)}`;
  return sha ? `${url}?v=${sha}` : url;
}

function baseName(path) {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

function folderOf(path) {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

function cleanFolder(value) {
  const folder = (value || "").trim().replace(/^\/+|\/+$/g, "");
  if (!folder) return "";
  if (/[\\/]/.test(folder) || folder.includes("..") || folder === "." ) {
    throw new Error("Use one folder name, with no slashes.");
  }
  if (["site", "netlify", "scripts", ".github"].includes(folder.toLowerCase())) {
    throw new Error("Pick another folder name.");
  }
  return folder;
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
  grid.innerHTML = `<p class="empty">Loading files…</p>`;
  try {
    const response = await fetch("/api/library", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load the library.");
    library = data.map(decorate);
  } catch {
    try {
      const tree = await gh(`/repos/${CFG.owner}/${CFG.repo}/git/trees/${encodeURIComponent(CFG.branch)}?recursive=1`);
      library = (tree.tree || [])
        .filter((entry) => entry.type === "blob" && ALLOWED.includes(extOf(entry.path)) && !/^(site|netlify|scripts)\//.test(entry.path) && entry.path !== "redirects.json")
        .map((entry) => decorate({ ...entry, date: "" }));
    } catch (error) {
      library = [];
      grid.innerHTML = `<p class="empty">Could not load the library. ${error.message}</p>`;
      return;
    }
  }
  renderLibrary();
}

function decorate(entry) {
  const name = baseName(entry.path);
  const folder = folderOf(entry.path);
  return { ...entry, name, folder, ...fileMeta(name) };
}

function fileMeta(name) {
  const base = name.replace(/\.[^.]+$/, "").replace(/\s+$/, "");
  let language = "";
  if (/(^|[^a-z])(en|english)([^a-z]|$)/i.test(base)) language = "EN";
  else if (/(^|[^a-z])(ar|arabic)([^a-z]|$)/i.test(base)) language = "AR";
  let type = "";
  if (/offer\s*2/i.test(base)) type = "Offer 2";
  else if (/\boffer\b/i.test(base)) type = "Offer";
  else if (/brochure/i.test(base)) type = "Brochure";
  else if (/warranty/i.test(base)) type = "Warranty";
  else if (/maintenance/i.test(base)) type = "Maintenance";
  else if (/terms/i.test(base)) type = "Terms";
  let model = base.split(/\s+-\s+/)[0].replace(/\s+(en|ar|english|arabic)$/i, "").trim();
  if (/^(brochure|offer|warranty|maintenance|terms)/i.test(model)) model = "";
  return { model, type, language };
}

function folderNames() {
  return [...new Set([
    ...library.map((file) => file.folder).filter(Boolean),
    ...extraFolders,
  ])].sort((a, b) => a.localeCompare(b));
}

function renderLibrary() {
  const shown = visibleFiles();
  const query = search.value.trim().toLowerCase();
  const folders = currentFolder === null
    ? folderNames().filter((name) => !query || name.toLowerCase().includes(query))
    : [];
  foldersEl.innerHTML = folders.map((name) => {
    const count = library.filter((file) => file.folder === name).length;
    return `<div class="folder-card" role="button" tabindex="0" data-open="${escapeAttr(name)}" data-drop-folder="${escapeAttr(name)}">
      <span class="folder-glyph" aria-hidden="true"></span>
      <span class="folder-card-name">${escapeHtml(name)}</span>
      <span class="folder-card-count">${count} file${count === 1 ? "" : "s"}</span>
    </div>`;
  }).join("");
  foldersEl.hidden = folders.length === 0;
  folderBack.hidden = currentFolder === null;
  libraryTitle.textContent = currentFolder || "Library";
  filtersEl.hidden = !filtersOpen;
  filtersEl.innerHTML = [
    filterField("Model", unique("model"), modelFilter, "model"),
    filterField("Type", unique("type"), typeFilter, "type"),
    filterField("Language", unique("language"), languageFilter, "language"),
  ].join("");
  filterToggle.classList.toggle("on", filtersOpen || Boolean(modelFilter || typeFilter || languageFilter));
  filterToggle.textContent = modelFilter || typeFilter || languageFilter ? "Filter on" : "Filter";
  libraryEl.classList.toggle("selecting", selecting);
  selectMode.textContent = selecting ? "Done" : "Select";
  selectMode.classList.toggle("on", selecting);
  sortSelect.value = sortMode;
  moveTo.innerHTML = [
    `<option value="">Choose</option>`,
    ...folderNames().map((name) => `<option value="${escapeAttr(name)}">${escapeHtml(name)}</option>`),
    `<option value="__root">No folder</option>`,
  ].join("");
  copySelected.disabled = selected.size === 0;
  copySelected.textContent = selected.size ? `Copy ${selected.size} links` : "Copy links";
  selectShown.textContent = shown.length && shown.every((file) => selected.has(file.path)) ? "Clear shown" : "Select shown";
  const folderCount = currentFolder === null ? folderNames().length : 0;
  const fileLabel = `${shown.length} file${shown.length === 1 ? "" : "s"}`;
  countEl.textContent = folderCount ? `${folderCount} folder${folderCount === 1 ? "" : "s"} · ${fileLabel}` : fileLabel;
  if (!shown.length) {
    pdfThumbRun += 1;
    const message = !library.length
      ? "No files yet. Add one on the left."
      : currentFolder
        ? "This folder is empty."
        : query
          ? "Nothing matches."
          : "";
    grid.innerHTML = message ? `<p class="empty">${message}</p>` : "";
    return;
  }
  grid.innerHTML = shown.map((file) => {
    const badges = [file.type, file.language].filter(Boolean);
    const link = cdnUrl(file.path);
    return `
    <article class="card${selected.has(file.path) ? " is-on" : ""}" draggable="true" data-name="${escapeAttr(file.path)}">
      <div class="thumb">
        <label class="pick"><input type="checkbox" data-select="${escapeAttr(file.path)}" aria-label="Select ${escapeAttr(file.name)}" ${selected.has(file.path) ? "checked" : ""}></label>
        ${badges.length ? `<div class="badges">${badges.map((badge) => `<span class="badge">${escapeHtml(badge)}</span>`).join("")}</div>` : ""}
        ${fileThumb(file.name, previewUrl(file.path, file.sha))}
      </div>
      <div class="card-body">
        ${file.folder && currentFolder === null ? `<p class="folder-label">${escapeHtml(file.folder)}</p>` : ""}
        <h3 title="${escapeAttr(file.name)}">${escapeHtml(file.name)}</h3>
        <div class="card-actions">
          <button class="copy" type="button" data-copy="${escapeAttr(link)}" title="${escapeAttr(link)}">Copy link</button>
          <a class="open" href="${escapeAttr(link)}" target="_blank" rel="noopener">Open</a>
        </div>
        <div class="card-more">
          <button class="linkish" type="button" data-rename="${escapeAttr(file.path)}">Rename</button>
          <button class="linkish" type="button" data-remove="${escapeAttr(file.path)}">Remove</button>
        </div>
      </div>
    </article>
  `;
  }).join("");
  paintPdfThumbs();
}

function visibleFiles() {
  const query = search.value.trim().toLowerCase();
  const searchingEverywhere = currentFolder === null && query.length > 0;
  const shown = library.filter((file) => {
    const inView = searchingEverywhere || (currentFolder === null ? file.folder === "" : file.folder === currentFolder);
    if (!inView) return false;
    const nameMatch = !query || file.name.toLowerCase().includes(query) || file.folder.toLowerCase().includes(query) || file.model.toLowerCase().includes(query);
    if (!nameMatch) return false;
    if (modelFilter && file.model !== modelFilter) return false;
    if (typeFilter && file.type !== typeFilter) return false;
    if (languageFilter && file.language !== languageFilter) return false;
    return true;
  });
  shown.sort((a, b) => {
    if (sortMode === "new" && a.date !== b.date) return (b.date || "").localeCompare(a.date || "");
    if (sortMode === "type") {
      const typeCmp = (a.type || "\uffff").localeCompare(b.type || "\uffff");
      if (typeCmp) return typeCmp;
    }
    return a.name.localeCompare(b.name, undefined, { numeric: true });
  });
  return shown;
}

function unique(key) {
  return [...new Set(library.map((file) => file[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function filterField(label, values, current, kind) {
  if (values.length < 2) return "";
  const options = [`<option value="">All</option>`, ...values.map((value) => `<option value="${escapeAttr(value)}"${value === current ? " selected" : ""}>${escapeHtml(value)}</option>`)].join("");
  return `<label class="filter-field"><span>${escapeHtml(label)}</span><select data-kind="${kind}">${options}</select></label>`;
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
    let path = name;
    let pathError = nameError;
    if (!nameError) {
      try { path = publishPath(name); }
      catch (error) { pathError = error.message; }
    }
    const exists = library.some((file) => file.path === path);
    const url = pathError ? "" : cdnUrl(path);
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
          ${pathError ? `<p class="warn">${escapeHtml(pathError)}</p>` : `<p class="url-preview">${escapeHtml(url)}</p>`}
          ${exists ? `<p class="warn">This filename is already in the library. The public link can show the old file for up to 12 hours.</p>` : ""}
        </div>
      </li>
    `;
  }).join("");
  const ready = queue.length && queue.every((item) => {
    try { publishPath(targetName(item.original, item.typed)); return item.size <= MAX_BYTES; }
    catch { return false; }
  });
  publishBtn.disabled = publishing || !ready;
  publishBtn.textContent = queue.length > 1 ? `Publish ${queue.length} files` : "Publish";
}

function publishPath(filename) {
  const folder = cleanFolder(folderInput.value);
  return folder ? `${folder}/${filename}` : filename;
}

function fileThumb(name, src) {
  if (extOf(name) === "pdf") {
    return `<div class="file-tile pdf-label">PDF</div><canvas class="pdf-thumb" draggable="false" data-pdf="${escapeAttr(src)}" hidden></canvas>`;
  }
  return `<img alt="" draggable="false" src="${escapeAttr(src)}">`;
}

let pdfjsLib;
let pdfThumbRun = 0;

function loadPdfjs() {
  if (!pdfjsLib) {
    pdfjsLib = import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.min.mjs").then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.worker.min.mjs";
      return lib;
    });
  }
  return pdfjsLib;
}

function paintPdfThumbs() {
  const run = ++pdfThumbRun;
  const pending = [...grid.querySelectorAll("canvas.pdf-thumb")];
  const pump = async () => {
    while (pending.length && run === pdfThumbRun) await paintPdf(pending.shift(), run);
  };
  Promise.all([pump(), pump(), pump()]).catch(() => {});
}

async function paintPdf(canvas, run) {
  if (!canvas || run !== pdfThumbRun || !canvas.isConnected) return;
  try {
    const lib = await loadPdfjs();
    if (run !== pdfThumbRun || !canvas.isConnected) return;
    const doc = await lib.getDocument({
      url: canvas.dataset.pdf,
      cMapUrl: "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/standard_fonts/",
    }).promise;
    if (run !== pdfThumbRun || !canvas.isConnected) {
      await doc.destroy();
      return;
    }
    const page = await doc.getPage(1);
    const thumb = canvas.closest(".thumb");
    const boxW = thumb.clientWidth || 240;
    const boxH = thumb.clientHeight || 320;
    const ratio = window.devicePixelRatio || 1;
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(boxW / base.width, boxH / base.height) * ratio;
    const viewport = page.getViewport({ scale });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${Math.floor(viewport.width / ratio)}px`;
    canvas.style.height = `${Math.floor(viewport.height / ratio)}px`;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    if (run !== pdfThumbRun || !canvas.isConnected) {
      await doc.destroy();
      return;
    }
    canvas.hidden = false;
    canvas.previousElementSibling?.remove();
    await doc.destroy();
  } catch {
    /* The PDF label stays in place. */
  }
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
    for (const file of files) await uploadFile(publishPath(file.path), file.file);
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
  const rename = event.target.closest("[data-rename]");
  if (rename) {
    const card = rename.closest(".card");
    const input = card.querySelector(".rename-input");
    if (!input) {
      const field = document.createElement("input");
      field.className = "rename-input";
      field.value = baseName(rename.dataset.rename);
      card.querySelector("h3").replaceWith(field);
      rename.textContent = "Save";
      field.focus();
      return;
    }
    if (!passwordInput.value) {
      statusEl.textContent = "Enter the team password.";
      return;
    }
    const next = folderOf(rename.dataset.rename)
      ? `${folderOf(rename.dataset.rename)}/${targetName(baseName(rename.dataset.rename), input.value)}`
      : targetName(baseName(rename.dataset.rename), input.value);
    statusEl.textContent = `Renaming ${baseName(rename.dataset.rename)}…`;
    try {
      await api({ action: "rename", from: rename.dataset.rename, to: next });
      statusEl.textContent = `Renamed. The old link still opens this file.`;
      selected.delete(rename.dataset.rename);
      await loadLibrary();
    } catch (error) {
      statusEl.textContent = error.message;
    }
    return;
  }
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

grid.addEventListener("change", (event) => {
  const box = event.target.closest("[data-select]");
  if (!box) return;
  if (box.checked) selected.add(box.dataset.select);
  else selected.delete(box.dataset.select);
  box.closest(".card")?.classList.toggle("is-on", box.checked);
  copySelected.disabled = selected.size === 0;
  copySelected.textContent = selected.size ? `Copy ${selected.size} links` : "Copy links";
  const shown = visibleFiles();
  selectShown.textContent = shown.length && shown.every((file) => selected.has(file.path)) ? "Clear shown" : "Select shown";
});

sortSelect.addEventListener("change", () => { sortMode = sortSelect.value; renderLibrary(); });
filterToggle.addEventListener("click", () => { filtersOpen = !filtersOpen; renderLibrary(); });
folderBack.addEventListener("click", () => { currentFolder = null; renderLibrary(); });
moveTo.addEventListener("change", async () => {
  const dest = moveTo.value;
  if (!dest) return;
  const folder = dest === "__root" ? "" : dest;
  const paths = [...selected];
  moveTo.value = "";
  if (!paths.length) return;
  try {
    await moveFiles(paths, folder);
  } catch (error) {
    statusEl.textContent = error.message;
  }
});

let dragGhostEl = null;

function clearDrag() {
  document.querySelectorAll(".card.is-dragging").forEach((card) => card.classList.remove("is-dragging"));
  dragGhostEl?.remove();
  dragGhostEl = null;
  document.body.classList.remove("is-dragging-file");
}

function makeDragGhost(card, count) {
  const ghost = document.createElement("div");
  ghost.className = "drag-ghost";
  const media = card.querySelector(".thumb img, .thumb canvas, .thumb .file-tile");
  if (media?.tagName === "CANVAS") {
    const copy = document.createElement("canvas");
    copy.width = media.width;
    copy.height = media.height;
    copy.getContext("2d").drawImage(media, 0, 0);
    ghost.appendChild(copy);
  } else if (media?.tagName === "IMG") {
    const image = document.createElement("img");
    image.alt = "";
    image.src = media.currentSrc || media.src;
    ghost.appendChild(image);
  } else {
    const tile = document.createElement("div");
    tile.className = "file-tile";
    tile.textContent = "PDF";
    ghost.appendChild(tile);
  }
  const label = document.createElement("p");
  label.textContent = count > 1 ? `${count} files` : card.querySelector("h3").textContent;
  ghost.appendChild(label);
  document.body.appendChild(ghost);
  return ghost;
}

grid.addEventListener("dragstart", (event) => {
  const card = event.target.closest(".card");
  if (!card || event.target.closest("button, a, input, label")) {
    event.preventDefault();
    return;
  }
  const path = card.dataset.name;
  const paths = selected.has(path) && selected.size > 1 ? [...selected] : [path];
  event.dataTransfer.setData("text/plain", JSON.stringify(paths));
  event.dataTransfer.effectAllowed = "move";
  clearDrag();
  dragGhostEl = makeDragGhost(card, paths.length);
  event.dataTransfer.setDragImage(dragGhostEl, 84, 64);
  for (const item of paths) {
    grid.querySelector(`.card[data-name="${CSS.escape(item)}"]`)?.classList.add("is-dragging");
  }
  document.body.classList.add("is-dragging-file");
});

grid.addEventListener("dragend", clearDrag);

foldersEl.addEventListener("dragover", (event) => {
  const button = event.target.closest("[data-drop-folder]");
  if (!button) return;
  event.preventDefault();
  button.classList.add("hot");
});
foldersEl.addEventListener("dragleave", (event) => {
  const button = event.target.closest("[data-drop-folder]");
  if (button) button.classList.remove("hot");
});
async function moveFiles(paths, folder) {
  if (!passwordInput.value) {
    statusEl.textContent = "Enter the team password.";
    return false;
  }
  statusEl.textContent = "Moving…";
  for (const path of paths) {
    const next = folder ? `${folder}/${baseName(path)}` : baseName(path);
    if (next === path) continue;
    await api({ action: "rename", from: path, to: next });
    selected.delete(path);
  }
  statusEl.textContent = "Moved. The old link still opens the file.";
  await loadLibrary();
  return true;
}

function showNewFolder(open) {
  newFolderOpen.hidden = open;
  newFolderName.hidden = !open;
  newFolderSave.hidden = !open;
  if (open) newFolderName.focus();
}

foldersEl.addEventListener("drop", async (event) => {
  const button = event.target.closest("[data-drop-folder]");
  if (!button) return;
  event.preventDefault();
  button.classList.remove("hot");
  const folder = button.dataset.dropFolder;
  if (event.dataTransfer.files && event.dataTransfer.files.length) {
    folderInput.value = folder;
    addFiles(event.dataTransfer.files);
    statusEl.textContent = folder ? `These files will publish in ${folder}.` : "These files will publish with no folder.";
    renderQueue();
    return;
  }
  let paths = [];
  try { paths = JSON.parse(event.dataTransfer.getData("text/plain")); } catch { paths = []; }
  if (!Array.isArray(paths) || !paths.length) return;
  try {
    await moveFiles(paths, folder);
  } catch (error) {
    statusEl.textContent = error.message;
  }
});
selectMode.addEventListener("click", () => {
  selecting = !selecting;
  if (!selecting) selected.clear();
  renderLibrary();
});
selectShown.addEventListener("click", () => {
  const shown = visibleFiles();
  const allOn = shown.length && shown.every((file) => selected.has(file.path));
  for (const file of shown) {
    if (allOn) selected.delete(file.path);
    else selected.add(file.path);
  }
  renderLibrary();
});
copySelected.addEventListener("click", async () => {
  const links = [...selected].map((path) => cdnUrl(path)).join("\n");
  const ok = await copyText(links);
  copySelected.textContent = ok ? "Copied" : "Copy failed";
  setTimeout(renderLibrary, 1600);
});
filtersEl.addEventListener("change", (event) => {
  const field = event.target.closest("select[data-kind]");
  if (!field) return;
  if (field.dataset.kind === "model") modelFilter = field.value;
  if (field.dataset.kind === "type") typeFilter = field.value;
  if (field.dataset.kind === "language") languageFilter = field.value;
  renderLibrary();
});

folderInput.addEventListener("input", renderQueue);
newFolderOpen.addEventListener("click", () => showNewFolder(true));
newFolderForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  let name = "";
  try { name = cleanFolder(newFolderName.value); }
  catch (error) {
    statusEl.textContent = error.message;
    return;
  }
  if (!name) {
    statusEl.textContent = "Type a folder name.";
    return;
  }
  extraFolders.add(name);
  sessionStorage.setItem("deliver-folders", JSON.stringify([...extraFolders]));
  folderInput.value = name;
  currentFolder = name;
  renderQueue();
  newFolderName.value = "";
  showNewFolder(false);
  const paths = [...selected];
  if (!paths.length) {
    statusEl.textContent = `${name} is ready. Drag files onto it, or publish into it.`;
    renderLibrary();
    return;
  }
  try {
    await moveFiles(paths, name);
  } catch (error) {
    statusEl.textContent = error.message;
    renderLibrary();
  }
});
foldersEl.addEventListener("click", (event) => {
  if (event.target.closest("input") || folderRenameLock) return;
  const button = event.target.closest("[data-open]");
  if (!button) return;
  currentFolder = button.dataset.open;
  renderLibrary();
});
foldersEl.addEventListener("keydown", (event) => {
  if (event.target.closest("input")) return;
  if (event.key !== "Enter" && event.key !== " ") return;
  const button = event.target.closest("[data-open]");
  if (!button || event.target !== button) return;
  event.preventDefault();
  currentFolder = button.dataset.open;
  renderLibrary();
});

function rememberFolders() {
  sessionStorage.setItem("deliver-folders", JSON.stringify([...extraFolders]));
}

function filesInFolder(name) {
  return library.filter((file) => file.folder === name);
}

let folderRenameLock = false;

function beginFolderRename(name) {
  const card = foldersEl.querySelector(`[data-open="${CSS.escape(name)}"]`);
  const label = card?.querySelector(".folder-card-name");
  if (!label) return;
  const field = document.createElement("input");
  field.className = "rename-input";
  field.value = name;
  field.setAttribute("aria-label", `Rename ${name}`);
  field.addEventListener("click", (event) => event.stopPropagation());
  field.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      field.dataset.skip = "1";
      renderLibrary();
    }
    if (event.key === "Enter") {
      event.preventDefault();
      field.blur();
    }
  });
  field.addEventListener("blur", () => {
    if (field.dataset.skip === "1") return;
    commitFolderRename(name, field.value);
  });
  label.replaceWith(field);
  field.focus();
  field.select();
}

async function commitFolderRename(from, typed) {
  if (folderRenameLock) return;
  folderRenameLock = true;
  try {
    await renameFolder(from, typed);
  } finally {
    folderRenameLock = false;
  }
}

async function renameFolder(from, typed) {
  let to = "";
  try { to = cleanFolder(typed); }
  catch (error) {
    statusEl.textContent = error.message;
    renderLibrary();
    return;
  }
  if (!to || to === from) {
    renderLibrary();
    return;
  }
  if (folderNames().some((name) => name !== from && name.toLowerCase() === to.toLowerCase())) {
    statusEl.textContent = "A folder with that name already exists.";
    renderLibrary();
    return;
  }
  const paths = filesInFolder(from).map((file) => file.path);
  extraFolders.delete(from);
  extraFolders.add(to);
  rememberFolders();
  if (currentFolder === from) currentFolder = to;
  if (folderInput.value === from) folderInput.value = to;
  if (!paths.length) {
    statusEl.textContent = `Renamed to ${to}.`;
    renderLibrary();
    return;
  }
  if (!passwordInput.value) {
    extraFolders.delete(to);
    extraFolders.add(from);
    rememberFolders();
    if (currentFolder === to) currentFolder = from;
    if (folderInput.value === to) folderInput.value = from;
    statusEl.textContent = "Enter the team password.";
    renderLibrary();
    return;
  }
  try {
    await moveFiles(paths, to);
    statusEl.textContent = `Renamed to ${to}. The old links still open the files.`;
    renderLibrary();
  } catch (error) {
    statusEl.textContent = error.message;
    await loadLibrary();
    if (!filesInFolder(to).length) {
      extraFolders.delete(to);
      extraFolders.add(from);
      rememberFolders();
      if (currentFolder === to) currentFolder = from;
      if (folderInput.value === to) folderInput.value = from;
      renderLibrary();
    }
  }
}

async function deleteFolder(name) {
  const paths = filesInFolder(name).map((file) => file.path);
  if (!paths.length) {
    extraFolders.delete(name);
    rememberFolders();
    if (currentFolder === name) currentFolder = null;
    if (folderInput.value === name) folderInput.value = "";
    statusEl.textContent = `Removed ${name}.`;
    renderLibrary();
    return;
  }
  if (!passwordInput.value) {
    statusEl.textContent = "Enter the team password.";
    return;
  }
  statusEl.textContent = `Removing ${name}…`;
  try {
    for (const path of paths) await api({ action: "delete", path });
    extraFolders.delete(name);
    rememberFolders();
    if (currentFolder === name) currentFolder = null;
    if (folderInput.value === name) folderInput.value = "";
    statusEl.textContent = `Removed ${name} and ${paths.length} file${paths.length === 1 ? "" : "s"}.`;
    await loadLibrary();
  } catch (error) {
    statusEl.textContent = error.message;
    await loadLibrary();
  }
}

async function removeFiles(paths) {
  if (!passwordInput.value) {
    statusEl.textContent = "Enter the team password.";
    return;
  }
  statusEl.textContent = paths.length > 1 ? `Removing ${paths.length} files…` : `Removing ${paths[0]}…`;
  try {
    for (const path of paths) {
      await api({ action: "delete", path });
      selected.delete(path);
    }
    statusEl.textContent = paths.length > 1 ? `Removed ${paths.length} files.` : `Removed ${paths[0]}`;
    await loadLibrary();
  } catch (error) {
    statusEl.textContent = error.message;
    await loadLibrary();
  }
}

function closeMenu() {
  menu.hidden = true;
  menu.innerHTML = "";
  delete menu.dataset.kind;
  delete menu.dataset.folder;
  delete menu.dataset.paths;
  document.querySelectorAll(".is-menu-target").forEach((item) => item.classList.remove("is-menu-target"));
}

function placeMenu(event) {
  menu.hidden = false;
  const margin = 8;
  const rect = menu.getBoundingClientRect();
  const left = Math.max(margin, Math.min(event.clientX, window.innerWidth - rect.width - margin));
  const top = Math.max(margin, Math.min(event.clientY, window.innerHeight - rect.height - margin));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function fillMenu(title, meta, sections) {
  menu.innerHTML = [
    `<div class="menu-head"><p class="menu-title">${escapeHtml(title)}</p>${meta ? `<p class="menu-meta">${escapeHtml(meta)}</p>` : ""}</div>`,
    ...sections.filter(Boolean).map((section) => `<div class="menu-rule"></div>${section}`),
  ].join("");
}

function openFileMenu(event, card) {
  const path = card.dataset.name;
  const paths = selected.has(path) && selected.size > 1 ? [...selected] : [path];
  const destinations = folderNames().filter((name) => paths.some((item) => folderOf(item) !== name));
  const canLeave = paths.some((item) => folderOf(item));
  const moveItems = [
    ...destinations.map((name) => `<button type="button" data-act="move" data-dest="${escapeAttr(name)}">${escapeHtml(name)}</button>`),
    canLeave ? `<button type="button" data-act="move" data-dest="">Library</button>` : "",
  ].filter(Boolean);
  const many = paths.length > 1;
  fillMenu(
    many ? `${paths.length} files` : baseName(path),
    many ? "Actions apply to the selection" : (folderOf(path) || "Library"),
    [
      [
        many ? "" : `<button type="button" data-act="open">Open</button>`,
        `<button type="button" data-act="copy">${many ? "Copy links" : "Copy link"}</button>`,
      ].join(""),
      moveItems.length ? `<p class="menu-label">Move to</p>${moveItems.join("")}` : "",
      [
        many ? "" : `<button type="button" data-act="rename">Rename</button>`,
        `<button type="button" class="danger" data-act="remove">${many ? `Remove ${paths.length} files` : "Remove"}</button>`,
      ].join(""),
    ],
  );
  menu.dataset.kind = "file";
  menu.dataset.paths = JSON.stringify(paths);
  document.querySelectorAll(".is-menu-target").forEach((item) => item.classList.remove("is-menu-target"));
  for (const item of paths) {
    grid.querySelector(`.card[data-name="${CSS.escape(item)}"]`)?.classList.add("is-menu-target");
  }
  placeMenu(event);
}

function openFolderMenu(event, name) {
  const count = filesInFolder(name).length;
  fillMenu(name, count ? `${count} file${count === 1 ? "" : "s"}` : "Empty folder", [
    `<button type="button" data-act="open">Open</button>`,
    `<button type="button" data-act="rename">Rename</button><button type="button" class="danger" data-act="delete">Delete</button>`,
  ]);
  menu.dataset.kind = "folder";
  menu.dataset.folder = name;
  document.querySelectorAll(".is-menu-target").forEach((item) => item.classList.remove("is-menu-target"));
  foldersEl.querySelector(`[data-open="${CSS.escape(name)}"]`)?.classList.add("is-menu-target");
  placeMenu(event);
}

grid.addEventListener("contextmenu", (event) => {
  const card = event.target.closest(".card");
  if (!card) return;
  event.preventDefault();
  openFileMenu(event, card);
});

foldersEl.addEventListener("contextmenu", (event) => {
  const card = event.target.closest(".folder-card");
  if (!card) return;
  event.preventDefault();
  openFolderMenu(event, card.dataset.open);
});

menu.addEventListener("contextmenu", (event) => event.preventDefault());

menu.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-act]");
  if (!button) return;
  if (menu.dataset.kind === "folder") {
    const name = menu.dataset.folder;
    const action = button.dataset.act;
    if (action === "delete") {
      const count = filesInFolder(name).length;
      if (count && button.dataset.armed !== "1") {
        button.dataset.armed = "1";
        button.classList.add("armed");
        button.textContent = `Delete ${count} file${count === 1 ? "" : "s"}`;
        return;
      }
      closeMenu();
      await deleteFolder(name);
      return;
    }
    closeMenu();
    if (action === "open") {
      currentFolder = name;
      renderLibrary();
    }
    if (action === "rename") beginFolderRename(name);
    return;
  }
  const paths = JSON.parse(menu.dataset.paths || "[]");
  const path = paths[0];
  const action = button.dataset.act;
  if (action === "move") {
    const dest = button.dataset.dest;
    closeMenu();
    try {
      await moveFiles(paths, dest);
    } catch (error) {
      statusEl.textContent = error.message;
    }
    return;
  }
  if (action === "remove") {
    if (button.dataset.armed !== "1") {
      button.dataset.armed = "1";
      button.classList.add("armed");
      button.textContent = paths.length > 1 ? `Remove ${paths.length} files` : "Confirm remove";
      return;
    }
    closeMenu();
    await removeFiles(paths);
    return;
  }
  closeMenu();
  const card = grid.querySelector(`.card[data-name="${CSS.escape(path)}"]`);
  if (action === "open") window.open(cdnUrl(path), "_blank", "noopener");
  if (action === "copy") {
    const ok = await copyText(paths.map((item) => cdnUrl(item)).join("\n"));
    statusEl.textContent = ok ? "Copied." : "Copy failed.";
  }
  if (action === "rename") card?.querySelector("[data-rename]")?.click();
});

document.addEventListener("click", (event) => {
  if (!menu.hidden && !menu.contains(event.target)) closeMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMenu();
});
window.addEventListener("scroll", closeMenu, true);

search.addEventListener("input", renderLibrary);
loadLibrary();
