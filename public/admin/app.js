const apiBase = window.APP_CONFIG.apiBase;
const page = document.body.dataset.page || 'filters';
let token = localStorage.getItem('adminToken') || '';
let state = {
  tags: [],
  filters: [],
  files: [],
  folders: []
};

const MAX_FOLDER_DEPTH = 3;

const PAGE_META = {
  filters: {
    title: 'Редактор фильтров',
    hint: 'Здесь редактируются теги и фильтры, которые потом увидит главная страница.'
  },
  upload: {
    title: 'Загрузка файлов',
    hint: 'Здесь можно загрузить несколько файлов сразу и назначить им теги и фильтры.'
  },
  files: {
    title: 'Удаление файлов',
    hint: 'Здесь можно редактировать теги файлов и удалять их.'
  },
  catalogs: {
    title: 'Каталоги',
    hint: 'Создавайте и удаляйте папки, чтобы удобно раскладывать файлы по каталогам.'
  }
};

const el = (id) => document.getElementById(id);
const exists = (id) => !!document.getElementById(id);

let toastTimer = null;
function notify(msg) {
  let toast = document.querySelector('.toast-message');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast-message';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1600);
}

function authHeaders(extra = {}) {
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

async function request(path, options = {}) {
  const res = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...authHeaders(options.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function requestWithProgress(path, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${apiBase}${path}`);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.responseType = 'text';
    xhr.upload.onprogress = (event) => {
      if (typeof onProgress === 'function') onProgress(event.loaded, event.total || 0);
    };
    xhr.onerror = () => reject(new Error('Ошибка сети'));
    xhr.onload = () => {
      let data = {};
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : {};
      } catch {
        data = {};
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || `HTTP ${xhr.status}`));
    };
    xhr.send(formData);
  });
}

function setUploadProgress(visible, loaded = 0, total = 0, text = '') {
  const wrap = el('uploadProgress');
  const bar = el('uploadProgressBar');
  const label = el('uploadProgressText');
  if (!wrap || !bar || !label) return;
  wrap.classList.toggle('hidden', !visible);
  const pct = total > 0 ? Math.min(100, Math.max(0, (loaded / total) * 100)) : 0;
  bar.style.width = `${pct}%`;
  label.textContent = text || `${Math.round(pct)}%`;
}

function formatDuration(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} сек`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return `${minutes} мин ${rest} сек`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours} ч ${mins} мин`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"]/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[s])).replace(/'/g, '&#39;');
}

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = Number(bytes || 0);
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function createFilterTemplate(label = 'Новый фильтр') {
  return {
    id: `filter_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    label,
    type: 'dropdown',
    options: ['Опция 1', 'Опция 2'],
    children: []
  };
}

function getFilterByPath(filters, path = []) {
  let current = { children: filters };
  for (const index of path) {
    if (!current || !Array.isArray(current.children) || !current.children[index]) return null;
    current = current.children[index];
  }
  return current;
}

function getKnownFolders() {
  return [...new Set(state.files.map(file => String(file.folder || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
}

function renderFolderSuggestions() {
  const root = el('folderSuggestions');
  if (!root) return;
  root.innerHTML = '';
  const folders = getKnownFolders();
  const first = document.createElement('option');
  first.value = '';
  first.label = folders.length ? 'Без папки' : 'Папок пока нет';
  root.appendChild(first);
  for (const folder of folders) {
    const opt = document.createElement('option');
    opt.value = folder;
    root.appendChild(opt);
  }
}

function isFolderAllowed(folder) {
  const cleaned = String(folder ?? '').trim().replace(/\\/g, '/');
  if (!cleaned) return true;
  const parts = cleaned.split('/').filter(Boolean);
  return parts.length <= MAX_FOLDER_DEPTH && !cleaned.includes('..');
}

function renderTags(list, onDelete) {
  const wrap = document.createDocumentFragment();
  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'notice';
    empty.textContent = 'Тегов пока нет. Добавьте первый тег.';
    wrap.appendChild(empty);
    return wrap;
  }
  for (const tag of list) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `<span>${escapeHtml(tag)}</span>`;
    const btn = document.createElement('button');
    btn.textContent = '×';
    btn.title = 'Удалить';
    btn.type = 'button';
    btn.onclick = () => onDelete(tag);
    chip.appendChild(btn);
    wrap.appendChild(chip);
  }
  return wrap;
}

function renderTagCheckboxes(list) {
  const wrap = document.createDocumentFragment();
  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'notice';
    empty.textContent = 'Сначала добавьте теги в редакторе фильтров.';
    wrap.appendChild(empty);
    return wrap;
  }
  const box = document.createElement('div');
  box.className = 'checkbox-row';
  for (const tag of list) {
    const item = document.createElement('label');
    item.className = 'check';
    item.innerHTML = `<input type="checkbox" data-tag="${escapeHtml(tag)}" /> <span>${escapeHtml(tag)}</span>`;
    box.appendChild(item);
  }
  wrap.appendChild(box);
  return wrap;
}

function renderFilterNode(filter, container, depth = 0, parentList = state.filters, path = []) {
  const node = document.createElement('div');
  node.className = 'filter-node';
  node.dataset.depth = String(depth);
  node.dataset.path = path.join('.');

  const row = document.createElement('div');
  row.className = 'filter-item filter-item--tree';
  row.style.setProperty('--depth', String(depth));
  row.innerHTML = `
    <div class="filter-head filter-head--tree">
      <div class="filter-tree-label">
        <span class="filter-tree-indent" aria-hidden="true"></span>
        <div>
          <label>Название</label>
          <input data-role="label" value="${escapeHtml(filter.label)}" />
        </div>
      </div>
      <div>
        <label>Тип</label>
        <select data-role="type">
          <option value="dropdown" ${filter.type === 'dropdown' ? 'selected' : ''}>dropdown</option>
          <option value="checkbox" ${filter.type === 'checkbox' ? 'selected' : ''}>checkbox</option>
        </select>
      </div>
      <div>
        <label>Опции</label>
        <input data-role="options" value="${escapeHtml((filter.options || []).join(', '))}" placeholder="Опция 1, Опция 2" />
      </div>
    </div>
    <div class="filter-actions">
      <button class="secondary" data-role="add-child" type="button">+ Подфильтр</button>
      <button class="secondary" data-role="remove" type="button">Удалить</button>
    </div>
  `;

  const typeSelect = row.querySelector('[data-role="type"]');
  const optionsInput = row.querySelector('[data-role="options"]');
  const toggleOptions = () => {
    optionsInput.disabled = typeSelect.value !== 'dropdown';
    row.classList.toggle('is-checkbox', typeSelect.value === 'checkbox');
  };
  typeSelect.addEventListener('change', toggleOptions);
  toggleOptions();

  row.querySelector('[data-role="remove"]').onclick = () => {
    const idx = parentList.indexOf(filter);
    if (idx !== -1) parentList.splice(idx, 1);
    renderFilterEditor();
  };

  row.querySelector('[data-role="add-child"]').onclick = async () => {
    await persistFilterDraft(true);
    const target = getFilterByPath(state.filters, path);
    if (!target) return;
    target.children = Array.isArray(target.children) ? target.children : [];
    target.children.push(createFilterTemplate('Дочерний фильтр'));
    renderFilterEditor();
  };

  node.appendChild(row);
  const children = document.createElement('div');
  children.className = 'filter-children';
  if (Array.isArray(filter.children) && filter.children.length) {
    filter.children.forEach((child, index) => renderFilterNode(child, children, depth + 1, filter.children, [...path, index]));
  }
  node.appendChild(children);
  container.appendChild(node);
}

function renderFilterEditor() {
  const root = el('filtersList');
  if (!root) return;
  root.innerHTML = '';
  if (!state.filters.length) {
    root.innerHTML = '<div class="notice">Фильтров пока нет. Добавьте первый фильтр.</div>';
    return;
  }
  const shell = document.createElement('div');
  shell.className = 'filter-table';
  const head = document.createElement('div');
  head.className = 'filter-table__head';
  head.innerHTML = '<div>Название</div><div>Тип</div><div>Опции</div>';
  shell.appendChild(head);
  const body = document.createElement('div');
  body.className = 'filter-table__body';
  state.filters.forEach((filter, index) => renderFilterNode(filter, body, 0, state.filters, [index]));
  shell.appendChild(body);
  root.appendChild(shell);
}

function collectFiltersFromEditor() {
  const root = el('filtersList');
  if (!root) return [];

  const collectNodes = (container) => {
    const items = [];
    [...container.children].forEach(node => {
      if (!node.classList.contains('filter-node')) return;
      const label = node.querySelector('[data-role="label"]').value.trim();
      const type = node.querySelector('[data-role="type"]').value;
      const optionsValue = node.querySelector('[data-role="options"]').value;
      const idBase = label.toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '_').replace(/^_+|_+$/g, '');
      const id = idBase || `filter_${items.length + 1}`;
      const obj = {
        id,
        label: label || id,
        type
      };
      if (type === 'dropdown') {
        obj.options = optionsValue.split(',').map(s => s.trim()).filter(Boolean);
      }
      const childContainer = node.querySelector(':scope > .filter-children');
      const children = childContainer ? collectNodes(childContainer) : [];
      if (children.length) obj.children = children;
      items.push(obj);
    });
    return items;
  };

  return collectNodes(root.querySelector('.filter-table__body') || root);
}

async function persistFilterDraft(silent = false) {
  if (!exists('filtersList')) return;
  if (!el('filtersList').querySelector('.filter-node')) return;
  state.filters = collectFiltersFromEditor();
  await request('/api/admin/filters', { method: 'POST', body: JSON.stringify({ filters: state.filters }) });
  if (!silent) notify('Черновик фильтров сохранён');
}

function renderUploadArea() {
  const tagsRoot = el('uploadTags');
  if (tagsRoot) tagsRoot.replaceChildren(renderTagCheckboxes(state.tags));
  renderFolderSuggestions();

  const root = el('uploadFilters');
  if (!root) return;
  root.innerHTML = '';
  if (!state.filters.length) {
    root.innerHTML = '<div class="notice">Сначала создайте фильтры в редакторе.</div>';
    return;
  }

  const renderControl = (filter, depth = 0) => {
    const details = document.createElement('details');
    details.className = 'filter-accordion';
    if (depth < 1) details.open = true;

    const summary = document.createElement('summary');
    summary.innerHTML = `<span>${escapeHtml(filter.label)}</span><span class="muted">${escapeHtml(filter.type)}</span>`;
    details.appendChild(summary);

    const body = document.createElement('div');
    body.className = 'filter-accordion__body';
    if (filter.type === 'dropdown') {
      const wrap = document.createElement('div');
      wrap.innerHTML = `<label>${escapeHtml(filter.label)}</label>`;
      const sel = document.createElement('select');
      sel.dataset.filterId = filter.id;
      sel.innerHTML = '<option value="">— не выбрано —</option>' + (filter.options || []).map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
      wrap.appendChild(sel);
      body.appendChild(wrap);
    } else {
      const cb = document.createElement('label');
      cb.className = 'check';
      cb.innerHTML = `<input type="checkbox" data-filter-id="${escapeHtml(filter.id)}" /> <span>${escapeHtml(filter.label)}</span>`;
      body.appendChild(cb);
    }

    if (Array.isArray(filter.children) && filter.children.length) {
      const nested = document.createElement('div');
      nested.className = 'filter-accordion__nested';
      filter.children.forEach(child => nested.appendChild(renderControl(child, depth + 1)));
      body.appendChild(nested);
    }

    details.appendChild(body);
    return details;
  };

  state.filters.forEach(filter => root.appendChild(renderControl(filter)));
}

function renderFiles() {
  const root = el('filesList');
  if (!root) return;
  root.innerHTML = '';
  if (!state.files.length) {
    root.innerHTML = '<div class="notice">Файлов пока нет.</div>';
    return;
  }
  for (const file of state.files) {
    const row = document.createElement('div');
    row.className = 'file-item';
    row.innerHTML = `
      <strong>${escapeHtml(file.originalName)}</strong>
      <div class="meta">
        <span>Папка: ${escapeHtml(file.folder || '—')}</span>
        <span>Размер: ${formatBytes(file.size || 0)}</span>
        <span>Теги: ${(file.tags || []).map(escapeHtml).join(', ') || '—'}</span>
      </div>
      <div style="margin-top: 10px">
        <label>Теги файла (через запятую)</label>
        <input data-role="tags" value="${escapeHtml((file.tags || []).join(', '))}" />
      </div>
      <div class="actions">
        <button class="primary" data-role="save" type="button">Сохранить теги</button>
        <button class="secondary" data-role="delete" type="button">Удалить файл</button>
      </div>
    `;
    row.querySelector('[data-role="save"]').onclick = async () => {
      const tagsInput = row.querySelector('[data-role="tags"]');
      const tags = (tagsInput?.value || '').split(',').map(s => s.trim()).filter(Boolean);
      await request(`/api/admin/files/${encodeURIComponent(file.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ tags })
      });
      await loadAdminData();
      notify('Сохранено');
    };
    row.querySelector('[data-role="delete"]').onclick = async () => {
      if (!confirm(`Удалить файл ${file.originalName}?`)) return;
      await request(`/api/admin/files/${encodeURIComponent(file.id)}`, { method: 'DELETE' });
      await loadAdminData();
      notify('Удалено');
    };
    root.appendChild(row);
  }
}

function renderCatalogsPage() {
  const root = el('catalogsList');
  if (!root) return;
  const searchValue = (el('catalogSearch')?.value || '').trim().toLowerCase();
  const folders = (state.folders || []).filter(folder => !searchValue || folder.path.toLowerCase().includes(searchValue));
  root.innerHTML = '';

  if (!folders.length) {
    root.innerHTML = '<div class="notice">Папок пока нет. Создайте первый каталог ниже.</div>';
    return;
  }

  const tree = document.createElement('div');
  tree.className = 'catalog-tree';
  folders.forEach(folder => {
    const row = document.createElement('div');
    row.className = 'catalog-row';
    row.style.paddingLeft = `${12 + Math.max(0, folder.depth - 1) * 18}px`;
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(folder.path)}</strong>
        <div class="muted small">${folder.fileCount} файлов · ${folder.childCount} вложенных</div>
      </div>
    `;
    const actions = document.createElement('div');
    actions.className = 'catalog-row__actions';
    const btn = document.createElement('button');
    btn.className = 'secondary';
    btn.type = 'button';
    btn.textContent = 'Удалить';
    btn.onclick = async () => {
      if (!confirm(`Удалить каталог ${folder.path}?`)) return;
      await request('/api/admin/folders', { method: 'DELETE', body: JSON.stringify({ path: folder.path }) });
      await loadAdminData();
      notify('Каталог удалён');
    };
    actions.appendChild(btn);
    row.appendChild(actions);
    tree.appendChild(row);
  });

  root.appendChild(tree);
}

function renderPageShell() {
  const meta = PAGE_META[page] || PAGE_META.filters;
  if (el('pageTitle')) el('pageTitle').textContent = meta.title;
  if (el('pageHint')) el('pageHint').textContent = meta.hint;
  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.toggle('active', link.dataset.page === page);
  });
}

async function loadAdminData() {
  const data = await request('/api/admin/config');
  state.tags = data.tags || [];
  state.filters = data.filters || [];
  state.files = data.files || [];
  const authStatus = el('authStatus');
  if (authStatus) {
    authStatus.textContent = 'Авторизован';
    authStatus.className = 'status ok';
  }
  el('logoutBtn')?.classList.remove('hidden');
  el('loginBtn')?.classList.add('hidden');
  if (exists('passwordInput')) el('passwordInput').value = '';

  if (page === 'catalogs') {
    const foldersData = await request('/api/admin/folders');
    state.folders = foldersData.folders || [];
  }

  renderUI();
}

function renderUI() {
  if (exists('tagsList')) el('tagsList').replaceChildren(renderTags(state.tags, removeTag));
  renderFilterEditor();
  renderUploadArea();
  renderFiles();
  renderCatalogsPage();
}

async function refreshAll() {
  if (!token) {
    const authStatus = el('authStatus');
    if (authStatus) {
      authStatus.textContent = 'Не авторизован';
      authStatus.className = 'status warning';
    }
    renderUI();
    return;
  }
  await loadAdminData();
}

function removeTag(tag) {
  state.tags = state.tags.filter(t => t.toLowerCase() !== tag.toLowerCase());
  const tagsList = el('tagsList');
  if (tagsList) tagsList.replaceChildren(renderTags(state.tags, removeTag));
  renderUploadArea();
}

async function saveTags() {
  await request('/api/admin/tags', { method: 'POST', body: JSON.stringify({ tags: state.tags }) });
  notify('Сохранено');
  await loadAdminData();
}

function collectUploadFilters() {
  const filterValues = {};
  document.querySelectorAll('#uploadFilters [data-filter-id]').forEach(node => {
    if (node.type === 'checkbox') filterValues[node.dataset.filterId] = node.checked;
    else filterValues[node.dataset.filterId] = node.value;
  });
  return filterValues;
}

function bindActions() {
  if (exists('loginForm')) {
    el('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const password = el('passwordInput').value;
        const data = await request('/api/admin/login', {
          method: 'POST',
          body: JSON.stringify({ password })
        });
        token = data.token;
        localStorage.setItem('adminToken', token);
        await loadAdminData();
      } catch (err) {
        alert(err.message || 'Ошибка входа');
      }
    });
  }

  if (exists('logoutBtn')) {
    el('logoutBtn').onclick = () => {
      token = '';
      localStorage.removeItem('adminToken');
      const authStatus = el('authStatus');
      if (authStatus) {
        authStatus.textContent = 'Не авторизован';
        authStatus.className = 'status warning';
      }
      el('loginBtn')?.classList.remove('hidden');
      el('logoutBtn')?.classList.add('hidden');
      renderUI();
    };
  }

  if (exists('addTagBtn')) {
    el('addTagBtn').onclick = () => {
      const input = el('newTagInput');
      const v = input?.value.trim();
      if (!v) return;
      if (!state.tags.some(t => t.toLowerCase() === v.toLowerCase())) state.tags.push(v);
      if (input) input.value = '';
      if (exists('tagsList')) el('tagsList').replaceChildren(renderTags(state.tags, removeTag));
      renderUploadArea();
    };
  }

  if (exists('saveTagsBtn')) {
    el('tagsForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      await saveTags();
    });
  }

  if (exists('addFilterBtn')) {
    el('addFilterBtn').onclick = async () => {
      await persistFilterDraft(true);
      state.filters.push(createFilterTemplate());
      renderFilterEditor();
    };
  }

  if (exists('saveFiltersBtn')) {
    el('filtersForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      state.filters = collectFiltersFromEditor();
      await request('/api/admin/filters', { method: 'POST', body: JSON.stringify({ filters: state.filters }) });
      notify('Сохранено');
      await loadAdminData();
    });
  }

  if (exists('uploadBtn')) {
    el('uploadForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const filesInput = el('uploadFiles');
      if (!filesInput || !filesInput.files.length) return alert('Выберите файлы');

      const folderInput = el('uploadFolder');
      const folderValue = folderInput?.value.trim() || '';
      if (!isFolderAllowed(folderValue)) {
        alert(`Папка должна быть не глубже ${MAX_FOLDER_DEPTH} уровней`);
        return;
      }

      const form = new FormData();
      form.append('folder', folderValue);
      const selectedTags = [...document.querySelectorAll('#uploadTags input[type="checkbox"]:checked')].map(i => i.dataset.tag);
      form.append('tags', JSON.stringify(selectedTags));
      form.append('filterValues', JSON.stringify(collectUploadFilters()));
      const files = [...filesInput.files];
      files.forEach(file => form.append('files', file));

      const totalBytes = files.reduce((sum, file) => sum + (file.size || 0), 0);
      const startedAt = Date.now();
      setUploadProgress(true, 0, totalBytes, 'Подготовка к загрузке…');

      const updateProgress = (loaded, total) => {
        const pct = total > 0 ? Math.min(100, (loaded / total) * 100) : 0;
        const elapsedSec = Math.max(0.001, (Date.now() - startedAt) / 1000);
        const speed = loaded / elapsedSec;
        const remainingMs = speed > 0 ? ((total - loaded) / speed) * 1000 : 0;
        const etaText = remainingMs > 1000 ? ` · осталось ${formatDuration(remainingMs)}` : '';
        setUploadProgress(true, loaded, total, `${Math.round(pct)}% · ${formatBytes(loaded)} / ${formatBytes(total)}${etaText}`);
      };

      try {
        const result = await requestWithProgress('/api/admin/upload', form, updateProgress);
        setUploadProgress(false);
        notify(`Загружено файлов: ${result.saved || files.length}`);
        await loadAdminData();
        el('uploadForm').reset();
        renderUploadArea();
      } catch (err) {
        setUploadProgress(false);
        alert(err.message || 'Ошибка загрузки');
      }
    });
  }

  if (exists('reloadBtn')) {
    el('reloadBtn').onclick = refreshAll;
  }

  if (exists('catalogCreateForm')) {
    el('catalogCreateForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = el('catalogPathInput');
      const pathValue = input?.value.trim() || '';
      if (!pathValue) return;
      if (!isFolderAllowed(pathValue)) {
        alert(`Папка должна быть не глубже ${MAX_FOLDER_DEPTH} уровней`);
        return;
      }
      await request('/api/admin/folders', { method: 'POST', body: JSON.stringify({ path: pathValue }) });
      if (input) input.value = '';
      await loadAdminData();
      notify('Каталог создан');
    });
  }

  if (exists('catalogSearch')) {
    el('catalogSearch').addEventListener('input', renderCatalogsPage);
  }

  if (exists('refreshCatalogsBtn')) {
    el('refreshCatalogsBtn').onclick = loadAdminData;
  }
}

renderPageShell();
bindActions();

(async () => {
  if (token) {
    try {
      await loadAdminData();
      return;
    } catch {
      token = '';
      localStorage.removeItem('adminToken');
    }
  }
  const authStatus = el('authStatus');
  if (authStatus) {
    authStatus.textContent = 'Не авторизован';
    authStatus.className = 'status warning';
  }
  renderUI();
})();
