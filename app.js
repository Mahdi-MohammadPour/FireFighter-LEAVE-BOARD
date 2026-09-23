const MONTHLY_QUOTA_HOURS = 21;
const DAILY_LEAVE_HOURS = 3;
const MAX_HOURLY_LEAVE_MINUTES = 120;
const MIN_HOURLY_LEAVE_MINUTES = 60;
const MIN_DAILY_LEAVE_DAYS = 1;
const MAX_DAILY_LEAVE_DAYS = 7;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = { members: [], leaves: [] };
const ui = {
  boardTab: 'active',
  dataMode: 'locked',
  supabase: null,
  realtimeChannel: null,
  syncing: false,
  staff: null,
  authBusy: false,
  currentUserId: ''
};
let toastTimer;
let lastClockSignature = '';

function pad2(n) { return String(n).padStart(2, '0'); }
function faNum(value) { return String(value).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]); }
function uuid(prefix = 'id') { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }
function currentMonth() { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; }
function nowIso() { return new Date().toISOString(); }
function toLegacyDateTime(date, time) { return date && time ? new Date(`${date}T${time}:00`) : null; }
function localDateFromIso(iso) { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function localTimeFromIso(iso) { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
function localDateToStartIso(dateValue) {
  const value = String(dateValue || '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const d = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return '';
  return d.toISOString();
}
function todayLocalDateInput() { return localDateFromIso(nowIso()); }
function monthOf(date) { return String(date || '').slice(0, 7); }
function monthOfLeave(leave) { return monthOf(leave.date || localDateFromIso(leave.startAt)); }
function getMember(id) { return state.members.find(m => m.id === id); }
function isInCurrentMonth(leave) { return monthOfLeave(leave) === currentMonth(); }
function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch])); }
function initials(name) { const parts = String(name || '').trim().split(/\s+/).filter(Boolean); return parts.slice(0, 2).map(p => p[0]).join('').toUpperCase() || '؟'; }
function normalizeTime(value) { return value ? String(value).slice(0, 5) : ''; }
function formatHours(hours) {
  const normalized = Math.round(Number(hours || 0) * 100) / 100;
  if (Number.isInteger(normalized)) return faNum(normalized);
  return faNum(normalized.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''));
}
function formatDurationMinutes(totalMinutes) {
  const mins = Math.max(0, Math.round(Number(totalMinutes || 0)));
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h) return `${faNum(h)} ساعت${m ? ` و ${faNum(m)} دقیقه` : ''}`;
  return `${faNum(m)} دقیقه`;
}
function formatDurationSeconds(totalSeconds) {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}
function formatDateOnlyBoth(value) {
  let d;
  if (value instanceof Date) {
    d = value;
  } else {
    const raw = String(value ?? '').trim();
    if (!raw) return '<span class="date-pair">-</span>';
    // Accept full ISO timestamps (startAt/endAt) as well as YYYY-MM-DD values.
    d = raw.includes('T') || /Z$|[+-]\d{2}:?\d{2}$/.test(raw) ? new Date(raw) : new Date(`${raw}T12:00:00`);
  }
  if (Number.isNaN(d.getTime())) return '<span class="date-pair">-</span>';
  const gregorian = new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const jalali = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return `<span class="date-pair"><b>${escapeHtml(gregorian)}</b><small>شمسی: ${escapeHtml(jalali)}</small></span>`;
}
function formatDateTimeBoth(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '<span class="date-pair">-</span>';
  const gregorian = new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  const jalali = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return `<span class="date-pair"><b>${escapeHtml(gregorian)}</b><small>شمسی: ${escapeHtml(jalali)}</small></span>`;
}
function isSupabaseConfigured() {
  const cfg = window.LEAVE_MANAGER_CONFIG || {};
  return Boolean(window.supabase && cfg.supabaseUrl && cfg.supabaseKey);
}
function authDomain() { return String(window.LEAVE_MANAGER_CONFIG?.authEmailDomain || 'firefighter.local').replace(/^@+/, ''); }
function usernameToEmail(username) {
  const normalized = String(username || '').trim().toLowerCase();
  return normalized.includes('@') ? normalized : `${normalized}@${authDomain()}`;
}
function normalizeUsername(value) { return String(value || '').trim().replace(/^@+/, '').toLowerCase(); }

function addLocalDaysIso(iso, days) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + days);
  return d.toISOString();
}
function startOfLocalDayIso(isoOrDate = new Date()) {
  const d = isoOrDate instanceof Date ? new Date(isoOrDate) : new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return '';
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  return start.toISOString();
}
function leaveDurationMinutes(type, quotaHours, fallbackMinutes = 0, fallbackDays = 1) {
  if (type === 'daily') return clamp(Number(fallbackDays) || 1, MIN_DAILY_LEAVE_DAYS, MAX_DAILY_LEAVE_DAYS) * 24 * 60;
  const mins = Number(fallbackMinutes);
  if (Number.isFinite(mins) && mins > 0) return Math.round(mins);
  return Math.round(Number(quotaHours || 0) * 60);
}
function calculateEndAt(startAt, type, hours, durationMinutes = 0, durationDays = 1) {
  if (!startAt) return '';
  if (type === 'daily') return addLocalDaysIso(startAt, clamp(Number(durationDays) || 1, MIN_DAILY_LEAVE_DAYS, MAX_DAILY_LEAVE_DAYS));
  return new Date(new Date(startAt).getTime() + leaveDurationMinutes('hourly', hours, durationMinutes) * 60000).toISOString();
}
function normalizeState(data) {
  return {
    members: (Array.isArray(data?.members) ? data.members : []).map(m => ({
      id: String(m.id || uuid('m')),
      name: String(m.name || '').trim(),
      username: String(m.username || '').trim().replace(/^@+/, '')
    })).filter(m => m.name && m.username),
    leaves: (Array.isArray(data?.leaves) ? data.leaves : []).map(l => {
      const legacyDate = String(l.date || '');
      const legacyStart = normalizeTime(l.start);
      const legacyEnd = normalizeTime(l.end);
      const startLegacyDate = toLegacyDateTime(legacyDate, legacyStart);
      const endLegacyDate = toLegacyDateTime(legacyDate, legacyEnd);
      const type = l.type === 'daily' ? 'daily' : 'hourly';
      let startAt = l.startAt || (startLegacyDate ? startLegacyDate.toISOString() : '');
      let hours;
      let durationDays = 1;
      if (type === 'daily') {
        durationDays = clamp(Number(l.durationDays || l.days || 1), MIN_DAILY_LEAVE_DAYS, MAX_DAILY_LEAVE_DAYS);
        hours = durationDays * DAILY_LEAVE_HOURS;
      } else {
        // Keep historical hourly records intact; new records are restricted to 1h or 2h in the UI.
        hours = Number(l.hours || (endLegacyDate && startLegacyDate ? Math.max(0, (endLegacyDate - startLegacyDate) / 3600000) : 0));
      }
      if (type === 'daily' && startAt) startAt = startOfLocalDayIso(startAt);
      let endAt = l.endAt || '';
      if (type === 'daily' && startAt) endAt = calculateEndAt(startAt, 'daily', hours, durationDays * 24 * 60, durationDays);
      else if (!endAt && startAt && hours > 0) endAt = calculateEndAt(startAt, 'hourly', hours, Number(l.durationMinutes || l.minutes || Math.round(hours * 60)));
      const start = startAt ? localTimeFromIso(startAt) : legacyStart;
      const end = endAt ? localTimeFromIso(endAt) : legacyEnd;
      const date = startAt ? localDateFromIso(startAt) : legacyDate;
      const durationMinutes = type === 'daily' ? durationDays * 24 * 60 : Math.round(hours * 60);
      return {
        id: String(l.id || uuid('l')),
        memberId: String(l.memberId || ''),
        type,
        date,
        start,
        end,
        startAt,
        endAt,
        hours,
        durationDays,
        minutes: durationMinutes,
        durationMinutes,
        extraApproved: Boolean(l.extraApproved),
        approvedBy: String(l.approvedBy || ''),
        note: String(l.note || '')
      };
    }).filter(l => l.memberId && l.startAt && l.endAt && Number(l.hours) > 0)
  };
}
function replaceState(data) {
  const normalized = normalizeState(data);
  state.members = normalized.members;
  state.leaves = normalized.leaves;
}

async function initAuth() {
  if (!isSupabaseConfigured()) {
    showAuthMessage('تنظیمات Supabase در سایت وجود ندارد.', true);
    $('#loginSubmit').disabled = true;
    return;
  }
  ui.supabase = window.supabase.createClient(window.LEAVE_MANAGER_CONFIG.supabaseUrl, window.LEAVE_MANAGER_CONFIG.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });
  ui.supabase.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => handleSession(session), 0);
  });
  const { data, error } = await ui.supabase.auth.getSession();
  if (error) {
    console.error(error);
    showAuthMessage('بررسی نشست ورود انجام نشد. دوباره تلاش کنید.', true);
    return;
  }
  await handleSession(data.session);
}

async function handleSession(session) {
  const user = session?.user;
  if (!user) {
    if (ui.realtimeChannel && ui.supabase) {
      ui.supabase.removeChannel(ui.realtimeChannel);
      ui.realtimeChannel = null;
    }
    ui.dataMode = 'locked';
    ui.currentUserId = '';
    ui.staff = null;
    $('#appShell').classList.add('hidden-until-auth');
    $('#authGate').classList.remove('hidden');
    return;
  }
  if (ui.authBusy || (ui.currentUserId === user.id && ui.dataMode === 'remote')) return;
  ui.authBusy = true;
  try {
    const { data: staff, error } = await ui.supabase.from('ff_staff').select('username,display_name,role').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    if (!staff || !['leader', 'subleader'].includes(staff.role)) {
      await ui.supabase.auth.signOut();
      showAuthMessage('این حساب مجوز ورود به Leave Board را ندارد.', true);
      return;
    }
    ui.staff = staff;
    ui.currentUserId = user.id;
    $('#staffBadgeText').textContent = `${staff.display_name || staff.username} • ${staff.role === 'leader' ? 'لیدر' : 'ساب‌لیدر'}`;
    $('#authGate').classList.add('hidden');
    $('#appShell').classList.remove('hidden-until-auth');
    showAuthMessage('');
    await initDataLayer();
  } catch (error) {
    console.error(error);
    ui.dataMode = 'locked';
    $('#appShell').classList.add('hidden-until-auth');
    $('#authGate').classList.remove('hidden');
    showAuthMessage('حساب وارد شد اما مجوز دیتابیس دریافت نشد. تنظیمات امنیتی Supabase را بررسی کنید.', true);
    try { await ui.supabase.auth.signOut(); } catch (_) {}
  } finally {
    ui.authBusy = false;
  }
}

async function initDataLayer() {
  try {
    const { data, error } = await ui.supabase.from('leave_manager_state').select('id,data').eq('id', 1).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('leave_manager_state row id=1 not found');
    replaceState(data.data || {});
    ui.dataMode = 'remote';
    setSyncStatus('online');
    subscribeRealtime();
    renderAll();
  } catch (error) {
    console.error(error);
    ui.dataMode = 'locked';
    setSyncStatus('offline');
    $('#appShell').classList.add('hidden-until-auth');
    $('#authGate').classList.remove('hidden');
    showAuthMessage('دسترسی امن به دیتابیس برقرار نشد. Migration امنیتی و ff_staff را بررسی کنید.', true);
    throw error;
  }
}

function subscribeRealtime() {
  if (!ui.supabase) return;
  if (ui.realtimeChannel) ui.supabase.removeChannel(ui.realtimeChannel);
  ui.realtimeChannel = ui.supabase
    .channel('leave-manager-live-sync')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'leave_manager_state', filter: 'id=eq.1' }, async () => {
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
  if (ui.dataMode !== 'remote' || !ui.supabase || ui.syncing) return false;
  ui.syncing = true;
  setSyncStatus('saving');
  try {
    const payload = { members: state.members, leaves: state.leaves };
    const { error } = await ui.supabase.from('leave_manager_state').update({ data: payload, updated_at: new Date().toISOString() }).eq('id', 1);
    if (error) throw error;
    setSyncStatus('online');
    return true;
  } catch (error) {
    console.error(error);
    setSyncStatus('offline');
    toast('ذخیره اشتراکی انجام نشد. تغییر اعمال نشد.');
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
  else if (mode === 'offline') { pill.classList.add('offline'); label.textContent = 'دسترسی دیتابیس قطع است'; }
  else { label.textContent = 'قفل'; }
}

function getMonthlyLeaves(memberId, excludeId = '') { return state.leaves.filter(l => l.memberId === memberId && isInCurrentMonth(l) && !l.extraApproved && l.id !== excludeId); }
function quotaUsedHours(memberId, excludeId = '') { return getMonthlyLeaves(memberId, excludeId).reduce((sum, l) => sum + Number(l.hours || 0), 0); }
function quotaInfo(memberId, excludeId = '') {
  const used = Math.round(quotaUsedHours(memberId, excludeId) * 100) / 100;
  const left = Math.max(0, Math.round((MONTHLY_QUOTA_HOURS - used) * 100) / 100);
  return { used, left, pct: MONTHLY_QUOTA_HOURS ? clamp((used / MONTHLY_QUOTA_HOURS) * 100, 0, 100) : 0 };
}
function extraUsedHours(memberId) { return state.leaves.filter(l => l.memberId === memberId && isInCurrentMonth(l) && l.extraApproved).reduce((sum, l) => sum + Number(l.hours || 0), 0); }
function statusForQuota(q) {
  if (q.left <= 0) return ['zero', 'تمام شد'];
  if (q.left <= 6) return ['low', 'کمتر از ۶ ساعت'];
  return ['ok', 'باقی‌مانده مناسب'];
}
function quotaDaysEquivalent(used) { return (used / DAILY_LEAVE_HOURS).toFixed(2).replace(/\.00$/, ''); }

function leaveStatus(leave, now = new Date()) {
  const start = new Date(leave.startAt);
  const end = new Date(leave.endAt);
  if (now < start) return 'upcoming';
  if (now >= start && now < end) return 'active';
  return 'past';
}

function renderSummary() {
  $('#memberCount').textContent = faNum(state.members.length);
  const currentMonthLeaves = state.leaves.filter(isInCurrentMonth);
  const now = new Date();
  $('#activeLeaveCount').textContent = faNum(state.leaves.filter(l => leaveStatus(l, now) === 'active').length);
  $('#upcomingLeaveCount').textContent = faNum(state.leaves.filter(l => leaveStatus(l, now) === 'upcoming').length);
  const used = currentMonthLeaves.filter(l => !l.extraApproved).reduce((sum, l) => sum + Number(l.hours || 0), 0);
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
    const isOnLeave = state.leaves.some(l => l.memberId === member.id && leaveStatus(l, new Date()) === 'active');
    const leaveDotClass = isOnLeave ? 'active' : 'idle';
    const leaveDotText = isOnLeave ? 'در مرخصی' : 'آزاد';
    const ringColor = q.left <= 0 ? 'var(--red)' : q.left <= 6 ? 'var(--amber)' : 'var(--green)';
    return `<article class="member-card">
      <div class="member-head"><div class="member-main"><div class="avatar">${escapeHtml(initials(member.name))}</div><div><div class="member-name-row"><span class="leave-indicator ${leaveDotClass}" title="${leaveDotText}" aria-label="${leaveDotText}"></span><div class="member-name">${escapeHtml(member.name)}</div></div><div class="member-username">@${escapeHtml(member.username)}</div></div></div><span class="member-status ${statusClass}">${statusText}</span></div>
      <div class="quota-layout"><div class="usage-ring" style="--pct:${q.pct}%;--ring-color:${ringColor}"><div><strong>${formatHours(q.used)}h</strong><small>مصرف‌شده</small></div></div><div><div class="quota-title">مصرف سهمیه ماه</div><div class="quota-value">${formatHours(q.used)} از ۲۱ ساعت مصرف شده</div><div class="quota-remaining">باقی‌مانده مرخصی: <strong>${formatHours(q.left)} ساعت</strong></div><div class="quota-sub">معادل ${faNum((q.left / DAILY_LEAVE_HOURS).toFixed(2).replace(/\.00$/, ''))} روز کامل باقی مانده</div><div class="progress"><span style="width:${q.pct}%"></span></div>${extra > 0 ? `<span class="extra-badge">+ ${formatHours(extra)} ساعت مرخصی اضافه</span>` : ''}</div></div>
      <div class="member-actions"><button class="btn secondary" data-member-leave="${escapeHtml(member.id)}">ثبت مرخصی</button><button class="btn secondary" data-member-history="${escapeHtml(member.id)}">مشاهده سابقه</button></div>
    </article>`;
  }).join('');
}

function renderDatePreview(startAt, endAt) {
  if (!startAt || !endAt) return '<div class="preview-empty">تاریخ شروع و پایان به‌صورت خودکار هنگام ثبت محاسبه می‌شوند.</div>';
  return `<div class="date-preview-grid"><div><span>شروع</span>${formatDateOnlyBoth(startAt)}</div><div><span>پایان</span>${formatDateOnlyBoth(endAt)}</div></div>`;
}

function renderLiveRows(leaves) {
  const now = new Date();
  return leaves.map(leave => {
    const member = getMember(leave.memberId);
    if (!member) return '';
    const status = leaveStatus(leave, now);
    const typeLabel = leave.type === 'daily' ? 'روزانه' : 'ساعتی';
    const dateFormatter = formatDateOnlyBoth;
    const dateBlock = `<div class="leave-date-block"><div><span>شروع</span>${dateFormatter(leave.startAt)}</div><div><span>پایان</span>${dateFormatter(leave.endAt)}</div></div>`;
    const timer = status === 'active' ? `<div class="timer-wrap" data-timer data-start-at="${escapeHtml(leave.startAt)}" data-end-at="${escapeHtml(leave.endAt)}"><div class="leave-timer-ring"><div><strong data-timer-value>00:00:00</strong><small>گذشته</small></div></div><div class="timer-detail"><strong>زمان باقی‌مانده</strong><small class="timer-remaining" data-remaining>باقی‌مانده…</small></div></div>` : status === 'upcoming' ? `<div class="timer-wrap"><div class="leave-timer-ring" style="--progress:0%"><div><strong>—</strong><small>آینده</small></div></div><div class="timer-detail"><strong>هنوز شروع نشده</strong><small>در تاریخ تعیین‌شده فعال می‌شود</small></div></div>` : `<div class="timer-wrap"><div class="timer-detail"><strong>پایان‌یافته</strong><small>مرخصی به پایان رسیده است</small></div></div>`;
    return `<div class="board-row">
      <div class="board-person"><div class="avatar">${escapeHtml(initials(member.name))}</div><div><div class="board-name">${escapeHtml(member.name)}</div><div class="board-meta">@${escapeHtml(member.username)}</div></div></div>
      <div class="board-cell"><span class="badge ${status === 'active' ? 'active' : status === 'upcoming' ? 'upcoming' : ''}">${status === 'active' ? 'فعال' : status === 'upcoming' ? 'آینده' : 'پایان‌یافته'}</span></div>
      <div class="board-cell hide-mobile"><strong>${escapeHtml(typeLabel)}</strong>${leave.extraApproved ? '<div><span class="badge extra">اضافه</span></div>' : ''}</div>
      <div class="board-cell hide-mobile"><strong>${leave.type === 'daily' ? `${faNum(leave.durationDays || 1)} روز کامل` : `${faNum(Number(leave.hours || 0))} ساعت`}</strong></div>
      <div class="board-cell date-cell">${dateBlock}</div>
      <div class="board-cell">${timer}</div>
      <div class="table-actions"><button class="text-btn" data-edit-leave="${escapeHtml(leave.id)}">ویرایش</button><button class="text-btn danger" data-delete-leave="${escapeHtml(leave.id)}">حذف</button></div>
    </div>`;
  }).join('');
}

function renderLeaveBoard() {
  const allLeaves = state.leaves.slice().sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
  const now = new Date();
  let leaves = allLeaves;
  if (ui.boardTab === 'active') leaves = allLeaves.filter(l => leaveStatus(l, now) === 'active');
  if (ui.boardTab === 'upcoming') leaves = allLeaves.filter(l => leaveStatus(l, now) === 'upcoming');
  $('#leaveBoard').innerHTML = leaves.length ? `<div class="board-list">${renderLiveRows(leaves)}</div>` : '<div class="empty">موردی برای نمایش در این بخش وجود ندارد.</div>';
  updateLiveTimers();
}

function renderHistory() {
  const body = $('#historyTableBody');
  const rows = state.leaves.slice().sort((a, b) => new Date(b.startAt) - new Date(a.startAt));
  if (!rows.length) { body.innerHTML = '<tr><td colspan="7"><div class="empty">هنوز مرخصی‌ای ثبت نشده است.</div></td></tr>'; return; }
  const now = new Date();
  body.innerHTML = rows.map(l => {
    const m = getMember(l.memberId);
    const status = leaveStatus(l, now);
    const statusText = status === 'active' ? 'در حال مرخصی' : status === 'upcoming' ? 'آینده' : 'پایان‌یافته';
    const statusClass = status === 'active' ? 'active' : status === 'upcoming' ? 'upcoming' : '';
    const dateFormatter = l.type === 'daily' ? formatDateOnlyBoth : formatDateTimeBoth;
    return `<tr id="history-${escapeHtml(l.id)}"><td><strong>${escapeHtml(m?.name || 'عضو حذف‌شده')}</strong><div class="board-meta">@${escapeHtml(m?.username || '-')}</div></td><td>${l.type === 'daily' ? 'روزانه' : 'ساعتی'} ${l.extraApproved ? '<span class="badge extra">اضافه</span>' : ''}</td><td>${dateFormatter(l.startAt)}</td><td>${dateFormatter(l.endAt)}</td><td>${escapeHtml(l.type === 'daily' ? `${faNum(l.durationDays || 1)} روز کامل` : `${faNum(Number(l.hours || 0))} ساعت`)}</td><td><span class="badge ${statusClass}">${statusText}</span></td><td><div class="table-actions"><button class="text-btn" data-edit-leave="${escapeHtml(l.id)}">ویرایش</button><button class="text-btn danger" data-delete-leave="${escapeHtml(l.id)}">حذف</button></div></td></tr>`;
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

function getRequestedDays() {
  return clamp(Number.parseInt($('#leaveDays').value || '1', 10), MIN_DAILY_LEAVE_DAYS, MAX_DAILY_LEAVE_DAYS);
}
function getRequestedHours() {
  const type = $('#leaveType').value;
  if (type === 'daily') return getRequestedDays() * DAILY_LEAVE_HOURS;
  return clamp(Number.parseInt($('#leaveDurationHours').value || '1', 10), 1, 2);
}

function openLeaveModal(memberId = '') {
  $('#leaveForm').reset();
  $('#leaveModalTitle').textContent = 'ثبت مرخصی جدید';
  $('#leaveId').value = '';
  populateLeaveMember(memberId || state.members[0]?.id || '');
  $('#leaveType').value = 'daily';
  $('#leaveDays').value = '1';
  $('#leaveDurationHours').value = '1';
  $('#leaveExtra').value = 'no';
  $('#leaveLeader').value = '';
  $('#leaveNote').value = '';
  $('#leaveStartDate').value = todayLocalDateInput();
  $('#leaveModal').classList.remove('hidden');
  updateLeaveFormUI();
}

function updateLeaveFormUI() {
  const type = $('#leaveType').value;
  const extra = $('#leaveExtra').value === 'yes';
  const member = getMember($('#leaveMember').value);
  $('#dailyDaysField').classList.toggle('hidden', type !== 'daily');
  $('#hourlyDurationField').classList.toggle('hidden', type !== 'hourly');
  if (type === 'daily') $('#leaveDays').value = String(getRequestedDays());
  if (type === 'hourly') $('#leaveDurationHours').value = String(clamp(Number.parseInt($('#leaveDurationHours').value || '1', 10), 1, 2));
  const q = member ? quotaInfo(member.id, $('#leaveId').value) : { left: MONTHLY_QUOTA_HOURS, used: 0 };
  const hours = getRequestedHours();
  const durationDays = type === 'daily' ? getRequestedDays() : 0;
  const startDate = $('#leaveStartDate').value || ($('#leaveId').value ? localDateFromIso(state.leaves.find(l => l.id === $('#leaveId').value)?.startAt) : todayLocalDateInput());
  const startAt = localDateToStartIso(startDate);
  const durationMinutes = type === 'daily' ? durationDays * 24 * 60 : Math.round(hours * 60);
  const endAt = startAt ? calculateEndAt(startAt, type, hours, durationMinutes, durationDays) : '';
  $('#leaveDatePreview').innerHTML = renderDatePreview(startAt, endAt);
  const canFit = hours > 0 && q.left + 1e-9 >= hours;
  let hint = `سهمیه ${member ? escapeHtml(member.name) : 'عضو'}: ${formatHours(q.left)} ساعت از ۲۱ ساعت باقی مانده است.`;
  hint += type === 'daily' ? ` این درخواست ${faNum(durationDays)} روز کامل است و ${formatHours(hours)} ساعت از سهمیه کم می‌کند.` : ` این درخواست ${faNum(hours)} ساعت از سهمیه را مصرف می‌کند.`;
  if (extra) hint += canFit ? ' سهمیه هنوز کافی است؛ برای مرخصی اضافه باید سهمیه کافی نباشد.' : ' این درخواست به‌عنوان مرخصی اضافه ثبت می‌شود و از سهمیه ۲۱ ساعت کم نمی‌کند.';
  $('#leaveHint').innerHTML = hint;
  $('#leaveHint').classList.toggle('warn', extra || (!canFit && hours > 0));
  $('#leaderField').classList.toggle('hidden', !extra);
}

$('#leaveType').addEventListener('change', updateLeaveFormUI);
$('#leaveMember').addEventListener('change', updateLeaveFormUI);
$('#leaveExtra').addEventListener('change', updateLeaveFormUI);
$('#leaveDays').addEventListener('change', updateLeaveFormUI);
$('#leaveDurationHours').addEventListener('change', updateLeaveFormUI);
$('#leaveStartDate').addEventListener('change', updateLeaveFormUI);

$('#leaveForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (ui.dataMode !== 'remote') return toast('دسترسی امن به دیتابیس برقرار نیست.');
  const id = $('#leaveId').value;
  const memberId = $('#leaveMember').value;
  const type = $('#leaveType').value;
  const extraApproved = $('#leaveExtra').value === 'yes';
  const approvedBy = $('#leaveLeader').value.trim();
  const note = $('#leaveNote').value.trim();
  if (!memberId) return toast('عضو را انتخاب کنید.');
  if (type === 'daily') {
    const days = getRequestedDays();
    if (!Number.isInteger(days) || days < MIN_DAILY_LEAVE_DAYS || days > MAX_DAILY_LEAVE_DAYS) return toast('مرخصی روزانه باید بین ۱ تا ۷ روز باشد.');
  } else {
    const hourValue = Number.parseInt($('#leaveDurationHours').value || '0', 10);
    if (![1, 2].includes(hourValue)) return toast('مرخصی ساعتی فقط می‌تواند ۱ یا ۲ ساعت باشد.');
  }
  const hours = getRequestedHours();
  const durationDays = type === 'daily' ? getRequestedDays() : 0;
  const member = getMember(memberId);
  if (!member) return toast('عضو انتخاب‌شده پیدا نشد.');
  if (extraApproved) {
    const q = quotaInfo(memberId, id);
    if (!approvedBy) return toast('برای مرخصی اضافه نام لیدر تأییدکننده را وارد کنید.');
    if (q.left + 1e-9 >= hours) return toast('برای مرخصی اضافه باید سهمیه عادی برای این درخواست کافی نباشد.');
  } else {
    const q = quotaInfo(memberId, id);
    if (q.left + 1e-9 < hours) return toast(`سهمیه عادی کافی نیست؛ فقط ${formatHours(q.left)} ساعت باقی مانده است.`);
  }
  const existing = id ? state.leaves.find(l => l.id === id) : null;
  const startDate = $('#leaveStartDate').value;
  const startAt = localDateToStartIso(startDate);
  if (!startAt) return toast('تاریخ شروع مرخصی را به‌درستی انتخاب کنید.');
  const durationMinutes = type === 'daily' ? durationDays * 24 * 60 : Math.round(hours * 60);
  const endAt = calculateEndAt(startAt, type, hours, durationMinutes, durationDays);
  const record = { id: id || uuid('l'), memberId, type, date: localDateFromIso(startAt), start: localTimeFromIso(startAt), end: localTimeFromIso(endAt), startAt, endAt, hours, durationDays, minutes: durationMinutes, durationMinutes, extraApproved, approvedBy, note };
  if (existing) Object.assign(existing, record); else state.leaves.push(record);
  const saved = await persistState();
  if (!saved) return;
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
  $('#leaveDays').value = leave.type === 'daily' ? String(clamp(Number(leave.durationDays || 1), MIN_DAILY_LEAVE_DAYS, MAX_DAILY_LEAVE_DAYS)) : '1';
  $('#leaveDurationHours').value = leave.type === 'hourly' ? String(Number(leave.hours || 1) >= 2 ? 2 : 1) : '1';
  $('#leaveStartDate').value = localDateFromIso(leave.startAt) || todayLocalDateInput();
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
  const saved = await persistState();
  if (!saved) return;
  renderAll();
  toast('مرخصی حذف شد.');
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
  const saved = await persistState();
  if (!saved) return;
  resetMemberForm(); renderAll(); renderMembersSettings();
});
function resetMemberForm() { $('#memberForm').reset(); $('#memberId').value = ''; $('#cancelMemberEdit').classList.add('hidden'); }
function editMember(id) { const member = getMember(id); if (!member) return; $('#memberId').value = member.id; $('#memberName').value = member.name; $('#memberUsername').value = member.username; $('#cancelMemberEdit').classList.remove('hidden'); $('#memberName').focus(); }
async function deleteMember(id) {
  const member = getMember(id); if (!member) return;
  const linked = state.leaves.some(l => l.memberId === id);
  const message = linked ? `برای ${member.name} سابقه مرخصی وجود دارد. با حذف عضو سوابق نیز حذف می‌شوند. ادامه؟` : `عضو ${member.name} حذف شود؟`;
  if (!confirm(message)) return;
  state.members = state.members.filter(m => m.id !== id);
  state.leaves = state.leaves.filter(l => l.memberId !== id);
  const saved = await persistState();
  if (!saved) return;
  renderAll(); renderMembersSettings(); resetMemberForm(); toast('عضو حذف شد.');
}

$('#settingsBtn').addEventListener('click', () => { renderMembersSettings(); $('#membersModal').classList.remove('hidden'); });
$('#addLeaveBtn').addEventListener('click', () => openLeaveModal());
$('#cancelMemberEdit').addEventListener('click', resetMemberForm);
$('#logoutBtn').addEventListener('click', async () => { try { await ui.supabase.auth.signOut(); } catch (error) { console.error(error); } });
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

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!ui.supabase) return showAuthMessage('Supabase هنوز آماده نیست.', true);
  const username = normalizeUsername($('#loginUsername').value);
  const password = $('#loginPassword').value;
  if (!username || !password) return showAuthMessage('یوزرنیم و رمز عبور را وارد کنید.', true);
  $('#loginSubmit').disabled = true;
  showAuthMessage('در حال بررسی…');
  try {
    const { error } = await ui.supabase.auth.signInWithPassword({ email: usernameToEmail(username), password });
    if (error) throw error;
  } catch (error) {
    console.error(error);
    showAuthMessage('یوزرنیم یا رمز عبور اشتباه است، یا این حساب دسترسی Leave Board ندارد.', true);
    $('#loginSubmit').disabled = false;
    return;
  }
  $('#loginSubmit').disabled = false;
});

function showAuthMessage(message, isError = false) { const el = $('#authMessage'); el.textContent = message; el.classList.toggle('error', Boolean(isError)); }
function focusMemberHistory(memberId) { const rows = state.leaves.filter(l => l.memberId === memberId); if (!rows.length) return toast('برای این عضو سابقه‌ای وجود ندارد.'); const target = rows[0]; const el = document.getElementById(`history-${target.id}`); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('focus-row'); setTimeout(() => el.classList.remove('focus-row'), 1800); } }
function closeModal(id) { const el = document.getElementById(id); if (!el) return; el.classList.add('hidden'); el.setAttribute('aria-hidden', 'true'); }
function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2600); }

function updateLiveTimers() {
  const now = new Date();
  $$('[data-timer]').forEach(el => {
    const start = new Date(el.dataset.startAt);
    const end = new Date(el.dataset.endAt);
    const total = Math.max(1, end - start);
    const elapsed = clamp(now - start, 0, total);
    const progress = (elapsed / total) * 100;
    const remainingMs = Math.max(0, end - now);
    const ring = el.querySelector('.leave-timer-ring');
    const value = el.querySelector('[data-timer-value]');
    const remaining = el.querySelector('[data-remaining]');
    if (!ring || !value || !remaining) return;
    ring.style.setProperty('--progress', `${progress}%`);
    value.textContent = formatDurationSeconds(elapsed / 1000);
    remaining.textContent = `باقی‌مانده: ${formatDurationSeconds(remainingMs / 1000)}`;
  });
}
function clockTick() {
  if (ui.dataMode !== 'remote') return;
  const now = new Date();
  updateLiveTimers();
  const boardStatusSignature = state.leaves.map(l => `${l.id}:${leaveStatus(l, now)}`).join('|');
  if (boardStatusSignature !== lastClockSignature) { lastClockSignature = boardStatusSignature; renderSummary(); renderLeaveBoard(); renderHistory(); }
  else if (state.leaves.some(l => leaveStatus(l, now) === 'active')) renderSummary();
}
function renderAll() { renderSummary(); renderMembers(); renderLeaveBoard(); renderHistory(); renderMembersSettings(); }

$('#appShell').classList.add('hidden-until-auth');
initAuth();
setInterval(clockTick, 1000);
