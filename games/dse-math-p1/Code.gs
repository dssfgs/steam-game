/* ============================================================
 * HKDSE 數學卷一／卷二練習追蹤 — Google Apps Script (Code.gs)
 * ------------------------------------------------------------
 * 給「數學卷一成績記錄」App 用，亦可同時接收卷二老師版。
 *
 * 部署：
 *   1. 開一份 Google 試算表（可沿用卷二那份）。
 *   2. 擴充功能 → Apps Script，刪掉預設內容，貼上本檔。
 *   3. 把下面 SYNC_KEY 改成你的密鑰（須與 App「匯入匯出」頁一致）。
 *   4. 儲存。在編輯器選 setupSheets → 執行（首次要授權）。
 *   5. 部署 → 新增部署作業 → 類型「網頁應用程式」
 *        執行身分：我
 *        誰可以存取：任何人
 *   6. 複製 Web App URL（…/exec），貼回 App 並按「測試連線」。
 *
 * 每次改程式後：管理部署作業 → 編輯 → 新版本，URL 才會生效。
 *
 * 合約（與卷一 App 對齊）：
 *   POST Content-Type: text/plain;charset=utf-8
 *   ping : { action|type: "ping", syncKey, paper?: "paper1" }
 *          → { ok, authOk, pong, service, headerVersion }
 *   write: { syncKey, record, paper?: "paper1"|"paper2" }
 *          → { ok, duplicate?, attemptId, row, code?, error?, message? }
 *   同一 attemptId 重送視為成功（duplicate:true），不新增列。
 * ============================================================ */

var SYNC_KEY = 'hkdse-sync-2026'; // ← 改成你自己的密鑰（前後端須一致）
var SHEET_P1 = '卷一';
var SHEET_P2 = 'Records';
var HEADER_VERSION = 2;
var CACHE_TTL_SEC = 21600;
var Q_MAX_P1 = 20;
var Q_MAX_P2 = 45;

var FORM_WHITELIST = ['Form 1', 'Form 2', 'Form 3', 'Form 4', 'Form 5', 'Form 6'];
var CLASS_WHITELIST = ['A', 'B', 'C', 'D', 'E', 'BCD1', 'BCD2', 'BCD3'];

/* ---------- 表頭：系統／身分／試卷區與卷二老師版相同，成績區按卷別 ---------- */

function p1Headers_(qMax) {
  var n = Math.max(Q_MAX_P1, qMax || 0);
  var h = [
    'attemptId', 'receivedAt', 'clientCreatedAt', 'appVersion', 'schemaVersion',
    'form', 'class', 'classNo', 'displayName', 'classLabel',
    'year', 'paperId', 'paperName', 'cutoffVersion', 'mode',
    'a1Score', 'a2Score', 'bScore', 'a1Full', 'a2Full', 'bFull',
    'rawScore', 'totalMarks', 'percent', 'grade',
    'unanswered', 'notes', 'practicedOn'
  ];
  for (var i = 1; i <= n; i++) h.push('Q' + i);
  h.push('rawPayload');
  return h;
}

function p2Headers_() {
  var h = [
    'attemptId', 'receivedAt', 'clientCreatedAt', 'appVersion', 'schemaVersion',
    'form', 'class', 'classNo', 'displayName', 'classLabel',
    'year', 'paperId', 'paperName', 'cutoffVersion', 'mode',
    'mcqCorrect', 'mcqWrong', 'mcqNA', 'mcqScore', 'mcqTotal', 'mcqAccuracy',
    'writtenScore', 'writtenMax', 'percent', 'grade'
  ];
  for (var i = 1; i <= Q_MAX_P2; i++) h.push('Q' + i);
  h.push('rawPayload');
  return h;
}

/* ---------- 入口 ---------- */

function doPost(e) {
  try {
    var payload;
    try {
      payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    } catch (err) {
      return json_({ ok: false, code: 'VALIDATION_ERROR', error: 'VALIDATION_ERROR', message: 'Invalid JSON body' });
    }
    var key = String(payload.syncKey || '');
    var isPing = payload.action === 'ping' || payload.type === 'ping';
    if (isPing) {
      var authOk = key === SYNC_KEY;
      return json_({
        ok: true,
        authOk: authOk,
        pong: true,
        service: 'hkdse-p1-sync',
        headerVersion: HEADER_VERSION
      });
    }
    if (key !== SYNC_KEY) {
      return json_({ ok: false, code: 'AUTH_ERROR', error: 'AUTH_ERROR', message: 'Invalid sync key' });
    }
    return handleWrite_(payload);
  } catch (err) {
    return json_({ ok: false, code: 'SERVER_ERROR', error: 'SERVER_ERROR', message: String(err) });
  }
}

function doGet() {
  return json_({ ok: true, service: 'hkdse-p1-sync', headerVersion: HEADER_VERSION, sheets: [SHEET_P1, SHEET_P2] });
}

/* ---------- 寫入（Cache → Lock → attemptId 掃描 → append） ---------- */

function handleWrite_(payload) {
  var rec = payload.record;
  if (!rec || typeof rec !== 'object') {
    return json_({ ok: false, code: 'VALIDATION_ERROR', error: 'VALIDATION_ERROR', message: 'Missing record' });
  }
  var kind = paperKind_(payload, rec);
  var v = kind === 'paper2' ? validateP2_(rec) : validateP1_(rec);
  if (v) return json_({ ok: false, code: 'VALIDATION_ERROR', error: 'VALIDATION_ERROR', message: v });

  var attemptId = String(rec.attemptId);
  var cache = CacheService.getScriptCache();
  var cacheKey = 'aid_' + kind + '_' + attemptId;
  if (cache.get(cacheKey)) {
    return json_({ ok: true, duplicate: true, attemptId: attemptId });
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return json_({ ok: false, code: 'LOCK_TIMEOUT', error: 'LOCK_TIMEOUT', message: 'Server busy, please retry' });
  }
  try {
    var qMax = kind === 'paper1' ? neededQMaxP1_(rec) : Q_MAX_P2;
    var expected = kind === 'paper2' ? p2Headers_() : p1Headers_(qMax);
    var sheet = ensureSheet_(kind === 'paper2' ? SHEET_P2 : SHEET_P1);
    var headers = ensureHeaders_(sheet, expected);

    var last = sheet.getLastRow();
    if (last >= 2) {
      var ids = sheet.getRange(2, 1, last - 1, 1).getValues();
      for (var i = ids.length - 1; i >= 0; i--) {
        if (String(ids[i][0]) === attemptId) {
          cache.put(cacheKey, '1', CACHE_TTL_SEC);
          return json_({ ok: true, duplicate: true, attemptId: attemptId, row: i + 2 });
        }
      }
    }

    var row = kind === 'paper2' ? buildP2Row_(headers, rec) : buildP1Row_(headers, rec, qMax);
    sheet.appendRow(row);
    var rowIndex = sheet.getLastRow();
    cache.put(cacheKey, '1', CACHE_TTL_SEC);
    return json_({ ok: true, duplicate: false, attemptId: attemptId, row: rowIndex });
  } catch (err) {
    var code = String(err).indexOf('HEADER_EXTEND') >= 0 ? 'HEADER_EXTEND_ERROR' : 'SERVER_ERROR';
    return json_({ ok: false, code: code, error: code, message: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function paperKind_(payload, rec) {
  var hint = String(
    payload.paper ||
    rec.paperId ||
    (rec.paper && rec.paper.paperId) ||
    rec.paperName ||
    (rec.paper && rec.paper.paperName) ||
    ''
  ).toLowerCase();
  if (hint.indexOf('paper1') >= 0 || hint.indexOf('卷一') >= 0 || hint.indexOf('p1') === 0) return 'paper1';
  if (hint.indexOf('paper2') >= 0 || hint.indexOf('卷二') >= 0 || hint.indexOf('p2') === 0) return 'paper2';
  if (rec.scores || rec.sectionScores) return 'paper1';
  if (rec.mcq) return 'paper2';
  return 'paper1';
}

/* ---------- 驗證 ---------- */

function validateP1_(rec) {
  if (!rec.attemptId || !/^[0-9a-fA-F-]{36}$/.test(String(rec.attemptId))) return 'Invalid attemptId';
  var year = rec.year || (rec.paper && rec.paper.year);
  if (!year) return 'Missing year';
  var idErr = validateStudent_(rec.student, true);
  if (idErr) return idErr;
  var hasScores = rec.scores && rec.scores.length;
  var hasSec = rec.sectionScores && (rec.sectionScores.A1 != null || rec.sectionScores.A2 != null || rec.sectionScores.B != null);
  if (!hasScores && !hasSec && rec.rawScore == null && rec.percentage == null) {
    return 'Missing scores';
  }
  return null;
}

function validateP2_(rec) {
  if (!rec.attemptId || !/^[0-9a-fA-F-]{36}$/.test(String(rec.attemptId))) return 'Invalid attemptId';
  var idErr = validateStudent_(rec.student, false);
  if (idErr) return idErr;
  var answers = (rec.mcq && rec.mcq.answers) || [];
  if (answers.length > Q_MAX_P2) return 'Too many MCQ answers (max ' + Q_MAX_P2 + ')';
  return null;
}

function validateStudent_(s, optional) {
  if (!s) return optional ? null : 'Missing student';
  if (!s.form && !s.cls && (s.classNo === null || s.classNo === undefined || s.classNo === '')) {
    return optional ? null : 'Missing student';
  }
  if (FORM_WHITELIST.indexOf(s.form) < 0) return 'Invalid form: ' + s.form;
  if (CLASS_WHITELIST.indexOf(s.cls) < 0) return 'Invalid class: ' + s.cls;
  var n = Number(String(s.classNo).replace(/^0+/, '') || s.classNo);
  if (!isFinite(n) || n !== Math.floor(n) || n < 1 || n > 50) return 'Invalid classNo: ' + s.classNo;
  return null;
}

function neededQMaxP1_(rec) {
  var max = Q_MAX_P1;
  (rec.scores || []).forEach(function (s) {
    var q = Number(s && s.q);
    if (isFinite(q) && q > max) max = q;
  });
  return max;
}

/* ---------- Sheet／表頭（只准右側追加） ---------- */

function ensureSheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

function ensureHeaders_(sheet, expected) {
  try {
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, expected.length).setValues([expected]);
      sheet.setFrozenRows(1);
      sheet.setFrozenColumns(1);
      return expected;
    }
    var width = Math.max(sheet.getLastColumn(), 1);
    var current = sheet.getRange(1, 1, 1, width).getValues()[0].map(String);
    var missing = expected.filter(function (h) { return current.indexOf(h) < 0; });
    if (missing.length > 0) {
      sheet.getRange(1, current.length + 1, 1, missing.length).setValues([missing]);
      current = current.concat(missing);
    }
    return current;
  } catch (err) {
    throw new Error('HEADER_EXTEND: ' + err);
  }
}

/* ---------- 組列 ---------- */

function identity_(rec) {
  var s = rec.student || {};
  var form = s.form || '';
  var cls = s.cls || s.class || '';
  return {
    form: form,
    'class': cls,
    classNo: (s.classNo === null || s.classNo === undefined || s.classNo === '') ? '' : Number(String(s.classNo).replace(/^0+/, '') || s.classNo),
    displayName: s.displayName || s.studentName || '',
    classLabel: s.classLabel || ((form && cls) ? (form + ' ' + cls) : '')
  };
}

function paperMeta_(rec) {
  var p = rec.paper || {};
  return {
    year: rec.year || p.year || '',
    paperId: rec.paperId || p.paperId || '',
    paperName: rec.paperName || p.paperName || '',
    cutoffVersion: rec.cutoffVersion || p.cutoffVersion || '',
    mode: rec.mode || ''
  };
}

function buildP1Row_(headers, rec, qMax) {
  var idn = identity_(rec);
  var meta = paperMeta_(rec);
  var sec = rec.sectionScores || {};
  var map = {
    attemptId: String(rec.attemptId),
    receivedAt: new Date(),
    clientCreatedAt: rec.submittedAt || rec.createdAt || rec.practicedOn || '',
    appVersion: rec.appVersion || 'p1-1.0',
    schemaVersion: rec.schemaVersion || '',
    form: idn.form,
    'class': idn['class'],
    classNo: idn.classNo,
    displayName: idn.displayName,
    classLabel: idn.classLabel,
    year: meta.year,
    paperId: meta.paperId || 'paper1',
    paperName: meta.paperName,
    cutoffVersion: meta.cutoffVersion,
    mode: meta.mode,
    a1Score: num_(sec.A1),
    a2Score: num_(sec.A2),
    bScore: num_(sec.B),
    a1Full: 35,
    a2Full: 35,
    bFull: 35,
    rawScore: num_(rec.rawScore),
    totalMarks: num_(rec.totalMarks != null ? rec.totalMarks : 105),
    percent: num_(rec.percentage != null ? rec.percentage : (rec.result && rec.result.percent)),
    grade: rec.estimatedGrade || (rec.result && rec.result.grade) || '',
    unanswered: num_(rec.unanswered),
    notes: rec.notes || '',
    practicedOn: rec.practicedOn || '',
    rawPayload: sanitize_(rec)
  };
  var byQ = {};
  (rec.scores || []).forEach(function (s) {
    if (!s || s.q == null) return;
    byQ[Number(s.q)] = s.score;
  });
  var n = Math.max(Q_MAX_P1, qMax || 0);
  for (var i = 1; i <= n; i++) {
    map['Q' + i] = (i in byQ) ? (byQ[i] == null ? '' : num_(byQ[i])) : '';
  }
  return headers.map(function (h) { return (h in map) ? map[h] : ''; });
}

function buildP2Row_(headers, rec) {
  var idn = identity_(rec);
  var meta = paperMeta_(rec);
  var m = rec.mcq || {};
  var r = rec.result || {};
  var writtenScore = 0, writtenMax = 0;
  (rec.written || []).forEach(function (w) {
    writtenScore += Number(w.score) || 0;
    writtenMax += Number(w.max != null ? w.max : w.full) || 0;
  });
  var answers = m.answers || [];
  var map = {
    attemptId: String(rec.attemptId),
    receivedAt: new Date(),
    clientCreatedAt: rec.submittedAt || rec.createdAt || '',
    appVersion: rec.appVersion || '',
    schemaVersion: rec.schemaVersion || '',
    form: idn.form,
    'class': idn['class'],
    classNo: idn.classNo,
    displayName: idn.displayName,
    classLabel: idn.classLabel,
    year: meta.year,
    paperId: meta.paperId || 'paper2',
    paperName: meta.paperName,
    cutoffVersion: meta.cutoffVersion,
    mode: meta.mode,
    mcqCorrect: num_(m.correct),
    mcqWrong: num_(m.wrong),
    mcqNA: num_(m.unanswered != null ? m.unanswered : m.na),
    mcqScore: num_(m.score != null ? m.score : m.correct),
    mcqTotal: num_(m.total != null ? m.total : answers.length),
    mcqAccuracy: num_(m.accuracy),
    writtenScore: writtenScore,
    writtenMax: writtenMax,
    percent: num_(rec.percentage != null ? rec.percentage : r.percent),
    grade: rec.estimatedGrade || r.grade || '',
    rawPayload: sanitize_(rec)
  };
  for (var i = 1; i <= Q_MAX_P2; i++) {
    var a = answers[i - 1];
    map['Q' + i] = (a === null || a === undefined) ? '' : String(a);
  }
  return headers.map(function (h) { return (h in map) ? map[h] : ''; });
}

function num_(x) {
  if (x === null || x === undefined || x === '') return '';
  var n = Number(x);
  return isFinite(n) ? n : '';
}

function sanitize_(rec) {
  var copy = {};
  var keys = Object.keys(rec || {});
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (k === 'syncStatus' || k === 'syncedAt' || k === 'lastSyncError') continue;
    copy[k] = rec[k];
  }
  return JSON.stringify(copy);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------- 老師在編輯器手動執行 ---------- */

function setupSheets() {
  var p1 = ensureSheet_(SHEET_P1);
  ensureHeaders_(p1, p1Headers_(Q_MAX_P1));
  var p2 = ensureSheet_(SHEET_P2);
  ensureHeaders_(p2, p2Headers_());
  createDashboardP1_(false);
}

function createDashboardP1() {
  createDashboardP1_(true);
}

function createDashboardP1_(overwrite) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var name = 'Dashboard_卷一';
  var sh = ss.getSheetByName(name);
  if (sh && !overwrite) return;
  if (!sh) sh = ss.insertSheet(name);
  else sh.clear();
  sh.getRange(1, 1, 1, 2).setValues([['卷一老師統計（公式，勿在資料列手改）', '']]);
  sh.getRange(3, 1).setValue('各班平均');
  sh.getRange(4, 1).setFormula(
    "=QUERY('" + SHEET_P1 + "'!A2:AZ,\"select J, avg(P), avg(Q), avg(R), avg(X), count(A) where A is not null group by J label J '班別', avg(P) '甲一', avg(Q) '甲二', avg(R) '乙部', avg(X) '平均百分比', count(A) '次數'\",0)"
  );
  sh.getRange(16, 1).setValue('等級分布');
  sh.getRange(17, 1).setFormula(
    "=QUERY('" + SHEET_P1 + "'!A2:AZ,\"select Y, count(A) where A is not null group by Y label Y '等級', count(A) '人次'\",0)"
  );
  sh.getRange(28, 1).setValue('各年次數與平均');
  sh.getRange(29, 1).setFormula(
    "=QUERY('" + SHEET_P1 + "'!A2:AZ,\"select K, avg(X), count(A) where A is not null group by K label K '年份', avg(X) '平均百分比', count(A) '次數'\",0)"
  );
  sh.setFrozenRows(1);
}

function pingTest() {
  var out = doPost({ postData: { contents: JSON.stringify({ action: 'ping', syncKey: SYNC_KEY }) } });
  Logger.log(out.getContent());
}
