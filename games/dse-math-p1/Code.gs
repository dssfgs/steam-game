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
 * 重要：專案裡只能有本檔（Code.gs）。不要把 sw.js／網頁檔貼進來。
 * 若出現 ReferenceError: self is not defined（file "sv"），刪除名為 sv 的檔案後重新部署新版本。
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

var P1_META = {
  2012: { full: [3,3,3,4,4,4,4,5,5,6,6,7,7,9,3,4,7,8,13], topic: ["指數","主項變換","因式分解","百分數","聯立方程","不等式","統計","圓的性質","面積與體積","統計","變分","面積與體積","二次函數圖像","軌跡","統計","排列組合","圓方程","三角學（乙部）","數列"] },
  2013: { full: [3,3,3,4,4,4,4,5,5,6,6,7,7,9,4,4,6,8,13], topic: ["指數","主項變換","因式分解","聯立方程","不等式","坐標幾何：點","全等與相似三角形","量度與誤差","統計","統計","變分","多項式","面積與體積","軌跡","統計","排列組合","二次函數圖像","三角學（乙部）","數列"] },
  2014: { full: [3,3,3,3,4,4,5,5,5,6,6,7,8,8,3,4,7,8,13], topic: ["指數","因式分解","量度與誤差","統計","主項變換","百分數","多項式","坐標幾何：點","全等與相似三角形","率與比","統計","圓方程","變分","面積與體積","圖像軸的變換","數列","三角學（乙部）","線性規劃","概率"] },
  2015: { full: [3,3,3,4,4,4,4,5,5,6,6,7,7,9,4,4,5,9,13], topic: ["指數","主項變換","概率","因式分解","不等式","百分數","聯立方程","圓的性質","面積與體積","變分","多項式","統計","全等與相似三角形","圓方程","統計","排列組合","數列","二次函數圖像","三角學（乙部）"] },
  2016: { full: [3,3,3,4,4,4,4,5,5,5,6,7,7,10,3,3,5,6,6,12], topic: ["指數","主項變換","代數分式","因式分解","百分數","不等式","坐標幾何：點","變分","統計","軌跡","面積與體積","統計","全等與相似三角形","多項式","排列組合","統計","數列","二次函數圖像","三角學（乙部）","直線圖形：角度"] },
  2017: { full: [3,3,3,4,4,4,4,5,5,6,7,7,7,8,4,4,6,8,13], topic: ["主項變換","指數","因式分解","聯立方程","不等式","坐標幾何：點","統計","變分","量度與誤差","圓的性質","統計","面積與體積","直線方程","多項式","圖像軸的變換","數列","排列組合","圓方程","三角學（乙部）"] },
  2018: { full: [3,3,3,3,4,4,5,5,5,5,6,7,8,9,3,5,7,8,12], topic: ["主項變換","指數","量度與誤差","概率","因式分解","不等式","百分數","圓的性質","率與比","統計","多項式","多項式","全等與相似三角形","面積與體積","排列組合","數列","三角學（乙部）","變分","圓方程"] },
  2019: { full: [3,3,3,4,4,4,4,5,5,5,6,8,8,8,3,6,7,7,12], topic: ["主項變換","代數分式","二次方程","因式分解","百分數","不等式","聯立方程","統計","面積與體積","變分","多項式","統計","圓的性質","全等與相似三角形","排列組合","數列","軌跡","三角學（乙部）","二次函數圖像"] },
  2020: { full: [3,3,3,3,4,4,5,5,5,6,6,6,8,9,5,5,6,7,12], topic: ["指數","因式分解","量度與誤差","率與比","聯立方程","不等式","二次函數圖像","直線圖形：角度","統計","變分","統計","面積與體積","多項式","圓方程","排列組合","數列","二次函數圖像","圓的性質","三角學（乙部）"] },
  2021: { full: [3,3,3,4,4,4,4,5,5,6,7,7,7,8,4,5,7,7,12], topic: ["指數","主項變換","因式分解","不等式","聯立方程","百分數","坐標幾何：點","全等與相似三角形","統計","變分","統計","多項式","軌跡","面積與體積","排列組合","線性規劃","數列","三角學（乙部）","圓方程"] },
  2022: { full: [3,3,3,4,4,4,4,5,5,6,7,7,7,8,4,5,7,7,12], topic: ["指數","聯立方程","因式分解","因式分解","百分數","不等式","二次函數圖像","全等與相似三角形","統計","二次方程","統計","圓方程","面積與體積","多項式","排列組合","二次函數圖像","數列","三角學（乙部）","圓方程"] },
  2023: { full: [3,3,3,4,4,4,4,5,5,6,7,7,7,8,4,5,6,8,12], topic: ["主項變換","指數","量度與誤差","不等式","百分數","率與比","圓的性質","全等與相似三角形","統計","軌跡","統計","變分","多項式","面積與體積","排列組合","二次方程","三角學（乙部）","數列","三角形的心"] },
  2024: { full: [3,3,3,4,4,4,4,5,5,6,7,7,7,8,3,4,8,8,12], topic: ["代數分式","主項變換","因式分解","不等式","率與比","百分數","極坐標","全等與相似三角形","概率","變分","統計","直線方程","面積與體積","多項式","圖像軸的變換","排列組合","軌跡","三角學（乙部）","二次函數圖像"] },
  2025: { full: [3,3,3,3,4,4,5,5,5,6,6,7,7,9,4,4,6,9,12], topic: ["指數","代數分式","率與比","坐標幾何：點","因式分解","不等式","百分數","全等與相似三角形","統計","多項式","變分","統計","軌跡","面積與體積","排列組合","指數與對數","數列","二次函數圖像","圓方程"] },
  2026: { full: [3,3,3,4,4,4,4,5,5,6,6,7,8,8,4,6,6,7,12], topic: ["主項變換","指數","坐標幾何：點","因式分解","百分數","不等式","百分數","全等與相似三角形","統計","統計","變分","直線方程","面積與體積","多項式","排列組合","圓方程","三角學（乙部）","數列","二次函數圖像"] },
};


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

function pingTest() {
  var out = doPost({ postData: { contents: JSON.stringify({ action: 'ping', syncKey: SYNC_KEY }) } });
  Logger.log(out.getContent());
}

/* ---------- 教師分析選單（試算表開啟時出現） ---------- */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('教師分析')
    .addItem('① 一鍵重建全部報表', 'rebuildAllReportsP1')
    .addSeparator()
    .addItem('總覽儀表板', 'createDashboardP1')
    .addItem('學生名單（每人一行）', 'buildRosterP1')
    .addItem('班別比較', 'buildClassCompareP1')
    .addItem('題目答對率熱圖', 'buildHeatmapP1')
    .addItem('需關注學生', 'buildWatchP1')
    .addItem('進步追蹤', 'buildProgressP1')
    .addItem('教學重點', 'buildFocusP1')
    .addItem('年度排行榜', 'buildRankingP1')
    .addSeparator()
    .addItem('重新整理全班報告班別', 'showBulkClassDialogP1')
    .addItem('匯出單一學生報告...', 'buildPersonalFromRowP1')
    .addItem('開啟學生報告側邊欄', 'showPersonalSidebarP1')
    .addItem('開啟所選學生報告', 'buildPersonalFromRowP1')
    .addItem('設定每日自動更新', 'installDailyP1')
    .addToUi();
}

function rebuildAllReportsP1() {
  createDashboardP1_(true);
  buildRosterP1();
  buildClassCompareP1();
  buildHeatmapP1();
  buildWatchP1();
  buildProgressP1();
  buildFocusP1();
  buildRankingP1();
  SpreadsheetApp.getActive().toast('已重建卷一教師報表', '教師分析', 5);
}

function installDailyP1() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'rebuildAllReportsP1') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('rebuildAllReportsP1').timeBased().everyDays(1).atHour(6).create();
  SpreadsheetApp.getUi().alert('已設定每日約早上 6 時自動重建全部報表。');
}

function showPersonalSidebarP1() {
  var html = HtmlService.createHtmlOutput(
    '<div style="font:14px/1.5 sans-serif;padding:8px">' +
      '<p>請先打開「學生名單」工作表，選該生所在列，再按選單「開啟所選學生報告」。</p>' +
      '<p>個人報告會寫入工作表「學生個人報告」。</p></div>'
  ).setTitle('學生報告');
  SpreadsheetApp.getUi().showSidebar(html);
}

function readP1Rows_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_P1);
  if (!sh) return [];
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var h = values[0];
  var idx = {};
  for (var i = 0; i < h.length; i++) idx[String(h[i])] = i;
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (!row[idx.attemptId]) continue;
    var rec = {
      attemptId: String(row[idx.attemptId] || ''),
      form: String(row[idx.form] || ''),
      cls: String(row[idx['class']] || ''),
      classNo: row[idx.classNo],
      displayName: String(row[idx.displayName] || ''),
      classLabel: String(row[idx.classLabel] || ((row[idx.form] || '') + ' ' + (row[idx['class']] || ''))).trim() || '未分班',
      year: Number(row[idx.year]) || 0,
      a1: Number(row[idx.a1Score]) || 0,
      a2: Number(row[idx.a2Score]) || 0,
      b: Number(row[idx.bScore]) || 0,
      percent: Number(row[idx.percent]) || 0,
      grade: String(row[idx.grade] || ''),
      unanswered: Number(row[idx.unanswered]) || 0,
      practicedOn: row[idx.practicedOn],
      receivedAt: row[idx.receivedAt],
      qs: []
    };
    for (var q = 1; q <= Q_MAX_P1; q++) {
      var col = idx['Q' + q];
      rec.qs[q] = col == null || row[col] === '' ? null : Number(row[col]);
    }
    rec.key = rec.form + '|' + rec.cls + '|' + rec.classNo;
    rows.push(rec);
  }
  return rows;
}

function writeSheet_(name, header, body, formats) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  sh.clear();
  var hLen = header && header.length ? header.length : 0;
  var cols = 1;
  if (hLen) {
    header.forEach(function (row) { if (row.length > cols) cols = row.length; });
    header = header.map(function (row) {
      var copy = row.slice();
      while (copy.length < cols) copy.push('');
      return copy;
    });
    sh.getRange(1, 1, hLen, cols).setValues(header);
  }
  if (body && body.length) {
    body.forEach(function (row) { if (row.length > cols) cols = row.length; });
    body = body.map(function (row) {
      var copy = row.slice();
      while (copy.length < cols) copy.push('');
      return copy;
    });
    sh.getRange(hLen + 1, 1, body.length, cols).setValues(body);
  }
  sh.setFrozenRows(Math.min(Math.max(hLen, 1), 2));
  sh.autoResizeColumns(1, cols);
  if (formats) formats(sh, hLen, body ? body.length : 0);
  return sh;
}

function groupStudentsP1_(rows) {
  var map = {};
  rows.forEach(function (r) {
    if (!map[r.key]) map[r.key] = [];
    map[r.key].push(r);
  });
  var out = [];
  Object.keys(map).forEach(function (k) {
    var list = map[k].slice().sort(function (a, b) {
      return String(a.practicedOn).localeCompare(String(b.practicedOn));
    });
    var pcts = list.map(function (x) { return x.percent; });
    var first = pcts[0] || 0;
    var latest = pcts[pcts.length - 1] || 0;
    var last = list[list.length - 1];
    var sum = function (fn) {
      return pcts.length ? +(list.reduce(function (s, x) { return s + fn(x); }, 0) / list.length).toFixed(1) : 0;
    };
    out.push({
      key: k,
      classLabel: last.classLabel,
      classNo: last.classNo,
      displayName: last.displayName,
      n: list.length,
      avg: sum(function (x) { return x.percent; }),
      best: Math.max.apply(null, pcts),
      latest: latest,
      first: first,
      delta: +(latest - first).toFixed(1),
      grade: last.grade,
      a1: sum(function (x) { return x.a1; }),
      a2: sum(function (x) { return x.a2; }),
      b: sum(function (x) { return x.b; }),
      unanswered: last.unanswered,
      list: list
    });
  });
  out.sort(function (a, b) {
    return String(a.classLabel).localeCompare(String(b.classLabel)) || Number(a.classNo) - Number(b.classNo);
  });
  return out;
}

function buildRosterP1() {
  var groups = groupStudentsP1_(readP1Rows_());
  var body = groups.map(function (g) {
    return [g.classLabel, g.classNo, g.displayName, g.n, g.avg, g.best, g.latest, g.grade, g.delta, g.a1, g.a2, g.b];
  });
  writeSheet_('學生名單', [[
    '班別', '學號', '姓名', '次數', '平均%', '最佳%', '最新%', '最新等級', '進步', '甲一均', '甲二均', '乙均'
  ]], body);
}

function buildClassCompareP1() {
  var rows = readP1Rows_();
  var by = {};
  rows.forEach(function (r) {
    if (!by[r.classLabel]) by[r.classLabel] = [];
    by[r.classLabel].push(r);
  });
  var body = Object.keys(by).sort().map(function (cl) {
    var list = by[cl];
    var keys = {};
    list.forEach(function (x) { keys[x.key] = 1; });
    var avg = function (fn) {
      return list.length ? +(list.reduce(function (s, x) { return s + fn(x); }, 0) / list.length).toFixed(1) : 0;
    };
    var pass = list.filter(function (x) { return x.percent >= 50; }).length;
    var pcts = list.map(function (x) { return x.percent; });
    return [
      cl, Object.keys(keys).length, list.length, avg(function (x) { return x.percent; }),
      avg(function (x) { return x.a1; }), avg(function (x) { return x.a2; }), avg(function (x) { return x.b; }),
      list.length ? +((pass / list.length) * 100).toFixed(1) : 0,
      pcts.length ? Math.max.apply(null, pcts) : 0,
      pcts.length ? Math.min.apply(null, pcts) : 0
    ];
  });
  writeSheet_('班別比較', [[
    '班別', '人數', '次數', '平均%', '甲一', '甲二', '乙', '及格率', '最高', '最低'
  ]], body);
}

function buildHeatmapP1() {
  var rows = readP1Rows_();
  var years = {};
  rows.forEach(function (r) {
    if (!years[r.year]) years[r.year] = [];
    years[r.year].push(r);
  });
  var ys = Object.keys(years).map(Number).sort();
  var qMax = Q_MAX_P1;
  ys.forEach(function (y) {
    var m = P1_META[y];
    if (m && m.full.length > qMax) qMax = m.full.length;
  });
  var header = ['年份 \\ 題'];
  for (var q = 1; q <= qMax; q++) header.push('Q' + q);
  var body = ys.map(function (y) {
    var list = years[y];
    var row = [y];
    for (var i = 1; i <= qMax; i++) {
      var full = p1Full_(y, i);
      var vals = [];
      list.forEach(function (r) {
        if (r.qs[i] != null && isFinite(r.qs[i])) vals.push(r.qs[i]);
      });
      if (!vals.length || !full) row.push('');
      else row.push(Math.round((vals.reduce(function (s, n) { return s + n; }, 0) / vals.length / full) * 100) / 100);
    }
    return row;
  });
  var topicRow = ['課題'];
  for (var t = 1; t <= qMax; t++) topicRow.push(p1Topic_(ys[0] || 2012, t));
  var sh = writeSheet_('題目答對率熱圖', [header], body.concat([[], topicRow]), function (sheet, hLen, bLen) {
    if (!ys.length) return;
    var range = sheet.getRange(hLen + 1, 2, ys.length, qMax);
    var rule = SpreadsheetApp.newConditionalFormatRule()
      .setGradientMaxpointWithValue('#2f6b4f', SpreadsheetApp.InterpolationType.NUMBER, 1)
      .setGradientMidpointWithValue('#c9a227', SpreadsheetApp.InterpolationType.NUMBER, 0.5)
      .setGradientMinpointWithValue('#9b3a32', SpreadsheetApp.InterpolationType.NUMBER, 0)
      .setRanges([range])
      .build();
    sheet.setConditionalFormatRules([rule]);
    sheet.getRange(hLen + 1, 2, ys.length, qMax).setNumberFormat('0%');
  });
  sh.getRange(body.length + 4, 1).setValue('格子為該題平均得分／滿分。綠 ≥80%，黃 ≥50%，紅偏低。卷一沒有選擇題正確答案。');
}

function buildWatchP1() {
  var groups = groupStudentsP1_(readP1Rows_());
  var body = [];
  groups.forEach(function (g) {
    var reasons = [];
    if (g.avg < 50) reasons.push('平均偏低');
    if (g.latest < 50) reasons.push('最新未及格');
    if (g.n >= 2 && g.delta <= -8) reasons.push('明顯退步');
    var last = g.list[g.list.length - 1];
    if (last && last.unanswered >= 4) reasons.push('最新未做 ' + last.unanswered + ' 題');
    if (reasons.length) {
      body.push([g.classLabel, g.classNo, g.displayName, g.avg, g.latest, g.delta, reasons.join('、')]);
    }
  });
  writeSheet_('需關注學生', [['班別', '學號', '姓名', '平均%', '最新%', '進步', '原因']], body);
}

function buildProgressP1() {
  var groups = groupStudentsP1_(readP1Rows_());
  var body = groups.map(function (g) {
    return [g.classLabel, g.classNo, g.displayName, g.n, g.first, g.latest, g.delta];
  });
  writeSheet_('進步追蹤', [['班別', '學號', '姓名', '次數', '第一次%', '最近%', '差值']], body);
}

function buildFocusP1() {
  var rows = readP1Rows_();
  var acc = {};
  rows.forEach(function (r) {
    for (var q = 1; q <= Q_MAX_P1; q++) {
      if (r.qs[q] == null || !isFinite(r.qs[q])) continue;
      var id = r.year + '-Q' + q;
      if (!acc[id]) acc[id] = { year: r.year, q: q, sum: 0, n: 0 };
      acc[id].sum += r.qs[q];
      acc[id].n += 1;
    }
  });
  var list = Object.keys(acc).map(function (k) {
    var x = acc[k];
    return { year: x.year, q: x.q, avg: +(x.sum / x.n).toFixed(2), n: x.n };
  }).sort(function (a, b) { return a.avg - b.avg; }).slice(0, 20);
  var body = list.map(function (x) { return [x.year, 'Q' + x.q, x.avg, x.n]; });
  writeSheet_('教學重點', [['年份', '題', '平均得分', '作答人次']], body);
}

function buildRankingP1() {
  var rows = readP1Rows_();
  var byYear = {};
  rows.forEach(function (r) {
    if (!byYear[r.year]) byYear[r.year] = [];
    byYear[r.year].push(r);
  });
  var body = [];
  Object.keys(byYear).map(Number).sort(function (a, b) { return b - a; }).forEach(function (year) {
    var groups = groupStudentsP1_(byYear[year]).sort(function (a, b) { return b.best - a.best; });
    groups.forEach(function (g, i) {
      body.push([year, i + 1, g.classLabel, g.classNo, g.displayName, g.best, g.grade]);
    });
  });
  writeSheet_('年度排行榜', [['年份', '名次', '班別', '學號', '姓名', '最佳%', '等級']], body);
}

function buildPersonalFromRowP1() {
  var sh = SpreadsheetApp.getActiveSheet();
  var row = sh.getActiveRange().getRow();
  var values = sh.getDataRange().getValues();
  if (row < 2 || !values[row - 1]) {
    SpreadsheetApp.getUi().alert('請在「學生名單」選該生資料列。');
    return;
  }
  var classNo = values[row - 1][1];
  var classLabel = String(values[row - 1][0] || '');
  var groups = groupStudentsP1_(readP1Rows_()).filter(function (g) {
    return String(g.classNo) === String(classNo) && (!classLabel || g.classLabel === classLabel);
  });
  if (!groups.length) {
    SpreadsheetApp.getUi().alert('找不到該學生在「卷一」的紀錄。請先重建學生名單。');
    return;
  }
  var g = groups[0];
  writePersonalSheet_('學生個人報告', g, false, '全部年份');
}

function createDashboardP1_(overwrite) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var name = '教師總覽儀表板';
  var sh = ss.getSheetByName(name) || ss.getSheetByName('Dashboard_卷一');
  if (sh && !overwrite && sh.getLastRow() > 2) return;
  if (!sh) sh = ss.insertSheet(name);
  else {
    sh.setName(name);
    sh.clear();
  }
  var rows = readP1Rows_();
  var groups = groupStudentsP1_(rows);
  var now = new Date();
  var week = rows.filter(function (r) {
    var t = r.receivedAt ? new Date(r.receivedAt).getTime() : 0;
    return now.getTime() - t <= 7 * 86400000;
  }).length;
  var todayStr = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var today = rows.filter(function (r) {
    if (!r.receivedAt) return false;
    return Utilities.formatDate(new Date(r.receivedAt), Session.getScriptTimeZone(), 'yyyy-MM-dd') === todayStr;
  }).length;
  var pcts = rows.map(function (r) { return r.percent; });
  var avg = pcts.length ? +(pcts.reduce(function (s, n) { return s + n; }, 0) / pcts.length).toFixed(1) : 0;
  var pass = rows.filter(function (r) { return r.percent >= 50; }).length;
  sh.getRange(1, 1, 1, 3).setValues([['教師總覽儀表板', '', '']]);
  sh.getRange(2, 1, 1, 2).setValues([['更新時間', now]]);
  var kpis = [
    ['指標', '數值', '說明'],
    ['作答學生人數', groups.length, '不重複學生'],
    ['總練習次數', rows.length, '所有提交紀錄'],
    ['本週提交', week, '過去 7 天'],
    ['今日提交', today, ''],
    ['平均百分比', avg, '全體平均'],
    ['最高分', pcts.length ? Math.max.apply(null, pcts) : 0, ''],
    ['最低分', pcts.length ? Math.min.apply(null, pcts) : 0, ''],
    ['及格率', rows.length ? (pass / rows.length) : 0, '≥ 50%']
  ];
  sh.getRange(4, 1, kpis.length, 3).setValues(kpis);
  sh.getRange(12, 3).setNumberFormat('0.00%');
  var gCount = {};
  rows.forEach(function (r) { gCount[r.grade] = (gCount[r.grade] || 0) + 1; });
  var gOrder = ['5**', '5*', '5', '4', '3', '2', '1', 'U'];
  var gRows = [['等級分布', '人次', '佔比']];
  gOrder.forEach(function (g) {
    if (!gCount[g]) return;
    gRows.push([g, gCount[g], rows.length ? gCount[g] / rows.length : 0]);
  });
  sh.getRange(14, 1, gRows.length, 3).setValues(gRows);
  if (gRows.length > 1) sh.getRange(15, 3, gRows.length - 1, 1).setNumberFormat('0.00%');
  var byYear = {};
  rows.forEach(function (r) {
    if (!byYear[r.year]) byYear[r.year] = [];
    byYear[r.year].push(r);
  });
  var yHeader = [['各年份試卷表現', '練習人次', '平均分', '甲一', '甲二', '乙']];
  var yBody = Object.keys(byYear).map(Number).sort().map(function (y) {
    var list = byYear[y];
    var n = list.length;
    var m = function (fn) { return n ? +(list.reduce(function (s, x) { return s + fn(x); }, 0) / n).toFixed(1) : 0; };
    return [y, n, m(function (x) { return x.percent; }), m(function (x) { return x.a1; }), m(function (x) { return x.a2; }), m(function (x) { return x.b; })];
  });
  sh.getRange(14 + gRows.length + 2, 1, 1, 6).setValues(yHeader);
  if (yBody.length) sh.getRange(15 + gRows.length + 2, 1, yBody.length, 6).setValues(yBody);
  sh.setFrozenRows(1);
  sh.getRange(1, 1).setFontWeight('bold').setFontSize(14);
}

function p1Full_(year, q) {
  var m = P1_META[year];
  if (!m || !m.full || q < 1 || q > m.full.length) return 0;
  return m.full[q - 1] || 0;
}
function p1Topic_(year, q) {
  var m = P1_META[year];
  if (!m || !m.topic || q < 1) return '';
  return m.topic[q - 1] || '';
}

function showBulkClassDialogP1() {
  var info = listClassOptionsP1();
  var opts = (info.classes || []).map(function (c) {
    return '<option value="' + c.label.replace(/"/g, '"') + '">' + c.label + '（' + c.n + ' 人）</option>';
  }).join('');
  var yopts = '<option value="">全部年份</option>' + (info.years || []).map(function (y) {
    return '<option value="' + y + '">' + y + '</option>';
  }).join('');
  var html = HtmlService.createHtmlOutput(
    '<div style="font:14px/1.5 sans-serif;color:#1a1c1f">' +
    '<p style="color:#1e4a7a;font-weight:700;margin:0 0 6px">一鍵產生全班報告</p>' +
    '<p style="color:#5c6168;font-size:13px">每位學生會建立一個獨立分頁。再次執行相同班別及年份時，原分頁會被重建。</p>' +
    '<label style="display:block;margin:10px 0 4px;color:#5c6168">班別</label>' +
    '<select id="cl" style="width:100%;padding:8px">' + (opts || '<option>沒有班別</option>') + '</select>' +
    '<label style="display:block;margin:10px 0 4px;color:#5c6168">年份</label>' +
    '<select id="yr" style="width:100%;padding:8px">' + yopts + '</select>' +
    '<label style="display:flex;gap:8px;margin:12px 0;align-items:flex-start"><input id="oo" type="checkbox"><span>錯題部分只列「仍未掌握／未作答」，不列已改善題目</span></label>' +
    '<button id="go" style="width:100%;padding:10px;background:#1e4a7a;color:#fff;border:0;border-radius:8px">產生全班報告</button>' +
    '<p id="msg" style="color:#2f6b4f;margin-top:10px">已載入 ' + (info.classes || []).length + ' 個班別。</p>' +
    '<script>' +
    'document.getElementById("go").onclick=function(){' +
    'var cl=document.getElementById("cl").value; var yr=document.getElementById("yr").value; var oo=document.getElementById("oo").checked;' +
    'google.script.run.withSuccessHandler(function(r){ document.getElementById("msg").textContent="已建立 "+r.n+" 份學生個人報告。"; }).withFailureHandler(function(e){ document.getElementById("msg").textContent=String(e); }).buildClassPersonalSheetsP1(cl, yr, oo);' +
    '};</script></div>'
  ).setWidth(420).setHeight(460);
  SpreadsheetApp.getUi().showModalDialog(html, '全班學生報告');
}

function listClassOptionsP1() {
  var groups = groupStudentsP1_(readP1Rows_());
  var by = {};
  groups.forEach(function (g) { by[g.classLabel] = (by[g.classLabel] || 0) + 1; });
  var years = {};
  readP1Rows_().forEach(function (r) { if (r.year) years[r.year] = 1; });
  return {
    classes: Object.keys(by).sort().map(function (c) { return { label: c, n: by[c] }; }),
    years: Object.keys(years).map(Number).sort(function (a, b) { return b - a; })
  };
}

function buildClassPersonalSheetsP1(classLabel, year, onlyOpen) {
  year = year ? Number(year) : 0;
  var rows = readP1Rows_().filter(function (r) {
    if (classLabel && r.classLabel !== classLabel) return false;
    if (year && Number(r.year) !== year) return false;
    return true;
  });
  var groups = groupStudentsP1_(rows);
  var ss = SpreadsheetApp.getActive();
  var prefix = 'P1報表-' + String(classLabel || '全級').replace(/\s+/g, '');
  ss.getSheets().forEach(function (sh) {
    if (sh.getName().indexOf(prefix) === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });
  groups.forEach(function (g) {
    var name = (prefix + '-' + g.classNo + (g.displayName ? g.displayName : '')).slice(0, 99);
    writePersonalSheet_(name, g, onlyOpen, year ? String(year) : '全部年份');
  });
  SpreadsheetApp.getActive().toast('已建立 ' + groups.length + ' 份學生個人報告', '教師分析', 6);
  return { ok: true, n: groups.length };
}

function weakOfGroupP1_(g, onlyOpen) {
  var map = {};
  g.list.forEach(function (a) {
    var meta = P1_META[a.year];
    if (!meta) return;
    var n = meta.full.length;
    for (var q = 1; q <= n; q++) {
      var score = a.qs[q];
      var full = meta.full[q - 1];
      var id = a.year + '-Q' + q;
      if (!map[id]) map[id] = { year: a.year, q: q, topic: meta.topic[q - 1] || '', full: full, wrong: 0, na: 0, tried: 0, last: score, lastAt: a.practicedOn, lastWrong: '', status: '仍未掌握' };
      var w = map[id];
      w.tried += 1;
      w.last = score;
      w.lastAt = a.practicedOn;
      if (score == null || score === '') { w.na += 1; continue; }
      var r = Number(score) / full;
      if (r < 0.5) { w.wrong += 1; w.status = '仍未掌握'; w.lastWrong = a.practicedOn; }
      else w.status = '已改善';
    }
  });
  var list = Object.keys(map).map(function (k) { return map[k]; }).filter(function (w) { return w.wrong > 0 || w.na > 0; });
  if (onlyOpen) list = list.filter(function (w) { return w.status === '仍未掌握'; });
  list.sort(function (a, b) { return Number(a.status === '已改善') - Number(b.status === '已改善') || b.wrong - a.wrong; });
  return list;
}

function writePersonalSheet_(name, g, onlyOpen, yearLabel) {
  var header = [
    ['學生個人報告', '', '', '', '', '', '', ''],
    ['班別', g.classLabel, '學號', g.classNo, '姓名', g.displayName, '年份', yearLabel || '全部年份'],
    ['練習次數', g.n, '平均分', g.avg, '最佳', g.best, '最新分', g.latest],
    [],
    ['日期', '年份', '百分比', '等級', '答對', '答錯', '未答', '準確率']
  ];
  var body = g.list.slice().reverse().map(function (a) {
    var d = a.practicedOn ? (function () { try { return Utilities.formatDate(new Date(a.practicedOn), Session.getScriptTimeZone(), 'yyyy-MM-dd'); } catch (e) { return String(a.practicedOn).slice(0, 10); } })() : '';
    var meta = P1_META[a.year];
    var ok = 0, bad = 0, na = 0;
    if (meta) {
      for (var q = 1; q <= meta.full.length; q++) {
        var s = a.qs[q];
        if (s == null || s === '') na++;
        else if (Number(s) + 1e-9 >= meta.full[q - 1]) ok++;
        else bad++;
      }
    }
    return [d, a.year, a.percent, a.grade, ok, bad, na, a.percent];
  });
  var weaks = weakOfGroupP1_(g, onlyOpen);
  body.push([]);
  body.push(['全部錯題', '答錯次數', '未答', '作答', '錯率', '滿分', '最近結果', '最後答錯']);
  weaks.forEach(function (w) {
    var err = w.tried ? Math.round((w.wrong / w.tried) * 100) : 0;
    var lastW = w.lastWrong ? (function () { try { return Utilities.formatDate(new Date(w.lastWrong), Session.getScriptTimeZone(), 'yyyy-MM-dd'); } catch (e) { return String(w.lastWrong).slice(0, 10); } })() : '';
    body.push([w.year + ' Q' + w.q + ' ' + w.topic, w.wrong, w.na, w.tried, err, w.full, w.status, lastW]);
  });
  writeSheet_(name, header, body);
}

