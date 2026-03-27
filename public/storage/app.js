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
  return String(str).replace(/[&<>"]/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[s])).replace(/'/g, '&#39;');
}

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = Number(bytes || 0);
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function makeCheckboxChip(text, checked, onChange, dataset = {}) {
  const item = document.createElement('label');
  item.className = 'check';
  for (const [key, value] of Object.entries(dataset)) item.dataset[key] = value;
  item.innerHTML = `<input type="checkbox" ${checked ? 'checked' : ''} /> <span>${escapeHtml(text)}</span>`;
  const input = item.querySelector('input');
  input.onchange = () => onChange(input.checked);
  return item;
}

function renderFilterNode(filter, depth = 0) {
  const details = document.createElement('details');
  details.className = 'filter-row';
  details.open = false;
  details.style.setProperty('--depth', String(depth));

  const summary = document.createElement('summary');
  summary.className = 'filter-row__summary';
  summary.innerHTML = `
    <span class="filter-row__name" title="${escapeHtml(filter.label)}">${escapeHtml(filter.label)}</span>
    <span class="filter-row__type muted">${escapeHtml(filter.type)}</span>
    <span class="filter-row__chev" aria-hidden="true"></span>
  `;
  details.appendChild(summary);

  const body = document.createElement('div');
  body.className = 'filter-row__body';

  const control = document.createElement('div');
  control.className = 'filter-row__control';

  if (filter.type === 'dropdown') {
    const sel = document.createElement('select');
    sel.dataset.filterId = filter.id;
    sel.innerHTML = '<option value="">— не выбрано —</option>' + (filter.options || []).map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    sel.onchange = () => {
      if (sel.value) state.filters[filter.id] = sel.value;
      else delete state.filters[filter.id];
    };
    if (state.filters[filter.id]) sel.value = state.filters[filter.id];
    control.appendChild(sel);
  } else {
    const item = makeCheckboxChip(filter.label, !!state.filters[filter.id], (isChecked) => {
      if (isChecked) state.filters[filter.id] = true;
      else delete state.filters[filter.id];
    }, { filterId: filter.id });
    control.appendChild(item);
  }

  body.appendChild(control);

  if (Array.isArray(filter.children) && filter.children.length) {
    const nested = document.createElement('div');
    nested.className = 'filter-row__children';
    filter.children.forEach(child => nested.appendChild(renderFilterNode(child, depth + 1)));
    body.appendChild(nested);
  }

  details.appendChild(body);
  return details;
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

  const shell = document.createElement('div');
  shell.className = 'filter-grid';

  const head = document.createElement('div');
  head.className = 'filter-grid__head';
  head.innerHTML = '<div>Название</div><div>Тип</div><div>Значение</div>';
  shell.appendChild(head);

  const body = document.createElement('div');
  body.className = 'filter-grid__body';
  (config.filters || []).forEach(filter => body.appendChild(renderFilterNode(filter)));
  shell.appendChild(body);
  root.appendChild(shell);

  if (config.tags.length) {
    const tagBox = document.createElement('section');
    tagBox.className = 'checkbox-group-card';
    const title = document.createElement('div');
    title.className = 'checkbox-group-card__title';
    title.textContent = 'Теги';
    const tagsWrap = document.createElement('div');
    tagsWrap.className = 'checkbox-group';
    for (const tag of config.tags) {
      const checked = state.tags.includes(tag);
      const item = makeCheckboxChip(tag, checked, (isChecked) => {
        if (isChecked) {
          if (!state.tags.includes(tag)) state.tags.push(tag);
        } else {
          state.tags = state.tags.filter(t => t.toLowerCase() !== tag.toLowerCase());
        }
      }, { tag });
      tagsWrap.appendChild(item);
    }
    tagBox.appendChild(title);
    tagBox.appendChild(tagsWrap);
    root.appendChild(tagBox);
  }
}

function renderFolders() {
  const root = el('foldersTree');
  const select = el('folderSelect');
  root.innerHTML = '';

  if (select) {
    const current = state.folder || '';
    select.innerHTML = '<option value="">Все папки</option>';
    for (const folder of config.folders || []) {
      const opt = document.createElement('option');
      opt.value = folder;
      opt.textContent = folder;
      select.appendChild(opt);
    }
    select.value = current;
  }

  const allBtn = document.createElement('button');
  allBtn.className = `folder-item ${!state.folder ? 'active' : ''}`;
  allBtn.type = 'button';
  allBtn.textContent = 'Все папки';
  allBtn.dataset.folder = '';
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
      btn.type = 'button';
      btn.dataset.folder = folder;
      btn.textContent = folder;
      btn.title = folder;
      btn.style.paddingLeft = `${12 + folder.split('/').length * 12}px`;
      btn.onclick = () => { state.folder = folder; setFolderUI(); applySearch(); };
      root.appendChild(btn);
    }
  }
  setFolderUI();
}

function setFolderUI() {
  const select = el('folderSelect');
  if (select) select.value = state.folder;
  document.querySelectorAll('.folder-item').forEach(btn => btn.classList.toggle('active', btn.dataset.folder === (state.folder || '')));
}

function resetFilters() {
  state = { search: '', folder: '', tags: [], filters: {} };
  if (el('searchInput')) el('searchInput').value = '';
  if (el('folderSelect')) el('folderSelect').value = '';
  renderFilters();
  renderFolders();
  applySearch();
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
        <div class="file-name" title="${escapeHtml(file.originalName)}">${escapeHtml(file.originalName)}</div>
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
        pill.title = tag;
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

async function applySearch() {
  if (el('folderSelect')) el('folderSelect').value = state.folder;
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
  el('searchInput')?.addEventListener('input', (e) => { state.search = e.target.value; });
  el('folderSelect')?.addEventListener('change', (e) => {
    state.folder = e.target.value;
    renderFolders();
    applySearch();
  });
  el('searchForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    applySearch();
  });
  el('applyBtn').onclick = applySearch;
  el('resetBtn').onclick = resetFilters;
  el('clearFolderBtn').onclick = () => { state.folder = ''; renderFolders(); applySearch(); };
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const target = e.target;
    if (!target || target.matches('textarea,[contenteditable="true"]')) return;
    if (target.closest('#searchForm')) {
      e.preventDefault();
      applySearch();
    }
  });
}

bindEvents();
loadConfig().catch(err => {
  console.error(err);
  el('results').innerHTML = `<div class="empty">Ошибка: ${escapeHtml(err.message || 'не удалось загрузить данные')}</div>`;
});
