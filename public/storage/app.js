const apiBase = window.APP_CONFIG.apiBase;
let config = { tags: [], filters: [], folders: [] };
let state = {
  search: '',
  folder: '',
  tags: [],
  filters: {}
};

const el = (id) => document.getElementById(id);
const request = async (path, body) => {
  const res = await fetch(`${apiBase}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
};

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
}

async function loadConfig() {
  const res = await fetch(`${apiBase}/api/public/config`);
  config = await res.json();
  if (!config.ok) throw new Error('Не удалось загрузить конфигурацию');
  renderFilters();
  renderFolders();
  await applySearch();
}

function renderFilters() {
  const root = el('filtersArea');
  root.innerHTML = '';
  if (!config.filters.length && !config.tags.length) {
    root.innerHTML = '<div class="empty">Фильтры ещё не настроены в админке.</div>';
    return;
  }
  for (const filter of config.filters) {
    const box = document.createElement('div');
    box.className = 'filter-row';
    if (filter.type === 'dropdown') {
      box.innerHTML = `<label>${escapeHtml(filter.label)}</label>`;
      const sel = document.createElement('select');
      sel.dataset.filterId = filter.id;
      sel.innerHTML = '<option value="">— не выбрано —</option>' + (filter.options || []).map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
      sel.onchange = () => state.filters[filter.id] = sel.value;
      box.appendChild(sel);
      if (state.filters[filter.id]) sel.value = state.filters[filter.id];
    } else {
      const checked = !!state.filters[filter.id];
      box.innerHTML = `<label>${escapeHtml(filter.label)}</label>`;
      const cb = document.createElement('label');
      cb.className = 'check';
      cb.innerHTML = `<input type="checkbox" data-filter-id="${escapeHtml(filter.id)}" ${checked ? 'checked' : ''} /> <span>${escapeHtml(filter.label)}</span>`;
      cb.querySelector('input').onchange = () => {
        if (cb.querySelector('input').checked) state.filters[filter.id] = true;
        else delete state.filters[filter.id];
      };
      box.appendChild(cb);
    }
    root.appendChild(box);
  }

  if (config.tags.length) {
    const tagBox = document.createElement('div');
    tagBox.className = 'filter-row';
    tagBox.innerHTML = `<label>Теги</label>`;
    const tagsWrap = document.createElement('div');
    tagsWrap.className = 'checkbox-pills';
    for (const tag of config.tags) {
      const item = document.createElement('label');
      item.className = 'check';
      const checked = state.tags.includes(tag);
      item.innerHTML = `<input type="checkbox" ${checked ? 'checked' : ''} /> <span>${escapeHtml(tag)}</span>`;
      item.querySelector('input').onchange = () => {
        if (item.querySelector('input').checked) {
          if (!state.tags.includes(tag)) state.tags.push(tag);
        } else {
          state.tags = state.tags.filter(t => t.toLowerCase() !== tag.toLowerCase());
        }
      };
      tagsWrap.appendChild(item);
    }
    tagBox.appendChild(tagsWrap);
    root.appendChild(tagBox);
  }
}

function renderFolders() {
  const root = el('foldersTree');
  root.innerHTML = '';
  const allBtn = document.createElement('button');
  allBtn.className = `folder-item ${!state.folder ? 'active' : ''}`;
  allBtn.textContent = 'Все папки';
  allBtn.onclick = () => { state.folder = ''; setFolderUI(); applySearch(); };
  root.appendChild(allBtn);
  if (!config.folders.length) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.style.padding = '8px 2px';
    empty.textContent = 'Папок пока нет';
    root.appendChild(empty);
  } else {
    for (const folder of config.folders) {
      const btn = document.createElement('button');
      btn.className = `folder-item ${state.folder === folder ? 'active' : ''}`;
      btn.textContent = folder;
      btn.onclick = () => { state.folder = folder; setFolderUI(); applySearch(); };
      root.appendChild(btn);
    }
  }
  setFolderUI();
}

function setFolderUI() {
  const select = el('folderSelect');
  select.value = state.folder;
  document.querySelectorAll('.folder-item').forEach(btn => btn.classList.toggle('active', btn.textContent === (state.folder || 'Все папки')));
}

function groupFilesByFolder(files) {
  const groups = new Map();
  for (const file of files) {
    const key = file.folder || 'Без папки';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(file);
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ru'));
}

function renderResults(files) {
  el('resultCount').textContent = `${files.length} файлов`;
  const root = el('results');
  root.innerHTML = '';
  if (!files.length) {
    root.innerHTML = '<div class="empty">Ничего не найдено.</div>';
    return;
  }
  const groups = groupFilesByFolder(files);
  for (const [folder, group] of groups) {
    const wrap = document.createElement('section');
    wrap.className = 'result-group';
    wrap.innerHTML = `<div class="result-header"><h4>${escapeHtml(folder)}</h4><span class="muted">${group.length}</span></div>`;
    for (const file of group) {
      const row = document.createElement('div');
      row.className = 'file-row';
      const left = document.createElement('div');
      left.innerHTML = `
        <div class="file-name">${escapeHtml(file.originalName)}</div>
        <div class="file-meta">
          <span>${formatBytes(file.size || 0)}</span>
          <span>${file.createdAt ? new Date(file.createdAt).toLocaleString('ru-RU') : ''}</span>
        </div>
      `;
      const tags = document.createElement('div');
      tags.className = 'tags';
      (file.tags || []).forEach(tag => {
        const pill = document.createElement('span');
        pill.className = 'tag';
        pill.textContent = tag;
        tags.appendChild(pill);
      });
      left.appendChild(tags);
      const actions = document.createElement('div');
      const a = document.createElement('a');
      a.className = 'download-btn';
      a.href = `${apiBase}/api/files/${encodeURIComponent(file.id)}/download`;
      a.textContent = 'Скачать';
      actions.appendChild(a);
      row.appendChild(left);
      row.appendChild(actions);
      wrap.appendChild(row);
    }
    root.appendChild(wrap);
  }
}

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = Number(bytes || 0);
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

async function applySearch() {
  el('folderSelect').value = state.folder;
  const data = await request('/api/public/search', {
    search: state.search,
    folder: state.folder,
    tags: state.tags,
    filters: state.filters
  });
  renderResults(data.files || []);
  if (data.folders && data.folders.length) {
    config.folders = data.folders;
    renderFolders();
  }
}

function bindEvents() {
  el('searchInput').addEventListener('input', (e) => { state.search = e.target.value; });
  el('folderSelect').addEventListener('change', (e) => { state.folder = e.target.value; renderFolders(); });
  el('applyBtn').onclick = applySearch;
  el('clearFolderBtn').onclick = () => { state.folder = ''; renderFolders(); applySearch(); };
}

bindEvents();
loadConfig().catch(err => {
  console.error(err);
  el('results').innerHTML = `<div class="empty">Ошибка: ${escapeHtml(err.message || 'не удалось загрузить данные')}</div>`;
});
