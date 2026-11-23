/**
 * 스카이티제이 가맹점 응대 기록 — 구글시트 Apps Script
 *
 * 쓰는 법 (한 번만):
 *  1. 구글 드라이브에서 새 스프레드시트를 만든다 (이름 예: 가맹점 응대 기록).
 *  2. 확장 프로그램 › Apps Script 를 열고, 기본 코드를 지운 뒤 이 파일 내용을 전부 붙여넣고 저장.
 *  3. 위쪽 함수 목록에서 setup 을 고르고 ▶ 실행 → 권한 허용.
 *     → 응대기록·통계·설정 탭이 만들어지고, 설정 탭 B2 에 "비밀키"가 생긴다.
 *  4. 배포 › 새 배포 › 유형: 웹 앱 / 실행: 나 / 액세스 권한: 모든 사용자 → 배포.
 *     → 나오는 "웹 앱 URL"(…/exec)을 복사.
 *  5. 가맹점 답장 도구 › 📒 응대 기록 시트 연결 에 웹 앱 URL 과 비밀키를 넣고 저장 → 연결 테스트.
 *
 * 이 파일에는 시트 주소·비밀키가 들어 있지 않다. 비밀키는 setup 이 시트 안에서 만든다.
 * 웹 앱은 "모든 사용자" 접근이라 비밀키가 잠금장치다. 키가 새면 설정 탭에서 "비밀키 새로 만들기".
 */

var SHEET_LOG = '응대기록';
var SHEET_STAT = '통계';
var SHEET_SET = '설정';
var PROP_KEY = 'MR_SECRET';

// 열 순서 = 답장 도구가 보내는 순서. 바꾸면 도구도 같이 바꿔야 한다.
var COLS = [
  ['id', '접수번호', 120], ['at', '접수일시', 130], ['type', '유형', 60], ['name', '상호', 140],
  ['addr', '주소', 200], ['phone', '연락 온 번호', 110], ['caller', '발신자', 100], ['model', '장비 모델', 100],
  ['main', '요지', 160], ['sub', '세부', 200], ['visit', '방문예정', 110], ['fault', '과실·비용청구', 80],
  ['penalty', '위약금(원)', 90], ['succ', '승계', 80], ['sugeum', '수금방 기록', 80],
  ['status', '상태', 70], ['doneAt', '완료일', 90], ['staff', '담당', 70], ['memo', '메모 전문', 320], ['note', '비고', 200]
];
// 도구가 다시 보내도(수정) 덮어쓰지 않는 열: 상태·완료일·비고 (시트에서 직접 관리)
var KEEP_ON_UPDATE = { status: 1, doneAt: 1, note: 1 };
var TYPES = ['메모', '간단', 'A/S', '교체', '해지', '수수료', '신규', '승계'];
var STATUS = ['접수', '진행', '완료', '보류'];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('응대기록')
    .addItem('처음 설정 (탭·통계 만들기)', 'setup')
    .addItem('비밀키 보기', 'showKey')
    .addItem('비밀키 새로 만들기', 'resetKey')
    .addToUi();
}

/** 탭·머리글·드롭다운·통계 수식을 만든다. 여러 번 실행해도 기록은 지워지지 않는다. */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone('Asia/Seoul');

  // ① 응대기록
  var log = ss.getSheetByName(SHEET_LOG) || ss.insertSheet(SHEET_LOG, 0);
  var head = COLS.map(function (c) { return c[1]; });
  log.getRange(1, 1, 1, head.length).setValues([head])
    .setFontWeight('bold').setBackground('#eff6ff').setFontColor('#1e3a8a');
  log.setFrozenRows(1);
  log.setFrozenColumns(1);
  COLS.forEach(function (c, i) { log.setColumnWidth(i + 1, c[2]); });
  var n = log.getMaxRows() - 1;
  log.getRange(2, col_('at'), n, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  log.getRange(2, col_('doneAt'), n, 1).setNumberFormat('yyyy-mm-dd');
  log.getRange(2, col_('penalty'), n, 1).setNumberFormat('#,##0');
  log.getRange(2, col_('memo'), n, 1).setWrap(false);
  log.getRange(2, col_('type'), n, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(TYPES, true).setAllowInvalid(true).build());
  log.getRange(2, col_('status'), n, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(STATUS, true).setAllowInvalid(false).build());
  log.getRange(2, col_('doneAt'), n, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(true).build());
  // 상태별 줄 색
  var all = log.getRange(2, 1, n, COLS.length);
  var P = colLetter_(col_('status'));
  log.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$' + P + '2="완료"')
      .setFontColor('#94a3b8').setRanges([all]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$' + P + '2="보류"')
      .setBackground('#fffbeb').setRanges([all]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND($A2<>"",$' + P + '2="접수")')
      .setBackground('#fef2f2').setRanges([log.getRange(2, col_('status'), n, 1)]).build()
  ]);

  // ③ 설정 (비밀키 + 목록)
  var set = ss.getSheetByName(SHEET_SET) || ss.insertSheet(SHEET_SET);
  var key = getKey_() || resetKey_();
  set.getRange('A1:B1').setValues([['항목', '값']]).setFontWeight('bold');
  set.getRange('A2:B2').setValues([['비밀키 (답장 도구에 입력)', key]]);
  set.getRange('A3').setValue('※ 이 시트는 본인만 보세요. 비밀키가 새면 메뉴 › 응대기록 › 비밀키 새로 만들기');
  set.getRange('D1:E1').setValues([['유형', '상태']]).setFontWeight('bold');
  set.getRange(2, 4, TYPES.length, 1).setValues(TYPES.map(function (t) { return [t]; }));
  set.getRange(2, 5, STATUS.length, 1).setValues(STATUS.map(function (t) { return [t]; }));
  set.setColumnWidth(1, 200); set.setColumnWidth(2, 260);

  // ② 통계
  var st = ss.getSheetByName(SHEET_STAT) || ss.insertSheet(SHEET_STAT, 1);
  st.clear();
  buildStats_(st);

  try {
    SpreadsheetApp.getUi().alert('설정 완료',
      '응대기록·통계·설정 탭을 만들었어요.\n\n비밀키: ' + key +
      '\n\n다음: 배포 › 새 배포 › 웹 앱 (실행: 나, 액세스: 모든 사용자) 후\n웹 앱 URL 과 이 비밀키를 답장 도구에 넣으세요.',
      SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {
    Logger.log('설정 완료. 비밀키: ' + key + ' (설정 탭 B2 에도 있어요)');
  }
}

function buildStats_(st) {
  var L = "'" + SHEET_LOG + "'!A2:T";
  var c = function (k) { return 'Col' + col_(k); };
  var monthStart = '"&TEXT(EOMONTH(TODAY(),-1)+1,"yyyy-mm-dd")&"';
  var lastStart = '"&TEXT(EOMONTH(TODAY(),-2)+1,"yyyy-mm-dd")&"';
  var d90 = '"&TEXT(TODAY()-90,"yyyy-mm-dd")&"';
  var blocks = [
    ['A1', '이번 달 유형별 건수',
      '=QUERY({' + L + '},"select ' + c('type') + ', count(' + c('id') + ') where ' + c('id') + ' is not null and ' + c('at') + " >= date '" + monthStart + "' group by " + c('type') + ' order by count(' + c('id') + ") desc label " + c('type') + " '유형', count(" + c('id') + ") '건수'\",0)"],
    ['D1', '지난 달 유형별 건수',
      '=QUERY({' + L + '},"select ' + c('type') + ', count(' + c('id') + ') where ' + c('id') + ' is not null and ' + c('at') + " >= date '" + lastStart + "' and " + c('at') + " < date '" + monthStart + "' group by " + c('type') + ' order by count(' + c('id') + ") desc label " + c('type') + " '유형', count(" + c('id') + ") '건수'\",0)"],
    ['Z1', '미완료 건 (접수·진행)',
      '=QUERY({' + L + '},"select ' + [c('id'), c('at'), c('type'), c('name'), c('status')].join(', ') + ' where ' + c('id') + " is not null and (" + c('status') + " = '접수' or " + c('status') + " = '진행') order by " + c('at') + "\",0)"],
    ['AF1', '월별 추이 (유형별)',
      '=QUERY({' + L + '},"select year(' + c('at') + '), month(' + c('at') + ')+1, count(' + c('id') + ') where ' + c('id') + ' is not null group by year(' + c('at') + '), month(' + c('at') + ')+1 pivot ' + c('type') + " label year(" + c('at') + ") '연', month(" + c('at') + ")+1 '월'\",0)"],
    ['L1', '해지 사유 순위',
      '=QUERY({' + L + '},"select ' + c('main') + ', count(' + c('id') + ") where " + c('type') + " = '해지' group by " + c('main') + ' order by count(' + c('id') + ") desc label " + c('main') + " '사유', count(" + c('id') + ") '건수'\",0)"],
    ['U1', '해지 월별 건수·위약금',
      '=QUERY({' + L + '},"select year(' + c('at') + '), month(' + c('at') + ')+1, count(' + c('id') + '), sum(' + c('penalty') + ") where " + c('type') + " = '해지' group by year(" + c('at') + '), month(' + c('at') + ")+1 label year(" + c('at') + ") '연', month(" + c('at') + ")+1 '월', count(" + c('id') + ") '건수', sum(" + c('penalty') + ") '위약금 합계'\",0)"],
    ['I1', '폐업 해지 중 승계 가능',
      '=QUERY({' + L + '},"select ' + c('succ') + ', count(' + c('id') + ") where " + c('type') + " = '해지' and " + c('succ') + " is not null and " + c('succ') + " <> '' group by " + c('succ') + " label " + c('succ') + " '승계', count(" + c('id') + ") '건수'\",0)"],
    ['O1', 'A/S·교체 장비 모델 순위',
      '=QUERY({' + L + '},"select ' + c('model') + ', count(' + c('id') + ") where (" + c('type') + " = 'A/S' or " + c('type') + " = '교체') and " + c('model') + " <> '' group by " + c('model') + ' order by count(' + c('id') + ") desc limit 20 label " + c('model') + " '모델', count(" + c('id') + ") '건수'\",0)"],
    ['R1', '같은 가게 반복 문의 (최근 90일 2회 이상)',
      '=IFERROR(QUERY(QUERY({' + L + '},"select ' + c('name') + ', count(' + c('id') + ") where " + c('name') + " <> '' and " + c('at') + " >= date '" + d90 + "' group by " + c('name') + " label " + c('name') + " '상호', count(" + c('id') + ") '건수'\",0),\"select Col1, Col2 where Col2 >= 2 order by Col2 desc\",1),\"없음\")"],
    ['G1', '평균 처리 일수 (완료일 입력된 건)',
      "=IFERROR(ROUND(AVERAGE(FILTER('" + SHEET_LOG + "'!Q2:Q-INT('" + SHEET_LOG + "'!B2:B),'" + SHEET_LOG + "'!Q2:Q<>\"\")),1),\"완료일 입력 필요\")"]
  ];
  blocks.forEach(function (b) {
    var r = st.getRange(b[0]);
    r.setValue(b[1]).setFontWeight('bold').setFontColor('#2563eb');
    r.offset(1, 0).setFormula(b[2]);
  });
  // 표마다 다른 열에 두어, 기록이 늘어 표가 길어져도 서로 겹치지 않게 한다.
  st.setColumnWidths(1, 40, 90);
  st.setFrozenRows(1);
}

/** 답장 도구 → 기록 1줄 (같은 접수번호면 수정) */
function doPost(e) {
  var out = function (o) {
    return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
  };
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return out({ ok: false, error: 'bad_json' }); }
  var key = getKey_();
  if (!key || !body || body.key !== key) return out({ ok: false, error: 'bad_key' });
  if (body.ping) return out({ ok: true, ping: true, sheet: SpreadsheetApp.getActiveSpreadsheet().getName() });

  var list = body.rows || (body.row ? [body.row] : []);
  if (!list.length || list.length > 20) return out({ ok: false, error: 'bad_rows' });
  for (var i = 0; i < list.length; i++) {
    if (!list[i] || !/^[0-9A-Za-z-]{6,30}$/.test(String(list[i].id))) return out({ ok: false, error: 'bad_id' });
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var log = ss.getSheetByName(SHEET_LOG);
    if (!log) return out({ ok: false, error: 'no_sheet' });
    var results = list.map(function (r) { return upsert_(log, r); });
    return out({ ok: true, results: results, id: results[0].id, row: results[0].row, updated: results[0].updated });
  } finally {
    lock.releaseLock();
  }
}

/** 같은 접수번호 줄이 있으면 수정(상태·완료일·비고·접수일시 유지), 없으면 맨 아래 추가 */
function upsert_(log, r) {
  var found = log.getRange('A:A').createTextFinder(String(r.id)).matchEntireCell(true).findNext();
  var rowNo, updated = false, existing = null;
  if (found && found.getRow() > 1) {
    rowNo = found.getRow(); updated = true;
    existing = log.getRange(rowNo, 1, 1, COLS.length).getValues()[0];
  } else {
    rowNo = log.getLastRow() + 1;
  }
  var vals = COLS.map(function (c, i) {
    var k = c[0];
    if (updated && (KEEP_ON_UPDATE[k] || k === 'at')) return existing[i];
    if (k === 'at') return new Date();
    if (k === 'status') return '접수';
    if (k === 'doneAt' || k === 'note') return '';
    if (k === 'penalty') return r.penalty === '' || r.penalty == null ? '' : Number(r.penalty) || 0;
    return clean_(r[k]);
  });
  log.getRange(rowNo, 1, 1, vals.length).setValues([vals]);
  return { id: r.id, row: rowNo, updated: updated };
}

function doGet() {
  return ContentService.createTextOutput('응대 기록 시트가 연결돼 있어요. (답장 도구에서 보내는 기록만 받습니다)');
}

// 수식 주입 방지 + 길이 제한
function clean_(v) {
  if (v == null) return '';
  var s = String(v).slice(0, 5000);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}
function col_(k) { for (var i = 0; i < COLS.length; i++) if (COLS[i][0] === k) return i + 1; throw new Error(k); }
function colLetter_(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; }
function getKey_() { return PropertiesService.getScriptProperties().getProperty(PROP_KEY); }
function resetKey_() {
  var k = Utilities.getUuid().replace(/-/g, '').slice(0, 20);
  PropertiesService.getScriptProperties().setProperty(PROP_KEY, k);
  return k;
}
function showKey() { SpreadsheetApp.getUi().alert('비밀키: ' + (getKey_() || '(없음 — 처음 설정을 먼저 실행)')); }
function resetKey() {
  var k = resetKey_();
  var set = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SET);
  if (set) set.getRange('B2').setValue(k);
  SpreadsheetApp.getUi().alert('새 비밀키: ' + k + '\n답장 도구 설정의 비밀키도 바꿔 주세요.');
}
