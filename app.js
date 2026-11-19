// Replaces Google's in-page connection with a normal web request to the same Apps Script back end.
(function () {
  var cfg = window.PSW_CONFIG || {};
  function run(onOk, onFail) {
    return {
      withSuccessHandler: function (f) { return run(f, onFail); },
      withFailureHandler: function (f) { return run(onOk, f); },
      api: function (token, action, payload) {
        if (!cfg.apiUrl || /PASTE/.test(cfg.apiUrl)) { onFail && onFail({ message: 'The web app address is not set in config.js' }); return; }
        fetch(cfg.apiUrl, { method: 'POST', redirect: 'follow', body: JSON.stringify({ token: token, action: action, payload: payload }) })
          .then(function (r) { return r.json(); })
          .then(function (j) { onOk && onOk(j); })
          .catch(function () { onFail && onFail({ message: 'Could not reach the server' }); });
      }
    };
  }
  window.google = { script: { run: run() } };
  window.APP_VERSION = '0.4.0';
  window.APP_HOST = 'GitHub Pages';
})();

(function () {
'use strict';

var VERSION = window.APP_VERSION || '';
var SPECIALTIES = ['Anesthesia', 'Cardiology', 'Nephrology', 'Pulmonology', 'Hematology', 'Endocrinology', 'Neurology', 'Genetics', 'Other'];
var TAGS = ['Cardiac', 'Asthma', 'Trisomy 21', 'Syndromic', 'Renal', 'Hematologic', 'Prematurity', 'Neurologic'];
var SPONSOR = ['Bahraini', 'Family of Bahraini', 'Family of government worker', 'Exempted', 'Self-payment', 'Covered by insurance'];
var PRIORITY = ['', 'Clinical', 'Social', 'Age-sensitive', 'Other'];
var REMOVE_REASONS = ['Patient refused procedure', 'Done in private', 'Not needed', 'Booked and did not attend', 'Called multiple times, no response', 'Other'];
var NOT_READY_REASONS = ['Sick', 'Traveling', 'Busy (exams)', 'Other'];
var CONTACT_TYPES = ['Called - reached', 'Called - no answer', 'Booked', 'Note'];
var CATS = ['Minor', 'Intermediate', 'Major'];
var DAYS = ['', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

var S = {
  token: null, user: null, d: null, today: '', view: 'list', cons: 'all', loadedAt: 0,
  f: { q: '', status: '', cat: '', care: '', proc: '', prio: false }, sort: 'priority',
  doneQ: '', doneStar: false, removedQ: '', calMonth: '', redrawList: null,
  dashCons: 'all', dashYear: '', idleTimer: null, backup: null
};

// ---------------------------------------------------------------- helpers
function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function opt(value, label, selected) {
  return '<option value="' + esc(value) + '"' + (selected ? ' selected' : '') + '>' + esc(label) + '</option>';
}
function val(id) { var e = $(id); return e ? e.value.trim() : ''; }
function checked(id) { var e = $(id); return !!(e && e.checked); }
function fmtDate(s) {
  if (!s) return '';
  var p = s.split('-');
  var out = (+p[2]) + ' ' + MONTHS[+p[1] - 1];
  if (S.today && p[0] !== S.today.split('-')[0]) out += ' ' + p[0];
  return out;
}
function utc(s) { var p = s.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
function daysBetween(a, b) { return Math.round((utc(b) - utc(a)) / 86400000); }
function addDaysStr(s, n) { return new Date(utc(s) + n * 86400000).toISOString().slice(0, 10); }
function ageMonths(dob, today) {
  if (!dob) return 0;
  var a = dob.split('-'), b = today.split('-');
  var m = (+b[0] - +a[0]) * 12 + (+b[1] - +a[1]);
  if (+b[2] < +a[2]) m--;
  return Math.max(0, m);
}
function ageText(dob) {
  var m = ageMonths(dob, S.today);
  return m < 24 ? m + 'm' : Math.floor(m / 12) + 'y';
}
function toast(msg, isErr) {
  var t = $('toast');
  t.textContent = msg;
  t.className = isErr ? 'err' : '';
  t.style.display = 'block';
  clearTimeout(toast.h);
  toast.h = setTimeout(function () { t.style.display = 'none'; }, isErr ? 6000 : 2800);
}
function store(k, v) { try { if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) { /* ignore */ } }
function fetchStored(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }

var SPEED = [];
function noteSpeed(ms) {
  if (ms !== null) { SPEED.push(ms); if (SPEED.length > 20) SPEED.shift(); }
  var el = document.getElementById('spd');
  if (el && SPEED.length) {
    ms = SPEED[SPEED.length - 1];
    var avg = SPEED.reduce(function (a, b) { return a + b; }, 0) / SPEED.length;
    el.textContent = (ms / 1000).toFixed(1) + ' s';
    el.title = 'Hosted on: ' + (window.APP_HOST || 'Apps Script') + '. Last server call ' + Math.round(ms) + ' ms; average of the last ' + SPEED.length + ' calls ' + Math.round(avg) + ' ms.';
  }
}
function call(action, payload) {
  var t0 = Date.now();
  return new Promise(function (resolve, reject) {
    google.script.run
      .withSuccessHandler(function (r) {
        noteSpeed(Date.now() - t0);
        if (r && r.ok) { resolve(r.data); return; }
        var m = (r && r.error) || 'Request failed';
        if (m === 'SESSION_EXPIRED') { expire(); }
        reject(new Error(m));
      })
      .withFailureHandler(function (e) { noteSpeed(Date.now() - t0); reject(new Error((e && e.message) || 'Could not reach the server')); })
      .api(S.token, action, payload || {});
  });
}
function fail(e) { if (e && e.message === 'SESSION_EXPIRED') return; toast(e.message || String(e), true); }

function openModal(html, o) {
  o = o || {};
  var ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = '<div class="modal' + (o.narrow ? ' narrow' : '') + '" role="dialog" aria-modal="true">' + html + '</div>';
  document.body.appendChild(ov);
  function close() { if (ov.parentNode) ov.parentNode.removeChild(ov); }
  if (!o.locked) ov.addEventListener('mousedown', function (e) { if (e.target === ov) close(); });
  return { el: ov.firstChild, close: close };
}
function closeAllModals() {
  var all = document.querySelectorAll('.overlay');
  for (var i = 0; i < all.length; i++) all[i].parentNode.removeChild(all[i]);
}
function on(root, sel, ev, fn) {
  var list = root.querySelectorAll(sel);
  for (var i = 0; i < list.length; i++) list[i].addEventListener(ev, fn);
}

// ---------------------------------------------------------------- data helpers
function procById(id) { var l = S.d.procedures; for (var i = 0; i < l.length; i++) if (l[i].Id === id) return l[i]; return null; }
function consById(id) { var l = S.d.consultants; for (var i = 0; i < l.length; i++) if (l[i].Id === id) return l[i]; return null; }
function consName(id) { var c = consById(id); return c ? c.Name : '(unknown)'; }
function getP(id) { var l = S.d.patients; for (var i = 0; i < l.length; i++) if (l[i].Id === id) return l[i]; return null; }
function upsertP(p) {
  var l = S.d.patients;
  for (var i = 0; i < l.length; i++) if (l[i].Id === p.Id) { l[i] = p; return; }
  l.push(p);
}
function isActive(p) { return p.Status === 'Ready' || p.Status === 'Awaiting clearance' || p.Status === 'Not ready'; }
function clearances(p) { try { var a = JSON.parse(p.Clearances || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
function tagsOf(p) { return (p.Tags || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean); }
function waitDays(p) { return Math.max(0, daysBetween(p.DateAdded || S.today, S.today)); }
function priceFor(p) {
  var pr = procById(p.ProcedureId);
  if (!pr) return '';
  var v = p.CareType === 'Inpatient' ? pr.PriceInpatient : pr.PriceDay;
  return v === '' ? '' : v;
}
function extras(p) { try { var a = JSON.parse(p.Extra || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
function totalMin(p) { return (Number(p.ExpMinutes) || 0) + extras(p).reduce(function (s, x) { return s + (Number(x.minutes) || 0); }, 0); }
function procLabel(p) {
  var s = p.Procedure + (p.Laterality ? ', ' + p.Laterality.toLowerCase() : '');
  extras(p).forEach(function (x) { s += ' + ' + x.procedure + (x.laterality ? ', ' + x.laterality.toLowerCase() : ''); });
  return s;
}
var WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
var LONGM = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function roomName(id) { var l = S.d.rooms || []; for (var i = 0; i < l.length; i++) if (l[i].Id === id) return l[i].Name; return ''; }
function listById(id) { var l = S.d.lists || []; for (var i = 0; i < l.length; i++) if (l[i].Id === id) return l[i]; return null; }
function fmtDay(s) { var p = s.split('-'); return WD[new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay()] + ' ' + fmtDate(s); }
function listTitle(l) { return consName(l.ConsultantId) + (l.RoomId ? ' · ' + roomName(l.RoomId) : ''); }
function onList(l) { return S.d.patients.filter(function (p) { return p.ListId === l.Id && p.Status !== 'Removed'; }); }
function listUsed(l) { var pts = onList(l); return { n: pts.length, min: pts.reduce(function (s, p) { return s + totalMin(p); }, 0) }; }
function upsertLists(l) { S.d.lists = l; }

function statusInfo(p) {
  if (p.Status === 'Ready') {
    if (p.ScheduledDate) {
      var bl = p.ListId ? listById(p.ListId) : null;
      return { label: 'Booked ' + fmtDate(p.ScheduledDate), cls: 'green', sub: bl ? listTitle(bl) : '' };
    }
    return { label: 'Ready', cls: 'green' };
  }
  if (p.Status === 'Awaiting clearance') {
    var pend = clearances(p).filter(function (c) { return c.state === 'Requested'; }).map(function (c) { return c.spec.toLowerCase(); });
    return { label: 'Awaiting ' + (pend.join(', ') || 'clearance'), cls: 'blue', sub: 'Not bookable until cleared' };
  }
  if (p.Status === 'Not ready') {
    return { label: 'Not ready until ' + fmtDate(p.NotReadyUntil), cls: '', sub: p.NotReadyReason };
  }
  return { label: p.Status, cls: '' };
}

function warnings(p) {
  var w = [];
  if (!isActive(p)) return w;
  var st = S.d.settings, t = S.today, pr = procById(p.ProcedureId);
  var wait = waitDays(p);
  var lim = Number(st['waitDays' + p.Category]) || 0;
  if (lim > 0 && wait > lim) w.push({ sev: 'high', text: 'Waiting ' + wait + ' d (limit ' + lim + ')' });
  if (pr && Number(pr.MaxAgeMonths) > 0) {
    var rem = Number(pr.MaxAgeMonths) - ageMonths(p.DOB, t);
    var wm = Number(pr.WarnMonthsBefore) || 3;
    if (rem < 0) w.push({ sev: 'high', text: 'Past age limit' });
    else if (rem <= wm) w.push({ sev: 'high', text: rem === 0 ? 'Age limit this month' : 'Age limit in ' + rem + ' mo' });
  }
  var target = p.TargetDate || (pr && Number(pr.TargetDays) > 0 ? addDaysStr(p.DateAdded, Number(pr.TargetDays)) : '');
  if (target) {
    var left = daysBetween(t, target), tw = Number(st.targetWarnDays) || 14;
    if (left < 0) w.push({ sev: 'high', text: 'Past target date by ' + (-left) + ' d' });
    else if (left <= tw) w.push({ sev: 'med', text: 'Target date in ' + left + ' d' });
  }
  var nc = Number(st.noContactDays) || 0;
  if (nc > 0 && p.Status !== 'Not ready') {
    var gap = daysBetween(p.LastContact || p.DateAdded, t);
    if (gap > nc) w.push({ sev: 'med', text: 'No contact for ' + gap + ' d' });
  }
  clearances(p).forEach(function (c) {
    if (c.state === 'Requested' && c.apptDate && c.apptDate < t) w.push({ sev: 'med', text: 'Check ' + c.spec + ' result (visit ' + fmtDate(c.apptDate) + ')' });
  });
  if (p.ScheduledDate && p.ScheduledDate < t) w.push({ sev: 'high', text: 'Booked date passed (' + fmtDate(p.ScheduledDate) + ')' });
  if (Number(p.CallCount) >= 3) w.push({ sev: 'med', text: 'Called ' + p.CallCount + ' times, no answer' });
  return w;
}

// ---------------------------------------------------------------- start up and login
function init() {
  S.token = fetchStored('psw_token');
  if (S.token) {
    load().catch(function () { tryAuto(); });
  } else {
    tryAuto();
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && S.d && Date.now() - S.loadedAt > 120000 && !document.querySelector('.overlay')) {
      load().catch(function () { /* ignore */ });
    }
  });
  ['click', 'keydown', 'touchstart', 'scroll', 'mousemove'].forEach(function (ev) { document.addEventListener(ev, idleTouch, true); });
  window.addEventListener('resize', function () {
    clearTimeout(init.h);
    init.h = setTimeout(function () { if (S.d && (S.view === 'list' || S.view === 'warn' || S.view === 'done' || S.view === 'removed') && !document.querySelector('.overlay')) render(); }, 200);
  });
}
function tryAuto() {
  S.token = null;
  call('autoLogin').then(function (r) {
    S.token = r.token; store('psw_token', r.token);
    return load();
  }).catch(function () { showLogin(); });
}
function expire() {
  S.token = null; S.d = null; store('psw_token', null); clearTimeout(S.idleTimer);
  closeAllModals();
  showLogin('Your session ended. Sign in again.');
}
function showLogin(msg) {
  $('app').innerHTML =
    '<div class="login"><h2>Pediatric Surgery</h2><p class="muted small" style="margin:4px 0 14px">Waiting list · v' + esc(VERSION) + '</p>' +
    (msg ? '<p class="small" style="color:var(--red)">' + esc(msg) + '</p>' : '') +
    '<div class="field"><label for="l_email">Email</label><input type="email" id="l_email" autocomplete="username"></div>' +
    '<div class="field"><label for="l_pin">PIN</label><input type="password" id="l_pin" autocomplete="current-password"></div>' +
    '<button class="primary" id="l_go" style="width:100%">Sign in</button></div>';
  function go() {
    var email = val('l_email'), pin = $('l_pin').value;
    if (!email || !pin) { toast('Enter your email and PIN', true); return; }
    $('l_go').disabled = true;
    call('login', { email: email, pin: pin }).then(function (r) {
      S.token = r.token; store('psw_token', r.token);
      return load();
    }).catch(function (e) { $('l_go').disabled = false; toast(e.message, true); });
  }
  $('l_go').addEventListener('click', go);
  $('l_pin').addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
  $('l_email').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('l_pin').focus(); });
}
function idleMs() { var m = Number(S.d && S.d.settings && S.d.settings.idleMinutes); if (isNaN(m)) m = 20; return m > 0 ? m * 60000 : 0; }
function resetIdle() {
  clearTimeout(S.idleTimer);
  if (!S.d || !idleMs()) return;
  S.idleTimer = setTimeout(function () {
    if (!S.d) return;
    var mins = Math.round(idleMs() / 60000);
    call('logout').catch(function () { /* ignore */ }).then(function () {
      S.token = null; S.d = null; store('psw_token', null); closeAllModals();
      showLogin('You were signed out after ' + mins + ' minutes without activity.');
    });
  }, idleMs());
}
var idleLast = 0;
function idleTouch() { var n = Date.now(); if (n - idleLast > 5000) { idleLast = n; resetIdle(); } }
function load() {
  return call('bootstrap').then(function (d) {
    S.d = d; S.user = d.user; S.today = d.today; S.loadedAt = Date.now();
    resetIdle();
    render();
    if (S.user.MustChange) forcePinChange();
  });
}
function forcePinChange() {
  var m = openModal('<h2>Choose your own PIN</h2><p class="muted small">You are using a temporary PIN. Set a new one with at least 6 characters.</p>' +
    '<div class="field"><label for="p_old">Temporary PIN</label><input type="password" id="p_old"></div>' +
    '<div class="field"><label for="p_new">New PIN</label><input type="password" id="p_new"></div>' +
    '<div class="field"><label for="p_new2">Repeat new PIN</label><input type="password" id="p_new2"></div>' +
    '<button class="primary" id="p_go">Save PIN</button>', { narrow: true, locked: true });
  $('p_go').addEventListener('click', function () {
    if ($('p_new').value !== $('p_new2').value) { toast('The new PINs do not match', true); return; }
    call('changePin', { oldPin: $('p_old').value, newPin: $('p_new').value }).then(function (u) {
      S.user = u; m.close(); toast('PIN changed');
    }).catch(fail);
  });
}

// ---------------------------------------------------------------- shell and navigation
function render() {
  if (!S.d) return;
  var nw = S.d.patients.filter(function (p) { return warnings(p).length > 0; }).length;
  var nav = [['list', 'Waiting list'], ['cal', 'Calendar'], ['dash', 'Dashboard'], ['warn', 'Warnings' + (nw ? ' (' + nw + ')' : '')], ['done', 'Done'], ['removed', 'Removed'], ['settings', 'Settings']];
  $('app').innerHTML =
    '<div class="topbar"><div class="row"><strong>Pediatric Surgery</strong><span class="muted small">v' + esc(VERSION) + '</span><span class="muted small" id="spd"></span></div>' +
    '<div class="nav">' + nav.map(function (n) { return '<button data-v="' + n[0] + '" class="' + (S.view === n[0] ? 'on' : '') + '">' + esc(n[1]) + '</button>'; }).join('') + '</div>' +
    '<div class="row"><span class="muted small">' + esc(S.user.Name) + '</span><button id="refresh" title="Reload data">Refresh</button><button id="logout">Sign out</button></div></div>' +
    '<div class="page" id="view"></div>';
  noteSpeed(null);
  on(document, '.nav button', 'click', function (e) { S.view = e.currentTarget.getAttribute('data-v'); render(); window.scrollTo(0, 0); });
  $('refresh').addEventListener('click', function () { load().then(function () { toast('Data reloaded'); }).catch(fail); });
  $('logout').addEventListener('click', function () {
    call('logout').catch(function () { /* ignore */ }).then(function () { S.token = null; S.d = null; store('psw_token', null); clearTimeout(S.idleTimer); showLogin(); });
  });
  if (S.view === 'list') viewList();
  else if (S.view === 'cal') viewCalendar();
  else if (S.view === 'dash') viewDashboard();
  else if (S.view === 'warn') viewWarn();
  else if (S.view === 'done') viewDone();
  else if (S.view === 'removed') viewRemoved();
  else viewSettings();
  if (S.redrawList) S.redrawList();
}
function useTable() { return window.innerWidth >= 860; }

// ---------------------------------------------------------------- waiting list
function activeList() {
  return S.d.patients.filter(function (p) {
    return isActive(p) && (S.cons === 'all' || p.ConsultantId === S.cons);
  });
}
function applyFilters(list) {
  var f = S.f, q = f.q.toLowerCase();
  return list.filter(function (p) {
    if (q && (p.Name + ' ' + p.MRN).toLowerCase().indexOf(q) < 0) return false;
    if (f.status && p.Status !== f.status) return false;
    if (f.cat && p.Category !== f.cat) return false;
    if (f.care && p.CareType !== f.care) return false;
    if (f.proc && p.ProcedureId !== f.proc && p.Procedure !== f.proc) return false;
    if (f.prio && !p.Priority) return false;
    return true;
  });
}
function sortList(list, key) {
  var k = key || S.sort;
  var arr = list.slice();
  var cache = {};
  function wc(p) { if (!cache[p.Id]) cache[p.Id] = warnings(p).filter(function (x) { return x.sev === 'high'; }).length; return cache[p.Id]; }
  arr.sort(function (a, b) {
    if (k === 'wait') return waitDays(b) - waitDays(a);
    if (k === 'name') return a.Name.localeCompare(b.Name);
    if (k === 'procedure') return a.Procedure.localeCompare(b.Procedure) || waitDays(b) - waitDays(a);
    if (k === 'age') return ageMonths(a.DOB, S.today) - ageMonths(b.DOB, S.today);
    var pa = a.Priority ? 1 : 0, pb = b.Priority ? 1 : 0;
    if (pa !== pb) return pb - pa;
    if (wc(a) !== wc(b)) return wc(b) - wc(a);
    return waitDays(b) - waitDays(a);
  });
  return arr;
}

function viewList() {
  var d = S.d;
  var procs = d.procedures.filter(function (p) { return p.Active === 'Y'; });
  var cons = d.consultants.filter(function (c) { return c.Active === 'Y'; });
  $('view').innerHTML =
    '<div class="spread"><h2>Waiting list</h2><button class="primary" id="addp">Add patient</button></div>' +
    '<div class="pills" id="conspills"></div>' +
    '<div class="filters">' +
    '<input type="text" id="fq" placeholder="Search name or MRN" value="' + esc(S.f.q) + '">' +
    '<select id="fstatus"><option value="">All statuses</option>' + ['Ready', 'Awaiting clearance', 'Not ready'].map(function (s) { return opt(s, s, S.f.status === s); }).join('') + '</select>' +
    '<select id="fcat"><option value="">All categories</option>' + CATS.map(function (s) { return opt(s, s, S.f.cat === s); }).join('') + '</select>' +
    '<select id="fcare"><option value="">Day-case and inpatient</option>' + ['Day-case', 'Inpatient'].map(function (s) { return opt(s, s, S.f.care === s); }).join('') + '</select>' +
    '<select id="fproc"><option value="">All procedures</option>' + procs.map(function (p) { return opt(p.Id, p.Name, S.f.proc === p.Id); }).join('') + '</select>' +
    '<select id="fsort">' + [['priority', 'Sort: priority and wait'], ['wait', 'Sort: longest wait'], ['name', 'Sort: name'], ['procedure', 'Sort: procedure'], ['age', 'Sort: youngest first']].map(function (s) { return opt(s[0], s[1], S.sort === s[0]); }).join('') + '</select>' +
    '<label class="check" style="padding-top:8px"><input type="checkbox" id="fprio"' + (S.f.prio ? ' checked' : '') + '> Priority only</label>' +
    '</div><div id="listBody"></div>';
  $('addp').addEventListener('click', function () { openPatient(null); });
  $('fq').addEventListener('input', function () { S.f.q = this.value; listBody(); });
  [['fstatus', 'status'], ['fcat', 'cat'], ['fcare', 'care'], ['fproc', 'proc']].forEach(function (x) {
    $(x[0]).addEventListener('change', function () { S.f[x[1]] = this.value; listBody(); });
  });
  $('fsort').addEventListener('change', function () { S.sort = this.value; listBody(); });
  $('fprio').addEventListener('change', function () { S.f.prio = this.checked; listBody(); });
  var cp = $('conspills');
  cp.innerHTML = '<span class="pill' + (S.cons === 'all' ? ' on' : '') + '" data-c="all">All</span>' +
    cons.map(function (c) { return '<span class="pill' + (S.cons === c.Id ? ' on' : '') + '" data-c="' + esc(c.Id) + '">' + esc(c.Name) + '</span>'; }).join('');
  on(cp, '.pill', 'click', function (e) { S.cons = e.currentTarget.getAttribute('data-c'); viewList(); });
  listBody();
}

function patientRowsHtml(list) {
  if (!list.length) return '<p class="muted">No patients match.</p>';
  if (useTable()) {
    return '<table class="tbl"><thead><tr><th>Patient</th><th>Procedure</th><th>Category</th><th>Type</th><th>Status</th><th>Wait</th><th>Flags</th><th></th></tr></thead><tbody>' +
      list.map(function (p) {
        var si = statusInfo(p);
        return '<tr class="click" data-id="' + esc(p.Id) + '">' +
          '<td>' + (p.Starred ? '<span class="chip amber">★</span>' : '') + '<strong>' + esc(p.Name) + '</strong><br><span class="muted small">' + esc(ageText(p.DOB)) + ' · ' + esc(p.MRN) + ' · ' + esc(consName(p.ConsultantId)) + '</span></td>' +
          '<td>' + esc(procLabel(p)) + '<br><span class="muted small">' + esc(p.Diagnosis) + '</span></td>' +
          '<td>' + esc(p.Category) + '<br><span class="muted small">' + totalMin(p) + ' min</span></td>' +
          '<td>' + esc(p.CareType) + (p.NeedsAdmission ? '<br><span class="muted small">Needs admission</span>' : '') + '</td>' +
          '<td><span class="chip ' + si.cls + '">' + esc(si.label) + '</span>' + (si.sub ? '<br><span class="muted small">' + esc(si.sub) + '</span>' : '') + '</td>' +
          '<td>' + waitDays(p) + ' d</td>' +
          '<td>' + flagsHtml(p) + '</td><td>' + sendBtn(p) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }
  return '<div class="cards">' + list.map(function (p) {
    var si = statusInfo(p);
    return '<div class="card" data-id="' + esc(p.Id) + '">' +
      '<div class="spread"><div class="name">' + (p.Starred ? '★ ' : '') + esc(p.Name) + ' <span class="muted small">· ' + esc(ageText(p.DOB)) + ' · ' + esc(p.MRN) + '</span></div>' +
      '<span class="chip ' + si.cls + '">' + esc(si.label) + '</span></div>' +
      '<div class="small" style="margin-top:2px">' + esc(procLabel(p)) + ' · ' + esc(consName(p.ConsultantId)) + '</div>' +
      '<div style="margin-top:4px"><span class="chip">' + esc(p.Category) + ' · ' + esc(p.ExpMinutes) + ' min</span><span class="chip">' + esc(p.CareType) + '</span><span class="chip">Waiting ' + waitDays(p) + ' d</span>' + flagsHtml(p) + '</div>' + (isActive(p) ? '<div style="margin-top:6px">' + sendBtn(p) + '</div>' : '') + '</div>';
  }).join('') + '</div>';
}
function canSend(p) { return p.Status === 'Ready' && !p.ListId; }
function sendWhy(p) { return p.ListId ? 'Already booked on an OT list' : p.Status === 'Awaiting clearance' ? 'Not cleared yet' : p.Status === 'Not ready' ? 'Patient is not ready' : ''; }
function sendBtn(p) {
  if (canSend(p)) return '<button data-send="' + esc(p.Id) + '">Add to OT</button>';
  if (isActive(p)) return '<button disabled class="greyed ' + (p.ListId ? 'bk' : 'nr') + '" title="' + esc(sendWhy(p)) + '">' + (p.ListId ? 'Booked' : 'Not ready') + '</button>';
  return '';
}
function flagsHtml(p) {
  var h = '';
  if (p.Priority) h += '<span class="chip amber">Priority: ' + esc(p.Priority) + '</span>';
  warnings(p).forEach(function (w) { h += '<span class="chip ' + (w.sev === 'high' ? 'red' : 'amber') + '">' + esc(w.text) + '</span>'; });
  var tags = tagsOf(p);
  if (tags.length) h += tags.map(function (t) { return '<span class="chip">' + esc(t) + '</span>'; }).join('');
  else if (!clearances(p).some(function (c) { return c.state === 'Requested'; })) h += '<span class="chip">Medically free</span>';
  return h;
}
function bindRows(root) {
  on(root, '[data-send]', 'click', function (e) { e.stopPropagation(); dlgSendToList(getP(e.currentTarget.getAttribute('data-send'))); });
  on(root, '[data-id]', 'click', function (e) {
    if (e.target.closest && e.target.closest('button')) return;
    openPatient(e.currentTarget.getAttribute('data-id'));
  });
}

function listBody() {
  var base = activeList();
  var counts = { all: base.length, Ready: 0, 'Awaiting clearance': 0, 'Not ready': 0 };
  var byProc = {};
  var nw = 0;
  base.forEach(function (p) {
    counts[p.Status]++;
    byProc[p.Procedure] = (byProc[p.Procedure] || 0) + 1;
    if (warnings(p).length) nw++;
  });
  var list = sortList(applyFilters(base));
  var procChips = Object.keys(byProc).sort(function (a, b) { return byProc[b] - byProc[a]; }).map(function (k) {
    return '<span class="pill' + (S.f.proc === k ? ' on' : '') + '" data-proc="' + esc(k) + '">' + esc(k) + ' ' + byProc[k] + '</span>';
  }).join('');
  $('listBody').innerHTML =
    '<div class="tiles">' +
    '<div class="tile"><div class="n">' + counts.all + '</div><div class="l">Waiting</div></div>' +
    '<div class="tile"><div class="n">' + counts.Ready + '</div><div class="l">Ready or booked</div></div>' +
    '<div class="tile"><div class="n">' + counts['Awaiting clearance'] + '</div><div class="l">Awaiting clearance</div></div>' +
    '<div class="tile"><div class="n">' + counts['Not ready'] + '</div><div class="l">Not ready</div></div>' +
    '<div class="tile"><div class="n">' + nw + '</div><div class="l">With warnings</div></div></div>' +
    '<div class="pills">' + procChips + '</div>' +
    '<p class="muted small">Showing ' + list.length + ' of ' + base.length + '</p>' +
    patientRowsHtml(list);
  var lb = $('listBody');
  on(lb, '[data-proc]', 'click', function (e) {
    var k = e.currentTarget.getAttribute('data-proc');
    S.f.proc = (S.f.proc === k) ? '' : k;
    var sel = $('fproc'); if (sel) sel.value = '';
    listBody();
  });
  bindRows(lb);
}

// ---------------------------------------------------------------- warnings, done, removed
function viewWarn() {
  var rows = S.d.patients.map(function (p) { return { p: p, w: warnings(p) }; }).filter(function (x) { return x.w.length; });
  rows.sort(function (a, b) {
    var ha = a.w.filter(function (x) { return x.sev === 'high'; }).length, hb = b.w.filter(function (x) { return x.sev === 'high'; }).length;
    return hb - ha || b.w.length - a.w.length;
  });
  $('view').innerHTML = '<h2>Warnings</h2><p class="muted small">Patients who need attention. Thresholds are in Settings.</p>' +
    (rows.length ? rows.map(function (x) {
      var high = x.w.some(function (w) { return w.sev === 'high'; });
      return '<div class="panel warnrow ' + (high ? 'high' : '') + '" data-id="' + esc(x.p.Id) + '" style="cursor:pointer">' +
        '<div class="spread"><strong>' + esc(x.p.Name) + '</strong><span class="muted small">' + esc(x.p.MRN) + ' · ' + esc(consName(x.p.ConsultantId)) + '</span></div>' +
        '<div class="small">' + esc(procLabel(x.p)) + '</div>' +
        '<div>' + x.w.map(function (w) { return '<span class="chip ' + (w.sev === 'high' ? 'red' : 'amber') + '">' + esc(w.text) + '</span>'; }).join('') + '</div></div>';
    }).join('') : '<p class="muted">No warnings. Nice.</p>');
  bindRows($('view'));
}

function viewDone() {
  $('view').innerHTML = '<h2>Done cases</h2>' +
    '<div class="filters"><input type="text" id="dq" placeholder="Search name or MRN" value="' + esc(S.doneQ) + '">' +
    '<label class="check" style="padding-top:8px"><input type="checkbox" id="dstar"' + (S.doneStar ? ' checked' : '') + '> Starred for case report</label></div>' +
    '<div id="doneBody"></div>';
  $('dq').addEventListener('input', function () { S.doneQ = this.value; doneBody(); });
  $('dstar').addEventListener('change', function () { S.doneStar = this.checked; doneBody(); });
  doneBody();
}
function doneBody() {
  var q = S.doneQ.toLowerCase();
  var list = S.d.patients.filter(function (p) {
    return p.Status === 'Done' && (!q || (p.Name + ' ' + p.MRN).toLowerCase().indexOf(q) >= 0) && (!S.doneStar || p.Starred);
  }).sort(function (a, b) { return (b.DoneDate || '').localeCompare(a.DoneDate || ''); });
  $('doneBody').innerHTML = list.length ?
    '<table class="tbl"><thead><tr><th>Patient</th><th>Procedure</th><th>Consultant</th><th>Done</th><th>Notes</th></tr></thead><tbody>' +
    list.map(function (p) {
      return '<tr class="click" data-id="' + esc(p.Id) + '"><td>' + (p.Starred ? '<span class="chip amber">★</span>' : '') + '<strong>' + esc(p.Name) + '</strong><br><span class="muted small">' + esc(ageText(p.DOB)) + ' · ' + esc(p.MRN) + '</span></td>' +
        '<td>' + esc(procLabel(p)) + '</td><td>' + esc(consName(p.ConsultantId)) + '</td><td>' + esc(fmtDate(p.DoneDate)) + '</td><td>' + esc(p.DoneNotes) + '</td></tr>';
    }).join('') + '</tbody></table>' : '<p class="muted">No done cases yet.</p>';
  bindRows($('doneBody'));
}

function viewRemoved() {
  $('view').innerHTML = '<h2>Removed from the list</h2>' +
    '<div class="filters"><input type="text" id="rq" placeholder="Search name or MRN" value="' + esc(S.removedQ) + '"></div><div id="remBody"></div>';
  $('rq').addEventListener('input', function () { S.removedQ = this.value; remBody(); });
  remBody();
}
function remBody() {
  var q = S.removedQ.toLowerCase();
  var list = S.d.patients.filter(function (p) {
    return p.Status === 'Removed' && (!q || (p.Name + ' ' + p.MRN).toLowerCase().indexOf(q) >= 0);
  }).sort(function (a, b) { return (b.RemovedDate || '').localeCompare(a.RemovedDate || ''); });
  $('remBody').innerHTML = list.length ?
    '<table class="tbl"><thead><tr><th>Patient</th><th>Procedure</th><th>Reason</th><th>Removed</th><th></th></tr></thead><tbody>' +
    list.map(function (p) {
      return '<tr class="click" data-id="' + esc(p.Id) + '"><td><strong>' + esc(p.Name) + '</strong><br><span class="muted small">' + esc(ageText(p.DOB)) + ' · ' + esc(p.MRN) + '</span></td>' +
        '<td>' + esc(procLabel(p)) + '</td><td>' + esc(p.RemovedReason) + (p.RemovedNote ? '<br><span class="muted small">' + esc(p.RemovedNote) + '</span>' : '') + '</td>' +
        '<td>' + esc(fmtDate(p.RemovedDate)) + '</td><td><button data-restore="' + esc(p.Id) + '">Restore</button></td></tr>';
    }).join('') + '</tbody></table>' : '<p class="muted">Nobody has been removed.</p>';
  bindRows($('remBody'));
  on($('remBody'), '[data-restore]', 'click', function (e) {
    e.stopPropagation();
    var id = e.currentTarget.getAttribute('data-restore');
    call('restorePatient', { patientId: id }).then(function (p) { upsertP(p); render(); toast('Patient restored to the list'); }).catch(fail);
  });
}

// ---------------------------------------------------------------- patient record
function openPatient(id) {
  var p = id ? getP(id) : null;
  var isNew = !p;
  var d = S.d;
  var procs = d.procedures.filter(function (x) { return x.Active === 'Y' || (p && x.Id === p.ProcedureId); });
  var cons = d.consultants.filter(function (c) { return c.Active === 'Y' || (p && c.Id === p.ConsultantId); });
  var procSel = '';
  if (p) procSel = procById(p.ProcedureId) ? p.ProcedureId : (p.Procedure ? '__other' : '');
  var preCons = p ? p.ConsultantId : (S.cons !== 'all' ? S.cons : '');
  var tags = p ? tagsOf(p) : [];
  var extraTags = p ? (p.TagsOther || '') : '';
  var statusLine = '';
  if (p) {
    var si = statusInfo(p);
    statusLine = '<span class="chip ' + si.cls + '">' + esc(si.label) + '</span>' + (si.sub ? '<span class="muted small"> ' + esc(si.sub) + '</span>' : '');
  }
  var html =
    '<div class="spread"><h2>' + (isNew ? 'Add patient' : esc(p.Name)) + '</h2><button id="f_close">Close</button></div>' +
    (p ? '<div style="margin-bottom:8px">' + statusLine + '</div>' : '') +
    '<div class="grid2">' +
    '<div class="field"><label for="f_name">Name *</label><input type="text" id="f_name" value="' + esc(p ? p.Name : '') + '"></div>' +
    '<div class="field"><label for="f_mrn">MRN *</label><input type="text" id="f_mrn" value="' + esc(p ? p.MRN : '') + '"></div>' +
    '<div class="field"><label for="f_dob">Date of birth *</label><input type="date" id="f_dob" value="' + esc(p ? p.DOB : '') + '"></div>' +
    '<div class="field"><label for="f_sex">Sex</label><select id="f_sex">' + opt('', '', !p || !p.Sex) + opt('M', 'Male', p && p.Sex === 'M') + opt('F', 'Female', p && p.Sex === 'F') + '</select></div>' +
    '<div class="field"><label for="f_guard">Guardian contact</label><input type="text" id="f_guard" value="' + esc(p ? p.Guardian : '') + '"></div>' +
    '<div class="field"><label for="f_cons">Consultant *</label><select id="f_cons">' + opt('', 'Choose…', !preCons) + cons.map(function (c) { return opt(c.Id, c.Name, c.Id === preCons); }).join('') + '</select></div>' +
    '<div class="field"><label for="f_seen">Seen by consultant</label><select id="f_seen">' + opt('', '', !p || !p.SeenByConsultant) + opt('Y', 'Yes', p && p.SeenByConsultant === 'Y') + opt('N', 'No', p && p.SeenByConsultant === 'N') + '</select></div>' +
    '<div class="field"><label for="f_added">Date added</label><input type="date" id="f_added" value="' + esc(p ? p.DateAdded : S.today) + '"></div></div>' +

    '<div class="sect"><h3>Procedure</h3><div class="grid2">' +
    '<div class="field"><label for="f_proc">Procedure *</label><select id="f_proc">' + opt('', 'Choose…', !procSel) + procs.map(function (x) { return opt(x.Id, x.Name, x.Id === procSel); }).join('') + opt('__other', 'Other (type the name)', procSel === '__other') + '</select></div>' +
    '<div class="field" id="r_procother"><label for="f_procother">Procedure name</label><input type="text" id="f_procother" value="' + esc(p && procSel === '__other' ? p.Procedure : '') + '"></div>' +
    '<div class="field" id="r_lat"><label for="f_lat">Side</label><select id="f_lat">' + opt('', '', !p || !p.Laterality) + ['Right', 'Left', 'Bilateral'].map(function (s) { return opt(s, s, p && p.Laterality === s); }).join('') + '</select></div>' +
    '<div class="field"><label for="f_dx">Diagnosis</label><input type="text" id="f_dx" value="' + esc(p ? p.Diagnosis : '') + '"></div>' +
    '<div class="field"><label for="f_cat">Category</label><select id="f_cat">' + CATS.map(function (s) { return opt(s, s, p && p.Category === s); }).join('') + '</select></div>' +
    '<div class="field"><label for="f_min">Expected time (minutes)</label><input type="number" id="f_min" min="0" value="' + esc(p ? p.ExpMinutes : '') + '"></div>' +
    '<div class="field"><label for="f_care">Day-case or inpatient</label><select id="f_care">' + ['Day-case', 'Inpatient'].map(function (s) { return opt(s, s, p && p.CareType === s); }).join('') + '</select></div>' +
    '<div class="field"><label>&nbsp;</label><label class="check"><input type="checkbox" id="f_admit"' + (p && p.NeedsAdmission ? ' checked' : '') + '> Needs prior admission</label></div>' +
    '<div class="field"><label for="f_target">Target date (optional)</label><input type="date" id="f_target" value="' + esc(p ? p.TargetDate : '') + '"></div>' +
    '<div class="field"><label for="f_sched">Booked on OT list</label><input type="date" id="f_sched" value="' + esc(p ? p.ScheduledDate : '') + '" disabled></div></div>' +
    '<p class="small muted" id="f_price"></p><p class="small" id="f_sponsorhint" style="color:var(--amber)"></p></div>' +
    '<div class="sect"><h3>Additional procedures in the same sitting</h3><div id="f_ex"></div><button type="button" id="f_addex">Add procedure</button><p class="small muted" id="f_total"></p></div>' +

    '<div class="sect"><h3>Medical</h3>' +
    '<label>Conditions (none ticked means medically free)</label><div class="tags" style="margin-bottom:10px">' +
    TAGS.map(function (t, i) { return '<label class="check"><input type="checkbox" class="f_tag" value="' + esc(t) + '"' + (tags.indexOf(t) >= 0 ? ' checked' : '') + '> ' + esc(t) + '</label>'; }).join('') + '</div>' +
    '<div class="grid2"><div class="field"><label for="f_tagother">Other conditions</label><input type="text" id="f_tagother" value="' + esc(extraTags) + '"></div>' +
    '<div class="field"><label for="f_spdocs">Specialty doctors (who follows him or her)</label><input type="text" id="f_spdocs" value="' + esc(p ? p.SpecialtyDoctors : '') + '" placeholder="Cardiology: Dr. …"></div></div>' +
    '<label>Medical clearance</label><div id="f_cl"></div><button id="f_addcl" type="button">Add clearance</button></div>' +

    '<div class="sect"><h3>Priority, sponsorship and notes</h3><div class="grid2">' +
    '<div class="field"><label for="f_prio">Priority tag</label><select id="f_prio">' + PRIORITY.map(function (s) { return opt(s, s || 'None', p ? p.Priority === s : s === ''); }).join('') + '</select></div>' +
    '<div class="field"><label for="f_prior">Priority reason</label><input type="text" id="f_prior" value="' + esc(p ? p.PriorityReason : '') + '"></div>' +
    '<div class="field"><label for="f_spons">Sponsorship</label><select id="f_spons">' + opt('', '', !p || !p.Sponsorship) + SPONSOR.map(function (s) { return opt(s, s, p && p.Sponsorship === s); }).join('') + '</select></div>' +
    '<div class="field"><label>&nbsp;</label><label class="check"><input type="checkbox" id="f_star"' + (p && p.Starred ? ' checked' : '') + '> Star: interesting case for a report</label></div></div>' +
    '<div class="field"><label for="f_notes">Notes</label><textarea id="f_notes">' + esc(p ? p.Notes : '') + '</textarea></div></div>' +
    '<div class="row" style="margin-top:8px"><button class="primary" id="f_save">' + (isNew ? 'Add to list' : 'Save changes') + '</button><button id="f_cancel">Cancel</button></div>' +
    (p ? '<div class="sect"><h3>Contact log</h3>' +
      '<div class="grid3"><div class="field"><label for="c_type">Type</label><select id="c_type">' + CONTACT_TYPES.map(function (s) { return opt(s, s, s === 'Called - reached'); }).join('') + '</select></div>' +
      '<div class="field"><label for="c_date">Date</label><input type="date" id="c_date" value="' + esc(S.today) + '"></div>' +
      '<div class="field"><label for="c_note">Note</label><input type="text" id="c_note" placeholder="Called, sick, call back in 2 weeks"></div></div>' +
      '<button id="c_add">Add to log</button><div id="c_list" style="margin-top:8px"><p class="muted small">Loading…</p></div></div>' +
      '<div class="sect"><h3>Actions</h3><div id="f_actions" class="row"></div><div id="f_info" class="small muted" style="margin-top:8px"></div></div>' : '');

  var m = openModal(html);
  var cl = p ? clearances(p) : [];

  function readCl() {
    var rows = m.el.querySelectorAll('.clrow'), out = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      out.push({
        spec: r.querySelector('.cl_spec').value, state: r.querySelector('.cl_state').value,
        apptDate: r.querySelector('.cl_date').value, doctor: r.querySelector('.cl_doc').value.trim()
      });
    }
    return out;
  }
  function drawCl() {
    $('f_cl').innerHTML = cl.map(function (c, i) {
      return '<div class="clrow">' +
        '<select class="cl_spec">' + SPECIALTIES.map(function (s) { return opt(s, s, s === c.spec); }).join('') + '</select>' +
        '<select class="cl_state">' + ['Requested', 'Cleared'].map(function (s) { return opt(s, s, s === c.state); }).join('') + '</select>' +
        '<input type="date" class="cl_date" title="Appointment date" value="' + esc(c.apptDate || '') + '">' +
        '<input type="text" class="cl_doc" placeholder="Doctor" value="' + esc(c.doctor || '') + '">' +
        '<button type="button" class="cl_x" data-i="' + i + '" aria-label="Remove clearance">Remove</button></div>';
    }).join('') || '<p class="muted small" style="margin:0 0 6px">None requested.</p>';
    on($('f_cl'), '.cl_x', 'click', function (e) {
      cl = readCl(); cl.splice(+e.currentTarget.getAttribute('data-i'), 1); drawCl();
    });
  }
  drawCl();
  var ex = p ? extras(p) : [];
  function readEx() {
    var rows = m.el.querySelectorAll('.exrow'), out = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], sel = r.querySelector('.ex_proc'), pr = procById(sel.value);
      out.push({ procedureId: pr ? pr.Id : '', procedure: pr ? pr.Name : '', laterality: r.querySelector('.ex_lat').value, minutes: r.querySelector('.ex_min').value });
    }
    return out;
  }
  function totalText() {
    var t = Number($('f_min').value) || 0;
    readEx().forEach(function (x) { t += Number(x.minutes) || 0; });
    $('f_total').textContent = 'Total time for the list: ' + t + ' min';
  }
  function drawEx() {
    var act = S.d.procedures.filter(function (x) { return x.Active === 'Y'; });
    $('f_ex').innerHTML = ex.map(function (x, i) {
      return '<div class="exrow" style="display:grid;gap:6px;margin-bottom:6px;grid-template-columns:minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) auto">' +
        '<select class="ex_proc">' + act.map(function (pr) { return opt(pr.Id, pr.Name, pr.Id === x.procedureId); }).join('') + '</select>' +
        '<select class="ex_lat">' + opt('', 'Side', !x.laterality) + ['Right', 'Left', 'Bilateral'].map(function (z) { return opt(z, z, x.laterality === z); }).join('') + '</select>' +
        '<input type="number" class="ex_min" min="0" placeholder="Minutes" value="' + esc(x.minutes || '') + '">' +
        '<button type="button" class="ex_x" data-i="' + i + '">Remove</button></div>';
    }).join('') || '<p class="muted small" style="margin:0 0 6px">None.</p>';
    on($('f_ex'), '.ex_x', 'click', function (e) { ex = readEx(); ex.splice(+e.currentTarget.getAttribute('data-i'), 1); drawEx(); });
    on($('f_ex'), '.ex_proc', 'change', function (e) {
      var pr = procById(e.currentTarget.value), row = e.currentTarget.closest('.exrow');
      if (pr) row.querySelector('.ex_min').value = pr.DefaultMinutes;
      totalText();
    });
    on($('f_ex'), '.ex_min', 'input', totalText);
    totalText();
  }
  drawEx();
  $('f_min').addEventListener('input', totalText);
  $('f_addex').addEventListener('click', function () {
    ex = readEx();
    var first = S.d.procedures.filter(function (x) { return x.Active === 'Y'; })[0];
    if (!first) { toast('Add a procedure in Settings first', true); return; }
    ex.push({ procedureId: first.Id, procedure: first.Name, laterality: '', minutes: first.DefaultMinutes });
    drawEx();
  });
  $('f_addcl').addEventListener('click', function () {
    cl = readCl(); cl.push({ spec: 'Cardiology', state: 'Requested', apptDate: '', doctor: '' }); drawCl();
  });

  var prevDx = '';
  function procChanged(fill) {
    var sel = $('f_proc').value, pr = procById(sel);
    $('r_procother').style.display = sel === '__other' ? '' : 'none';
    $('r_lat').style.display = (pr && pr.Laterality === 'Y') || sel === '__other' || (p && p.Laterality) ? '' : 'none';
    if (fill && pr) {
      $('f_cat').value = pr.DefaultCategory;
      $('f_min').value = pr.DefaultMinutes;
      $('f_care').value = pr.DefaultCare;
      var dx = $('f_dx');
      if (!dx.value.trim() || dx.value === prevDx) dx.value = pr.DefaultDiagnosis;
      prevDx = pr.DefaultDiagnosis;
      if (pr.Laterality !== 'Y') $('f_lat').value = '';
    } else if (pr) { prevDx = pr.DefaultDiagnosis; }
    priceChanged();
  }
  function priceChanged() {
    var pr = procById($('f_proc').value), care = $('f_care').value, txt = '';
    if (pr) {
      var v = care === 'Inpatient' ? pr.PriceInpatient : pr.PriceDay;
      txt = v === '' ? 'Price not set for this procedure (' + care.toLowerCase() + ').' : 'Price (' + care.toLowerCase() + '): BHD ' + v;
    }
    $('f_price').textContent = txt;
  }
  function sponsorHint() {
    var s = $('f_spons').value, b = $('f_sched').value;
    $('f_sponsorhint').textContent = (b || !p) ? (s ? 'Check sponsorship with the family before booking: ' + s : 'Sponsorship not recorded yet. Check with the family before booking.') : '';
  }
  $('f_proc').addEventListener('change', function () { procChanged(true); });
  $('f_care').addEventListener('change', priceChanged);
  $('f_spons').addEventListener('change', sponsorHint);
  $('f_sched').addEventListener('change', sponsorHint);
  procChanged(false); sponsorHint();

  $('f_close').addEventListener('click', m.close);
  $('f_cancel').addEventListener('click', m.close);
  $('f_save').addEventListener('click', function () {
    var sel = $('f_proc').value, pr = procById(sel);
    var tagList = [], tagEls = m.el.querySelectorAll('.f_tag');
    for (var i = 0; i < tagEls.length; i++) if (tagEls[i].checked) tagList.push(tagEls[i].value);
    var o = {
      Id: p ? p.Id : '', Name: val('f_name'), MRN: val('f_mrn'), DOB: val('f_dob'), Sex: val('f_sex'), Guardian: val('f_guard'),
      ConsultantId: val('f_cons'), SeenByConsultant: val('f_seen'), DateAdded: val('f_added'),
      ProcedureId: pr ? sel : '', Procedure: pr ? pr.Name : (sel === '__other' ? val('f_procother') : ''),
      Laterality: $('r_lat').style.display === 'none' ? '' : val('f_lat'),
      Diagnosis: val('f_dx'), Category: val('f_cat'), ExpMinutes: val('f_min'), CareType: val('f_care'),
      NeedsAdmission: checked('f_admit') ? 'Y' : '', TargetDate: val('f_target'),
      Tags: tagList.join(','), TagsOther: val('f_tagother'), SpecialtyDoctors: val('f_spdocs'),
      Clearances: JSON.stringify(readCl().filter(function (c) { return c.spec; })),
      Priority: val('f_prio'), PriorityReason: val('f_prior'), Sponsorship: val('f_spons'),
      Starred: checked('f_star') ? 'Y' : '', Notes: val('f_notes'), Extra: JSON.stringify(readEx())
    };
    $('f_save').disabled = true;
    var hadList = !!(p && p.ListId);
    if (hadList && o.Clearances.indexOf('"Requested"') >= 0 && !window.confirm('This patient is booked on an OT list. A pending clearance takes them off it until cleared. Continue?')) return;
    call('savePatient', o).then(function (saved) {
      upsertP(saved); m.close(); render(); toast(isNew ? 'Patient added' : (hadList && !saved.ListId ? 'Saved. Taken off the OT list until cleared.' : 'Saved'));
    }).catch(function (e) { $('f_save').disabled = false; fail(e); });
  });

  if (p) {
    var cur = p;
    function drawLog(list) {
      $('c_list').innerHTML = list.length ? list.map(function (c) {
        return '<div class="log"><span class="muted small">' + esc(fmtDate(c.Date)) + ' · ' + esc(c.Type) + (c.By ? ' · ' + esc(c.By) : '') + '</span>' + (c.Note ? '<br>' + esc(c.Note) : '') + '</div>';
      }).join('') : '<p class="muted small">No entries yet.</p>';
    }
    function drawActions() {
      var h = '';
      if (isActive(cur)) {
        if (cur.ListId) h += '<button id="a_off">Take off theatre list</button>';
        if (canSend(cur)) h += '<button id="a_send" class="primary">Add to OT</button>';
        else h += '<button disabled class="greyed ' + (cur.ListId ? 'bk' : 'nr') + '" title="' + esc(sendWhy(cur)) + '">' + (cur.ListId ? 'Booked' : 'Not ready') + '</button>';
        h += cur.Status === 'Not ready' ? '<button id="a_back">Back on the list now</button>' : '<button id="a_nr">Mark not ready</button>';
        h += '<button id="a_done">Mark done</button><button id="a_rem" class="danger">Remove from list</button>';
      } else { h += '<button id="a_restore">Restore to waiting list</button>'; }
      $('f_actions').innerHTML = h;
      var info = '';
      if (cur.Status === 'Done') info = 'Done on ' + fmtDate(cur.DoneDate) + (cur.DoneNotes ? ': ' + cur.DoneNotes : '');
      if (cur.Status === 'Removed') info = 'Removed on ' + fmtDate(cur.RemovedDate) + ': ' + cur.RemovedReason + (cur.RemovedNote ? ' (' + cur.RemovedNote + ')' : '');
      if (cur.ListId && listById(cur.ListId)) info = 'On the theatre list of ' + fmtDay(listById(cur.ListId).Date) + ' (' + listTitle(listById(cur.ListId)) + '). ';
      if (cur.Status === 'Not ready') info = 'Hold until ' + fmtDate(cur.NotReadyUntil) + ': ' + cur.NotReadyReason + '. The patient returns to the active list automatically after this date.';
      $('f_info').textContent = info;
      var bind = function (id, fn) { var b = $(id); if (b) b.addEventListener('click', fn); };
      bind('a_nr', function () { dlgNotReady(cur, m); });
      bind('a_off', function () { dlgTakeOff(cur, function () { m.close(); }); });
      bind('a_send', function () { dlgSendToList(cur, function () { m.close(); }); });
      bind('a_done', function () { dlgDone(cur, m); });
      bind('a_rem', function () { dlgRemove(cur, m); });
      bind('a_back', function () {
        call('clearNotReady', { patientId: cur.Id }).then(function (r) { upsertP(r.patient); m.close(); render(); toast('Back on the list'); }).catch(fail);
      });
      bind('a_restore', function () {
        call('restorePatient', { patientId: cur.Id }).then(function (r) { upsertP(r); m.close(); render(); toast('Restored to the waiting list'); }).catch(fail);
      });
    }
    drawActions();
    call('getContacts', { patientId: p.Id }).then(drawLog).catch(function () { $('c_list').innerHTML = '<p class="muted small">Could not load the log.</p>'; });
    $('c_add').addEventListener('click', function () {
      call('addContact', { patientId: cur.Id, type: val('c_type'), date: val('c_date'), note: val('c_note') }).then(function (r) {
        cur = r.patient; upsertP(cur); drawLog(r.contacts); $('c_note').value = ''; render(); toast('Added to the log');
      }).catch(fail);
    });
  }
}

function dlgNotReady(p, parent) {
  var m = openModal('<h2>Mark not ready</h2><p class="muted small">The patient stays on the list and returns to active after the date.</p>' +
    '<div class="field"><label for="n_reason">Reason</label><select id="n_reason">' + NOT_READY_REASONS.map(function (s) { return opt(s, s); }).join('') + '</select></div>' +
    '<div class="field"><label for="n_note">Details (optional)</label><input type="text" id="n_note" placeholder="Traveling abroad"></div>' +
    '<div class="field"><label for="n_until">Ready again on</label><input type="date" id="n_until" min="' + esc(S.today) + '"></div>' +
    '<div class="row" style="margin-bottom:10px"><button type="button" data-d="14">2 weeks</button><button type="button" data-d="30">1 month</button><button type="button" data-d="90">3 months</button><button type="button" data-d="180">6 months</button></div>' +
    '<div class="row"><button class="primary" id="n_go">Save</button><button id="n_cancel">Cancel</button></div>', { narrow: true });
  on(m.el, '[data-d]', 'click', function (e) { $('n_until').value = addDaysStr(S.today, +e.currentTarget.getAttribute('data-d')); });
  $('n_cancel').addEventListener('click', m.close);
  $('n_go').addEventListener('click', function () {
    var reason = val('n_reason') + (val('n_note') ? ': ' + val('n_note') : '');
    call('setNotReady', { patientId: p.Id, reason: reason, until: val('n_until') }).then(function (r) {
      upsertP(r.patient); m.close(); parent.close(); render(); toast('Marked not ready');
    }).catch(fail);
  });
}
function dlgDone(p, parent) {
  var m = openModal('<h2>Mark done</h2>' +
    '<div class="field"><label for="d_date">Date of procedure</label><input type="date" id="d_date" value="' + esc(S.today) + '"></div>' +
    '<div class="field"><label for="d_notes">Notes (optional)</label><textarea id="d_notes"></textarea></div>' +
    '<div class="row"><button class="primary" id="d_go">Save</button><button id="d_cancel">Cancel</button></div>', { narrow: true });
  $('d_cancel').addEventListener('click', m.close);
  $('d_go').addEventListener('click', function () {
    call('markDone', { patientId: p.Id, date: val('d_date'), notes: val('d_notes') }).then(function (r) {
      upsertP(r); m.close(); parent.close(); render(); toast('Moved to done cases');
    }).catch(fail);
  });
}
function dlgRemove(p, parent) {
  var m = openModal('<h2>Remove from the list</h2><p class="muted small">You can restore the patient later from the Removed page.</p>' +
    '<div class="field"><label for="r_reason">Reason</label><select id="r_reason">' + REMOVE_REASONS.map(function (s) { return opt(s, s); }).join('') + '</select></div>' +
    '<div class="field"><label for="r_note">Details (optional)</label><input type="text" id="r_note"></div>' +
    '<div class="row"><button class="danger" id="r_go">Remove</button><button id="r_cancel">Cancel</button></div>', { narrow: true });
  $('r_cancel').addEventListener('click', m.close);
  $('r_go').addEventListener('click', function () {
    call('removePatient', { patientId: p.Id, reason: val('r_reason'), note: val('r_note') }).then(function (r) {
      upsertP(r); m.close(); parent.close(); render(); toast('Removed from the list');
    }).catch(fail);
  });
}

// ---------------------------------------------------------------- settings
function viewSettings() {
  var d = S.d, st = d.settings, admin = S.user.Role === 'admin';
  $('view').innerHTML =
    '<h2>Settings</h2>' +
    '<div class="panel"><div class="spread"><h3>Procedures</h3><button id="s_addproc">Add procedure</button></div><div id="s_procs"></div></div>' +
    '<div class="panel"><div class="spread"><h3>Consultants and operating days</h3><button id="s_addcons">Add consultant</button></div><div id="s_cons"></div></div>' +
    '<div class="panel"><div class="spread"><h3>Operating rooms</h3></div><div id="s_rooms"></div>' +
    '<div class="row" style="margin-top:8px"><input type="text" id="s_roomname" placeholder="Room name, for example OT 1" style="max-width:260px"><button id="s_addroom">Add room</button></div></div>' +
    '<div class="panel"><div class="spread"><h3>Residents</h3></div><div id="s_res"></div>' +
    '<div class="row" style="margin-top:8px"><input type="text" id="s_resname" placeholder="Resident name" style="max-width:260px"><button id="s_addres">Add resident</button></div></div>' +
    '<div class="panel"><h3>Warning thresholds</h3><p class="muted small">Days in the list before a patient is flagged, by category.</p>' +
    '<div class="grid3"><div class="field"><label for="t_min">Minor (days)</label><input type="number" id="t_min" min="0" value="' + esc(st.waitDaysMinor) + '"></div>' +
    '<div class="field"><label for="t_int">Intermediate (days)</label><input type="number" id="t_int" min="0" value="' + esc(st.waitDaysIntermediate) + '"></div>' +
    '<div class="field"><label for="t_maj">Major (days)</label><input type="number" id="t_maj" min="0" value="' + esc(st.waitDaysMajor) + '"></div>' +
    '<div class="field"><label for="t_nc">No contact for (days)</label><input type="number" id="t_nc" min="0" value="' + esc(st.noContactDays) + '"></div>' +
    '<div class="field"><label for="t_tg">Warn before target date (days)</label><input type="number" id="t_tg" min="0" value="' + esc(st.targetWarnDays) + '"></div></div>' +
    '<div class="grid3"><div class="field"><label for="t_idle">Sign out after idle (minutes, 0 = never)</label><input type="number" id="t_idle" min="0" value="' + esc(st.idleMinutes) + '"></div>' +
    '<div class="field"><label for="t_ahead">Create OT-day lists this many weeks ahead (0 = off)</label><input type="number" id="t_ahead" min="0" max="52" value="' + esc(st.listsAheadWeeks) + '"></div></div>' +
    '<button id="t_save">Save thresholds</button></div>' +
    '<div class="panel"><h3>Data</h3><div class="row"><button id="x_import" class="primary">Import from Excel or CSV</button></div><div class="row" style="margin-top:8px"><button id="x_wait">Export waiting list (CSV)</button><button id="x_done">Export done cases (CSV)</button><button id="x_rem">Export removed (CSV)</button></div>' +
    (admin ? '<div class="row"><button id="x_sample">Add sample patients</button><button id="x_clear" class="danger">Remove all sample patients</button></div>' : '') + '</div>' +
    (admin ? '<div class="panel"><h3>Backup</h3><p class="muted small">Makes a copy of the whole Google Sheet in a Drive folder called "Waiting list backups" (the newest 14 are kept). The copies stay in the same Google account and contain patient data, so they follow the same data-location rules as the Sheet.</p><p id="bk_info" class="small">Loading…</p><div class="row"><button id="bk_now">Back up now</button><button id="bk_daily">Daily backup</button></div></div>' : '') +
    (admin ? '<div class="panel"><div class="spread"><h3>Users</h3><button id="u_add">Add doctor</button></div><div id="u_list"><p class="muted small">Loading…</p></div></div>' +
      '<div class="panel"><div class="spread"><h3>Audit log</h3><button id="a_load">Show recent changes</button></div><div id="a_list"></div></div>' : '') +
    '<div class="panel"><h3>My account</h3><p class="muted small">' + esc(S.user.Name) + ' · ' + esc(S.user.Email) + ' · ' + esc(S.user.Role) + ' · app v' + esc(VERSION) + '</p>' +
    '<div class="grid3"><div class="field"><label for="m_old">Current PIN</label><input type="password" id="m_old"></div>' +
    '<div class="field"><label for="m_new">New PIN</label><input type="password" id="m_new"></div>' +
    '<div class="field"><label>&nbsp;</label><button id="m_go">Change PIN</button></div></div></div>';

  drawProcs(); drawCons(); drawRes(); drawRooms();
  $('s_addroom').addEventListener('click', function () {
    call('saveRoom', { Name: val('s_roomname') }).then(function (l) { S.d.rooms = l; viewSettings(); toast('Room added'); }).catch(fail);
  });
  $('x_import').addEventListener('click', openImport);
  $('s_addproc').addEventListener('click', function () { procModal(null); });
  $('s_addcons').addEventListener('click', function () { consModal(null); });
  $('s_addres').addEventListener('click', function () {
    call('saveResident', { Name: val('s_resname') }).then(function (l) { S.d.residents = l; viewSettings(); toast('Resident added'); }).catch(fail);
  });
  $('t_save').addEventListener('click', function () {
    call('saveSettings', { waitDaysMinor: val('t_min'), waitDaysIntermediate: val('t_int'), waitDaysMajor: val('t_maj'), noContactDays: val('t_nc'), targetWarnDays: val('t_tg'), idleMinutes: val('t_idle'), listsAheadWeeks: val('t_ahead') })
      .then(function (s) { S.d.settings = s; resetIdle(); toast('Saved'); }).catch(fail);
  });
  $('x_wait').addEventListener('click', function () { exportCsv('waiting-list', S.d.patients.filter(isActive)); });
  $('x_done').addEventListener('click', function () { exportCsv('done-cases', S.d.patients.filter(function (p) { return p.Status === 'Done'; })); });
  $('x_rem').addEventListener('click', function () { exportCsv('removed', S.d.patients.filter(function (p) { return p.Status === 'Removed'; })); });
  $('m_go').addEventListener('click', function () {
    call('changePin', { oldPin: $('m_old').value, newPin: $('m_new').value }).then(function () { $('m_old').value = ''; $('m_new').value = ''; toast('PIN changed'); }).catch(fail);
  });
  if (admin) {
    $('x_sample').addEventListener('click', function () {
      call('loadSample').then(function (n) { return load().then(function () { S.view = 'list'; render(); toast(n + ' sample patients added'); }); }).catch(fail);
    });
    $('x_clear').addEventListener('click', function () {
      if (!window.confirm('Remove all sample patients? Real patients are not affected.')) return;
      call('clearSample').then(function (n) { return load().then(function () { toast(n + ' sample patients removed'); }); }).catch(fail);
    });
    function bkDraw() {
      var b = S.backup; if (!b) return;
      $('bk_info').textContent = 'Last backup: ' + (b.lastBackup || 'never') + ' · Daily backup: ' + (b.daily ? 'on (about 2 am)' : 'off');
      $('bk_daily').textContent = b.daily ? 'Turn daily backup off' : 'Turn daily backup on';
    }
    call('getBackupInfo').then(function (b) { S.backup = b; bkDraw(); }).catch(function (e) { $('bk_info').textContent = 'Could not read backup status: ' + e.message + ''; });
    $('bk_now').addEventListener('click', function () {
      $('bk_now').disabled = true;
      call('backupNow').then(function (r) { S.backup = S.backup || {}; S.backup.lastBackup = r.lastBackup; $('bk_now').disabled = false; bkDraw(); toast('Backup saved in Drive'); }).catch(function (e) { $('bk_now').disabled = false; fail(e); });
    });
    $('bk_daily').addEventListener('click', function () {
      call('setDailyBackup', { on: !(S.backup && S.backup.daily) }).then(function (r) { S.backup = S.backup || {}; S.backup.daily = r.daily; bkDraw(); }).catch(fail);
    });
    $('u_add').addEventListener('click', function () { userModal(); });
    drawUsers();
    $('a_load').addEventListener('click', function () {
      call('getAudit').then(function (rows) {
        $('a_list').innerHTML = '<table class="tbl" style="margin-top:8px"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead><tbody>' +
          rows.map(function (r) {
            var when = r.At ? new Date(r.At).toLocaleString() : '';
            return '<tr><td class="small">' + esc(when) + '</td><td class="small">' + esc(r.User) + '</td><td class="small">' + esc(r.Action) + '</td><td class="small">' + esc(r.Details) + '</td></tr>';
          }).join('') + '</tbody></table>';
      }).catch(fail);
    });
  }
}
function drawProcs() {
  var l = S.d.procedures;
  $('s_procs').innerHTML = '<table class="tbl"><thead><tr><th>Procedure</th><th>Time</th><th>Category</th><th>Care</th><th>Price day / in</th><th></th></tr></thead><tbody>' +
    l.map(function (p) {
      return '<tr><td>' + esc(p.Name) + (p.Active !== 'Y' ? ' <span class="chip">retired</span>' : '') + '<br><span class="muted small">' + esc(p.DefaultDiagnosis) + '</span></td><td>' + esc(p.DefaultMinutes) + ' min</td><td>' + esc(p.DefaultCategory) +
        '</td><td>' + esc(p.DefaultCare) + '</td><td>' + esc(p.PriceDay || '-') + ' / ' + esc(p.PriceInpatient || '-') + '</td><td><button data-e="' + esc(p.Id) + '">Edit</button></td></tr>';
    }).join('') + '</tbody></table>';
  on($('s_procs'), '[data-e]', 'click', function (e) { procModal(procById(e.currentTarget.getAttribute('data-e'))); });
}
function procModal(pr) {
  var isNew = !pr; pr = pr || { DefaultMinutes: '30', DefaultCategory: 'Minor', DefaultCare: 'Day-case', Active: 'Y', WarnMonthsBefore: '3' };
  var m = openModal('<h2>' + (isNew ? 'Add procedure' : 'Edit procedure') + '</h2><div class="grid2">' +
    '<div class="field"><label for="p_name">Name</label><input type="text" id="p_name" value="' + esc(pr.Name || '') + '"></div>' +
    '<div class="field"><label for="p_dx">Default diagnosis</label><input type="text" id="p_dx" value="' + esc(pr.DefaultDiagnosis || '') + '"></div>' +
    '<div class="field"><label for="p_min">Default time (minutes)</label><input type="number" id="p_min" min="0" value="' + esc(pr.DefaultMinutes) + '"></div>' +
    '<div class="field"><label for="p_cat">Default category</label><select id="p_cat">' + CATS.map(function (s) { return opt(s, s, pr.DefaultCategory === s); }).join('') + '</select></div>' +
    '<div class="field"><label for="p_care">Default care</label><select id="p_care">' + ['Day-case', 'Inpatient'].map(function (s) { return opt(s, s, pr.DefaultCare === s); }).join('') + '</select></div>' +
    '<div class="field"><label>&nbsp;</label><label class="check"><input type="checkbox" id="p_lat"' + (pr.Laterality === 'Y' ? ' checked' : '') + '> Needs side (right, left, bilateral)</label></div>' +
    '<div class="field"><label for="p_pd">Price, day-case (BHD)</label><input type="number" id="p_pd" min="0" step="any" value="' + esc(pr.PriceDay || '') + '"></div>' +
    '<div class="field"><label for="p_pi">Price, inpatient (BHD)</label><input type="number" id="p_pi" min="0" step="any" value="' + esc(pr.PriceInpatient || '') + '"></div>' +
    '<div class="field"><label for="p_td">Target: days from date added (0 = none)</label><input type="number" id="p_td" min="0" value="' + esc(pr.TargetDays || '') + '"></div>' +
    '<div class="field"><label for="p_ma">Age limit in months (0 = none)</label><input type="number" id="p_ma" min="0" value="' + esc(pr.MaxAgeMonths || '') + '"></div>' +
    '<div class="field"><label for="p_wm">Warn this many months before the age limit</label><input type="number" id="p_wm" min="0" value="' + esc(pr.WarnMonthsBefore || '3') + '"></div>' +
    '<div class="field"><label>&nbsp;</label><label class="check"><input type="checkbox" id="p_act"' + (pr.Active === 'Y' ? ' checked' : '') + '> In use</label></div></div>' +
    '<div class="row"><button class="primary" id="p_save">Save</button><button id="p_cancel">Cancel</button></div>');
  $('p_cancel').addEventListener('click', m.close);
  $('p_save').addEventListener('click', function () {
    call('saveProcedure', {
      Id: pr.Id || '', Name: val('p_name'), DefaultDiagnosis: val('p_dx'), DefaultMinutes: val('p_min'), DefaultCategory: val('p_cat'),
      DefaultCare: val('p_care'), Laterality: checked('p_lat') ? 'Y' : '', PriceDay: val('p_pd'), PriceInpatient: val('p_pi'),
      TargetDays: val('p_td'), MaxAgeMonths: val('p_ma'), WarnMonthsBefore: val('p_wm'), Active: checked('p_act') ? 'Y' : 'N'
    }).then(function (l) { S.d.procedures = l; m.close(); viewSettings(); toast('Procedure saved'); }).catch(fail);
  });
}
function drawCons() {
  var l = S.d.consultants;
  $('s_cons').innerHTML = '<table class="tbl"><thead><tr><th>Consultant</th><th>Operating day</th><th>Usual room</th><th>List length</th><th></th></tr></thead><tbody>' +
    l.map(function (c) {
      return '<tr><td>' + esc(c.Name) + (c.Active !== 'Y' ? ' <span class="chip">inactive</span>' : '') + '</td><td>' + esc(c.OTDay) + '</td><td>' + esc(roomName(c.DefaultRoomId)) + '</td><td>' + esc(c.SlotMinutes) + ' min</td><td><button data-e="' + esc(c.Id) + '">Edit</button></td></tr>';
    }).join('') + '</tbody></table>';
  on($('s_cons'), '[data-e]', 'click', function (e) { consModal(consById(e.currentTarget.getAttribute('data-e'))); });
}
function consModal(c) {
  var isNew = !c; c = c || { OTDay: '', SlotMinutes: '240', Active: 'Y' };
  var m = openModal('<h2>' + (isNew ? 'Add consultant' : 'Edit consultant') + '</h2>' +
    '<div class="field"><label for="c_name">Name</label><input type="text" id="c_name" value="' + esc(c.Name || '') + '"></div>' +
    '<div class="field"><label for="c_day">Operating day</label><select id="c_day">' + DAYS.map(function (s) { return opt(s, s, c.OTDay === s); }).join('') + '</select></div>' +
    '<div class="field"><label for="c_room">Usual operating room</label><select id="c_room">' + opt('', 'None', !c.DefaultRoomId) + (S.d.rooms || []).filter(function (r) { return r.Active === 'Y' || r.Id === c.DefaultRoomId; }).map(function (r) { return opt(r.Id, r.Name, r.Id === c.DefaultRoomId); }).join('') + '</select></div>' +
    '<div class="field"><label for="c_slot">List length (minutes)</label><input type="number" id="c_slot" min="0" value="' + esc(c.SlotMinutes) + '"></div>' +
    '<label class="check"><input type="checkbox" id="c_act"' + (c.Active === 'Y' ? ' checked' : '') + '> Active</label>' +
    '<div class="row" style="margin-top:12px"><button class="primary" id="c_save">Save</button><button id="c_cancel">Cancel</button></div>', { narrow: true });
  $('c_cancel').addEventListener('click', m.close);
  $('c_save').addEventListener('click', function () {
    call('saveConsultant', { Id: c.Id || '', Name: val('c_name'), OTDay: val('c_day'), DefaultRoomId: val('c_room'), SlotMinutes: val('c_slot'), Active: checked('c_act') ? 'Y' : 'N' })
      .then(function (r) { S.d.consultants = r.consultants; S.d.lists = r.lists; m.close(); viewSettings(); toast('Consultant saved. Lists for the coming weeks are in the Calendar.'); }).catch(fail);
  });
}
function drawRes() {
  var l = S.d.residents;
  $('s_res').innerHTML = l.length ? l.map(function (r) {
    return '<div class="spread log"><span>' + esc(r.Name) + (r.Active !== 'Y' ? ' <span class="chip">inactive</span>' : '') + '</span><button data-r="' + esc(r.Id) + '">' + (r.Active === 'Y' ? 'Deactivate' : 'Activate') + '</button></div>';
  }).join('') : '<p class="muted small">No residents yet.</p>';
  on($('s_res'), '[data-r]', 'click', function (e) {
    var id = e.currentTarget.getAttribute('data-r'), r = S.d.residents.filter(function (x) { return x.Id === id; })[0];
    call('saveResident', { Id: id, Name: r.Name, Active: r.Active === 'Y' ? 'N' : 'Y' }).then(function (l) { S.d.residents = l; drawRes(); }).catch(fail);
  });
}
function drawUsers() {
  call('listUsers').then(function (users) {
    $('u_list').innerHTML = '<table class="tbl"><thead><tr><th>Doctor</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody>' +
      users.map(function (u) {
        return '<tr><td>' + esc(u.Name) + '<br><span class="muted small">' + esc(u.Email) + '</span></td><td>' + esc(u.Role) + '</td><td>' + (u.Active === 'Y' ? 'Active' : 'Disabled') + (u.MustChange === 'Y' ? ' · temporary PIN' : '') +
          '</td><td><button data-edit="' + esc(u.Email) + '">Edit</button> <button data-reset="' + esc(u.Email) + '">Reset PIN</button></td></tr>';
      }).join('') + '</tbody></table>';
    on($('u_list'), '[data-edit]', 'click', function (e) {
      var em = e.currentTarget.getAttribute('data-edit');
      userModal(users.filter(function (u) { return u.Email === em; })[0]);
    });
    on($('u_list'), '[data-reset]', 'click', function (e) {
      var em = e.currentTarget.getAttribute('data-reset');
      call('resetUserPin', { Email: em }).then(showPin).catch(fail);
    });
  }).catch(fail);
}
function showPin(r) {
  var m = openModal('<h2>Temporary PIN</h2><p>Give this to <strong>' + esc(r.email) + '</strong> privately. They will be asked to choose their own at first sign-in.</p>' +
    '<p style="font-size:22px;font-family:monospace;letter-spacing:1px">' + esc(r.tempPin) + '</p><p class="muted small">It is shown only once.</p><button class="primary" id="tp_ok">Done</button>', { narrow: true, locked: true });
  $('tp_ok').addEventListener('click', function () { m.close(); drawUsers(); });
}
function userModal(u) {
  var isNew = !u; u = u || { Role: 'doctor', Active: 'Y' };
  var m = openModal('<h2>' + (isNew ? 'Add doctor' : 'Edit doctor') + '</h2>' +
    '<div class="field"><label for="u_email">Email</label><input type="email" id="u_email" value="' + esc(u.Email || '') + '"' + (isNew ? '' : ' readonly') + '></div>' +
    '<div class="field"><label for="u_name">Name</label><input type="text" id="u_name" value="' + esc(u.Name || '') + '"></div>' +
    '<div class="field"><label for="u_role">Role</label><select id="u_role">' + opt('doctor', 'Doctor', u.Role !== 'admin') + opt('admin', 'Admin (manages users, sample data, audit log)', u.Role === 'admin') + '</select></div>' +
    '<label class="check"><input type="checkbox" id="u_act"' + (u.Active === 'Y' ? ' checked' : '') + '> Can sign in</label>' +
    '<div class="row" style="margin-top:12px"><button class="primary" id="u_save">Save</button><button id="u_cancel">Cancel</button></div>', { narrow: true });
  $('u_cancel').addEventListener('click', m.close);
  $('u_save').addEventListener('click', function () {
    call('saveUser', { Email: val('u_email'), Name: val('u_name'), Role: val('u_role'), Active: checked('u_act') ? 'Y' : 'N' }).then(function (r) {
      m.close();
      if (r.tempPin) showPin(r); else { drawUsers(); toast('Saved'); }
    }).catch(fail);
  });
}

// ---------------------------------------------------------------- calendar and theatre lists
function viewCalendar() {
  var m = S.calMonth || S.today.slice(0, 7);
  S.calMonth = m;
  var y = +m.slice(0, 4), mo = +m.slice(5, 7);
  var startDow = new Date(Date.UTC(y, mo - 1, 1)).getUTCDay();
  var dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  var byDate = {}, clash = {};
  (S.d.lists || []).forEach(function (l) {
    if (l.Date.slice(0, 7) === m) (byDate[l.Date] = byDate[l.Date] || []).push(l);
    if (l.Status === 'Open' && l.RoomId) { var k = l.Date + '|' + l.RoomId; clash[k] = (clash[k] || 0) + 1; }
  });
  function block(l) {
    var u = listUsed(l), cap = Number(l.Minutes) || 0;
    var cls = l.Status !== 'Open' ? 'gray' : (u.min > cap ? 'red' : (u.n === 0 ? '' : (u.min >= cap * 0.8 ? 'green' : 'blue')));
    var line2 = l.Status !== 'Open' ? 'Cancelled' : (u.n + (u.n === 1 ? ' case · ' : ' cases · ') + u.min + '/' + cap + ' min' + (l.RoomId && clash[l.Date + '|' + l.RoomId] > 1 ? ' · room clash' : ''));
    return '<div class="lst ' + cls + '" data-list="' + esc(l.Id) + '"><strong>' + esc(consName(l.ConsultantId)) + '</strong>' + (l.RoomId ? ' · ' + esc(roomName(l.RoomId)) : '') + '<br><span class="small">' + esc(line2) + '</span></div>';
  }
  var body = '';
  if (window.innerWidth >= 760) {
    body = '<div class="calgrid">' + WD.map(function (d) { return '<div class="calh">' + d + '</div>'; }).join('');
    for (var i = 0; i < startDow; i++) body += '<div class="cday blank"></div>';
    for (var d = 1; d <= dim; d++) {
      var ds = m + '-' + ('0' + d).slice(-2), dow = (startDow + d - 1) % 7;
      body += '<div class="cday' + (ds === S.today ? ' today' : '') + (dow === 5 || dow === 6 ? ' wk' : '') + '"><div class="dn"><span>' + d + '</span><button class="link" data-add="' + ds + '" aria-label="Add a list on ' + ds + '">+</button></div>' +
        (byDate[ds] || []).map(block).join('') + '</div>';
    }
    body += '</div>';
  } else {
    var days = Object.keys(byDate).sort();
    body = days.length ? days.map(function (ds) {
      return '<div class="panel"><div class="spread"><strong>' + esc(fmtDay(ds)) + '</strong><button class="link" data-add="' + ds + '">Add list</button></div>' + byDate[ds].map(block).join('') + '</div>';
    }).join('') : '<p class="muted">No lists this month.</p>';
  }
  $('view').innerHTML =
    '<div class="spread"><h2>Calendar</h2><div class="row"><button id="cal_gen">Create month lists</button><button class="primary" id="cal_add">Add list</button></div></div>' +
    '<div class="row" style="margin:8px 0"><button id="cal_prev" aria-label="Previous month">&lsaquo;</button><strong style="min-width:150px;text-align:center">' + LONGM[mo - 1] + ' ' + y + '</strong><button id="cal_next" aria-label="Next month">&rsaquo;</button><button id="cal_today">Today</button></div>' +
    '<p class="muted small">Each block is one consultant\'s list: name, room, cases and minutes used of the list length. Tap a block to build or review the list.</p>' + body;
  function shift(n) {
    var t = new Date(Date.UTC(y, mo - 1 + n, 1));
    S.calMonth = t.getUTCFullYear() + '-' + ('0' + (t.getUTCMonth() + 1)).slice(-2);
    viewCalendar();
  }
  $('cal_prev').addEventListener('click', function () { shift(-1); });
  $('cal_next').addEventListener('click', function () { shift(1); });
  $('cal_today').addEventListener('click', function () { S.calMonth = S.today.slice(0, 7); viewCalendar(); });
  $('cal_add').addEventListener('click', function () { listForm(null, m === S.today.slice(0, 7) ? S.today : m + '-01'); });
  $('cal_gen').addEventListener('click', function () {
    if (!window.confirm('Create each consultant\'s list on their operating day for ' + LONGM[mo - 1] + ' ' + y + '? Existing lists are kept and past dates are skipped.')) return;
    call('generateLists', { month: m }).then(function (r) { S.d.lists = r.lists; render(); toast(r.created + ' lists created'); }).catch(fail);
  });
  on($('view'), '[data-list]', 'click', function (e) { openList(e.currentTarget.getAttribute('data-list')); });
  on($('view'), '[data-add]', 'click', function (e) { e.stopPropagation(); listForm(null, e.currentTarget.getAttribute('data-add')); });
}

function listForm(l, presetDate) {
  var isNew = !l;
  var cons = S.d.consultants.filter(function (c) { return c.Active === 'Y' || (l && c.Id === l.ConsultantId); });
  var rooms = (S.d.rooms || []).filter(function (r) { return r.Active === 'Y' || (l && r.Id === l.RoomId); });
  l = l || { Date: presetDate || S.today, ConsultantId: '', RoomId: '', Minutes: '', Notes: '' };
  var m = openModal('<h2>' + (isNew ? 'Add theatre list' : 'Edit theatre list') + '</h2>' +
    '<div class="field"><label for="l_date">Date</label><input type="date" id="l_date" value="' + esc(l.Date) + '"></div>' +
    '<div class="field"><label for="l_cons">Consultant</label><select id="l_cons">' + opt('', 'Choose…', !l.ConsultantId) + cons.map(function (c) { return opt(c.Id, c.Name, c.Id === l.ConsultantId); }).join('') + '</select></div>' +
    '<div class="field"><label for="l_room">Operating room</label><select id="l_room">' + opt('', 'Not set', !l.RoomId) + rooms.map(function (r) { return opt(r.Id, r.Name, r.Id === l.RoomId); }).join('') + '</select></div>' +
    '<div class="field"><label for="l_min">List length (minutes)</label><input type="number" id="l_min" min="0" value="' + esc(l.Minutes) + '"></div>' +
    '<div class="field"><label for="l_notes">Notes</label><input type="text" id="l_notes" value="' + esc(l.Notes) + '"></div>' +
    '<div class="row"><button class="primary" id="l_save">Save</button><button id="l_cancel">Cancel</button></div>', { narrow: true });
  $('l_cons').addEventListener('change', function () {
    var c = consById(this.value);
    if (c && isNew) {
      $('l_min').value = c.SlotMinutes; $('l_room').value = c.DefaultRoomId || '';
      if (c.OTDay) {
        var ds = val('l_date') || S.today;
        for (var k = 0; k < 7; k++) { var x = addDaysStr(ds, k), wd = DAYS[new Date(utc(x)).getUTCDay() + 1]; if (wd === c.OTDay) { $('l_date').value = x; break; } }
      }
    }
  });
  $('l_cancel').addEventListener('click', m.close);
  $('l_save').addEventListener('click', function () {
    call('saveList', { Id: l.Id || '', Date: val('l_date'), ConsultantId: val('l_cons'), RoomId: val('l_room'), Minutes: val('l_min'), Notes: val('l_notes') }).then(function (r) {
      S.d.lists = r.lists; r.patients.forEach(upsertP); m.close(); render(); toast('List saved');
    }).catch(fail);
  });
}

// ---------------------------------------------------------------- send one patient to an OT list
function dlgSendToList(p, after) {
  if (!p) return;
  var all = S.d.lists.filter(function (l) { return l.Status === 'Open' && l.Date >= S.today; }).sort(function (a, b) { return a.Date.localeCompare(b.Date); });
  var mine = all.filter(function (l) { return l.ConsultantId === p.ConsultantId; });
  var showAll = !mine.length;
  var need = totalMin(p);
  var m = openModal('<div id="sl_body"></div>', { narrow: true });
  function draw() {
    var rows = (showAll ? all : mine).slice(0, 40);
    var html = '<div class="spread"><h2>Add to OT</h2><button id="sl_close">Close</button></div>' +
      '<p style="margin:4px 0"><strong>' + esc(p.Name) + '</strong> <span class="muted small">' + esc(ageText(p.DOB)) + ' · ' + esc(p.MRN) + '</span><br>' + esc(procLabel(p)) + ' <span class="muted small">· ' + need + ' min · ' + esc(p.CareType) + ' · ' + esc(consName(p.ConsultantId)) + '</span></p>' +
      '<p class="muted small">Check with the family before booking.' + (p.Sponsorship ? ' Sponsorship: ' + esc(p.Sponsorship) + '.' : ' Sponsorship is not recorded.') + '</p>' +
      '<label class="check"><input type="checkbox" id="sl_all"' + (showAll ? ' checked' : '') + '> Show lists of all consultants</label>';
    html += rows.length ? rows.map(function (l) {
      var u = listUsed(l), cap = Number(l.Minutes) || 0, free = cap - u.min, fits = need <= free;
      return '<div class="log"><div class="spread"><div><strong>' + esc(fmtDay(l.Date)) + '</strong> <span class="muted small">' + esc(listTitle(l)) + '</span><br>' +
        '<span class="small">' + u.n + (u.n === 1 ? ' case' : ' cases') + ' · ' + free + ' min free of ' + cap + '</span> ' +
        '<span class="chip ' + (fits ? 'green' : 'red') + '">' + (fits ? 'Fits' : 'Over by ' + (need - free) + ' min') + '</span></div>' +
        '<button class="primary" data-l="' + esc(l.Id) + '">Book here</button></div></div>';
    }).join('') : '<p class="muted small">No open lists coming up. Set an operating day for the consultant in Settings, or add a list from the Calendar.</p>';
    $('sl_body').innerHTML = html;
    $('sl_close').addEventListener('click', m.close);
    $('sl_all').addEventListener('change', function () { showAll = this.checked; draw(); });
    on($('sl_body'), '[data-l]', 'click', function (e) {
      var l = listById(e.currentTarget.getAttribute('data-l')), u = listUsed(l), free = (Number(l.Minutes) || 0) - u.min;
      if (need > free && !window.confirm('This goes over the list time by ' + (need - free) + ' minutes. Book anyway?')) return;
      call('addToList', { listId: l.Id, patientIds: [p.Id] }).then(function (r) {
        if (r.skipped.length) { toast(r.skipped[0].reason, true); return; }
        r.patients.forEach(upsertP); m.close(); render(); toast('Booked on ' + fmtDay(l.Date) + ' (' + listTitle(l) + ')');
        if (after) after();
      }).catch(fail);
    });
  }
  draw();
}

// ---------------------------------------------------------------- print a theatre list
function printList(l) {
  var pts = onList(l).sort(function (a, b) { return ageMonths(a.DOB, S.today) - ageMonths(b.DOB, S.today); });
  var used = pts.reduce(function (s, p) { return s + totalMin(p); }, 0);
  var m = openModal('<div class="row noprint" style="margin-bottom:8px"><button class="primary" id="pr_go">Print</button><button id="pr_close">Close</button></div>' +
    '<div class="printable"><h2>Theatre list: ' + esc(fmtDay(l.Date)) + '</h2>' +
    '<p><strong>' + esc(consName(l.ConsultantId)) + '</strong>' + (l.RoomId ? ' · ' + esc(roomName(l.RoomId)) : '') + ' · ' + (Number(l.Minutes) || 0) + ' min list · ' + pts.length + ' cases · ' + used + ' min planned</p>' +
    (l.Notes ? '<p>' + esc(l.Notes) + '</p>' : '') +
    (pts.length ? '<table class="tbl"><thead><tr><th>#</th><th>Patient</th><th>Age</th><th>MRN</th><th>Procedure</th><th>Min</th><th>Care</th><th>Notes</th></tr></thead><tbody>' +
      pts.map(function (p, i) {
        var notes = [];
        tagsOf(p).forEach(function (t) { notes.push(t); });
        if (p.TagsOther) notes.push(p.TagsOther);
        clearances(p).forEach(function (c) { notes.push(c.spec + ' ' + (c.state === 'Requested' ? 'pending' : 'cleared')); });
        if (p.NeedsAdmission) notes.push('Admit before');
        return '<tr><td>' + (i + 1) + '</td><td><strong>' + esc(p.Name) + '</strong><br><span class="small">' + esc(p.Guardian) + '</span></td><td>' + esc(ageText(p.DOB)) + '</td><td>' + esc(p.MRN) + '</td><td>' + esc(procLabel(p)) + '<br><span class="small">' + esc(p.Diagnosis) + '</span></td><td>' + totalMin(p) + '</td><td>' + esc(p.CareType) + '</td><td class="small">' + esc(notes.join(', ')) + '</td></tr>';
      }).join('') + '</tbody></table>' : '<p>Nobody on this list.</p>') +
    '<p class="small" style="margin-top:16px">Printed ' + esc(fmtDate(S.today)) + ' by ' + esc(S.user.Name) + '. Contains patient information: handle and dispose of it according to hospital policy.</p></div>');
  m.el.style.maxWidth = '980px';
  $('pr_close').addEventListener('click', m.close);
  $('pr_go').addEventListener('click', function () { window.print(); });
}

// ---------------------------------------------------------------- dashboard and yearly summary
function countBy(list, fn) { var o = {}; list.forEach(function (p) { var k = fn(p) || '(none)'; o[k] = (o[k] || 0) + 1; }); return o; }
function barsHtml(o, max) {
  var keys = Object.keys(o).sort(function (a, b) { return o[b] - o[a]; });
  if (!keys.length) return '<p class="muted small">Nothing yet.</p>';
  var top = max || o[keys[0]] || 1;
  return keys.map(function (k) {
    return '<div class="barrow"><span class="bl">' + esc(k) + '</span><span class="bar"><i style="width:' + Math.max(2, Math.round(o[k] / top * 100)) + '%"></i></span><span class="bn">' + o[k] + '</span></div>';
  }).join('');
}
function monthKey(s) { return s ? s.slice(0, 7) : ''; }
function viewDashboard() {
  var d = S.d, cons = d.consultants.filter(function (c) { return c.Active === 'Y'; });
  var all = d.patients.filter(function (p) { return S.dashCons === 'all' || p.ConsultantId === S.dashCons; });
  var act = all.filter(isActive), done = all.filter(function (p) { return p.Status === 'Done'; }), rem = all.filter(function (p) { return p.Status === 'Removed'; });
  var booked = act.filter(function (p) { return p.ListId; }).length;
  var warn = act.filter(function (p) { return warnings(p).length; }).length;
  var avg = act.length ? Math.round(act.reduce(function (s, p) { return s + waitDays(p); }, 0) / act.length) : 0;
  var buckets = { '0 to 30 days': 0, '31 to 90 days': 0, '91 to 180 days': 0, '181 to 365 days': 0, 'Over a year': 0 };
  act.forEach(function (p) { var w = waitDays(p); buckets[w <= 30 ? '0 to 30 days' : w <= 90 ? '31 to 90 days' : w <= 180 ? '91 to 180 days' : w <= 365 ? '181 to 365 days' : 'Over a year']++; });
  var end = addDaysStr(S.today, 28);
  var up = d.lists.filter(function (l) { return l.Status === 'Open' && l.Date >= S.today && l.Date <= end && (S.dashCons === 'all' || l.ConsultantId === S.dashCons); });
  var cap = 0, usedMin = 0, empty = 0;
  up.forEach(function (l) { var u = listUsed(l); cap += Number(l.Minutes) || 0; usedMin += u.min; if (!u.n) empty++; });
  var util = cap ? Math.round(usedMin / cap * 100) : 0;
  // 12-month trend
  var months = [], t = S.today.slice(0, 7);
  for (var i = 11; i >= 0; i--) { var y = +t.slice(0, 4), mo = +t.slice(5, 7) - i; while (mo < 1) { mo += 12; y--; } months.push(y + '-' + ('0' + mo).slice(-2)); }
  var addedM = countBy(all.filter(function (p) { return p.DateAdded; }), function (p) { return monthKey(p.DateAdded); });
  var doneM = countBy(done.filter(function (p) { return p.DoneDate; }), function (p) { return monthKey(p.DoneDate); });
  var tmax = 1; months.forEach(function (k) { tmax = Math.max(tmax, addedM[k] || 0, doneM[k] || 0); });
  var trend = '<div class="trend">' + months.map(function (k) {
    return '<div class="tcol"><div class="tbars"><i class="ta" style="height:' + Math.round((addedM[k] || 0) / tmax * 100) + '%" title="Added ' + (addedM[k] || 0) + '"></i><i class="td" style="height:' + Math.round((doneM[k] || 0) / tmax * 100) + '%" title="Done ' + (doneM[k] || 0) + '"></i></div><div class="tl">' + MONTHS[+k.slice(5) - 1] + '</div></div>';
  }).join('') + '</div><p class="muted small"><span class="chip">Added</span> <span class="chip green">Done</span> per month, last 12 months</p>';
  // years available
  var years = {}; years[S.today.slice(0, 4)] = true;
  all.forEach(function (p) { if (p.DoneDate) years[p.DoneDate.slice(0, 4)] = true; if (p.DateAdded) years[p.DateAdded.slice(0, 4)] = true; if (p.RemovedDate) years[p.RemovedDate.slice(0, 4)] = true; });
  var ylist = Object.keys(years).sort().reverse();
  if (!S.dashYear || !years[S.dashYear]) S.dashYear = ylist[0];
  var yr = S.dashYear;
  var dY = done.filter(function (p) { return (p.DoneDate || '').slice(0, 4) === yr; });
  var aY = all.filter(function (p) { return (p.DateAdded || '').slice(0, 4) === yr; });
  var rY = rem.filter(function (p) { return (p.RemovedDate || '').slice(0, 4) === yr; });
  var waits = dY.filter(function (p) { return p.DateAdded && p.DoneDate; }).map(function (p) { return daysBetween(p.DateAdded, p.DoneDate); }).sort(function (a, b) { return a - b; });
  var med = waits.length ? waits[Math.floor(waits.length / 2)] : 0;
  var byRem = countBy(rY, function (p) { return p.RemovedReason; });
  $('view').innerHTML =
    '<div class="spread"><h2>Dashboard</h2><select id="dc" style="width:auto">' + opt('all', 'All consultants', S.dashCons === 'all') + cons.map(function (c) { return opt(c.Id, c.Name, S.dashCons === c.Id); }).join('') + '</select></div>' +
    '<div class="tiles"><div class="tile"><div class="n">' + act.length + '</div><div class="l">Waiting</div></div>' +
    '<div class="tile"><div class="n">' + booked + '</div><div class="l">Booked on a list</div></div>' +
    '<div class="tile"><div class="n">' + warn + '</div><div class="l">With warnings</div></div>' +
    '<div class="tile"><div class="n">' + avg + ' d</div><div class="l">Average wait</div></div>' +
    '<div class="tile"><div class="n">' + util + '%</div><div class="l">Theatre time booked, next 4 weeks</div></div>' +
    '<div class="tile"><div class="n">' + empty + '</div><div class="l">Empty lists, next 4 weeks</div></div></div>' +
    '<div class="grid2"><div class="panel"><h3>Waiting by procedure</h3>' + barsHtml(countBy(act, function (p) { return p.Procedure; })) + '</div>' +
    '<div class="panel"><h3>Waiting by category</h3>' + barsHtml(countBy(act, function (p) { return p.Category; })) +
    '<h3 style="margin-top:14px">Waiting time</h3>' + barsHtml(buckets, Math.max(1, act.length)) + '</div></div>' +
    '<div class="grid2"><div class="panel"><h3>Waiting by consultant</h3>' + barsHtml(countBy(act, function (p) { return consName(p.ConsultantId); })) + '</div>' +
    '<div class="panel"><h3>Day-case or inpatient</h3>' + barsHtml(countBy(act, function (p) { return p.CareType; })) + '</div></div>' +
    '<div class="panel"><h3>Trend</h3>' + trend + '</div>' +
    '<div class="panel"><div class="spread"><h3>Yearly summary</h3><div class="row"><select id="dy" style="width:auto">' + ylist.map(function (y) { return opt(y, y, y === yr); }).join('') + '</select><button id="dy_csv">Export CSV</button></div></div>' +
    '<div class="tiles"><div class="tile"><div class="n">' + dY.length + '</div><div class="l">Operations done</div></div>' +
    '<div class="tile"><div class="n">' + aY.length + '</div><div class="l">Added to the list</div></div>' +
    '<div class="tile"><div class="n">' + rY.length + '</div><div class="l">Removed</div></div>' +
    '<div class="tile"><div class="n">' + med + ' d</div><div class="l">Median wait of done cases</div></div></div>' +
    '<div class="grid2"><div><h3>Done by procedure</h3>' + barsHtml(countBy(dY, function (p) { return p.Procedure; })) + '</div>' +
    '<div><h3>Done by consultant</h3>' + barsHtml(countBy(dY, function (p) { return consName(p.ConsultantId); })) + '<h3 style="margin-top:14px">Done by category</h3>' + barsHtml(countBy(dY, function (p) { return p.Category; })) + '</div></div>' +
    '<h3>Removed by reason</h3>' + barsHtml(byRem) + '</div>';
  $('dc').addEventListener('change', function () { S.dashCons = this.value; viewDashboard(); });
  $('dy').addEventListener('change', function () { S.dashYear = this.value; viewDashboard(); });
  $('dy_csv').addEventListener('click', function () {
    var rows = [['Year', yr], ['Consultant', S.dashCons === 'all' ? 'All' : consName(S.dashCons)], ['Operations done', dY.length], ['Added', aY.length], ['Removed', rY.length], ['Median wait of done cases (days)', med], [], ['Done by procedure', 'Count']];
    var bp = countBy(dY, function (p) { return p.Procedure; }); Object.keys(bp).sort(function (a, b) { return bp[b] - bp[a]; }).forEach(function (k) { rows.push([k, bp[k]]); });
    rows.push([], ['Done by consultant', 'Count']);
    var bc = countBy(dY, function (p) { return consName(p.ConsultantId); }); Object.keys(bc).sort(function (a, b) { return bc[b] - bc[a]; }).forEach(function (k) { rows.push([k, bc[k]]); });
    rows.push([], ['Done by month', 'Count']);
    var bm = countBy(dY, function (p) { return monthKey(p.DoneDate); }); Object.keys(bm).sort().forEach(function (k) { rows.push([k, bm[k]]); });
    rows.push([], ['Removed by reason', 'Count']);
    Object.keys(byRem).forEach(function (k) { rows.push([k, byRem[k]]); });
    var csv = '﻿' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'yearly-summary-' + yr + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  });
}

function dlgTakeOff(p, after) {
  var reasons = ['Sick on the day', 'Did not attend', 'Family cancelled', 'Moved to another list', 'Not fit for surgery', 'Other'];
  var m = openModal('<h2>Take off theatre list</h2><p class="muted small">' + esc(p.Name) + ' goes back on the waiting list. The freed time can be filled from the list builder.</p>' +
    '<div class="field"><label for="t_reason">Reason</label><select id="t_reason">' + reasons.map(function (s) { return opt(s, s); }).join('') + '</select></div>' +
    '<div class="field"><label for="t_note">Details (optional)</label><input type="text" id="t_note"></div>' +
    '<div class="row"><button class="primary" id="t_go">Take off</button><button id="t_cancel">Cancel</button></div>', { narrow: true });
  $('t_cancel').addEventListener('click', m.close);
  $('t_go').addEventListener('click', function () {
    call('removeFromList', { patientId: p.Id, reason: val('t_reason'), note: val('t_note') }).then(function (r) {
      upsertP(r); m.close(); render(); toast('Taken off the list'); if (after) after();
    }).catch(fail);
  });
}
function dlgCancelList(l) {
  var m = openModal('<h2>Cancel this list</h2><p class="muted small">All patients on it go back on the waiting list.</p>' +
    '<div class="field"><label for="x_reason">Reason</label><input type="text" id="x_reason" placeholder="Surgeon on leave"></div>' +
    '<div class="row"><button class="danger" id="x_go">Cancel list</button><button id="x_back">Keep list</button></div>', { narrow: true });
  $('x_back').addEventListener('click', m.close);
  $('x_go').addEventListener('click', function () {
    call('cancelList', { listId: l.Id, reason: val('x_reason') }).then(function (r) {
      S.d.lists = r.lists; r.patients.forEach(upsertP); m.close(); render(); toast('List cancelled');
    }).catch(fail);
  });
}

function openList(id) {
  var F = { allCons: false, awaiting: false, noMajor: false, noAdmit: false, medFree: false, fit: true, care: '', minAge: '', minUnit: 'y', maxAge: '', maxUnit: 'y', excl: {} };
  var T = {};
  var m = openModal('<div id="ls_body"></div>');
  m.el.style.maxWidth = '980px';

  function draw() {
    var l = listById(id);
    if (!l) { m.close(); return; }
    var cap = Number(l.Minutes) || 0;
    var pts = onList(l).sort(function (a, b) { return ageMonths(a.DOB, S.today) - ageMonths(b.DOB, S.today); });
    var used = pts.reduce(function (s, p) { return s + totalMin(p); }, 0), rem = cap - used;
    var open = l.Status === 'Open', past = l.Date < S.today;
    var html = '<div class="spread"><h2>' + esc(fmtDay(l.Date)) + '</h2><button id="ls_close">Close</button></div>' +
      '<p style="margin:4px 0"><strong>' + esc(consName(l.ConsultantId)) + '</strong>' + (l.RoomId ? ' · ' + esc(roomName(l.RoomId)) : '') + ' · ' + cap + ' min list</p>' +
      '<p style="margin:4px 0">' + pts.length + (pts.length === 1 ? ' case' : ' cases') + ' · <strong>' + used + ' min used</strong> · ' + (rem >= 0 ? rem + ' min free' : '<span style="color:var(--red)">' + (-rem) + ' min over</span>') +
      (l.Status !== 'Open' ? ' · <span class="chip red">Cancelled: ' + esc(l.CancelReason) + '</span>' : '') + '</p>' +
      (l.Notes ? '<p class="muted small" style="margin:4px 0">' + esc(l.Notes) + '</p>' : '') +
      '<div class="row" style="margin:8px 0">' + (open ? '<button id="ls_edit">Edit list</button>' : '') + '<button id="ls_print">Print list</button>' + (open ? '<button id="ls_cancel" class="danger">Cancel list</button>' : '') + '</div>';
    html += '<div class="sect"><h3>On this list</h3>' + (pts.length ? pts.map(function (p, i) {
      return '<div class="log"><div class="spread"><div><strong>' + (i + 1) + '. ' + (p.Starred ? '★ ' : '') + esc(p.Name) + '</strong> <span class="muted small">' + esc(ageText(p.DOB)) + ' · ' + esc(p.MRN) + '</span><br>' +
        esc(procLabel(p)) + ' <span class="muted small">· ' + totalMin(p) + ' min · ' + esc(p.CareType) + '</span></div>' +
        '<div class="row">' + (p.Status === 'Done' ? '<span class="chip green">Done</span>' : '<span class="chip green">Booked</span>') + '<button data-open="' + esc(p.Id) + '">Open</button>' +
        (open && p.Status !== 'Done' ? '<button data-off="' + esc(p.Id) + '">Take off</button>' : '') + '</div></div><div>' + flagsHtml(p) + '</div></div>';
    }).join('') : '<p class="muted small">Nobody on this list yet.</p>') + '</div>';

    if (open && !past) {
      var cs = cands(l, rem);
      var procs = S.d.procedures.filter(function (x) { return x.Active === 'Y'; });
      html += '<div class="sect"><h3>Add patients</h3>' +
        '<div class="tags" style="margin-bottom:8px">' +
        chk('b_all', F.allCons, 'All consultants') + chk('b_nomaj', F.noMajor, 'No major cases') +
        chk('b_noadm', F.noAdmit, 'No prior admission needed') + chk('b_free', F.medFree, 'Only medically free') + chk('b_fit', F.fit, 'Only cases that fit the free time') + '</div>' +
        '<div class="grid3"><div class="field"><label for="b_care">Care</label><select id="b_care">' + opt('', 'Day-case and inpatient', !F.care) + opt('Day-case', 'Day-case', F.care === 'Day-case') + opt('Inpatient', 'Inpatient', F.care === 'Inpatient') + '</select></div>' +
        '<div class="field"><label for="b_min">Age from</label><div class="row" style="flex-wrap:nowrap"><input type="number" id="b_min" min="0" value="' + esc(F.minAge) + '"><select id="b_minu" style="width:auto">' + opt('y', 'years', F.minUnit === 'y') + opt('m', 'months', F.minUnit === 'm') + '</select></div></div>' +
        '<div class="field"><label for="b_max">Age up to</label><div class="row" style="flex-wrap:nowrap"><input type="number" id="b_max" min="0" value="' + esc(F.maxAge) + '"><select id="b_maxu" style="width:auto">' + opt('y', 'years', F.maxUnit === 'y') + opt('m', 'months', F.maxUnit === 'm') + '</select></div></div></div>' +
        '<details style="margin-bottom:8px"><summary class="small muted" style="cursor:pointer">Leave out procedures' + (Object.keys(F.excl).length ? ' (' + Object.keys(F.excl).length + ')' : '') + '</summary><div class="tags" style="margin-top:6px">' +
        procs.map(function (x) { return chk('b_ex_' + x.Id, !!F.excl[x.Name], x.Name, 'b_ex'); }).join('') + '</div></details>' +
        '<div class="row" style="margin-bottom:8px"><button id="b_suggest">Suggest a full list</button><button class="primary" id="b_add">Add ticked</button><span class="muted small" id="b_tot"></span></div>' +
        (cs.length ? cs.map(function (p) {
          return '<div class="log"><label class="check" style="align-items:flex-start"><input type="checkbox" class="b_chk" data-id="' + esc(p.Id) + '"' + (T[p.Id] ? ' checked' : '') + '><span><strong>' + (p.Starred ? '★ ' : '') + esc(p.Name) + '</strong> <span class="muted small">' + esc(ageText(p.DOB)) + ' · ' + esc(p.MRN) + (F.allCons ? ' · ' + esc(consName(p.ConsultantId)) : '') + '</span><br>' +
            esc(procLabel(p)) + ' <span class="muted small">· ' + totalMin(p) + ' min · ' + esc(p.Category) + ' · ' + esc(p.CareType) + ' · waiting ' + waitDays(p) + ' d</span><br>' + flagsHtml(p) + (totalMin(p) > rem ? '<span class="chip red">Longer than the free time</span>' : '') + '</span></label></div>';
        }).join('') : '<p class="muted small">No patients match these filters.</p>') + '</div>';
    } else if (open && past) {
      html += '<p class="muted small">This list is in the past, so patients can\'t be added.</p>';
    }
    $('ls_body').innerHTML = html;

    $('ls_close').addEventListener('click', m.close);
    var b = function (idd, fn) { var e = $(idd); if (e) e.addEventListener('click', fn); };
    b('ls_edit', function () { listForm(listById(id)); });
    b('ls_print', function () { printList(listById(id)); });
    b('ls_cancel', function () { dlgCancelList(listById(id)); });
    on($('ls_body'), '[data-open]', 'click', function (e) { openPatient(e.currentTarget.getAttribute('data-open')); });
    on($('ls_body'), '[data-off]', 'click', function (e) { dlgTakeOff(getP(e.currentTarget.getAttribute('data-off'))); });
    if (open && !past) {
      [['b_all', 'allCons'], ['b_nomaj', 'noMajor'], ['b_noadm', 'noAdmit'], ['b_free', 'medFree'], ['b_fit', 'fit']].forEach(function (x) {
        $(x[0]).addEventListener('change', function () { F[x[1]] = this.checked; T = {}; draw(); });
      });
      $('b_care').addEventListener('change', function () { F.care = this.value; T = {}; draw(); });
      [['b_min', 'minAge'], ['b_max', 'maxAge']].forEach(function (x) { $(x[0]).addEventListener('change', function () { F[x[1]] = this.value; T = {}; draw(); }); });
      [['b_minu', 'minUnit'], ['b_maxu', 'maxUnit']].forEach(function (x) { $(x[0]).addEventListener('change', function () { F[x[1]] = this.value; T = {}; draw(); }); });
      on($('ls_body'), '.b_ex', 'change', function (e) {
        var name = e.currentTarget.getAttribute('data-name');
        if (e.currentTarget.checked) F.excl[name] = true; else delete F.excl[name];
        T = {}; draw();
      });
      on($('ls_body'), '.b_chk', 'change', function (e) {
        var pid = e.currentTarget.getAttribute('data-id');
        if (e.currentTarget.checked) T[pid] = true; else delete T[pid];
        tot(rem);
      });
      $('b_suggest').addEventListener('click', function () {
        T = {};
        var left = rem;
        cands(listById(id), rem).forEach(function (p) { var t = totalMin(p); if (t <= left) { T[p.Id] = true; left -= t; } });
        draw();
        if (!Object.keys(T).length) toast('Nothing fits the free time with these filters');
      });
      $('b_add').addEventListener('click', function () {
        var ids = Object.keys(T);
        if (!ids.length) { toast('Tick at least one patient', true); return; }
        var sum = ids.reduce(function (s, x) { return s + totalMin(getP(x)); }, 0);
        if (sum > rem && !window.confirm('This goes over the list time by ' + (sum - rem) + ' minutes. Add anyway?')) return;
        call('addToList', { listId: id, patientIds: ids }).then(function (r) {
          r.patients.forEach(upsertP); T = {}; render();
          toast(r.patients.length + ' added' + (r.skipped.length ? ', ' + r.skipped.length + ' skipped (' + r.skipped[0].reason + ')' : ''), r.skipped.length > 0);
        }).catch(fail);
      });
      tot(rem);
    }
  }
  function chk(idd, on_, label, cls) {
    var nm = idd.indexOf('b_ex_') === 0 ? ' data-name="' + esc(label) + '"' : '';
    return '<label class="check"><input type="checkbox" id="' + esc(idd) + '"' + (cls ? ' class="' + cls + '"' : '') + nm + (on_ ? ' checked' : '') + '> ' + esc(label) + '</label>';
  }
  function tot(rem) {
    var ids = Object.keys(T), sum = ids.reduce(function (s, x) { var p = getP(x); return s + (p ? totalMin(p) : 0); }, 0);
    var e = $('b_tot');
    if (e) e.textContent = ids.length ? ids.length + ' ticked · ' + sum + ' of ' + rem + ' min free' : '';
  }
  function cands(l, rem) {
    var base = S.d.patients.filter(function (p) {
      if (p.ListId) return false;
      if (p.Status !== 'Ready') return false;
      if (!F.allCons && p.ConsultantId !== l.ConsultantId) return false;
      if (F.noMajor && p.Category === 'Major') return false;
      if (F.noAdmit && p.NeedsAdmission) return false;
      if (F.medFree && (tagsOf(p).length || clearances(p).some(function (c) { return c.state === 'Requested'; }))) return false;
      if (F.care && p.CareType !== F.care) return false;
      var names = [p.Procedure].concat(extras(p).map(function (x) { return x.procedure; }));
      if (names.some(function (n) { return F.excl[n]; })) return false;
      var am = ageMonths(p.DOB, S.today);
      if (F.minAge !== '' && am < Number(F.minAge) * (F.minUnit === 'y' ? 12 : 1)) return false;
      if (F.maxAge !== '' && am > Number(F.maxAge) * (F.maxUnit === 'y' ? 12 : 1)) return false;
      if (F.fit && totalMin(p) > rem) return false;
      return true;
    });
    return sortList(base, 'priority');
  }
  draw();
  S.redrawList = function () { if (!m.el.isConnected) { S.redrawList = null; return; } draw(); };
}

// ---------------------------------------------------------------- import from Excel or CSV
function parseTable(text) {
  text = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  var first = text.split('\n')[0] || '';
  var delim = first.split('\t').length > 1 ? '\t' : (first.split(';').length > first.split(',').length ? ';' : ',');
  var rows = [], row = [], cell = '', q = false;
  for (var i = 0; i < text.length; i++) {
    var ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
}
function parseDateLoose(v) {
  var s = String(v === null || v === undefined ? '' : v).trim();
  if (!s) return '';
  function pad(n) { return ('0' + n).slice(-2); }
  function ok(y, mo, d) {
    var t = new Date(Date.UTC(y, mo - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? y + '-' + pad(mo) + '-' + pad(d) : '';
  }
  var m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  if (m) return ok(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/);
  if (m) {
    var a = +m[1], b = +m[2], yy = +m[3];
    if (yy < 100) yy += yy < 50 ? 2000 : 1900;
    var r = ok(yy, b, a);
    return r || ok(yy, a, b);
  }
  if (/^\d{5}$/.test(s) && +s > 20000 && +s < 70000) {
    var t = new Date(Date.UTC(1899, 11, 30) + (+s) * 86400000);
    return ok(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }
  var d = new Date(s);
  if (!isNaN(d.getTime())) return ok(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return '';
}
function parseAgeMonths(v) {
  var s = String(v === null || v === undefined ? '' : v).toLowerCase().trim();
  if (!s) return null;
  var re = /(\d+(?:\.\d+)?)\s*(years?|yrs?|y|months?|mos?|m|weeks?|wks?|w|days?|d)?/g, total = 0, found = false, mm;
  while ((mm = re.exec(s)) !== null) {
    var n = parseFloat(mm[1]), u = mm[2] || 'y';
    found = true;
    if (u[0] === 'y') total += n * 12; else if (u[0] === 'm') total += n; else if (u[0] === 'w') total += n / 4.35; else if (u[0] === 'd') total += n / 30.44;
  }
  return found ? total : null;
}
var IMP = [
  { k: 'Name', label: 'Name', req: true, syn: ['patient name', 'name', 'patient', 'full name'] },
  { k: 'MRN', label: 'MRN', req: true, syn: ['mrn', 'file no', 'file number', 'hospital no', 'cpr', 'id'] },
  { k: 'Procedure', label: 'Procedure', req: true, syn: ['procedure', 'operation', 'planned procedure', 'surgery', 'op'] },
  { k: 'DOB', label: 'Date of birth', syn: ['date of birth', 'dob', 'birth'] },
  { k: 'Age', label: 'Age (used if there is no date of birth)', syn: ['age'] },
  { k: 'Laterality', label: 'Side', syn: ['side', 'laterality', 'site'] },
  { k: 'Diagnosis', label: 'Diagnosis', syn: ['diagnosis', 'dx'] },
  { k: 'Consultant', label: 'Consultant', syn: ['consultant', 'surgeon', 'doctor'] },
  { k: 'Category', label: 'Category', syn: ['category', 'class'] },
  { k: 'DateAdded', label: 'Date added to the list', syn: ['date added', 'added', 'date of listing', 'listed', 'date', 'referral'] },
  { k: 'Guardian', label: 'Guardian contact', syn: ['phone', 'mobile', 'contact', 'guardian', 'tel'] },
  { k: 'Sponsorship', label: 'Sponsorship', syn: ['sponsorship', 'sponsor', 'payment', 'nationality'] },
  { k: 'CareType', label: 'Day-case or inpatient', syn: ['day case', 'daycase', 'care', 'admission'] },
  { k: 'Tags', label: 'Conditions', syn: ['comorbidity', 'comorbidities', 'conditions', 'medical', 'tags'] },
  { k: 'Notes', label: 'Notes', syn: ['notes', 'note', 'comment', 'comments', 'remarks'] }
];
function openImport() {
  var cons = S.d.consultants.filter(function (c) { return c.Active === 'Y'; });
  var table = null, map = {};
  var m = openModal('<div id="im_body"></div>');
  function step1() {
    $('im_body').innerHTML = '<div class="spread"><h2>Import from Excel or CSV</h2><button id="im_close">Close</button></div>' +
      '<p class="muted small">In Excel, select your table including the heading row, copy it, and paste it below. Or save the sheet as CSV and choose the file. Nothing is saved until you confirm.</p>' +
      '<div class="field"><label for="im_text">Paste your table here</label><textarea id="im_text" style="min-height:140px"></textarea></div>' +
      '<div class="field"><label for="im_file">Or choose a CSV file</label><input type="file" id="im_file" accept=".csv,.txt,.tsv"></div>' +
      '<button class="primary" id="im_read">Read the data</button>';
    $('im_close').addEventListener('click', m.close);
    $('im_file').addEventListener('change', function () {
      var f = this.files[0]; if (!f) return;
      var rd = new FileReader();
      rd.onload = function () { $('im_text').value = rd.result; };
      rd.readAsText(f);
    });
    $('im_read').addEventListener('click', function () {
      var t = parseTable($('im_text').value);
      if (t.length < 2) { toast('Paste a table with a heading row and at least one patient', true); return; }
      table = t; autoMap(); step2();
    });
  }
  function norm(x) { return String(x).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function autoMap() {
    map = {};
    var heads = table[0].map(norm), used = {};
    IMP.forEach(function (f) {
      for (var i = 0; i < heads.length; i++) if (!used[i] && f.syn.indexOf(heads[i]) >= 0) { map[f.k] = i; used[i] = true; return; }
    });
    IMP.forEach(function (f) {
      if (map[f.k] !== undefined) return;
      for (var i = 0; i < heads.length; i++) {
        if (used[i]) continue;
        if (f.syn.some(function (sy) { return sy.length > 3 && heads[i].indexOf(sy) >= 0; })) { map[f.k] = i; used[i] = true; return; }
      }
    });
  }
  function convert() {
    var good = [], bad = [];
    for (var r = 1; r < table.length; r++) {
      var row = table[r], o = { _n: r + 1 };
      IMP.forEach(function (f) { var i = map[f.k]; o[f.k] = i === undefined ? '' : String(row[i] === undefined ? '' : row[i]).trim(); });
      o.DOB = parseDateLoose(o.DOB);
      if (!o.DOB && o.Age) {
        var am = parseAgeMonths(o.Age);
        if (am !== null) { o.DOB = addDaysStr(S.today, -Math.round(am * 30.44)); o.approxDob = true; }
      }
      o.DateAdded = parseDateLoose(o.DateAdded);
      delete o.Age;
      var missing = [];
      if (!o.Name) missing.push('name'); if (!o.MRN) missing.push('MRN'); if (!o.Procedure) missing.push('procedure'); if (!o.DOB) missing.push('date of birth or age');
      if (missing.length) bad.push({ n: o._n, reason: 'Missing ' + missing.join(', ') }); else good.push(o);
    }
    return { good: good, bad: bad };
  }
  function step2() {
    var heads = table[0];
    var c = convert();
    $('im_body').innerHTML = '<div class="spread"><h2>Match your columns</h2><button id="im_close">Close</button></div>' +
      '<p class="muted small">I matched what I could. Check each choice. Fields marked * are required (a date of birth or an age is needed).</p><div class="grid2">' +
      IMP.map(function (f) {
        return '<div class="field"><label for="im_f_' + f.k + '">' + esc(f.label) + (f.req ? ' *' : '') + '</label><select id="im_f_' + f.k + '" class="im_map" data-k="' + f.k + '">' +
          opt('', 'Not in my file', map[f.k] === undefined) + heads.map(function (h, i) { return opt(String(i), h || ('Column ' + (i + 1)), map[f.k] === i); }).join('') + '</select></div>';
      }).join('') + '</div>' +
      '<div class="field"><label for="im_cons">Consultant for rows with no match</label><select id="im_cons">' + cons.map(function (x) { return opt(x.Id, x.Name); }).join('') + '</select></div>' +
      '<p><strong>' + c.good.length + '</strong> rows ready to import' + (c.bad.length ? ', <span style="color:var(--red)">' + c.bad.length + ' with problems</span> (' + esc(c.bad.slice(0, 3).map(function (b) { return 'row ' + b.n + ': ' + b.reason; }).join('; ')) + (c.bad.length > 3 ? '…' : '') + ')' : '') + '.</p>' +
      (c.good.length ? '<div style="overflow-x:auto"><table class="tbl" style="font-size:12px"><thead><tr><th>Name</th><th>MRN</th><th>Born</th><th>Procedure</th><th>Side</th></tr></thead><tbody>' +
        c.good.slice(0, 5).map(function (o) { return '<tr><td>' + esc(o.Name) + '</td><td>' + esc(o.MRN) + '</td><td>' + esc(o.DOB) + (o.approxDob ? ' (estimated)' : '') + '</td><td>' + esc(o.Procedure) + '</td><td>' + esc(o.Laterality) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '') +
      '<div class="row" style="margin-top:10px"><button class="primary" id="im_go">Import ' + c.good.length + ' patients</button><button id="im_back">Back</button></div><p class="small muted" id="im_prog"></p>';
    $('im_close').addEventListener('click', m.close);
    $('im_back').addEventListener('click', step1);
    on(m.el, '.im_map', 'change', function (e) {
      var k = e.currentTarget.getAttribute('data-k');
      if (e.currentTarget.value === '') delete map[k]; else map[k] = +e.currentTarget.value;
      var keep = $('im_cons').value; step2(); $('im_cons').value = keep;
    });
    $('im_go').addEventListener('click', function () {
      var good = c.good, added = 0, skipped = c.bad.slice(), idx = 0, defc = val('im_cons');
      if (!good.length) { toast('Nothing to import. Check the column matching.', true); return; }
      $('im_go').disabled = true;
      function next() {
        if (idx >= good.length) { done(); return; }
        var batch = good.slice(idx, idx + 40);
        $('im_prog').textContent = 'Importing ' + Math.min(idx + 40, good.length) + ' of ' + good.length + '…';
        call('importPatients', { rows: batch, defaultConsultantId: defc }).then(function (r) {
          added += r.added; skipped = skipped.concat(r.skipped); idx += 40; next();
        }).catch(function (e) { fail(e); $('im_go').disabled = false; });
      }
      function done() {
        load().then(function () {
          $('im_body').innerHTML = '<h2>Import finished</h2><p><strong>' + added + '</strong> patients added. ' + skipped.length + ' skipped.</p>' +
            (skipped.length ? '<div class="small">' + skipped.slice(0, 30).map(function (s2) { return 'Row ' + s2.n + ': ' + esc(s2.reason); }).join('<br>') + (skipped.length > 30 ? '<br>…' : '') + '</div>' : '') +
            '<p class="muted small">Imported patients start as Ready. Check clearances and priorities, and the date of birth where it was estimated.</p><button class="primary" id="im_ok">Close</button>';
          $('im_ok').addEventListener('click', m.close);
        });
      }
      next();
    });
  }
  step1();
}

function drawRooms() {
  var l = S.d.rooms || [];
  $('s_rooms').innerHTML = l.length ? l.map(function (r) {
    return '<div class="spread log"><span>' + esc(r.Name) + (r.Active !== 'Y' ? ' <span class="chip">not in use</span>' : '') + '</span><button data-r="' + esc(r.Id) + '">Edit</button></div>';
  }).join('') : '<p class="muted small">No rooms yet.</p>';
  on($('s_rooms'), '[data-r]', 'click', function (e) {
    var id = e.currentTarget.getAttribute('data-r'), r = S.d.rooms.filter(function (x) { return x.Id === id; })[0];
    var m = openModal('<h2>Edit room</h2><div class="field"><label for="rm_name">Name</label><input type="text" id="rm_name" value="' + esc(r.Name) + '"></div>' +
      '<label class="check"><input type="checkbox" id="rm_act"' + (r.Active === 'Y' ? ' checked' : '') + '> In use</label>' +
      '<div class="row" style="margin-top:12px"><button class="primary" id="rm_save">Save</button><button id="rm_cancel">Cancel</button></div>', { narrow: true });
    $('rm_cancel').addEventListener('click', m.close);
    $('rm_save').addEventListener('click', function () {
      call('saveRoom', { Id: id, Name: val('rm_name'), Active: checked('rm_act') ? 'Y' : 'N' }).then(function (l2) { S.d.rooms = l2; m.close(); viewSettings(); toast('Room saved'); }).catch(fail);
    });
  });
}

// ---------------------------------------------------------------- export
function csvCell(v) {
  var s = String(v === null || v === undefined ? '' : v);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
function exportCsv(name, list) {
  var head = ['MRN', 'Name', 'Date of birth', 'Age', 'Consultant', 'Procedure', 'Side', 'Diagnosis', 'Category', 'Minutes', 'Care', 'Status', 'Date added',
    'Days waiting', 'Booked date', 'Conditions', 'Clearances', 'Priority', 'Sponsorship', 'Guardian', 'Done date', 'Removed reason', 'Notes'];
  var rows = list.map(function (p) {
    return [p.MRN, p.Name, p.DOB, ageText(p.DOB), consName(p.ConsultantId), procLabel(p), p.Laterality, p.Diagnosis, p.Category, totalMin(p), p.CareType, p.Status, p.DateAdded,
      waitDays(p), p.ScheduledDate, tagsOf(p).concat(p.TagsOther ? [p.TagsOther] : []).join('; '),
      clearances(p).map(function (c) { return c.spec + ' ' + c.state; }).join('; '), p.Priority, p.Sponsorship, p.Guardian, p.DoneDate, p.RemovedReason, p.Notes];
  });
  var csv = '﻿' + [head].concat(rows).map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name + '-' + S.today + '.csv';
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  toast('Exported ' + list.length + ' rows');
}

init();
})();
