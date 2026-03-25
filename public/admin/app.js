const apiBase = window.APP_CONFIG.apiBase;
const page = document.body.dataset.page || 'filters';
let token = localStorage.getItem('adminToken') || '';
let state = {
  tags: [],
  filters: [],
  files: []
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

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
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

function renderFilterEditor() {
  const root = el('filtersList');
  if (!root) return;
  root.innerHTML = '';
  if (!state.filters.length) {
    root.innerHTML = '<div class="notice">Фильтров пока нет. Добавьте первый фильтр.</div>';
    return;
  }
  state.filters.forEach((f, index) => {
    const box = document.createElement('div');
    box.className = 'filter-item';
    box.innerHTML = `
      <div class="filter-head">
        <div>
          <label>Название</label>
          <input data-role="label" value="${escapeHtml(f.label)}" />
        </div>
        <div>
          <label>Тип</label>
          <select data-role="type">
            <option value="dropdown" ${f.type === 'dropdown' ? 'selected' : ''}>dropdown</option>
            <option value="checkbox" ${f.type === 'checkbox' ? 'selected' : ''}>checkbox</option>
          </select>
        </div>
        <div>
          <label>&nbsp;</label>
          <button class="secondary" data-role="remove" type="button">Удалить</button>
        </div>
      </div>
      <div class="filter-options ${f.type === 'dropdown' ? '' : 'hidden'}" data-role="optionsBox">
        <label>Опции (через запятую)</label>
        <input data-role="options" value="${escapeHtml((f.options || []).join(', '))}" />
      </div>
    `;
    const removeBtn = box.querySelector('[data-role="remove"]');
    if (removeBtn) {
      removeBtn.onclick = () => {
        state.filters.splice(index, 1);
        renderFilterEditor();
      };
    }
    const typeSelect = box.querySelector('[data-role="type"]');
    const optionsBox = box.querySelector('[data-role="optionsBox"]');
    if (typeSelect && optionsBox) {
      typeSelect.onchange = () => {
        optionsBox.classList.toggle('hidden', typeSelect.value !== 'dropdown');
      };
    }
    root.appendChild(box);
  });
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

  const dropdownFilters = state.filters.filter(f => f.type === 'dropdown');
  const checkboxFilters = state.filters.filter(f => f.type === 'checkbox');

  if (dropdownFilters.length) {
    const group = document.createElement('div');
    group.className = 'upload-filter-group';
    const title = document.createElement('div');
    title.className = 'upload-filter-group__title';
    title.textContent = 'Списки';
    group.appendChild(title);

    dropdownFilters.forEach(f => {
      const wrap = document.createElement('div');
      wrap.style.marginBottom = '12px';
      const label = document.createElement('label');
      label.textContent = f.label;
      wrap.appendChild(label);
      const sel = document.createElement('select');
      sel.dataset.filterId = f.id;
      const options = (f.options || []).map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
      sel.innerHTML = '<option value="">— не выбрано —</option>' + options;
      wrap.appendChild(sel);
      group.appendChild(wrap);
    });

    root.appendChild(group);
  }

  if (checkboxFilters.length) {
    const group = document.createElement('div');
    group.className = 'upload-filter-group';
    const title = document.createElement('div');
    title.className = 'upload-filter-group__title';
    title.textContent = 'Галочки';
    const row = document.createElement('div');
    row.className = 'checkbox-group';

    checkboxFilters.forEach(f => {
      const cb = document.createElement('label');
      cb.className = 'check';
      cb.innerHTML = `<input type="checkbox" data-filter-id="${escapeHtml(f.id)}" /> <span>${escapeHtml(f.label)}</span>`;
      row.appendChild(cb);
    });

    group.appendChild(title);
    group.appendChild(row);
    root.appendChild(group);
  }
}

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = Number(bytes || 0);
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
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
    const saveBtn = row.querySelector('[data-role="save"]');
    if (saveBtn) {
      saveBtn.onclick = async () => {
        const tagsInput = row.querySelector('[data-role="tags"]');
        const tags = (tagsInput?.value || '').split(',').map(s => s.trim()).filter(Boolean);
        await request(`/api/admin/files/${encodeURIComponent(file.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ tags })
        });
        await loadAdminData();
        notify('Сохранено');
      };
    }
    const deleteBtn = row.querySelector('[data-role="delete"]');
    if (deleteBtn) {
      deleteBtn.onclick = async () => {
        if (!confirm(`Удалить файл ${file.originalName}?`)) return;
        await request(`/api/admin/files/${encodeURIComponent(file.id)}`, { method: 'DELETE' });
        await loadAdminData();
        notify('Сохранено');
      };
    }
    root.appendChild(row);
  }
}

function collectFiltersFromEditor() {
  const root = el('filtersList');
  if (!root) return [];
  return [...root.querySelectorAll('.filter-item')].map((node, idx) => {
    const label = node.querySelector('[data-role="label"]').value.trim();
    const type = node.querySelector('[data-role="type"]').value;
    const id = label.toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '_').replace(/^_+|_+$/g, '') || `filter_${idx + 1}`;
    const obj = { id, label: label || id, type };
    if (type === 'dropdown') {
      obj.options = node.querySelector('[data-role="options"]').value.split(',').map(s => s.trim()).filter(Boolean);
    }
    return obj;
  });
}

function removeTag(tag) {
  state.tags = state.tags.filter(t => t.toLowerCase() !== tag.toLowerCase());
  const tagsList = el('tagsList');
  if (tagsList) tagsList.replaceChildren(renderTags(state.tags, removeTag));
  renderUploadArea();
}

function renderPageShell() {
  const meta = PAGE_META[page] || PAGE_META.filters;
  if (el('pageTitle')) el('pageTitle').textContent = meta.title;
  if (el('pageHint')) el('pageHint').textContent = meta.hint;
  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.toggle('active', link.dataset.page === page);
  });
}

function bindNav() {
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
  if (exists('logoutBtn')) el('logoutBtn').classList.remove('hidden');
  if (exists('loginBtn')) el('loginBtn').classList.add('hidden');
  if (exists('passwordInput')) el('passwordInput').value = '';
  renderUI();
}

function renderUI() {
  if (exists('tagsList')) el('tagsList').replaceChildren(renderTags(state.tags, removeTag));
  renderFilterEditor();
  renderUploadArea();
  renderFiles();
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
      await request('/api/admin/tags', { method: 'POST', body: JSON.stringify({ tags: state.tags }) });
      notify('Сохранено');
      await loadAdminData();
    });
  }

  if (exists('addFilterBtn')) {
    el('addFilterBtn').onclick = () => {
      state.filters.push({ id: `filter_${state.filters.length + 1}`, label: 'Новый фильтр', type: 'dropdown', options: ['Опция 1', 'Опция 2'] });
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
      const filterValues = {};
      document.querySelectorAll('#uploadFilters [data-filter-id]').forEach(node => {
        if (node.type === 'checkbox') filterValues[node.dataset.filterId] = node.checked;
        else filterValues[node.dataset.filterId] = node.value;
      });
      form.append('filterValues', JSON.stringify(filterValues));
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
        const etaText = total > 0 ? `, осталось ${formatDuration(remainingMs)}` : '';
        setUploadProgress(true, loaded, total, `${Math.round(pct)}% • ${formatBytes(loaded)} / ${formatBytes(total)}${etaText}`);
      };

      try {
        await requestWithProgress('/api/admin/upload', form, updateProgress);
        setUploadProgress(true, totalBytes, totalBytes, 'Загрузка завершена');
        filesInput.value = '';
        if (folderInput) folderInput.value = '';
        notify('Сохранено');
        await loadAdminData();
      } catch (err) {
        setUploadProgress(true, 0, totalBytes, `Ошибка: ${err.message || 'не удалось загрузить'}`);
        notify(err.message || 'Не удалось загрузить файлы');
      } finally {
        setTimeout(() => setUploadProgress(false), 1200);
      }
    });
  }

  if (exists('refreshFilesBtn')) {
    el('refreshFilesBtn').onclick = loadAdminData;
  }

  if (exists('reloadBtn')) {
    el('reloadBtn').onclick = loadAdminData;
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const target = e.target;
    if (!target || target.matches('textarea,[contenteditable="true"]')) return;
    if (page === 'files' && target.matches('[data-role="tags"]')) {
      e.preventDefault();
      target.closest('.file-item')?.querySelector('[data-role="save"]')?.click();
    }
  });
}

async function init() {
  renderPageShell();
  bindNav();
  bindActions();

  if (token) {
    try {
      await loadAdminData();
    } catch (err) {
      token = '';
      localStorage.removeItem('adminToken');
      const authStatus = el('authStatus');
      if (authStatus) {
        authStatus.textContent = 'Не авторизован';
        authStatus.className = 'status warning';
      }
      renderUI();
    }
  } else {
    renderUI();
    const authStatus = el('authStatus');
    if (authStatus) {
      authStatus.textContent = 'Не авторизован';
      authStatus.className = 'status warning';
    }
    if (exists('loginBtn')) el('loginBtn').classList.remove('hidden');
    if (exists('logoutBtn')) el('logoutBtn').classList.add('hidden');
  }
}

init().catch(err => {
  console.error(err);
  alert(err.message || 'Ошибка');
});
