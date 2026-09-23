const STORAGE_KEY = 'leave-manager-v2';
const SETTINGS_KEY = 'leave-manager-settings-v2';
const MONTHLY_QUOTA_HOURS = 21;
const DAILY_LEAVE_HOURS = 3;
const MAX_HOURLY_LEAVE_HOURS = 2;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const settings = loadSettings();
const state = { members: [], leaves: [] };
const ui = { boardTab: 'active', dataMode: 'local', supabase: null, realtimeChannel: null, syncing: false };
let toastTimer;
let lastClockSignature = '';

function pad2(n) { return String(n).padStart(2, '0'); }
function faNum(value) { return String(value).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]); }
function uuid(prefix = 'id') { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }
function currentMonth() { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; }
function nowLocalDateTime() {
  const d = new Date();
  return { date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`, time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}` };
}
function parseDateTime(date, time) { return new Date(`${date}T${time}:00`); }
function durationHours(start, end) {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return (eh * 60 + em - (sh * 60 + sm)) / 60;
}
function formatHours(hours) {
  const normalized = Math.round(Number(hours || 0) * 100) / 100;
  if (Number.isInteger(normalized)) return faNum(normalized);
  return faNum(normalized.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''));
}
function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(`${dateStr}T12:00:00`);
  return new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map(p => p[0]).join('').toUpperCase() || '؟';
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}
function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }
function normalizeTime(value) { return value ? String(value).slice(0, 5) : ''; }
function monthOf(date) { return String(date || '').slice(0, 7); }
function getMember(id) { return state.members.find(m => m.id === id); }
function isInSelectedMonth(leave) { return monthOf(leave.date) === settings.month; }
function validMonthKey(value) { return /^\d{4}-\d{2}$/.test(value || ''); }

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && validMonthKey(parsed.month)) return parsed;
    }
  } catch (_) {}
  return { month: currentMonth() };
}
function persistSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }
function loadLocalState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('leave-manager-v1');
    if (raw) {
      const parsed = JSON.parse(raw);
      return { members: Array.isArray(parsed.members) ? parsed.members : [], leaves: Array.isArray(parsed.leaves) ? parsed.leaves : [] };
    }
  } catch (_) {}
  return { members: [], leaves: [] };
}
function normalizeState(data) {
  return {
    members: (Array.isArray(data?.members) ? data.members : []).map(m => ({
      id: String(m.id || uuid('m')),
      name: String(m.name || '').trim(),
      username: String(m.username || '').trim().replace(/^@+/, '')
    })).filter(m => m.name && m.username),
    leaves: (Array.isArray(data?.leaves) ? data.leaves : []).map(l => ({
      id: String(l.id || uuid('l')),
      memberId: String(l.memberId || ''),
      type: l.type === 'daily' ? 'daily' : 'hourly',
      date: String(l.date || ''),
      start: normalizeTime(l.start),
      end: normalizeTime(l.end),
      hours: Number(l.hours || 0),
      extraApproved: Boolean(l.extraApproved),
      approvedBy: String(l.approvedBy || ''),
      note: String(l.note || '')
    })).filter(l => l.memberId && l.date && l.start && l.end && Number(l.hours) > 0)
  };
}
function replaceState(data) {
  const normalized = normalizeState(data);
  state.members = normalized.members;
  state.leaves = normalized.leaves;
}
function saveLocalState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

function isSupabaseConfigured() {
  const cfg = window.LEAVE_MANAGER_CONFIG || {};
  return Boolean(window.supabase && cfg.supabaseUrl && cfg.supabaseKey);
}

async function initDataLayer() {
  if (!isSupabaseConfigured()) {
    replaceState(loadLocalState());
    ui.dataMode = 'local';
    setSyncStatus('local');
    renderAll();
    return;
  }

  try {
    ui.supabase = window.supabase.createClient(window.LEAVE_MANAGER_CONFIG.supabaseUrl, window.LEAVE_MANAGER_CONFIG.supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
    const { data, error } = await ui.supabase.from('leave_manager_state').select('id,data').eq('id', 1).maybeSingle();
    if (error) throw error;
    if (!data) {
      const seed = { members: [], leaves: [] };
      const { error: insertError } = await ui.supabase.from('leave_manager_state').insert({ id: 1, data: seed });
      if (insertError) throw insertError;
      replaceState(seed);
    } else {
      replaceState(data.data || {});
    }
    ui.dataMode = 'remote';
    setSyncStatus('online');
    subscribeRealtime();
    renderAll();
  } catch (error) {
    console.error(error);
    replaceState(loadLocalState());
    ui.dataMode = 'local';
    setSyncStatus('offline');
    renderAll();
    toast('اتصال دیتابیس برقرار نشد؛ فعلاً نسخه محلی فعال است.');
  }
}

function subscribeRealtime() {
  if (!ui.supabase) return;
  if (ui.realtimeChannel) ui.supabase.removeChannel(ui.realtimeChannel);
  ui.realtimeChannel = ui.supabase
    .channel('leave-manager-live-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'leave_manager_state', filter: 'id=eq.1' }, async () => {
      try {
        const { data, error } = await ui.supabase.from('leave_manager_state').select('id,data').eq('id', 1).maybeSingle();
        if (error) throw error;
        if (data) {
          replaceState(data.data || {});
          renderAll();
          setSyncStatus('online');
        }
      } catch (error) {
        console.error(error);
        setSyncStatus('offline');
      }
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') setSyncStatus('online');
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setSyncStatus('offline');
    });
}

async function persistState() {
  saveLocalState();
  if (ui.dataMode !== 'remote' || !ui.supabase || ui.syncing) return true;
  ui.syncing = true;
  setSyncStatus('saving');
  try {
    const payload = { members: state.members, leaves: state.leaves };
    const { error } = await ui.supabase.from('leave_manager_state').upsert({ id: 1, data: payload, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    if (error) throw error;
    setSyncStatus('online');
    return true;
  } catch (error) {
    console.error(error);
    setSyncStatus('offline');
    toast('ذخیره اشتراکی انجام نشد؛ تغییر در حافظه محلی نگه داشته شد.');
    return false;
  } finally {
    ui.syncing = false;
  }
}

function setSyncStatus(mode) {
  const pill = $('#syncStatus');
  const label = $('#syncStatusText');
  if (!pill || !label) return;
  pill.classList.remove('online', 'offline');
  if (mode === 'online') { pill.classList.add('online'); label.textContent = 'اشتراکی و همگام'; }
  else if (mode === 'saving') { label.textContent = 'در حال ذخیره…'; }
  else if (mode === 'offline') { pill.classList.add('offline'); label.textContent = 'اتصال اشتراکی قطع است'; }
  else { label.textContent = 'حافظه همین مرورگر'; }
}

function getMonthlyLeaves(memberId, excludeId = '') {
  return state.leaves.filter(l => l.memberId === memberId && isInSelectedMonth(l) && !l.extraApproved && l.id !== excludeId);
}
function quotaUsedHours(memberId, excludeId = '') {
  return getMonthlyLeaves(memberId, excludeId).reduce((sum, l) => sum + Number(l.hours || 0), 0);
}
function quotaInfo(memberId, excludeId = '') {
  const used = Math.round(quotaUsedHours(memberId, excludeId) * 100) / 100;
  const left = Math.max(0, Math.round((MONTHLY_QUOTA_HOURS - used) * 100) / 100);
  return { used, left, pct: MONTHLY_QUOTA_HOURS ? clamp((used / MONTHLY_QUOTA_HOURS) * 100, 0, 100) : 0 };
}
function extraUsedHours(memberId) {
  return state.leaves.filter(l => l.memberId === memberId && isInSelectedMonth(l) && l.extraApproved).reduce((sum, l) => sum + Number(l.hours || 0), 0);
}
function statusForQuota(q) {
  if (q.left <= 0) return ['zero', 'تمام شد'];
  if (q.left <= 6) return ['low', 'کمتر از ۶ ساعت'];
  return ['ok', 'باقی‌مانده مناسب'];
}
function quotaDaysEquivalent(used) {
  return (used / DAILY_LEAVE_HOURS).toFixed(2).replace(/\.00$/, '');
}

function leaveStatus(leave, now = new Date()) {
  const start = parseDateTime(leave.date, leave.start);
  const end = parseDateTime(leave.date, leave.end);
  if (now < start) return 'upcoming';
  if (now >= start && now < end) return 'active';
  return 'past';
}
function formatDurationMinutes(totalMinutes) {
  const mins = Math.max(0, Math.floor(totalMinutes));
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h) return `${faNum(h)} ساعت${m ? ` و ${faNum(m)} دقیقه` : ''}`;
  return `${faNum(m)} دقیقه`;
}
function formatDurationSeconds(totalSeconds) {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

function renderSummary() {
  $('#memberCount').textContent = faNum(state.members.length);
  const monthLeaves = state.leaves.filter(isInSelectedMonth);
  const now = new Date();
  $('#activeLeaveCount').textContent = faNum(monthLeaves.filter(l => leaveStatus(l, now) === 'active').length);
  $('#upcomingLeaveCount').textContent = faNum(monthLeaves.filter(l => leaveStatus(l, now) === 'upcoming').length);
  const used = monthLeaves.filter(l => !l.extraApproved).reduce((sum, l) => sum + Number(l.hours || 0), 0);
  $('#usedLeaveHours').textContent = formatHours(used);
}

function renderMembers() {
  const el = $('#membersGrid');
  if (!state.members.length) {
    el.innerHTML = '<div class="empty card">هنوز عضوی ثبت نشده است. از «تنظیم اعضا» اولین نفر را اضافه کن.</div>';
    return;
  }
  el.innerHTML = state.members.map(member => {
    const q = quotaInfo(member.id);
    const extra = extraUsedHours(member.id);
    const [statusClass, statusText] = statusForQuota(q);
    const ringColor = q.left <= 0 ? 'var(--red)' : q.left <= 6 ? 'var(--amber)' : 'var(--green)';
    return `
      <article class="member-card">
        <div class="member-head">
          <div class="member-main">
            <div class="avatar">${escapeHtml(initials(member.name))}</div>
            <div>
              <div class="member-name">${escapeHtml(member.name)}</div>
              <div class="member-username">@${escapeHtml(member.username)}</div>
            </div>
          </div>
          <span class="member-status ${statusClass}">${statusText}</span>
        </div>
        <div class="quota-layout">
          <div class="usage-ring" style="--pct:${q.pct}%;--ring-color:${ringColor}">
            <div><strong>${formatHours(q.used)}h</strong><small>مصرف‌شده</small></div>
          </div>
          <div>
            <div class="quota-title">مصرف سهمیه ماه</div>
            <div class="quota-value">${formatHours(q.left)} ساعت باقی‌مانده</div>
            <div class="quota-sub">${formatHours(q.used)} از ۲۱ ساعت مصرف شده • معادل ${faNum(quotaDaysEquivalent(q.used))} روز کامل</div>
            <div class="progress"><span style="width:${q.pct}%"></span></div>
            ${extra > 0 ? `<span class="extra-badge">+ ${formatHours(extra)} ساعت مرخصی اضافه</span>` : ''}
          </div>
        </div>
        <div class="member-actions">
          <button class="btn secondary" data-member-leave="${escapeHtml(member.id)}">ثبت مرخصی</button>
          <button class="btn secondary" data-member-history="${escapeHtml(member.id)}">مشاهده سابقه</button>
        </div>
      </article>`;
  }).join('');
}

function renderLiveRows(leaves) {
  const now = new Date();
  return leaves.map(leave => {
    const member = getMember(leave.memberId);
    if (!member) return '';
    const status = leaveStatus(leave, now);
    const typeLabel = leave.type === 'daily' ? 'روزانه' : 'ساعتی';
    const timer = status === 'active' ? `
      <div class="timer-wrap" data-timer data-date="${leave.date}" data-start="${leave.start}" data-end="${leave.end}">
        <div class="leave-timer-ring"><div><strong data-timer-value>00:00:00</strong><small>گذشته</small></div></div>
        <div class="timer-detail"><strong>پایان: ${escapeHtml(leave.end)}</strong><small class="timer-remaining" data-remaining>باقی‌مانده…</small></div>
      </div>` : status === 'upcoming' ? `
      <div class="timer-wrap"><div class="leave-timer-ring" style="--progress:0%"><div><strong>—</strong><small>آینده</small></div></div><div class="timer-detail"><strong>شروع: ${escapeHtml(leave.start)}</strong><small>${escapeHtml(formatDate(leave.date))}</small></div></div>` : `
      <div class="timer-wrap"><div class="timer-detail"><strong>پایان: ${escapeHtml(leave.end)}</strong><small>${escapeHtml(formatDate(leave.date))}</small></div></div>`;
    return `
      <div class="board-row">
        <div class="board-person"><div class="avatar">${escapeHtml(initials(member.name))}</div><div><div class="board-name">${escapeHtml(member.name)}</div><div class="board-meta">@${escapeHtml(member.username)}</div></div></div>
        <div class="board-cell"><span class="badge ${status === 'active' ? 'active' : status === 'upcoming' ? 'upcoming' : ''}">${status === 'active' ? 'فعال' : status === 'upcoming' ? 'آینده' : 'پایان‌یافته'}</span></div>
        <div class="board-cell hide-mobile"><strong>${escapeHtml(typeLabel)}</strong>${leave.extraApproved ? `<div><span class="badge extra">اضافه</span></div>` : ''}</div>
        <div class="board-cell hide-mobile"><strong>${escapeHtml(formatDate(leave.date))}</strong></div>
        <div class="board-cell hide-mobile"><strong>${escapeHtml(formatHours(leave.hours))} ساعت</strong></div>
        <div class="board-cell">${timer}</div>
        <div class="table-actions"><button class="text-btn" data-edit-leave="${escapeHtml(leave.id)}">ویرایش</button><button class="text-btn danger" data-delete-leave="${escapeHtml(leave.id)}">حذف</button></div>
      </div>`;
  }).join('');
}

function renderLeaveBoard() {
  const monthLeaves = state.leaves.filter(isInSelectedMonth).sort((a, b) => parseDateTime(a.date, a.start) - parseDateTime(b.date, b.start));
  const now = new Date();
  let leaves = monthLeaves;
  if (ui.boardTab === 'active') leaves = monthLeaves.filter(l => leaveStatus(l, now) === 'active');
  if (ui.boardTab === 'upcoming') leaves = monthLeaves.filter(l => leaveStatus(l, now) === 'upcoming');
  $('#leaveBoard').innerHTML = leaves.length ? `<div class="board-list">${renderLiveRows(leaves)}</div>` : '<div class="empty">موردی برای نمایش در این بخش وجود ندارد.</div>';
  updateLiveTimers();
}

function renderHistory() {
  const body = $('#historyTableBody');
  const rows = state.leaves.filter(isInSelectedMonth).sort((a, b) => parseDateTime(b.date, b.start) - parseDateTime(a.date, a.start));
  if (!rows.length) { body.innerHTML = '<tr><td colspan="7"><div class="empty">برای این ماه هنوز مرخصی ثبت نشده است.</div></td></tr>'; return; }
  const now = new Date();
  body.innerHTML = rows.map(l => {
    const m = getMember(l.memberId);
    const status = leaveStatus(l, now);
    const statusText = status === 'active' ? 'در حال مرخصی' : status === 'upcoming' ? 'آینده' : 'پایان‌یافته';
    const statusClass = status === 'active' ? 'active' : status === 'upcoming' ? 'upcoming' : '';
    return `<tr id="history-${escapeHtml(l.id)}"><td><strong>${escapeHtml(m?.name || 'عضو حذف‌شده')}</strong><div class="board-meta">@${escapeHtml(m?.username || '-')}</div></td><td>${l.type === 'daily' ? 'روزانه' : 'ساعتی'} ${l.extraApproved ? '<span class="badge extra">اضافه</span>' : ''}</td><td>${escapeHtml(formatDate(l.date))}</td><td>${escapeHtml(l.start)} تا ${escapeHtml(l.end)}</td><td>${escapeHtml(formatHours(l.hours))} ساعت</td><td><span class="badge ${statusClass}">${statusText}</span></td><td><div class="table-actions"><button class="text-btn" data-edit-leave="${escapeHtml(l.id)}">ویرایش</button><button class="text-btn danger" data-delete-leave="${escapeHtml(l.id)}">حذف</button></div></td></tr>`;
  }).join('');
}

function renderMembersSettings() {
  const el = $('#memberSettingsList');
  if (!state.members.length) { el.innerHTML = '<div class="empty">عضوی ثبت نشده است.</div>'; return; }
  el.innerHTML = state.members.map(m => `<div class="settings-row"><div class="settings-person"><div class="avatar" style="width:40px;height:40px;border-radius:12px">${escapeHtml(initials(m.name))}</div><div><strong>${escapeHtml(m.name)}</strong></div></div><div class="settings-user">@${escapeHtml(m.username)}</div><div class="table-actions"><button class="text-btn" data-edit-member="${escapeHtml(m.id)}">ویرایش</button><button class="text-btn danger" data-delete-member="${escapeHtml(m.id)}">حذف</button></div></div>`).join('');
}

function populateLeaveMember(selectedId = '') {
  const select = $('#leaveMember');
  select.innerHTML = state.members.length ? state.members.map(m => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)} (@${escapeHtml(m.username)})</option>`).join('') : '<option value="">ابتدا عضو اضافه کن</option>';
  if (selectedId) select.value = selectedId;
}
function openLeaveModal(memberId = '') {
  $('#leaveForm').reset();
  $('#leaveModalTitle').textContent = 'ثبت مرخصی جدید';
  $('#leaveId').value = '';
  populateLeaveMember(memberId || state.members[0]?.id || '');
  const now = nowLocalDateTime();
  $('#leaveDate').value = now.date;
  $('#leaveStart').value = now.time;
  $('#leaveType').value = 'daily';
  $('#leaveExtra').value = 'no';
  $('#leaveLeader').value = '';
  $('#leaveEnd').disabled = false;
  $('#leaveModal').classList.remove('hidden');
  updateLeaveFormUI();
}
function updateLeaveFormUI() {
  const type = $('#leaveType').value;
  const extra = $('#leaveExtra').value === 'yes';
  const member = getMember($('#leaveMember').value);
  $('#leaveEnd').disabled = type === 'daily';
  if (type === 'daily') {
    const start = $('#leaveStart').value || '09:00';
    const [h, m] = start.split(':').map(Number);
    const mins = h * 60 + m + DAILY_LEAVE_HOURS * 60;
    $('#leaveEnd').value = `${pad2(Math.floor((mins % 1440) / 60))}:${pad2(mins % 60)}`;
  }
  const q = member ? quotaInfo(member.id, $('#leaveId').value) : { left: MONTHLY_QUOTA_HOURS, used: 0 };
  const hours = type === 'daily' ? DAILY_LEAVE_HOURS : durationHours($('#leaveStart').value || '00:00', $('#leaveEnd').value || '00:00');
  const canFit = hours > 0 && q.left + 1e-9 >= hours;
  let hint = `سهمیه ${member ? escapeHtml(member.name) : 'عضو'}: ${formatHours(q.left)} ساعت از ۲۱ ساعت باقی مانده است.`;
  if (type === 'daily') hint += ` این درخواست ${DAILY_LEAVE_HOURS} ساعت از سهمیه را مصرف می‌کند.`;
  else hint += ` مرخصی ساعتی باید بیشتر از صفر و حداکثر ${MAX_HOURLY_LEAVE_HOURS} ساعت باشد.`;
  if (extra) hint += canFit ? ' سهمیه برای این درخواست کافی است؛ برای ثبت اضافه باید واقعاً سهمیه کافی نباشد.' : ' این درخواست به‌عنوان مرخصی اضافه ثبت می‌شود و از سهمیه ۲۱ ساعت کم نمی‌کند.';
  $('#leaveHint').innerHTML = hint;
  $('#leaveHint').classList.toggle('warn', extra || !canFit && hours > 0);
  $('#leaderField').classList.toggle('hidden', !extra);
}

$('#leaveType').addEventListener('change', updateLeaveFormUI);
$('#leaveMember').addEventListener('change', updateLeaveFormUI);
$('#leaveExtra').addEventListener('change', updateLeaveFormUI);
$('#leaveStart').addEventListener('change', updateLeaveFormUI);
$('#leaveEnd').addEventListener('change', updateLeaveFormUI);

$('#leaveForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#leaveId').value;
  const memberId = $('#leaveMember').value;
  const type = $('#leaveType').value;
  const date = $('#leaveDate').value;
  const start = $('#leaveStart').value;
  const end = $('#leaveEnd').value;
  const extraApproved = $('#leaveExtra').value === 'yes';
  const approvedBy = $('#leaveLeader').value.trim();
  const note = $('#leaveNote').value.trim();
  if (!memberId || !date || !start || !end) return toast('اطلاعات مرخصی کامل نیست.');
  const hours = type === 'daily' ? DAILY_LEAVE_HOURS : durationHours(start, end);
  if (type === 'daily' && Math.abs(durationHours(start, end) - DAILY_LEAVE_HOURS) > 0.001) return toast('مرخصی روزانه باید دقیقاً ۳ ساعت باشد.');
  if (type === 'hourly' && (hours <= 0 || hours > MAX_HOURLY_LEAVE_HOURS)) return toast(`مرخصی ساعتی باید بیشتر از صفر و حداکثر ${MAX_HOURLY_LEAVE_HOURS} ساعت باشد.`);
  if (hours <= 0) return toast('زمان پایان باید بعد از زمان شروع باشد.');
  const member = getMember(memberId);
  if (!member) return toast('عضو انتخاب‌شده پیدا نشد.');

  const q = quotaInfo(memberId, id);
  if (extraApproved) {
    if (!approvedBy) return toast('برای مرخصی اضافه نام لیدر تأییدکننده را وارد کنید.');
    if (q.left + 1e-9 >= hours) return toast('برای مرخصی اضافه باید سهمیه عادی برای این درخواست کافی نباشد.');
  } else if (q.left + 1e-9 < hours) {
    return toast(`سهمیه عادی کافی نیست؛ فقط ${formatHours(q.left)} ساعت باقی مانده است. برای ادامه مرخصی اضافه را انتخاب کنید.`);
  }

  const existing = id ? state.leaves.find(l => l.id === id) : null;
  const record = { id: id || uuid('l'), memberId, type, date, start, end, hours, extraApproved, approvedBy, note };
  if (existing) Object.assign(existing, record); else state.leaves.push(record);
  await persistState();
  renderAll();
  closeModal('leaveModal');
  toast(existing ? 'مرخصی ویرایش شد.' : 'مرخصی با موفقیت ثبت شد.');
});

function editLeave(id) {
  const leave = state.leaves.find(l => l.id === id); if (!leave) return;
  $('#leaveModalTitle').textContent = 'ویرایش مرخصی';
  populateLeaveMember(leave.memberId);
  $('#leaveId').value = leave.id;
  $('#leaveType').value = leave.type;
  $('#leaveDate').value = leave.date;
  $('#leaveStart').value = leave.start;
  $('#leaveEnd').value = leave.end;
  $('#leaveExtra').value = leave.extraApproved ? 'yes' : 'no';
  $('#leaveLeader').value = leave.approvedBy || '';
  $('#leaveNote').value = leave.note || '';
  $('#leaveModal').classList.remove('hidden');
  updateLeaveFormUI();
}
async function deleteLeave(id) {
  const leave = state.leaves.find(l => l.id === id); if (!leave) return;
  const member = getMember(leave.memberId);
  if (!confirm(`مرخصی ${member ? member.name : ''} حذف شود؟`)) return;
  state.leaves = state.leaves.filter(l => l.id !== id);
  await persistState(); renderAll(); toast('مرخصی حذف شد.');
}

$('#memberForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#memberId').value;
  const name = $('#memberName').value.trim();
  const username = $('#memberUsername').value.trim().replace(/^@+/, '');
  if (!name || !username) return toast('نام و یوزرنیم را وارد کنید.');
  const duplicate = state.members.find(m => m.username.toLowerCase() === username.toLowerCase() && m.id !== id);
  if (duplicate) return toast('این username قبلاً ثبت شده است.');
  if (id) {
    const member = getMember(id);
    if (member) { member.name = name; member.username = username; }
    toast('اطلاعات عضو ویرایش شد.');
  } else {
    state.members.push({ id: uuid('m'), name, username });
    toast('عضو جدید اضافه شد.');
  }
  await persistState(); resetMemberForm(); renderAll(); renderMembersSettings();
});
function resetMemberForm() { $('#memberForm').reset(); $('#memberId').value = ''; $('#cancelMemberEdit').classList.add('hidden'); }
function editMember(id) {
  const member = getMember(id); if (!member) return;
  $('#memberId').value = member.id; $('#memberName').value = member.name; $('#memberUsername').value = member.username; $('#cancelMemberEdit').classList.remove('hidden'); $('#memberName').focus();
}
async function deleteMember(id) {
  const member = getMember(id); if (!member) return;
  const linked = state.leaves.some(l => l.memberId === id);
  const message = linked ? `برای ${member.name} سابقه مرخصی وجود دارد. با حذف عضو سوابق نیز حذف می‌شوند. ادامه؟` : `عضو ${member.name} حذف شود؟`;
  if (!confirm(message)) return;
  state.members = state.members.filter(m => m.id !== id);
  state.leaves = state.leaves.filter(l => l.memberId !== id);
  await persistState(); renderAll(); renderMembersSettings(); resetMemberForm(); toast('عضو حذف شد.');
}

$('#monthPicker').value = settings.month;
$('#monthPicker').addEventListener('change', () => { settings.month = $('#monthPicker').value; persistSettings(); renderAll(); });
$('#settingsBtn').addEventListener('click', () => { renderMembersSettings(); $('#membersModal').classList.remove('hidden'); });
$('#addLeaveBtn').addEventListener('click', () => openLeaveModal());
$('#cancelMemberEdit').addEventListener('click', resetMemberForm);
$$('[data-close-modal]').forEach(btn => btn.addEventListener('click', () => closeModal(btn.dataset.closeModal)));
$$('.tab').forEach(tab => tab.addEventListener('click', () => { $$('.tab').forEach(t => t.classList.remove('active')); tab.classList.add('active'); ui.boardTab = tab.dataset.boardTab; renderLeaveBoard(); }));

document.addEventListener('click', (e) => {
  const memberLeave = e.target.closest('[data-member-leave]'); if (memberLeave) return openLeaveModal(memberLeave.dataset.memberLeave);
  const memberHistory = e.target.closest('[data-member-history]'); if (memberHistory) return focusMemberHistory(memberHistory.dataset.memberHistory);
  const editLeaveBtn = e.target.closest('[data-edit-leave]'); if (editLeaveBtn) return editLeave(editLeaveBtn.dataset.editLeave);
  const deleteLeaveBtn = e.target.closest('[data-delete-leave]'); if (deleteLeaveBtn) return deleteLeave(deleteLeaveBtn.dataset.deleteLeave);
  const editMemberBtn = e.target.closest('[data-edit-member]'); if (editMemberBtn) return editMember(editMemberBtn.dataset.editMember);
  const deleteMemberBtn = e.target.closest('[data-delete-member]'); if (deleteMemberBtn) return deleteMember(deleteMemberBtn.dataset.deleteMember);
});

function focusMemberHistory(memberId) {
  const rows = state.leaves.filter(l => l.memberId === memberId && isInSelectedMonth(l));
  if (!rows.length) return toast('برای این عضو در ماه انتخاب‌شده سابقه‌ای وجود ندارد.');
  const target = rows[0];
  const el = document.getElementById(`history-${target.id}`);
  if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('focus-row'); setTimeout(() => el.classList.remove('focus-row'), 1800); }
}

$('#exportBtn').addEventListener('click', () => {
  const payload = { exportedAt: new Date().toISOString(), version: 2, members: state.members, leaves: state.leaves };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `leave-manager-backup-${settings.month}.json`; a.click(); URL.revokeObjectURL(url); toast('فایل پشتیبان ساخته شد.');
});

$('#importInput').addEventListener('change', async (e) => {
  const file = e.target.files?.[0]; if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.members) || !Array.isArray(data.leaves)) throw new Error('format');
    if (!confirm('داده‌های فعلی با فایل پشتیبان جایگزین شوند؟')) return;
    replaceState(data); await persistState(); renderAll(); renderMembersSettings(); toast('پشتیبان با موفقیت بازیابی شد.');
  } catch (_) { toast('فایل پشتیبان معتبر نیست.'); }
  finally { e.target.value = ''; }
});

function closeModal(id) { const el = document.getElementById(id); if (!el) return; el.classList.add('hidden'); el.setAttribute('aria-hidden', 'true'); }
function openModal(id) { const el = document.getElementById(id); if (!el) return; el.classList.remove('hidden'); el.setAttribute('aria-hidden', 'false'); }
function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2600); }

function updateLiveTimers() {
  const now = new Date();
  $$('[data-timer]').forEach(el => {
    const start = parseDateTime(el.dataset.date, el.dataset.start);
    const end = parseDateTime(el.dataset.date, el.dataset.end);
    const total = Math.max(1, end - start);
    const elapsed = clamp(now - start, 0, total);
    const progress = (elapsed / total) * 100;
    const remainingMs = Math.max(0, end - now);
    const ring = el.querySelector('.leave-timer-ring');
    const value = el.querySelector('[data-timer-value]');
    const remaining = el.querySelector('[data-remaining]');
    ring.style.setProperty('--progress', `${progress}%`);
    value.textContent = formatDurationSeconds(elapsed / 1000);
    remaining.textContent = `باقی‌مانده: ${formatDurationSeconds(remainingMs / 1000)}`;
  });
}

function clockTick() {
  const now = new Date();
  const signature = `${now.getMinutes()}:${now.getSeconds()}`;
  updateLiveTimers();
  const activeExists = state.leaves.some(l => isInSelectedMonth(l) && leaveStatus(l, now) === 'active');
  if (activeExists && signature.endsWith(':00')) renderSummary();
  const boardStatusSignature = state.leaves.filter(isInSelectedMonth).map(l => `${l.id}:${leaveStatus(l, now)}`).join('|');
  if (boardStatusSignature !== lastClockSignature) { lastClockSignature = boardStatusSignature; renderLeaveBoard(); }
}

function renderAll() {
  renderSummary(); renderMembers(); renderLeaveBoard(); renderHistory(); renderMembersSettings();
}

window.addEventListener('storage', (event) => {
  if (event.key !== STORAGE_KEY || ui.dataMode === 'remote') return;
  replaceState(loadLocalState()); renderAll();
});

renderAll();
lastClockSignature = state.leaves.filter(isInSelectedMonth).map(l => `${l.id}:${leaveStatus(l)}`).join('|');
initDataLayer();
setInterval(clockTick, 1000);
