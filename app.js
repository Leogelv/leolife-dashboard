/**
 * Leolife OS v12 — App Logic
 *
 * Данные хранятся в data.json в GitHub репо.
 * Читает/пишет через GitHub API. Токен в localStorage.
 * Агент тоже может пушить data.json — все видят одно и то же.
 */

const REPO_OWNER = 'Leogelv';
const REPO_NAME = 'leolife-dashboard';
const DATA_PATH = 'data.json';
const BRANCH = 'main';
const LS_TOKEN_KEY = 'leolife-gh-token';
const LS_THEME_KEY = 'leolife-theme';

let DATA = null;
let currentProjectId = null;
let fileSha = null; // SHA файла для обновления через GitHub API
let saveTimeout = null;

// ── GitHub API ──

function getToken() {
    return localStorage.getItem(LS_TOKEN_KEY);
}

async function fetchDataFromGitHub() {
    const token = getToken();
    const headers = { 'Accept': 'application/vnd.github.v3+json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const resp = await fetch(
        `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${DATA_PATH}?ref=${BRANCH}&t=${Date.now()}`,
        { headers }
    );

    if (!resp.ok) throw new Error(`GitHub API ${resp.status}: ${resp.statusText}`);

    const json = await resp.json();
    fileSha = json.sha;
    // Декодируем base64 → UTF-8 (поддержка кириллицы)
    const binary = atob(json.content.replace(/\n/g, ''));
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    const content = new TextDecoder('utf-8').decode(bytes);
    return JSON.parse(content);
}

async function saveDataToGitHub() {
    const token = getToken();
    if (!token) {
        showSaveStatus('error', 'No token — read-only');
        return;
    }

    showSaveStatus('saving', 'Saving...');

    // Кодируем UTF-8 → base64 (поддержка кириллицы)
    const textBytes = new TextEncoder().encode(JSON.stringify(DATA, null, 2) + '\n');
    const content = btoa(String.fromCharCode(...textBytes));

    try {
        const resp = await fetch(
            `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${DATA_PATH}`,
            {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    message: `Dashboard update: ${new Date().toLocaleString()}`,
                    content,
                    sha: fileSha,
                    branch: BRANCH,
                }),
            }
        );

        if (!resp.ok) {
            const err = await resp.json();
            throw new Error(err.message || resp.statusText);
        }

        const result = await resp.json();
        fileSha = result.content.sha; // Обновляем SHA для следующего коммита
        showSaveStatus('saved', 'Saved');
    } catch (err) {
        console.error('Save failed:', err);
        showSaveStatus('error', 'Save failed');
    }
}

// Дебаунс сохранения — пишем через 1.5с после последнего изменения
function scheduleSave() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveDataToGitHub, 1500);
}

// ── Индикатор сохранения ──

function showSaveStatus(type, text) {
    let el = document.getElementById('save-indicator');
    if (!el) {
        el = document.createElement('div');
        el.id = 'save-indicator';
        el.className = 'save-indicator';
        document.body.appendChild(el);
    }
    el.className = `save-indicator ${type} show`;
    el.textContent = text;
    if (type !== 'saving') {
        setTimeout(() => el.classList.remove('show'), 2000);
    }
}

// ── Модалка токена ──

function showTokenModal() {
    const existing = document.getElementById('token-overlay');
    if (existing) return;

    const overlay = document.createElement('div');
    overlay.id = 'token-overlay';
    overlay.className = 'token-overlay';
    overlay.innerHTML = `
        <div class="token-modal">
            <h3 style="font-size:16px;font-weight:700;margin-bottom:4px">GitHub Token</h3>
            <p style="font-size:12px;color:var(--text-muted);margin-bottom:16px">
                Для сохранения изменений нужен GitHub PAT с доступом к репо.<br>
                Без токена дашборд работает в read-only.
            </p>
            <input id="token-input" type="password" placeholder="ghp_... или github_pat_..." />
            <div style="display:flex;gap:8px;margin-top:12px">
                <button onclick="submitToken()" style="flex:1;padding:10px;border-radius:12px;background:var(--accent);color:white;font-weight:600;font-size:13px;border:none;cursor:pointer">
                    Save
                </button>
                <button onclick="skipToken()" style="flex:1;padding:10px;border-radius:12px;background:var(--surface);color:var(--text-muted);font-weight:600;font-size:13px;border:1px solid var(--border);cursor:pointer">
                    Read-only
                </button>
            </div>
            <div id="modal-deploy-status" style="margin-top:16px;border-top:1px solid var(--border);padding-top:16px">
                <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.15em;color:var(--text-muted);margin-bottom:8px">Deploy Status</div>
                <div id="modal-runs" style="font-size:12px;color:var(--text-muted)">Loading...</div>
            </div>
        </div>
    `;
    fetchDeployStatus('modal-runs');
    document.body.appendChild(overlay);
}

function submitToken() {
    const input = document.getElementById('token-input');
    const token = input.value.trim();
    if (token) {
        localStorage.setItem(LS_TOKEN_KEY, token);
    }
    document.getElementById('token-overlay')?.remove();
    loadData();
}

function skipToken() {
    document.getElementById('token-overlay')?.remove();
    loadDataFallback();
}

// ── Загрузка данных ──

async function loadData() {
    try {
        DATA = await fetchDataFromGitHub();
        currentProjectId = DATA.activeProjectId || 'money';
        applyTheme();
        render();
    } catch (err) {
        console.error('Failed to load from GitHub:', err);
        if (!getToken()) {
            showTokenModal();
        } else {
            loadDataFallback();
        }
    }
}

async function loadDataFallback() {
    try {
        const resp = await fetch('data.json?t=' + Date.now());
        DATA = await resp.json();
        fileSha = null;
        currentProjectId = DATA.activeProjectId || 'money';
        applyTheme();
        render();
    } catch (err) {
        console.error('Fallback load failed:', err);
        document.querySelector('.content-wrapper').innerHTML =
            '<p style="color:red;text-align:center;padding:40px">Error loading data</p>';
    }
}

function applyTheme() {
    const saved = localStorage.getItem(LS_THEME_KEY);
    if (saved === 'light') document.body.classList.add('light-theme');
}

// ── Основной рендер ──

function render() {
    if (!DATA) return;

    const proj = DATA.projects.find(p => p.id === currentProjectId);
    if (!proj) return;

    // Миссия
    document.getElementById('active-mission').innerText = proj.mission;
    document.getElementById('sync-info').innerText =
        `Synced ${new Date().toLocaleTimeString()} · ${currentProjectId.toUpperCase()}` +
        (fileSha ? '' : ' · READ-ONLY');

    // Бейджи миссии
    const missionBadges = document.getElementById('mission-badges');
    if (missionBadges && DATA.mission) {
        missionBadges.innerHTML = `
            <span class="text-[9px] font-bold px-3 py-1.5 rounded-full uppercase tracking-wider"
                  style="background: var(--accent-glow); color: var(--accent)">${DATA.mission.priority}</span>
            <span class="text-[9px] font-bold px-3 py-1.5 rounded-full uppercase tracking-wider"
                  style="background: rgba(245, 158, 11, 0.1); color: var(--warning)">Deadline: ${DATA.mission.deadline}</span>
        `;
    }

    // Челлендж
    if (DATA.challenge) {
        document.getElementById('challenge-text').innerText = `"${DATA.challenge.text}"`;
    }

    // Переключатель проектов
    document.getElementById('project-switcher').innerHTML = DATA.projects.map(p => `
        <button onclick="switchProject('${p.id}')"
            class="project-tab px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider ${currentProjectId === p.id ? 'active' : ''}"
            style="${currentProjectId !== p.id ? 'color: var(--text-muted)' : ''}">
            <span>${p.name}</span>
        </button>
    `).join('');

    // Фильтрация задач: Money = все кроме hobbies
    const filterTasks = (col) => DATA.tasks.filter(t =>
        t.column === col && (currentProjectId === 'money' ? t.projectId !== 'hobbies' : t.projectId === currentProjectId)
    );

    const allVisible = DATA.tasks.filter(t =>
        currentProjectId === 'money' ? t.projectId !== 'hobbies' : t.projectId === currentProjectId
    );

    // Статистика
    const doneCount = allVisible.filter(t => t.column === 'done').length;
    const total = allVisible.length;
    const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

    document.getElementById('stats-container').innerHTML = `
        <div class="flex items-center justify-between">
            <div>
                <div class="text-2xl font-black">${doneCount}/${total}</div>
                <div class="text-[10px] font-bold uppercase tracking-wider" style="color: var(--text-muted)">Tasks Done</div>
            </div>
            <div class="stat-ring" style="--progress: ${pct}%; color: var(--accent)">${pct}%</div>
        </div>
        <div class="h-1.5 rounded-full overflow-hidden" style="background: var(--border)">
            <div class="h-full rounded-full transition-all duration-500"
                 style="width: ${pct}%; background: linear-gradient(90deg, var(--accent), #8b5cf6)"></div>
        </div>
        <div class="grid grid-cols-3 gap-2 pt-1">
            <div class="text-center"><div class="text-lg font-black">${filterTasks('todo').length}</div><div class="text-[8px] font-bold uppercase" style="color: var(--text-muted)">Todo</div></div>
            <div class="text-center"><div class="text-lg font-black" style="color: var(--accent)">${filterTasks('inprogress').length}</div><div class="text-[8px] font-bold uppercase" style="color: var(--text-muted)">Active</div></div>
            <div class="text-center"><div class="text-lg font-black" style="color: var(--success)">${doneCount}</div><div class="text-[8px] font-bold uppercase" style="color: var(--text-muted)">Done</div></div>
        </div>
    `;

    // Канбан колонки
    ['todo', 'inprogress', 'done'].forEach(colId => {
        const col = document.getElementById(`col-${colId}`);
        const list = col.querySelector('.task-list');
        const filtered = filterTasks(colId);
        col.querySelector('.count').innerText = filtered.length;

        list.innerHTML = filtered.map(t => {
            const tc = (DATA.tagColors && DATA.tagColors[t.tag]) || { bg: 'rgba(139,92,246,0.1)', text: '#8b5cf6', border: '#8b5cf6' };
            return `
                <div class="task-card glass p-5 rounded-2xl relative pl-7" data-id="${t.id}">
                    <div class="border-indicator" style="background: ${tc.border}"></div>
                    <div class="flex justify-between items-start mb-3">
                        <span class="text-[9px] font-black px-2 py-1 rounded-md uppercase tracking-widest"
                              style="background: ${tc.bg}; color: ${tc.text}">${t.tag}</span>
                        <span class="text-[10px] font-bold" style="color: var(--accent)">${t.owner}</span>
                    </div>
                    <p class="text-[13px] font-semibold leading-snug">${t.text}</p>
                    ${currentProjectId === 'money' && t.projectId ? `<span class="text-[9px] font-bold mt-2 block uppercase tracking-wider" style="color: var(--text-muted)">${t.projectId}</span>` : ''}
                </div>
            `;
        }).join('');

        // Drag & drop
        new Sortable(list, {
            group: 'kanban',
            animation: 250,
            ghostClass: 'opacity-30',
            onEnd: (evt) => {
                const tid = parseInt(evt.item.getAttribute('data-id'));
                const newCol = evt.to.getAttribute('data-col');
                const task = DATA.tasks.find(t => t.id === tid);
                if (task) {
                    task.column = newCol;
                    render();
                    scheduleSave(); // Автосохранение в GitHub
                }
            }
        });
    });

    lucide.createIcons();
}

// ── Действия ──

function switchProject(id) {
    currentProjectId = id;
    render();
}

function toggleTheme() {
    document.body.classList.toggle('light-theme');
    const isLight = document.body.classList.contains('light-theme');
    localStorage.setItem(LS_THEME_KEY, isLight ? 'light' : 'dark');
    document.getElementById('theme-icon').setAttribute('data-lucide', isLight ? 'moon' : 'sun');
    lucide.createIcons();
}

function completeChallenge() {
    const btn = event.target;
    btn.innerText = 'DONE — RESPECT';
    btn.style.background = 'var(--success)';
    btn.style.color = 'white';
    setTimeout(() => {
        if (DATA.challenge) {
            document.getElementById('challenge-text').innerText = `"${DATA.challenge.completedText}"`;
        }
        btn.innerText = 'Submit Proof';
        btn.style.background = 'rgba(16, 185, 129, 0.1)';
        btn.style.color = 'var(--success)';
    }, 3000);
}

// Настройки токена
function resetToken() {
    localStorage.removeItem(LS_TOKEN_KEY);
    showTokenModal();
}

// ── Deploy Status (GitHub Actions) ──

const RUN_STATUS_ICONS = {
    completed: { success: '✅', failure: '❌', cancelled: '⚪' },
    in_progress: '🔄',
    queued: '⏳',
};

async function fetchDeployStatus(targetId) {
    const token = getToken();
    const headers = { 'Accept': 'application/vnd.github.v3+json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    try {
        const resp = await fetch(
            `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/runs?per_page=5`,
            { headers }
        );
        if (!resp.ok) throw new Error(`${resp.status}`);
        const data = await resp.json();
        const runs = data.workflow_runs || [];

        const el = document.getElementById(targetId);
        if (!el) return;

        if (runs.length === 0) {
            el.innerHTML = '<span style="color:var(--text-muted)">No runs</span>';
            return;
        }

        el.innerHTML = runs.map(r => {
            const icon = r.status === 'completed'
                ? (RUN_STATUS_ICONS.completed[r.conclusion] || '❓')
                : (RUN_STATUS_ICONS[r.status] || '❓');
            const time = new Date(r.updated_at).toLocaleString();
            const duration = r.status === 'completed' && r.run_started_at
                ? Math.round((new Date(r.updated_at) - new Date(r.run_started_at)) / 1000) + 's'
                : '...';
            return `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
                    <div style="display:flex;align-items:center;gap:6px">
                        <span>${icon}</span>
                        <span style="font-size:11px;font-weight:600;color:var(--text)">${r.display_title || r.name}</span>
                    </div>
                    <div style="text-align:right">
                        <div style="font-size:10px;color:var(--text-muted)">${time}</div>
                        <div style="font-size:9px;color:var(--text-muted)">${duration}</div>
                    </div>
                </div>
            `;
        }).join('');
    } catch (err) {
        const el = document.getElementById(targetId);
        if (el) el.innerHTML = `<span style="color:#ef4444;font-size:11px">Error: ${err.message}</span>`;
    }
}

// Попап статуса деплоя
function toggleDeployPopup() {
    let popup = document.getElementById('deploy-popup');
    if (popup) {
        popup.remove();
        return;
    }
    popup = document.createElement('div');
    popup.id = 'deploy-popup';
    popup.style.cssText = `
        position:fixed;top:60px;right:20px;z-index:80;
        width:360px;max-height:400px;overflow-y:auto;
        padding:16px;border-radius:16px;
        background:var(--surface);backdrop-filter:blur(40px);
        border:1px solid var(--border);box-shadow:0 20px 60px rgba(0,0,0,0.3);
    `;
    popup.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <span style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.15em;color:var(--text-muted)">GitHub Actions</span>
            <button onclick="toggleDeployPopup()" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:16px">&times;</button>
        </div>
        <div id="popup-runs" style="font-size:12px;color:var(--text-muted)">Loading...</div>
    `;
    document.body.appendChild(popup);
    fetchDeployStatus('popup-runs');

    // Закрыть при клике вне
    setTimeout(() => {
        document.addEventListener('click', function closePopup(e) {
            if (!popup.contains(e.target) && !e.target.closest('[onclick*="toggleDeployPopup"]')) {
                popup.remove();
                document.removeEventListener('click', closePopup);
            }
        });
    }, 100);
}

// ── Старт ──
loadData();
