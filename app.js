const STORAGE_KEY = 'leave-manager-v1';
const SETTINGS_KEY = 'leave-manager-settings-v1';
const DAILY_QUOTA = 7;
const HOURLY_QUOTA = 21;
const DAILY_HOURS = 3;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = loadState();
const ui = { boardTab: 'active' };

function pad2(n) { return String(n).padStart(2, '0'); }
function faNum(value) { return String(value).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]); }
function uuid(prefix = 'id') { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }
function nowLocalDateTime() {
  const d = new Date();
  return { date: `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`, time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}` };
}
function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}`;
}
function parseDateTime(date, time) {
  return new Date(`${date}T${time}:00`);
}
function durationHours(start, end) {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return (eh * 60 + em - (sh * 60 + sm)) / 60;
}
function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(`${dateStr}T12:00:00`);
  return new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function formatHours(hours) {
  const normalized = Math.round(hours * 100) / 100;
  if (Number.isInteger(normalized)) return faNum(normalized);
  return faNum(normalized.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''));
}
function initials(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map(p => p[0]).join('').toUpperCase() || '؟';
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return {
    members: [
      { id: uuid('m'), name: 'عضو نمونه ۱', username: 'member1' },
      { id: uuid('m'), name: 'عضو نمونه ۲', username: 'member2' },
      { id: uuid('m'), name: 'عضو نمونه ۳', username: 'member3' }
    ],
    leaves: []
  };
}
function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch (_) { return {}; }
}

const settings = loadSettings();
$('#monthPicker').value = settings.month || currentMonth();

function getMember(id) { return state.members.find(m => m.id === id); }
function monthLeaves(memberId, month = $('#monthPicker').value) {
  return state.leaves.filter(l => l.memberId === memberId && l.date.startsWith(month));
}
function normalUsage(memberId, month = $('#monthPicker').value, excludeId = '') {
  const leaves = monthLeaves(memberId, month).filter(l => !l.extraApproved && l.id !== excludeId);
  let daily = 0;
  let hourly = 0;
  for (const leave of leaves) {
    if (leave.type === 'daily') daily += 1;
    if (leave.type === 'hourly') hourly += leave.hours;
  }
  return { daily, hourly };
}
function extraUsage(memberId, month = $('#monthPicker').value) {
  return monthLeaves(memberId, month).filter(l => l.extraApproved);
}
function quotas(memberId, excludeId = '') {
  const usage = normalUsage(memberId, $('#monthPicker').value, excludeId);
  return {
    dailyLeft: Math.max(0, DAILY_QUOTA - usage.daily),
    hourlyLeft: Math.max(0, HOURLY_QUOTA - usage.hourly),
    dailyUsedPct: Math.min(100, (usage.daily / DAILY_QUOTA) * 100),
    hourlyUsedPct: Math.min(100, (usage.hourly / HOURLY_QUOTA) * 100)
  };
}

function statusFor(q) {
  if (q.dailyLeft === 0 && q.hourlyLeft === 0) return ['zero', 'سهمیه تمام شده'];
  if (q.dailyLeft <= 1 || q.hourlyLeft <= 3) return ['low', 'سهمیه کم'];
  return ['ok', 'سهمیه عادی'];
}

function renderSummary() {
  const month = $('#monthPicker').value;
  const today = nowLocalDateTime();
  const monthRecords = state.leaves.filter(l => l.date.startsWith(month));
  const active = state.leaves.filter(l => {
    const start = parseDateTime(l.date, l.start);
    const end = parseDateTime(l.date, l.end);
    return start <= new Date() && new Date() < end;
  }).length;
  const upcoming = state.leaves.filter(l => parseDateTime(l.date, l.start) > new Date()).length;
  $('#memberCount').textContent = faNum(state.members.length);
  $('#activeLeaveCount').textContent = faNum(active);
  $('#upcomingLeaveCount').textContent = faNum(upcoming);
  $('#usedLeaveCount').textContent = faNum(monthRecords.length);
}

function renderMembers() {
  const grid = $('#membersGrid');
  if (!state.members.length) {
    grid.innerHTML = `<div class="empty card" style="grid-column:1/-1">هنوز عضوی ثبت نشده است.</div>`;
    return;
  }
  grid.innerHTML = state.members.map(member => {
    const q = quotas(member.id);
    const [statusClass, statusText] = statusFor(q);
    const extras = extraUsage(member.id).length;
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
        <div class="quota">
          <div class="quota-box">
            <div class="quota-title">مرخصی روزانه</div>
            <div class="quota-value">${faNum(q.dailyLeft)} از ${faNum(DAILY_QUOTA)} روز</div>
            <div class="progress"><span style="width:${100 - q.dailyUsedPct}%"></span></div>
          </div>
          <div class="quota-box">
            <div class="quota-title">مرخصی ساعتی</div>
            <div class="quota-value">${formatHours(q.hourlyLeft)} از ${faNum(HOURLY_QUOTA)} ساعت</div>
            <div class="progress amber"><span style="width:${100 - q.hourlyUsedPct}%"></span></div>
          </div>
        </div>
        ${extras ? `<span class="extra-badge">${faNum(extras)} مرخصی اضافه ثبت شده</span>` : ''}
        <div class="member-actions">
          <button class="btn secondary" data-member-leave="${member.id}">ثبت مرخصی</button>
          <button class="btn secondary" data-member-history="${member.id}">سوابق</button>
        </div>
      </article>
    `;
  }).join('');
}

function leaveStatus(leave) {
  const now = new Date();
  const start = parseDateTime(leave.date, leave.start);
  const end = parseDateTime(leave.date, leave.end);
  if (now >= start && now < end) return 'active';
  if (now < start) return 'upcoming';
  return 'past';
}
function statusBadge(leave) {
  const status = leaveStatus(leave);
  if (status === 'active') return '<span class="badge active">● در حال مرخصی</span>';
  if (status === 'upcoming') return '<span class="badge upcoming">◷ در انتظار شروع</span>';
  return '<span class="badge">پایان‌یافته</span>';
}
function renderLeaveBoard() {
  const now = new Date();
  let leaves = [...state.leaves].sort((a,b) => parseDateTime(a.date,a.start) - parseDateTime(b.date,b.start));
  if (ui.boardTab === 'active') leaves = leaves.filter(l => leaveStatus(l) === 'active');
  if (ui.boardTab === 'upcoming') leaves = leaves.filter(l => leaveStatus(l) === 'upcoming');
  if (!leaves.length) {
    $('#leaveBoard').innerHTML = `<div class="empty">موردی برای نمایش وجود ندارد.</div>`;
    return;
  }
  $('#leaveBoard').innerHTML = `<div class="board-list">${leaves.map(leave => {
    const member = getMember(leave.memberId);
    if (!member) return '';
    const kind = leave.type === 'daily' ? 'روزانه' : 'ساعتی';
    const date = formatDate(leave.date);
    return `
      <div class="board-row">
        <div class="board-person">
          <div class="avatar">${escapeHtml(initials(member.name))}</div>
          <div>
            <div class="board-name">${escapeHtml(member.name)}</div>
            <div class="board-meta">@${escapeHtml(member.username)}</div>
          </div>
        </div>
        <div class="board-cell hide-mobile"><strong>${kind}</strong></div>
        <div class="board-cell hide-mobile"><strong>${date}</strong></div>
        <div class="board-cell"><strong>${leave.start} تا ${leave.end}</strong></div>
        <div>${leave.extraApproved ? `<span class="badge extra">اضافه${leave.approvedBy ? ` · ${escapeHtml(leave.approvedBy)}` : ''}</span>` : statusBadge(leave)}</div>
      </div>
    `;
  }).join('')}</div>`;
}

function renderHistory() {
  const month = $('#monthPicker').value;
  const rows = state.leaves.filter(l => l.date.startsWith(month)).sort((a,b) => parseDateTime(b.date,b.start) - parseDateTime(a.date,a.start));
  const body = $('#historyTableBody');
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="7" class="empty">برای این ماه مرخصی ثبت نشده است.</td></tr>`;
    return;
  }
  body.innerHTML = rows.map(leave => {
    const member = getMember(leave.memberId);
    return `
      <tr>
        <td><strong>${member ? escapeHtml(member.name) : 'عضو حذف‌شده'}</strong></td>
        <td>${leave.type === 'daily' ? 'روزانه' : 'ساعتی'}</td>
        <td>${formatDate(leave.date)}</td>
        <td>${leave.start} — ${leave.end}</td>
        <td>${leave.type === 'daily' ? '۳ ساعت' : `${formatHours(leave.hours)} ساعت`}</td>
        <td>${leave.extraApproved ? '<span class="badge extra">اضافه با تأیید لیدر</span>' : statusBadge(leave)}</td>
        <td><div class="table-actions"><button class="text-btn" data-edit-leave="${leave.id}">ویرایش</button><button class="text-btn danger" data-delete-leave="${leave.id}">حذف</button></div></td>
      </tr>
    `;
  }).join('');
}

function renderMembersSettings() {
  const box = $('#memberSettingsList');
  if (!state.members.length) {
    box.innerHTML = `<div class="empty">هیچ عضوی ثبت نشده است.</div>`;
    return;
  }
  box.innerHTML = state.members.map(member => `
    <div class="settings-row">
      <div class="settings-person"><div class="avatar">${escapeHtml(initials(member.name))}</div><strong>${escapeHtml(member.name)}</strong></div>
      <div class="settings-user">@${escapeHtml(member.username)}</div>
      <div class="table-actions"><button class="text-btn" data-edit-member="${member.id}">ویرایش</button><button class="text-btn danger" data-delete-member="${member.id}">حذف</button></div>
    </div>
  `).join('');
}

function populateLeaveMember(selectId) {
  const select = $(selectId);
  select.innerHTML = state.members.map(m => `<option value="${m.id}">${escapeHtml(m.name)} (@${escapeHtml(m.username)})</option>`).join('');
}
function resetLeaveForm(prefillMemberId = '') {
  $('#leaveForm').reset();
  $('#leaveId').value = '';
  $('#leaveLeader').value = '';
  $('#leaveModalTitle').textContent = 'ثبت مرخصی جدید';
  populateLeaveMember('#leaveMember');
  if (prefillMemberId) $('#leaveMember').value = prefillMemberId;
  const nd = nowLocalDateTime();
  $('#leaveDate').value = nd.date;
  $('#leaveStart').value = nd.time;
  const [h, m] = nd.time.split(':').map(Number);
  const endMins = h * 60 + m + DAILY_HOURS * 60;
  $('#leaveEnd').value = `${pad2(Math.floor((endMins % 1440) / 60))}:${pad2(endMins % 60)}`;
  updateLeaveFormUI();
}
function openLeaveModal(memberId='') {
  resetLeaveForm(memberId);
  $('#leaveModal').classList.remove('hidden');
  $('#leaveModal').setAttribute('aria-hidden','false');
}
function closeModal(id) { const el = document.getElementById(id); el.classList.add('hidden'); el.setAttribute('aria-hidden','true'); }

function updateLeaveFormUI() {
  const type = $('#leaveType').value;
  const endField = $('#leaveEndField');
  if (type === 'daily') {
    endField.style.opacity = '.65';
    $('#leaveEnd').required = true;
    $('#leaveHint').textContent = 'مرخصی روزانه همیشه ۳ ساعت از مدت کاری ثبت می‌کند و در سهمیه ۷ روزه محاسبه می‌شود.';
  } else {
    endField.style.opacity = '1';
    $('#leaveEnd').required = true;
    $('#leaveHint').textContent = 'مرخصی ساعتی از سهمیه ۲۱ ساعته ماه کم می‌شود. مدت با اختلاف ساعت شروع و پایان محاسبه خواهد شد.';
  }
  const member = getMember($('#leaveMember').value);
  if (member) {
    const q = quotas(member.id);
    const extra = $('#leaveExtra').value === 'yes';
    const summary = type === 'daily' ? `باقی‌مانده عادی: ${faNum(q.dailyLeft)} روز` : `باقی‌مانده عادی: ${formatHours(q.hourlyLeft)} ساعت`;
    $('#leaveHint').textContent += ` ${summary}${extra ? ' — این درخواست به‌عنوان مرخصی اضافه ثبت می‌شود و از سهمیه عادی کم نمی‌کند.' : ''}`;
    $('#leaveHint').classList.toggle('warn', extra);
  }
}

$('#leaveType').addEventListener('change', () => {
  if ($('#leaveType').value === 'daily') {
    const start = $('#leaveStart').value || '09:00';
    const [h,m] = start.split(':').map(Number);
    const mins = h * 60 + m + 180;
    $('#leaveEnd').value = `${pad2(Math.floor((mins % 1440) / 60))}:${pad2(mins % 60)}`;
  }
  updateLeaveFormUI();
});
$('#leaveMember').addEventListener('change', updateLeaveFormUI);
$('#leaveExtra').addEventListener('change', updateLeaveFormUI);
$('#leaveStart').addEventListener('change', () => { if ($('#leaveType').value === 'daily') $('#leaveType').dispatchEvent(new Event('change')); });

$('#leaveForm').addEventListener('submit', (e) => {
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
  const hours = type === 'daily' ? DAILY_HOURS : durationHours(start, end);
  if (hours <= 0) return toast('زمان پایان باید بعد از زمان شروع باشد.');
  if (type === 'hourly' && hours > 24) return toast('مدت مرخصی ساعتی معتبر نیست.');

  const existing = id ? state.leaves.find(l => l.id === id) : null;
  const q = quotas(memberId, id);
  if (extraApproved) {
    if (!approvedBy) return toast('برای مرخصی اضافه نام لیدر تأییدکننده را وارد کنید.');
    const quotaExhausted = type === 'daily' ? q.dailyLeft <= 0 : q.hourlyLeft < hours;
    if (!quotaExhausted) return toast('مرخصی اضافه فقط وقتی ثبت می‌شود که سهمیه عادی این نوع مرخصی کافی نباشد.');
  } else {
    if (type === 'daily' && q.dailyLeft <= 0) return toast('سهمیه ۷ روز مرخصی روزانه تمام شده؛ مرخصی اضافه را انتخاب کنید.');
    if (type === 'hourly' && q.hourlyLeft < hours) return toast('سهمیه ساعتی کافی نیست؛ مرخصی اضافه را انتخاب کنید.');
  }

  const record = { id: id || uuid('l'), memberId, type, date, start, end, hours, extraApproved, approvedBy, note };
  if (existing) Object.assign(existing, record); else state.leaves.push(record);
  saveState();
  renderAll();
  closeModal('leaveModal');
  toast(existing ? 'مرخصی ویرایش شد.' : 'مرخصی با موفقیت ثبت شد.');
});

function editLeave(id) {
  const leave = state.leaves.find(l => l.id === id);
  if (!leave) return;
  $('#leaveModalTitle').textContent = 'ویرایش مرخصی';
  populateLeaveMember('#leaveMember');
  $('#leaveId').value = leave.id;
  $('#leaveMember').value = leave.memberId;
  $('#leaveType').value = leave.type;
  $('#leaveDate').value = leave.date;
  $('#leaveStart').value = leave.start;
  $('#leaveEnd').value = leave.end;
  $('#leaveExtra').value = leave.extraApproved ? 'yes' : 'no';
  $('#leaveLeader').value = leave.approvedBy || '';
  $('#leaveNote').value = leave.note || '';
  updateLeaveFormUI();
  $('#leaveModal').classList.remove('hidden');
}
function deleteLeave(id) {
  const leave = state.leaves.find(l => l.id === id);
  if (!leave) return;
  const member = getMember(leave.memberId);
  if (!confirm(`مرخصی ${member ? member.name : ''} حذف شود؟`)) return;
  state.leaves = state.leaves.filter(l => l.id !== id);
  saveState(); renderAll(); toast('مرخصی حذف شد.');
}

$('#memberForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = $('#memberId').value;
  const name = $('#memberName').value.trim();
  const username = $('#memberUsername').value.trim().replace(/^@+/, '');
  if (!name || !username) return toast('نام و یوزرنیم را وارد کنید.');
  const duplicate = state.members.find(m => m.username.toLowerCase() === username.toLowerCase() && m.id !== id);
  if (duplicate) return toast('این username قبلاً ثبت شده است.');
  if (id) {
    const member = getMember(id);
    member.name = name; member.username = username;
    toast('اطلاعات عضو ویرایش شد.');
  } else {
    state.members.push({ id: uuid('m'), name, username });
    toast('عضو جدید اضافه شد.');
  }
  saveState();
  resetMemberForm();
  renderAll();
  renderMembersSettings();
});
function resetMemberForm() {
  $('#memberForm').reset();
  $('#memberId').value = '';
  $('#cancelMemberEdit').classList.add('hidden');
}
function editMember(id) {
  const member = getMember(id); if (!member) return;
  $('#memberId').value = member.id;
  $('#memberName').value = member.name;
  $('#memberUsername').value = member.username;
  $('#cancelMemberEdit').classList.remove('hidden');
  $('#memberName').focus();
}
function deleteMember(id) {
  const member = getMember(id); if (!member) return;
  const linked = state.leaves.some(l => l.memberId === id);
  const message = linked ? `برای ${member.name} سابقه مرخصی وجود دارد. با حذف عضو سوابق نیز حذف می‌شوند. ادامه؟` : `عضو ${member.name} حذف شود؟`;
  if (!confirm(message)) return;
  state.members = state.members.filter(m => m.id !== id);
  state.leaves = state.leaves.filter(l => l.memberId !== id);
  saveState(); renderAll(); renderMembersSettings(); resetMemberForm(); toast('عضو حذف شد.');
}

$('#monthPicker').addEventListener('change', () => {
  settings.month = $('#monthPicker').value;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  renderAll();
});
$('#settingsBtn').addEventListener('click', () => { renderMembersSettings(); $('#membersModal').classList.remove('hidden'); });
$('#addLeaveBtn').addEventListener('click', () => openLeaveModal());
$('#cancelMemberEdit').addEventListener('click', resetMemberForm);

$$('[data-close-modal]').forEach(btn => btn.addEventListener('click', () => closeModal(btn.dataset.closeModal)));
$$('.tab').forEach(tab => tab.addEventListener('click', () => {
  $$('.tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  ui.boardTab = tab.dataset.boardTab;
  renderLeaveBoard();
}));

document.addEventListener('click', (e) => {
  const memberLeave = e.target.closest('[data-member-leave]');
  if (memberLeave) return openLeaveModal(memberLeave.dataset.memberLeave);
  const memberHistory = e.target.closest('[data-member-history]');
  if (memberHistory) return focusMemberHistory(memberHistory.dataset.memberHistory);
  const editLeaveBtn = e.target.closest('[data-edit-leave]');
  if (editLeaveBtn) return editLeave(editLeaveBtn.dataset.editLeave);
  const deleteLeaveBtn = e.target.closest('[data-delete-leave]');
  if (deleteLeaveBtn) return deleteLeave(deleteLeaveBtn.dataset.deleteLeave);
  const editMemberBtn = e.target.closest('[data-edit-member]');
  if (editMemberBtn) return editMember(editMemberBtn.dataset.editMember);
  const deleteMemberBtn = e.target.closest('[data-delete-member]');
  if (deleteMemberBtn) return deleteMember(deleteMemberBtn.dataset.deleteMember);
});

function focusMemberHistory(memberId) {
  $('#historyTableBody').querySelectorAll('tr').forEach(row => row.classList.remove('focus-row'));
  const rows = state.leaves.filter(l => l.memberId === memberId && l.date.startsWith($('#monthPicker').value));
  if (!rows.length) return toast('برای این عضو در ماه انتخاب‌شده سابقه‌ای وجود ندارد.');
  const target = rows[0];
  const el = document.querySelector(`[data-edit-leave="${target.id}"]`);
  if (el) el.closest('tr').scrollIntoView({ behavior: 'smooth', block: 'center' });
  toast(`اولین سابقه ${getMember(memberId)?.name || ''} نمایش داده شد.`);
}

$('#exportBtn').addEventListener('click', () => {
  const payload = {
    exportedAt: new Date().toISOString(),
    version: 1,
    members: state.members,
    leaves: state.leaves
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `leave-manager-backup-${currentMonth()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('فایل پشتیبان ساخته شد.');
});

$('#importInput').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.members) || !Array.isArray(data.leaves)) throw new Error('format');
    if (!confirm('داده‌های فعلی با فایل پشتیبان جایگزین شوند؟')) return;
    state.members = data.members;
    state.leaves = data.leaves;
    saveState(); renderAll(); renderMembersSettings();
    toast('پشتیبان با موفقیت بازیابی شد.');
  } catch (_) {
    toast('فایل پشتیبان معتبر نیست.');
  } finally {
    e.target.value = '';
  }
});

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
}
let toastTimer;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function renderAll() {
  renderSummary();
  renderMembers();
  renderLeaveBoard();
  renderHistory();
}
renderAll();
setInterval(renderAll, 60_000);
