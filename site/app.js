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

const sortNew = document.querySelector("#sort-new");
const sortName = document.querySelector("#sort-name");
const sortType = document.querySelector("#sort-type");
const libraryEl = document.querySelector(".library");
const selectMode = document.querySelector("#select-mode");
const selectShown = document.querySelector("#select-shown");
const copySelected = document.querySelector("#copy-selected");
const filtersEl = document.querySelector("#filters");

let library = [];
let queue = [];
let publishing = false;
let folderFilter = null;
let sortMode = "new";
let selecting = false;
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

function renderLibrary() {
  const shown = visibleFiles();
  const folders = [...new Set([
    ...library.map((file) => file.folder).filter(Boolean),
    ...extraFolders,
  ])].sort((a, b) => a.localeCompare(b));
  foldersEl.innerHTML = folders.length ? [
    { id: "all", label: "All" },
    { id: "root", label: "No folder" },
    ...folders.map((folder) => ({ id: folder, label: folder })),
  ].map((item) => `<button type="button" data-folder="${escapeAttr(item.id)}" class="${(item.id === "all" && folderFilter === null) || item.id === folderFilter || (item.id === "root" && folderFilter === "") ? "on" : ""}">${escapeHtml(item.label)}</button>`).join("") : "";
  filtersEl.innerHTML = [
    filterField("Model", unique("model"), modelFilter, "model"),
    filterField("Type", unique("type"), typeFilter, "type"),
    filterField("Language", unique("language"), languageFilter, "language"),
  ].join("");
  libraryEl.classList.toggle("selecting", selecting);
  selectMode.textContent = selecting ? "Done" : "Select";
  selectMode.classList.toggle("on", selecting);
  sortNew.classList.toggle("on", sortMode === "new");
  sortName.classList.toggle("on", sortMode === "name");
  sortType.classList.toggle("on", sortMode === "type");
  copySelected.disabled = selected.size === 0;
  copySelected.textContent = selected.size ? `Copy ${selected.size} links` : "Copy links";
  selectShown.textContent = shown.length && shown.every((file) => selected.has(file.path)) ? "Clear shown" : "Select shown";
  countEl.textContent = `${shown.length} of ${library.length} file${library.length === 1 ? "" : "s"}`;
  if (!shown.length) {
    pdfThumbRun += 1;
    grid.innerHTML = `<p class="empty">${library.length ? "Nothing matches." : "No files yet. Add one on the left."}</p>`;
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
        ${file.folder ? `<p class="folder-label">${escapeHtml(file.folder)}</p>` : ""}
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
  const shown = library.filter((file) => {
    const nameMatch = file.name.toLowerCase().includes(query) || file.folder.toLowerCase().includes(query) || file.model.toLowerCase().includes(query);
    if (!nameMatch) return false;
    if (folderFilter !== null && file.folder !== folderFilter) return false;
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
    return `<div class="file-tile pdf-label">PDF</div><canvas class="pdf-thumb" data-pdf="${escapeAttr(src)}" hidden></canvas>`;
  }
  return `<img alt="" src="${escapeAttr(src)}">`;
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

sortNew.addEventListener("click", () => { sortMode = "new"; renderLibrary(); });
sortName.addEventListener("click", () => { sortMode = "name"; renderLibrary(); });
sortType.addEventListener("click", () => { sortMode = "type"; renderLibrary(); });

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
});

foldersEl.addEventListener("dragover", (event) => {
  const button = event.target.closest("[data-folder]");
  if (!button || button.dataset.folder === "all") return;
  event.preventDefault();
  button.classList.add("hot");
});
foldersEl.addEventListener("dragleave", (event) => {
  const button = event.target.closest("[data-folder]");
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
  const button = event.target.closest("[data-folder]");
  if (!button || button.dataset.folder === "all") return;
  event.preventDefault();
  button.classList.remove("hot");
  const folder = button.dataset.folder === "root" ? "" : button.dataset.folder;
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
  const button = event.target.closest("[data-folder]");
  if (!button) return;
  folderFilter = button.dataset.folder === "all" ? null : button.dataset.folder === "root" ? "" : button.dataset.folder;
  renderLibrary();
});
search.addEventListener("input", renderLibrary);
loadLibrary();
