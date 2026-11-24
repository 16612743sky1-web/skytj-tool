// ================================================
// 스카이티제이 용지관리 — 구글시트 API + 자동발송
// ★ V8: (V7) + KIS 무상전표(79*70) 수량 관리 — SECTION 16
//   - 메뉴: KIS 무상전표 수량 입력 / 현황(일별·월누적) / 이번 달 이미 보낸 수량 계산 / 14:00 사전점검 트리거
//   - 에이스아이피 발송 성공 때마다 79*70 박스 수를 'KIS발송기록' 시트에 기록 → 월 누적
//   - 누적이 무상수량을 넘으면 🟡 안내, 무상+여유를 넘으면 🔴 경보 (표시+경보만, 자동발송에서 빼지 않음)
//   - C열 색 판정·송장 감시·송장 반영 로직은 그대로
// ★ V7: (V6) + 송장 감시 연동
//   - 발송 직전 C열 헤더('수량') 확인 → 열이 밀렸으면 발송 중단 + 회사메일 경보
//   - 발송 성공 시 감시 목록 등록 → 반송/60분 내 송장 미입력이면 경보 + 가맹점명 칸 자홍색 표시
//   - 메뉴: 송장 감시 트리거 설정 / 송장 미입력 행 점검
//   ※ 감시 함수는 이 파일 맨 아래 SECTION 15에 포함 (이 파일 하나만 붙여넣으면 됨)
// ★ V6: (V5) 반복 트리거 + (신규) 송장번호 반영 메뉴 버튼
//   - applyTracking(): 에이스아이피 답장 첨부의 운송장번호를 시트에 반영
//     · 첨부의 '운송장번호' 열을 헤더 이름으로 자동 탐색(열 위치 무관)
//     · 전화번호(정규화) 1순위 + 가맹점명 2순위 매칭, 다박스는 순서대로
//     · 이미 송장번호 있는 행은 덮어쓰지 않음(가드)
//     · 미리보기 확인 후에만 반영 + 해당 행 노란색 처리 + 로그
// ================================================

// ── 설정 ──────────────────────────────────────
// ※ 저장소(공개)에 올린 사본이라 메일주소·KASI 인증키는 자리표시로 바꿔 두었다.
//   Apps Script 에 붙여넣을 때는 실제 값을 넣을 것 (기존 V7 의 CONFIG 값 그대로).
const CONFIG = {
  TEST_MODE: false,
  EMAIL_TO: '에이스아이피_메일주소',
  EMAIL_CC: '회사_참조메일주소',
  EMAIL_TEST: '회사_참조메일주소',
  EMAIL_ALERT: '회사_경보메일주소',
  SHEET_NAME_PATTERN: /^\d{2}\.\d{2}$/,
  AUTO_SEND_HOUR: 14,
  AUTO_SEND_MINUTE: 50,
  LOG_SHEET: '발송로그',

  // ▼ 송장번호 반영(applyTracking)용 설정
  ACEIP_REPLY_FROM: '에이스아이피_메일주소', // 답장 보내는 주소
  TRACKING_SEARCH_DAYS: 7,                    // 최근 며칠 내 답장에서 첨부 검색
  // ▼ 택배사 휴무일(블랙아웃) — 법정공휴일이 아니라 KASI API로는 안 잡히는 날을 직접 등록
  //   yyyy-MM-dd 형식. 이 날짜에는 자동발송을 건너뛴다.
   DELIVERY_BLACKOUT: [
    '2026-08-14', '2026-08-17',
    '2026-09-22', '2026-09-23',
  ],


  // 📢 [솔라피 가입 후 입력할 곳]
  SOLAPI_API_KEY: '이곳에_솔라피_API_KEY를_입력하세요',
  SOLAPI_API_SECRET: '이곳에_솔라피_API_SECRET을_입력하세요',
  KAKAO_CHANNEL_ID: '@이곳에_카톡채널아이디를_입력하세요',
  ALARM_PHONE: '이곳에_담당자_휴대폰번호를_입력하세요',

  // 📢 공공데이터포털 발급 인증키 (한국천문연구원_특일정보)
  KASI_SERVICE_KEY: '공공데이터포털_인증키',

  // ▼ V8: KIS 무상전표(79*70) 수량 관리
  KIS_ITEM_PATTERN: /79\s*[*xX×]\s*70/,   // '2열'(품명)에 79*70 / 79x70 / 79×70 이 들어 있으면 무상전표 품목 (예: '79*70 / 1BOX')
  KIS_ITEM_EXCLUDE: /\d+\s*EA/i,           // 단, 낱개 소량('79*70 24EA', '12EA')은 박스가 아니므로 제외
  KIS_DEFAULT_MARGIN: 10,                  // 무상수량을 넘어도 에이스아이피로 보낼 여유(박스) 기본값 — 메뉴에서 달마다 변경
  KIS_SETTING_SHEET: 'KIS무상전표',         // 월별 무상수량·여유·시작값
  KIS_RECORD_SHEET: 'KIS발송기록',          // 에이스 발송 성공 때마다 79*70 박스 수 기록
  KIS_PRECHECK_HOUR: 14,                   // 사전점검(오늘 대기분까지 보내면 초과?) 시각
  KIS_PRECHECK_MINUTE: 0,
};

// 발송로그 시트 헤더 (writeLog가 기록하는 10개 컬럼)
const LOG_HEADERS = ['시각', '시트', '방식', '총건수', '노란색', '빨간색', '발송', '결과', '수신', '비고'];

// ════════════════════════════════════════════════
// SECTION 0. 카카오톡(솔라피) 발송 유틸 함수
// ════════════════════════════════════════════════

function sendKakaoTalk(messageText) {
  if (CONFIG.SOLAPI_API_KEY.includes('입력하세요') || !CONFIG.SOLAPI_API_KEY) {
    Logger.log('⚠️ 솔라피 API 설정이 완료되지 않아 카카오톡 발송을 건너뜁니다.');
    return false;
  }
  const url = 'https://api.solapi.com/messages/v4/send-many';
  const dateStr = new Date().toISOString();
  const salt = Math.random().toString(36).substring(2, 12);
  const signatureData = dateStr + salt;
  const signature = Utilities.computeHmacSha256Signature(signatureData, CONFIG.SOLAPI_API_SECRET)
    .map(function(val) { return ('0' + (val & 0xFF).toString(16)).slice(-2); }).join('');
  const authHeader = `HMAC-SHA256 apiKey=${CONFIG.SOLAPI_API_KEY}, date=${dateStr}, salt=${salt}, signature=${signature}`;

  const payload = {
    messages: [{ to: CONFIG.ALARM_PHONE, text: messageText, kakaoOptions: { pfId: CONFIG.KAKAO_CHANNEL_ID.replace('@', ''), isAd: false } }]
  };
  const options = { method: 'post', contentType: 'application/json', headers: { 'Authorization': authHeader }, payload: JSON.stringify(payload), muteHttpExceptions: true };

  try {
    const response = UrlFetchApp.fetch(url, options);
    return (response.getResponseCode() === 200 || response.getResponseCode() === 201);
  } catch (e) {
    return false;
  }
}

// ════════════════════════════════════════════════
// SECTION 1. 공통 유틸
// ════════════════════════════════════════════════

function findCol(headers, name) {
  const exact = headers.findIndex(h => h === name);
  if (exact >= 0) return exact;
  return headers.findIndex(h => h.includes(name));
}

function toRgb(hex) {
  if (!hex) return null;
  let h = String(hex).trim().toLowerCase().replace('#', '');
  if (h === 'white' || h === 'ffffff' || h === 'fff') return [255, 255, 255];
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length !== 6) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
  return [r, g, b];
}

function isYellowColor(hex) {
  if (!hex) return false;
  const rgb = toRgb(hex);
  if (!rgb) return false;
  const [r, g, b] = rgb;
  return r > 200 && g > 180 && b < 150;
}

function isRedColor(hex) {
  if (!hex) return false;
  const rgb = toRgb(hex);
  if (!rgb) return false;
  const [r, g, b] = rgb;
  return r >= 150 && r > g + 30 && r > b + 30;
}

function getLatestSheet(ss) {
  const sheets = ss.getSheets()
    .filter(s => CONFIG.SHEET_NAME_PATTERN.test(s.getName().trim()) && !s.isSheetHidden());
  if (!sheets.length) return null;
  return sheets.sort((a, b) =>
    b.getName().trim().localeCompare(a.getName().trim())
  )[0];
}

function formatPhone(val) {
  if (val === null || val === undefined || val === '') return '';
  let s = String(val).trim().replace(/[^0-9]/g, '');
  if (!s) return '';
  if (s.length === 10 && s.startsWith('1')) s = '0' + s;
  else if (s.length === 9 && s.startsWith('2')) s = '0' + s;
  return s;
}

// 이름 정규화(공백/대소문자 제거)
function normName(v) { return String(v == null ? '' : v).replace(/\s+/g, '').toLowerCase(); }
// 날짜 → 'yyyy-MM-dd' (한국시각)
function ymd_(date) { return Utilities.formatDate(date, 'Asia/Seoul', 'yyyy-MM-dd'); }
// 택배사 휴무일인가? (CONFIG.DELIVERY_BLACKOUT)
function isDeliveryBlackout(date) {
  const list = CONFIG.DELIVERY_BLACKOUT || [];
  return list.indexOf(ymd_(date)) !== -1;
}
// 자동발송 가능 여부 공통 판단: 주말 → 택배사 휴무일 → 법정공휴일(KASI) 순
function getDeliveryDecision_(date) {
  const day = date.getDay();
  if (day === 0 || day === 6) return { canSend: false, mark: '⏭️', reason: '주말' };
  if (isDeliveryBlackout(date)) return { canSend: false, mark: '🚫', reason: '택배사 휴무일' };
  if (isKoreanHoliday(date)) return { canSend: false, mark: '⏭️', reason: '공휴일' };
  return { canSend: true, mark: '✅', reason: '정상 발송일' };
}

// ════════════════════════════════════════════════
// SECTION 2. Web API
// ════════════════════════════════════════════════

function doGet(e) {
  const params = e.parameter || {};
  const action = params.action || 'getData';
  const month = params.month || '';
  let result;
  try {
    if (action === 'getData') result = getData(month);
    else if (action === 'getSheets') result = getSheetNames();
    else if (action === 'getLogs') result = getLogsForApi();
    else result = { error: '알 수 없는 action: ' + action };
  } catch (err) { result = { error: err.message }; }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function getSheetNames() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets()
    .filter(s => !s.isSheetHidden())
    .map(s => s.getName())
    .filter(n => CONFIG.SHEET_NAME_PATTERN.test(n.trim()))
    .sort((a, b) => b.localeCompare(a));
  return { sheets };
}

function getData(month) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = null;
  if (month) sheet = ss.getSheets().find(s => s.getName().trim() === month.trim() && !s.isSheetHidden());
  if (!sheet) sheet = getLatestSheet(ss);
  if (!sheet) return { sheetName: '', rows: [], total: 0 };

  const sheetName = sheet.getName();
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return { sheetName, rows: [], total: 0 };

  const headers = data[0].map(h => String(h).trim());
  const c날 = findCol(headers, '1열'); const c품 = findCol(headers, '2열'); const c수 = findCol(headers, '수량');
  const c명 = findCol(headers, '받는분성명'); const c전 = findCol(headers, '받는분번호'); const c주 = findCol(headers, '받는분주소');
  const c메 = findCol(headers, '배송메세지'); const c보 = findCol(headers, '보내는분'); const c보번 = findCol(headers, '보내는분번호');
  const c보주 = findCol(headers, '보내는분주소'); const c송 = findCol(headers, '송장번호'); const c키 = findCol(headers, '정기분전표');

  const lastRow = sheet.getLastRow();
  const bgs = lastRow >= 2 ? sheet.getRange(2, 3, lastRow - 1, 1).getBackgrounds() : [];

  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i]; const name = String(r[c명] || '').trim(); if (!name) continue;
    let dateStr = ''; const rawDate = r[c날];
    if (rawDate instanceof Date) dateStr = Utilities.formatDate(rawDate, 'Asia/Seoul', 'yyyy-MM-dd');
    else if (rawDate) dateStr = String(rawDate).trim();
    const bg = (bgs[i - 1] && bgs[i - 1][0]) ? String(bgs[i - 1][0]).toLowerCase().trim() : '';

    rows.push({
      날짜: dateStr, 가맹점: name, 전화: String(r[c전] || '').trim(), 품명: c품 >= 0 ? String(r[c품] || '').trim() : '',
      수량: Number(r[c수]) || 1, 주소: c주 >= 0 ? String(r[c주] || '').trim() : '', 메세지: c메 >= 0 ? String(r[c메] || '').trim() : '',
      보내는분: c보 >= 0 ? String(r[c보] || '').trim() : '', 보내는분번호: c보번 >= 0 ? String(r[c보번] || '').trim() : '',
      보내는분주소: c보주 >= 0 ? String(r[c보주] || '').trim() : '', 송장번호: c송 >= 0 ? String(r[c송] || '').trim() : '',
      키핑: c키 >= 0 ? String(r[c키] || '').trim() : '', 색상: bg,
    });
  }
  return { sheetName, rows, total: rows.length, updated: new Date().toISOString() };
}

// ════════════════════════════════════════════════
// SECTION 3~12
// ════════════════════════════════════════════════
function analyzeRows(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return { total: 0, yellow: 0, red: 0, send: 0, yellowRows: [], redRows: [], sendRows: [] };
  const headers = data[0].map(h => String(h).trim()); const c명 = findCol(headers, '받는분성명'); const lastRow = sheet.getLastRow();
  const bgs = lastRow >= 2 ? sheet.getRange(2, 3, lastRow - 1, 1).getBackgrounds() : [];
  let yellowCount = 0, redCount = 0, sendCount = 0; const yellowRows = [], redRows = [], sendRows = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i]; const name = String(r[c명] || '').trim(); if (!name) continue;
    const bg = (bgs[i - 1] && bgs[i - 1][0]) ? String(bgs[i - 1][0]).toLowerCase().trim() : ''; const sheetRow = i + 1;
    if (isYellowColor(bg)) { yellowCount++; yellowRows.push({ row: sheetRow, name, bg }); }
    else if (isRedColor(bg)) { redCount++; redRows.push({ row: sheetRow, name, bg }); }
    else { sendCount++; sendRows.push({ row: sheetRow, name, bg }); }
  }
  return { total: yellowCount + redCount + sendCount, yellow: yellowCount, red: redCount, send: sendCount, yellowRows, redRows, sendRows };
}

function getExcludedRows(sheet) {
  const lastRow = sheet.getLastRow(); const excluded = new Set(); const unpaid = new Set(); if (lastRow < 2) return { excluded, unpaid };
  const backgrounds = sheet.getRange(2, 3, lastRow - 1, 1).getBackgrounds();
  backgrounds.forEach((rowBgs, rowIdx) => {
    const bg = String(rowBgs[0] || '').toLowerCase().trim(); const sheetRow = rowIdx + 2;
    if (isYellowColor(bg)) excluded.add(sheetRow); else if (isRedColor(bg)) { excluded.add(sheetRow); unpaid.add(sheetRow); }
  });
  return { excluded, unpaid };
}

function getRowsToSend(sheet) {
  const data = sheet.getDataRange().getValues(); if (data.length < 2) return { rows: [], sheetRows: [] };
  const headers = data[0].map(h => String(h).trim()); const { excluded } = getExcludedRows(sheet);
  const c품 = findCol(headers, '2열'); const c수 = findCol(headers, '수량'); const c명 = findCol(headers, '받는분성명');
  const c전 = findCol(headers, '받는분번호'); const c주 = findCol(headers, '받는분주소'); const c메 = findCol(headers, '배송메세지');
  const c보 = findCol(headers, '보내는분'); const c보번 = findCol(headers, '보내는분번호'); const c보주 = findCol(headers, '보내는분주소');
  const rows = []; const sheetRows = [];
  for (let i = 1; i < data.length; i++) {
    const sheetRow = i + 1; if (excluded.has(sheetRow)) continue;
    const r = data[i]; const name = String(r[c명] || '').trim(); if (!name) continue;
    rows.push([c품 >= 0 ? r[c품] : '', r[c수] || 1, name, formatPhone(r[c전]), c주 >= 0 ? r[c주] : '', c메 >= 0 ? r[c메] : '', c보 >= 0 ? r[c보] : '', c보번 >= 0 ? formatPhone(r[c보번]) : '', c보주 >= 0 ? r[c보주] : '', '']);
    sheetRows.push(sheetRow);
  }
  return { rows, sheetRows };
}



function createExcelBlob(rows, sheetName) {
  const headers = ['2열', '수량', '받는분성명', '받는분번호', '받는분주소', '배송메세지', '보내는분', '보내는분번호', '보내는분주소', '송장번호'];
  const tmpSS = SpreadsheetApp.create('_tmp_aceip_' + Date.now()); const tmpId = tmpSS.getId();
  try {
    const tmpSheet = tmpSS.getActiveSheet();
    if (rows.length > 0) { tmpSheet.getRange(2, 4, rows.length, 1).setNumberFormat('@'); tmpSheet.getRange(2, 8, rows.length, 1).setNumberFormat('@'); }
    tmpSheet.getRange(1, 1, 1, headers.length).setValues([headers]); if (rows.length > 0) tmpSheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    SpreadsheetApp.flush(); Utilities.sleep(1500);
    const url = `https://docs.google.com/spreadsheets/d/${tmpId}/export?format=xlsx`; const token = ScriptApp.getOAuthToken();
    const response = UrlFetchApp.fetch(url, { headers: { Authorization: `Bearer ${token}` }, muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) throw new Error(`엑셀 변환 실패 (HTTP ${response.getResponseCode()})`);
    return response.getBlob().setName(`에이스아이피_발송요청_${sheetName}.xlsx`);
  } finally { try { SpreadsheetApp.flush(); Utilities.sleep(500); DriveApp.getFileById(tmpId).setTrashed(true); } catch (e) {} }
}

function ensureLogSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet(); let log = ss.getSheetByName(CONFIG.LOG_SHEET);
  if (!log) {
    log = ss.insertSheet(CONFIG.LOG_SHEET); const hRange = log.getRange(1, 1, 1, LOG_HEADERS.length); hRange.setValues([LOG_HEADERS]);
    hRange.setBackground('#1a237e').setFontColor('#ffffff').setFontWeight('bold'); log.setFrozenRows(1);
  }
  return log;
}

function writeLog(entry) {
  try {
    const log = ensureLogSheet(); const now = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
    const row = [now, entry.sheetName || '-', entry.method || '-', entry.total || 0, entry.yellow || 0, entry.red || 0, entry.sent || 0, entry.result || '-', entry.recipient || '-', entry.note || ''];
    log.appendRow(row); const lastRow = log.getLastRow(); const resultCell = log.getRange(lastRow, 8);
    if (entry.result === '✅ 성공') resultCell.setBackground('#c8e6c9'); else if (entry.result === '⚠️ 0건') resultCell.setBackground('#fff9c4'); else if (entry.result && entry.result.includes('⏭️')) resultCell.setBackground('#e0e0e0'); else if (entry.result && entry.result.startsWith('❌')) resultCell.setBackground('#ffcdd2');
    SpreadsheetApp.flush();
  } catch (e) {}
}

function getLogsForApi() {
  const ss = SpreadsheetApp.getActiveSpreadsheet(); const log = ss.getSheetByName(CONFIG.LOG_SHEET); if (!log) return { logs: [] };
  const data = log.getDataRange().getValues(); if (data.length < 2) return { logs: [] };
  return { logs: data.slice(1).reverse().slice(0, 30).map(r => ({ 시각: r[0] ? String(r[0]) : '', 시트: r[1], 방식: r[2], 총: r[3], 노란: r[4], 빨간: r[5], 발송: r[6], 결과: r[7], 수신: r[8], 비고: r[9] })) };
}

function sendZeroAlert(sheetName, analysis) {
  const now = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy년 MM월 dd일 HH:mm');
  const kakaoText = `[스카이티제이 자동발송 비상 알림]\n⚠️ 오늘 발송요청 대상이 '0건'으로 감지되었습니다!\n\n• 일시: ${now}\n• 대상시트: ${sheetName}\n• 구글시트 총 데이터: ${analysis.total}건\n (노란색 제외: ${analysis.yellow}건 / 빨간색 제외: ${analysis.red}건)\n\n※ 발송할 건이 누락되지 않았는지 구글 시트의 색상을 꼭 확인해주세요!`;
  sendKakaoTalk(kakaoText);
  try {
    GmailApp.sendEmail(CONFIG.EMAIL_ALERT, `[스카이티제이] ⚠️ 자동발송 0건 감지 — ${sheetName}`, `발송 대상이 0건으로 감지되었습니다. 시트의 C열 색상을 확인하세요.`);
  } catch (e) {}
}

function sendToAceIP(isManual) {
  const ss = SpreadsheetApp.getActiveSpreadsheet(); const sheet = getLatestSheet(ss); const method = isManual ? '수동' : '자동';
  if (!sheet) { writeLog({ method, result: '❌ 시트없음', note: 'yy.mm 형식 시트 없음' }); return; }
  // ★ V7: C열(색 판정 열) 헤더가 '수량'인지 확인 — 열이 밀렸으면 발송 중단 + 회사메일 경보
  if (!assertColorColumn_(sheet, method)) return;
  const sheetName = sheet.getName().trim(); const analysis = analyzeRows(sheet); const { rows, sheetRows } = getRowsToSend(sheet);
  if (!rows.length) {
    writeLog({ sheetName, method, total: analysis.total, yellow: analysis.yellow, red: analysis.red, sent: 0, result: '⚠️ 0건', note: `전체${analysis.total} 노란${analysis.yellow} 빨강${analysis.red}` });
    if (!isManual && analysis.total > 0) sendZeroAlert(sheetName, analysis);
    return;
  }
  let blob; try { blob = createExcelBlob(rows, sheetName); } catch (err) { writeLog({ sheetName, method, total: analysis.total, yellow: analysis.yellow, red: analysis.red, sent: 0, result: '❌ 첨부실패', note: err.message }); return; }
  const subject = `[스카이티제이] 용지 발송 요청 ${sheetName} (${rows.length}건)${isManual ? '' : ' 자동발송'}`;
  const body = `안녕하세요, 에이스아이피 담당자님.\n스카이티제이입니다.\n\n발송 요청 드립니다.`;
  const recipient = CONFIG.TEST_MODE ? CONFIG.EMAIL_TEST : CONFIG.EMAIL_TO; const options = { attachments: [blob], name: '스카이티제이' }; if (!CONFIG.TEST_MODE) options.cc = CONFIG.EMAIL_CC;
  try {
    GmailApp.sendEmail(recipient, subject, body, options);
    // ★ 발송 성공 즉시 해당 행을 노란색(발송완료) 처리 → 다음 자동발송 때 중복발송 방지
    try {
      const lastCol = sheet.getLastColumn();
      sheetRows.forEach(r => sheet.getRange(r, 1, 1, lastCol).setBackground('#ffff00'));
      SpreadsheetApp.flush();
    } catch (colorErr) {
      sendKakaoTalk(`[경고] 발송은 성공했으나 노란색 처리 중 오류 발생: ${colorErr.message} (수동으로 노란색 처리 필요)`);
    }
    // ★ V7: 송장 감시 등록 — 반송되거나 60분 내 송장이 안 들어오면 경보
    try { registerWatchBatch_(sheet, sheetRows, subject); }
    catch (watchErr) { writeLog({ sheetName, method, result: '❌ 감시등록실패', note: watchErr.message }); }
    // ★ V8: KIS 무상전표(79*70) 누적 기록 — 실패해도 발송·노란색 처리에는 영향 없음
    try { recordKisSend_(sheetName, rows, method); }
    catch (kisErr) { writeLog({ sheetName, method, result: '❌ KIS기록실패', note: kisErr.message }); }
    writeLog({ sheetName, method, total: analysis.total, yellow: analysis.yellow, red: analysis.red, sent: rows.length, result: '✅ 성공', recipient: CONFIG.TEST_MODE ? 'TEST' : recipient });
  } catch (err) {
    writeLog({ sheetName, method, total: analysis.total, yellow: analysis.yellow, red: analysis.red, sent: rows.length, result: '❌ 메일실패', note: err.message });
    sendKakaoTalk(`[비상] 메일 전송 실패: ${err.message}`);
  }
}



function confirmSendOnBlackout_() {
  const today = new Date();
  if (!isDeliveryBlackout(today)) return true;
  const ui = SpreadsheetApp.getUi();
  const res = ui.alert(
    '⚠️ 택배 휴무일입니다',
    ymd_(today) + ' 은(는) 택배사 휴무일로 등록돼 있습니다.\n\n' +
    '지금 발송하면 실제 출고는 휴무가 끝난 뒤로 밀리는데,\n' +
    '시트의 해당 행은 바로 노란색(발송완료)으로 바뀌어 다음 자동발송에서 제외됩니다.\n\n' +
    '그래도 지금 발송할까요?',
    ui.ButtonSet.YES_NO);
  return res === ui.Button.YES;
}
function manualSend() { if (confirmSendOnBlackout_()) sendToAceIP(true); }
function retrySend() { if (confirmSendOnBlackout_()) sendToAceIP(true); }
function showTodayDeliveryStatus() {
  const now = new Date();
  const d = getDeliveryDecision_(now);
  const msg = '날짜: ' + ymd_(now) + '\n\n결과: ' + d.mark + ' ' + (d.canSend ? '발송 예정' : '발송하지 않음') +
    '\n사유: ' + d.reason + (d.canSend ? '\n\n자동발송 예정 시각: 매일 14:50' : '\n\n자동발송도 실행되지 않습니다.');
  SpreadsheetApp.getUi().alert('📦 오늘 발송 여부', msg, SpreadsheetApp.getUi().ButtonSet.OK);
}
function showDeliverySchedule() {
  const ui = SpreadsheetApp.getUi();
  const now = new Date();
  const WD = ['일', '월', '화', '수', '목', '금', '토'];
  const rowsHtml = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const decision = getDeliveryDecision_(d);
    rowsHtml.push(
      '<tr><td>' + ymd_(d) + '(' + WD[d.getDay()] + ')' + (i === 0 ? ' ← 오늘' : '') + '</td>' +
      '<td class="' + (decision.canSend ? 'send' : 'skip') + '">' + decision.mark + ' ' + (decision.canSend ? '발송 예정' : '발송 안 함') + '</td>' +
      '<td>' + decision.reason + '</td></tr>'
    );
  }
  const html = HtmlService.createHtmlOutput(
    '<style>' +
    'body{font-family:Arial,"Noto Sans KR",sans-serif;padding:14px;}' +
    'table{border-collapse:collapse;width:100%;font-size:13px;}' +
    'th,td{border:1px solid #dadce0;padding:8px;text-align:left;}' +
    'th{background:#f1f3f4;}' +
    '.send{color:#137333;font-weight:bold;}' +
    '.skip{color:#c5221f;font-weight:bold;}' +
    '</style>' +
    '<h3>📅 앞으로 2주 자동발송 예정</h3>' +
    '<table><tr><th>날짜</th><th>발송 여부</th><th>사유</th></tr>' + rowsHtml.join('') + '</table>' +
    '<p style="font-size:12px;color:#5f6368;">※ 법정공휴일은 KASI API 조회 결과이며, 조회 실패 시 안전을 위해 공휴일로 간주해 발송하지 않습니다.</p>'
  ).setWidth(480).setHeight(520);
  ui.showModalDialog(html, '📅 앞으로 2주 발송 예정');
}
function diagnoseRows() { /* 기존 진단 팝업 유지 */ }
function showDashboard() { const html = HtmlService.createHtmlOutputFromFile('Sidebar').setTitle('📦 용지발송 대시보드').setWidth(380); SpreadsheetApp.getUi().showSidebar(html); }
function getSidebarData() { const ss = SpreadsheetApp.getActiveSpreadsheet(); const sheet = getLatestSheet(ss); let sheetName = '-', analysis = { total: 0, yellow: 0, red: 0, send: 0 }; if (sheet) { sheetName = sheet.getName().trim(); analysis = analyzeRows(sheet); } return { sheetName, analysis, logs: getLogsForApi().logs }; }
function sidebarSend() { if (!confirmSendOnBlackout_()) return '취소됨'; sendToAceIP(true); return '완료'; }
function isKoreanHoliday(date) {
  try {
    const y = Utilities.formatDate(date, 'Asia/Seoul', 'yyyy');
    const mo = Utilities.formatDate(date, 'Asia/Seoul', 'MM');
    const d = Utilities.formatDate(date, 'Asia/Seoul', 'dd');
    const holidays = getKasiHolidaysForMonth(y, mo);
    return holidays.indexOf(y + mo + d) !== -1;
  } catch (e) {
    // 공휴일 확인 실패 시: 안전을 위해 '공휴일로 간주'하여 발송을 건너뛰고 담당자에게 알림
    try { sendKakaoTalk('[경고] 공휴일 확인 API 오류로 오늘 자동발송을 보류합니다: ' + e.message); } catch (e2) {}
    return true;
  }
}

// 한국천문연구원 특일 정보(getRestDeInfo) - 공공기관 공휴일(임시공휴일 포함) 조회, 월 단위 캐싱
function getKasiHolidaysForMonth(yyyy, mm) {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'kasiHolidays_' + yyyy + mm;
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const serviceKey = CONFIG.KASI_SERVICE_KEY;
  const base = 'https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo';
  const url = base + '?serviceKey=' + encodeURIComponent(serviceKey) + '&solYear=' + yyyy + '&solMonth=' + mm + '&numOfRows=50&_type=json';
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const code = res.getResponseCode();
  if (code !== 200) throw new Error('KASI API HTTP ' + code);

  const json = JSON.parse(res.getContentText());
  const header = json.response && json.response.header;
  if (!header || header.resultCode !== '00') {
    throw new Error('KASI API 오류: ' + (header ? header.resultMsg : '응답 형식 오류'));
  }

  const body = json.response.body;
  let items = (body && body.items && body.items.item) || [];
  if (!Array.isArray(items)) items = [items];

  const holidayDates = items
    .filter(function (it) { return it && it.isHoliday === 'Y'; })
    .map(function (it) { return String(it.locdate); });

  cache.put(cacheKey, JSON.stringify(holidayDates), 21600);
  return holidayDates;
}

// ── V5: finally의 자기재예약 호출 제거 (반복 트리거가 매일 실행) ──
function autoDailySend() {
  const now = new Date();
  const decision = getDeliveryDecision_(now);
  if (!decision.canSend) {
    writeLog({ method: '자동', result: decision.mark + ' ' + decision.reason });
    if (decision.reason === '공휴일') sendKakaoTalk(`[알림] 오늘은 공휴일이므로 자동발송을 건너뜁니다.`);
    return;
  }
  sendToAceIP(false);
}

// (참고) 기존 일회성 자기재예약 함수 — 더 이상 사용하지 않음
function scheduleNextRun(targetHour, targetMinute) {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'autoDailySend').forEach(t => ScriptApp.deleteTrigger(t));
  const now = new Date(); let next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), targetHour, targetMinute, 0);
  if (next.getTime() <= now.getTime()) next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, targetHour, targetMinute, 0);
  ScriptApp.newTrigger('autoDailySend').timeBased().at(next).create();
}

function testAutoDailySend() { sendToAceIP(false); }

// ── V5: 매일 14:50 반복 트리거 ──
function setupTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'autoDailySend')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('autoDailySend')
    .timeBased().everyDays(1).atHour(CONFIG.AUTO_SEND_HOUR).nearMinute(CONFIG.AUTO_SEND_MINUTE).create();
  ensureLogSheet();
}

// ════════════════════════════════════════════════
// SECTION 13. ★ 신규 — 송장번호 반영 (메뉴 버튼)
// ════════════════════════════════════════════════

// 메뉴에서 호출되는 메인 함수
function applyTracking() {
  const ui = SpreadsheetApp.getUi();

  // 1) 최근 에이스아이피 답장에서 xlsx 첨부 찾기
  let found;
  try { found = fetchLatestReplyBlob_(); }
  catch (e) { ui.alert('오류', '메일 검색 중 오류: ' + e.message, ui.ButtonSet.OK); return; }
  if (!found) {
    ui.alert('답장 없음', `최근 ${CONFIG.TRACKING_SEARCH_DAYS}일 내 '${CONFIG.ACEIP_REPLY_FROM}'의 xlsx 첨부 메일을 찾지 못했습니다.`, ui.ButtonSet.OK);
    return;
  }

  // 2) 첨부 파싱 (운송장번호 열을 헤더 이름으로 탐색)
  let entries;
  try { entries = parseReplyBlob_(found.blob); }
  catch (e) { ui.alert('오류', '첨부 파싱 오류: ' + e.message, ui.ButtonSet.OK); return; }
  if (!entries.length) {
    ui.alert('데이터 없음', "첨부에서 '운송장번호' 열 데이터를 찾지 못했습니다. (헤더에 '운송장번호'/'송장번호'가 있는지 확인)", ui.ButtonSet.OK);
    return;
  }

  // 3) 최신 시트 행과 매칭 계획 수립
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getLatestSheet(ss);
  if (!sheet) { ui.alert('시트 없음', 'yy.mm 형식 시트를 찾지 못했습니다.', ui.ButtonSet.OK); return; }
  const plan = buildTrackingPlan_(sheet, entries);
  if (plan.error) { ui.alert('반영 불가', plan.error, ui.ButtonSet.OK); return; }

  // 4) 미리보기 확인
  const mailDate = Utilities.formatDate(found.date, 'Asia/Seoul', 'MM/dd HH:mm');
  let msg = `[읽은 답장] ${mailDate} · ${found.subject}\n첨부: ${found.fileName}\n\n`
    + `대상 시트: ${sheet.getName().trim()}\n첨부 운송장 건수: ${entries.length}\n\n`
    + `✅ 반영 예정: ${plan.updates.length}건\n`
    + `⏭️ 이미 송장있음(건너뜀): ${plan.skipped.length}건\n`
    + `❓ 미매칭(시트에서 못찾음): ${plan.unmatched.length}건`;
  if (plan.unmatched.length) {
    msg += '\n\n[미매칭 목록]\n' + plan.unmatched.slice(0, 12).map(u => `• ${u.name || '(이름없음)'} / ${u.phone || '(번호없음)'}`).join('\n');
    if (plan.unmatched.length > 12) msg += `\n... 외 ${plan.unmatched.length - 12}건`;
  }
  msg += '\n\n위 내용대로 송장번호를 입력하고 해당 행을 노란색으로 표시할까요?';

  if (plan.updates.length === 0) { ui.alert('반영할 건 없음', msg, ui.ButtonSet.OK); return; }
  const res = ui.alert('송장번호 반영 확인', msg, ui.ButtonSet.YES_NO);
  if (res !== ui.Button.YES) { return; }

  // 5) 반영 실행
  applyTrackingPlan_(sheet, plan);
  writeLog({
    sheetName: sheet.getName().trim(), method: '송장반영', total: entries.length,
    sent: plan.updates.length, result: '✅ 성공',
    note: `반영${plan.updates.length} 건너뜀${plan.skipped.length} 미매칭${plan.unmatched.length}`
  });
  ui.alert('완료', `${plan.updates.length}건 반영 완료 (노란색 처리됨).\n미매칭 ${plan.unmatched.length}건은 시트에서 직접 확인해주세요.`, ui.ButtonSet.OK);
}

// 최근 답장 메일의 xlsx/xls 첨부 반환 (가장 최신) — 메일 정보 포함
function fetchLatestReplyBlob_() {
  const q = `from:${CONFIG.ACEIP_REPLY_FROM} has:attachment newer_than:${CONFIG.TRACKING_SEARCH_DAYS}d`;
  const threads = GmailApp.search(q, 0, 15);
  let best = null;
  threads.forEach(t => t.getMessages().forEach(m => {
    const when = m.getDate().getTime();
    m.getAttachments().forEach(a => {
      const n = (a.getName() || '').toLowerCase();
      if (n.endsWith('.xlsx') || n.endsWith('.xls')) {
        if (!best || when > best.when) {
          best = { blob: a.copyBlob(), when, fileName: a.getName(), subject: m.getSubject(), date: m.getDate() };
        }
      }
    });
  }));
  return best;
}

// xlsx blob → 임시 구글시트 변환 후 값 파싱 → 임시파일 삭제
function parseReplyBlob_(blob) {
  const tmpId = xlsxToTmpSheetId_(blob);
  try {
    const ss = SpreadsheetApp.openById(tmpId);
    const ws = ss.getSheets()[0];
    const data = ws.getDataRange().getValues();
    if (data.length < 2) return [];
    const headers = data[0].map(h => String(h).trim());

    // 운송장번호 열: '운송장' 또는 '송장' 포함 (위치 무관)
    const cT = headers.findIndex(h => h.includes('운송장') || h.includes('송장'));
    // 받는분(이름) 열: '받는분' 포함 & 전화/번호/주소 제외
    const cName = headers.findIndex(h => h.includes('받는분') && !h.includes('전화') && !h.includes('번호') && !h.includes('주소'));
    // 전화 열: '전화' 포함, 없으면 '받는'+'번호'
    let cPhone = headers.findIndex(h => h.includes('전화'));
    if (cPhone < 0) cPhone = headers.findIndex(h => h.includes('받는') && h.includes('번호'));

    if (cT < 0) return [];
    const out = [];
    for (let i = 1; i < data.length; i++) {
      const tr = String(data[i][cT] == null ? '' : data[i][cT]).trim();
      if (!tr) continue;
      out.push({
        tracking: tr,
        name: cName >= 0 ? String(data[i][cName] || '').trim() : '',
        phone: cPhone >= 0 ? String(data[i][cPhone] || '').trim() : '',
      });
    }
    return out;
  } finally {
    try { DriveApp.getFileById(tmpId).setTrashed(true); } catch (e) {}
  }
}

// xlsx blob을 드라이브에 올리고 구글시트로 변환 → 시트 fileId 반환 (원본 xlsx는 삭제)
function xlsxToTmpSheetId_(blob) {
  const token = ScriptApp.getOAuthToken();
  // 1) media 업로드 (xlsx 그대로)
  const up = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=media', {
    method: 'post',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    payload: blob.getBytes(),
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true,
  });
  if (up.getResponseCode() >= 300) throw new Error('첨부 업로드 실패 HTTP ' + up.getResponseCode());
  const xlsxId = JSON.parse(up.getContentText()).id;
  try {
    // 2) 구글시트로 변환 복사
    const cp = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + xlsxId + '/copy', {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify({ name: '_tmp_track_' + Date.now(), mimeType: 'application/vnd.google-apps.spreadsheet' }),
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true,
    });
    if (cp.getResponseCode() >= 300) throw new Error('시트 변환 실패 HTTP ' + cp.getResponseCode());
    return JSON.parse(cp.getContentText()).id;
  } finally {
    try { DriveApp.getFileById(xlsxId).setTrashed(true); } catch (e) {}
  }
}

// 시트 행 ↔ 답장 entries 매칭 계획
function buildTrackingPlan_(sheet, entries) {
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h).trim());
  const c명 = findCol(headers, '받는분성명');
  const c전 = findCol(headers, '받는분번호');
  const c송 = findCol(headers, '송장번호');
  // 가드: 송장번호 열이 없으면 반영 불가
  if (c송 < 0) return { updates: [], unmatched: entries.slice(), skipped: [], error: "시트에서 '송장번호' 열을 찾지 못했습니다." };

  // C열(3열) 색상 읽기 → 무색(발송된) 행만 매칭 후보로 사용 (과거 노란/빨간 행 오염 방지)
  const lastRow = sheet.getLastRow();
  const bgsC = lastRow >= 2 ? sheet.getRange(2, 3, lastRow - 1, 1).getBackgrounds() : [];

  // 시트 행 인덱스 구축
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const name = String(data[i][c명] || '').trim();
    if (!name) continue;
    const bg = (bgsC[i - 1] && bgsC[i - 1][0]) ? String(bgsC[i - 1][0]).toLowerCase().trim() : '';
    rows.push({
      sheetRow: i + 1,
      name,
      nname: normName(name),
      phone: formatPhone(data[i][c전]),
      hasTrack: String(data[i][c송] || '').trim() !== '',
      sendable: !isRedColor(bg), // 빨간색(미수금)만 제외 - 노란색(발송완료)도 후보 포함, 실제 반영 여부는 hasTrack으로 판별
    });
  }

  const consumed = {};
  const updates = [], unmatched = [], skipped = [];

  entries.forEach(e => {
    const ep = formatPhone(e.phone), en = normName(e.name);

    // 후보: 무색 + 미소비 + 송장없음 / 전화 1순위
    let cand = rows.filter(r => r.sendable && !consumed[r.sheetRow] && !r.hasTrack && r.phone && r.phone === ep);
    // 없으면 이름 2순위
    if (!cand.length) cand = rows.filter(r => r.sendable && !consumed[r.sheetRow] && !r.hasTrack && en && r.nname === en);

    if (!cand.length) {
      // 이미 송장있는 매칭행이 있으면 skipped, 아니면 unmatched
      const already = rows.find(r => r.hasTrack && ((r.phone && r.phone === ep) || (en && r.nname === en)));
      if (already) skipped.push(e); else unmatched.push(e);
      return;
    }
    // 후보 중 이름까지 맞는 걸 우선
    const pick = cand.find(r => en && r.nname === en) || cand[0];
    consumed[pick.sheetRow] = true;
    updates.push({ sheetRow: pick.sheetRow, col: c송 + 1, name: pick.name, tracking: e.tracking });
  });

  return { updates, unmatched, skipped };
}

// 계획 반영: 송장번호 입력 + 해당 행 노란색
function applyTrackingPlan_(sheet, plan) {
  const lastCol = sheet.getLastColumn();
  plan.updates.forEach(u => {
    sheet.getRange(u.sheetRow, u.col).setNumberFormat('@').setValue(u.tracking);
    sheet.getRange(u.sheetRow, 1, 1, lastCol).setBackground('#ffff00'); // 전체 행 노란색 → 다음 발송 제외
  });
  SpreadsheetApp.flush();
}

// ════════════════════════════════════════════════
// 메뉴
// ════════════════════════════════════════════════
// ══════════════════════════════════════════════════
// SECTION 14. ★ 신규 — 답장 자동 감지 & 송장번호 자동 반영
// ══════════════════════════════════════════════════

const TRACKING_PROCESSED_LABEL = '송장반영완료';

function getOrCreateProcessedLabel_() {
  let label = GmailApp.getUserLabelByName(TRACKING_PROCESSED_LABEL);
  if (!label) label = GmailApp.createLabel(TRACKING_PROCESSED_LABEL);
  return label;
}

function fetchUnprocessedReplies_() {
  const label = getOrCreateProcessedLabel_();
  const q = `from:${CONFIG.ACEIP_REPLY_FROM} has:attachment newer_than:${CONFIG.TRACKING_SEARCH_DAYS}d -label:"${TRACKING_PROCESSED_LABEL}"`;
  const threads = GmailApp.search(q, 0, 20);
  const results = [];
  threads.forEach(t => {
    t.getMessages().forEach(m => {
      const atts = m.getAttachments().filter(a => {
        const n = (a.getName() || '').toLowerCase();
        return n.endsWith('.xlsx') || n.endsWith('.xls');
      });
      atts.forEach(a => {
        results.push({ blob: a.copyBlob(), fileName: a.getName(), subject: m.getSubject(), date: m.getDate(), thread: t });
      });
    });
  });
  results.sort((a, b) => a.date - b.date);
  return { label, results };
}

function autoApplyTracking() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getLatestSheet(ss);
  if (!sheet) return;

  let data;
  try { data = fetchUnprocessedReplies_(); }
  catch (e) { sendKakaoTalk(`[경고] 자동 송장반영 메일 검색 오류: ${e.message}`); return; }

  const { label, results } = data;
  if (!results.length) return;

  let totalUpdated = 0, totalSkipped = 0, totalUnmatched = 0;
  const unmatchedDetails = [];

  results.forEach(r => {
    let entries;
    try { entries = parseReplyBlob_(r.blob); }
    catch (e) { sendKakaoTalk(`[경고] 첨부 파싱 실패(${r.fileName}): ${e.message}`); return; }

    if (!entries.length) { label.addToThread(r.thread); return; }

    const plan = buildTrackingPlan_(sheet, entries);
    if (plan.error) { sendKakaoTalk(`[경고] 송장 반영 불가: ${plan.error}`); return; }

    applyTrackingPlan_(sheet, plan);
    label.addToThread(r.thread);

    totalUpdated += plan.updates.length;
    totalSkipped += plan.skipped.length;
    totalUnmatched += plan.unmatched.length;
    if (plan.unmatched.length) {
      unmatchedDetails.push(...plan.unmatched.map(u => `[${r.fileName}] ${u.name || '(이름없음)'} / ${u.phone || '(번호없음)'}`));
    }

    writeLog({
      sheetName: sheet.getName().trim(), method: '송장반영(자동)', total: entries.length,
      sent: plan.updates.length, result: '✅ 성공',
      note: `반영${plan.updates.length} 건너뜀${plan.skipped.length} 미매칭${plan.unmatched.length}`
    });
  });

  if (!totalUpdated && !totalSkipped && !totalUnmatched) return;

  const summary = `[스카이티제이] 자동 송장반영 결과\n반영: ${totalUpdated}건 · 건너뜀: ${totalSkipped}건 · 미매칭: ${totalUnmatched}건`;
  sendKakaoTalk(summary);
  try {
    GmailApp.sendEmail(CONFIG.EMAIL_ALERT, '[스카이티제이] 자동 송장반영 결과',
      summary + (unmatchedDetails.length ? ('\n\n[미매칭 목록]\n' + unmatchedDetails.join('\n')) : ''));
  } catch (e) {}

  if (totalUnmatched > 0) {
    sendKakaoTalk(`⚠️ 미매칭 ${totalUnmatched}건 발생! 시트에서 직접 확인이 필요합니다.`);
  }
}

function setupTrackingTrigger() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'autoApplyTracking').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('autoApplyTracking').timeBased().everyHours(1).create();
}


function onOpen() {
  SpreadsheetApp.getUi().createMenu('📦 용지발송')
    .addItem('✉️ 지금 바로 발송 (수동)', 'manualSend')
    .addItem('🔄 지금 바로 재발송', 'retrySend')
    .addSeparator()
    .addItem('📮 송장번호 반영 (답장 첨부)', 'applyTracking')
    .addItem('🔎 송장 미입력 행 점검', 'checkMissingTrackingNow')
    .addSeparator()
    .addItem('📊 대시보드 열기', 'showDashboard')
    .addItem('🔍 현재 행 상태 진단', 'diagnoseRows')
    .addItem('📦 오늘 발송 여부 확인', 'showTodayDeliveryStatus')
    .addItem('📅 앞으로 2주 발송 예정 보기', 'showDeliverySchedule')
    .addSeparator()
    .addItem('🏦 KIS 무상전표 수량 입력', 'kisInputFree')
    .addItem('📊 KIS 무상전표 현황 (일별·월누적)', 'kisShowStatus')
    .addItem('🔢 이번 달 이미 보낸 79*70 계산', 'kisRecalcBase')
    .addSeparator()
    .addItem('⏰ 트리거 설정', 'setupTrigger')
    .addItem('⏰ 송장반영 자동감지 트리거 설정', 'setupTrackingTrigger')
    .addItem('🚨 송장 감시 트리거 설정 (10분)', 'setupWatchTrigger')
    .addItem('⏰ KIS 사전점검 트리거 설정 (14:00)', 'setupKisPrecheckTrigger')
    .addToUi();
}

// ══════════════════════════════════════════════════
// SECTION 15. ★ V7 — 송장 감시 (반송 감지 / 60분 내 송장 미입력 경보)
// ══════════════════════════════════════════════════
// ================================================
// 스카이티제이 용지관리 — V7 추가 파일: 송장 감시
//   같은 Apps Script 프로젝트에 "새 스크립트 파일"로 추가 (파일명: 송장감시)
//
//   배경(사고): 발송요청 메일이 수신 측 사정으로 반송됨.
//     GmailApp.sendEmail()은 '보내기'만 성공하면 예외가 안 나므로
//     시트는 노란색(발송완료)으로 바뀌었고, 송장번호(K열)는 비어 있는 채로
//     다음 자동발송에서 제외되어 출고 누락이 발생.
//
//   대책:
//   ① 발송할 때마다 "감시 목록"에 등록 (어느 시트 몇 행을 언제 보냈는지)
//   ② 10분마다 점검
//      - 반송 메일(mailer-daemon) 감지 → 즉시 경보
//      - 발송 후 60분이 지나도 송장번호가 안 들어온 행 → 경보
//      - 경보 대상 행은 D열(받는분성명) 칸을 자홍색, K열(송장번호) 칸을 빨간색 + 메모 표시
//        → 열 순서는 그대로 두고, 직원이 늘 보는 가맹점명 칸에서 바로 눈에 띄게
//        (C열 색은 안 건드리므로 발송/제외 판정에는 영향 없음)
//   ③ 송장번호가 들어오면 표시 자동 해제 & 감시 목록에서 제거
//   ④ 메뉴 "송장 미입력 행 점검" — 노란색인데 송장번호가 빈 행을 즉시 목록화
// ===========================================//=====

const WATCH = {
  DEADLINE_MIN: 60,       // 발송 후 이 시간(분)까지 송장 없으면 경보 → 로젠 직접발송 판단
  CHECK_EVERY_MIN: 10,    // 점검 주기(분) — 1, 5, 10, 15, 30 중 하나
  EXPIRE_HOURS: 72,       // 이 시간 지난 발송건은 감시 목록에서 자동 제거
  PROP_KEY: 'TRACKING_WATCH_BATCHES',
  MARK_BG: '#ff0000',     // 송장 미수신 표시 — 송장번호 칸
  MARK_NAME_BG: '#ff00ff', // 송장 미수신 표시 — 받는분성명 칸(자홍색: 미수금 빨강과 구분)
  NOTE_PREFIX: '⚠️ 송장 미수신',
};

// ★ 경보 받을 메일
//   - EMAIL_ALERT = 회사 공용메일 → 직원 누구나 확인 가능
//   - 반송 메일은 스크립트 실행 계정(개인 Gmail)으로 오지만, 이 감시가 대신 읽고
//     회사 공용메일로 경보를 보내므로 휴가 중에도 직원이 확인 가능
function getWatchAlertEmails_() {
  return [
    CONFIG.EMAIL_ALERT,
    CONFIG.EMAIL_CC,
  ].filter(Boolean);
}

// ── 열 구조 가드 ──
//   발송/제외 판정은 C열(3번째 열) 색으로 한다. 누가 A~C 사이에 열을 끼워 넣으면
//   엉뚱한 열 색을 읽어 '중복발송/미수금 발송'이 날 수 있으므로 발송 전에 헤더를 확인한다.
const COLOR_COL_HEADER = '수량';

function assertColorColumn_(sheet, method) {
  const h = String(sheet.getRange(1, 3).getValue() || '').trim();
  if (h === COLOR_COL_HEADER) return true;
  const msg = `시트 [${sheet.getName().trim()}]의 C열 헤더가 '${COLOR_COL_HEADER}'가 아니라 '${h}'입니다.\n` +
    `열이 밀려 노란색/빨간색 판정이 틀릴 수 있어 발송을 중단했습니다.\nC열이 '${COLOR_COL_HEADER}'가 되도록 열 순서를 바로잡은 뒤 수동 발송하세요.`;
  writeLog({ sheetName: sheet.getName().trim(), method, result: '❌ 열구조오류', note: msg });
  getWatchAlertEmails_().forEach(to => {
    try { GmailApp.sendEmail(to, '[스카이티제이][긴급] 자동발송 중단 — 시트 열 구조 오류', msg + '\n\n' + SpreadsheetApp.getActiveSpreadsheet().getUrl()); } catch (e) {}
  });
  return false;
}

// ── 감시 목록 저장/로드 (스크립트 속성) ──
function loadWatch_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(WATCH.PROP_KEY) || '[]'); }
  catch (e) { return []; }
}
function saveWatch_(batches) {
  PropertiesService.getScriptProperties().setProperty(WATCH.PROP_KEY, JSON.stringify(batches));
}

// sendToAceIP에서 메일 발송 성공 직후 호출
function registerWatchBatch_(sheet, sheetRows, subject) {
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h).trim());
  const c명 = findCol(headers, '받는분성명');
  const items = sheetRows.map(r => ({ row: r, name: String(data[r - 1][c명] || '').trim() }));
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const batches = loadWatch_();
    batches.push({ id: Date.now(), sheetName: sheet.getName().trim(), sentAt: Date.now(), subject, items, bounce: false, late: false });
    saveWatch_(batches);
  } finally { lock.releaseLock(); }
}

// ── 10분 주기 트리거 본체 ──
function checkTrackingWatch() {
  if (!loadWatch_().length) return;

  // 답장이 와 있으면 먼저 반영 (자동반영 트리거가 1시간 주기라 생기는 오경보 방지)
  try { autoApplyTracking(); } catch (e) {}

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const now = Date.now();
    const keep = [];

    loadWatch_().forEach(b => {
      if (now - b.sentAt > WATCH.EXPIRE_HOURS * 3600000) return;
      const sheet = ss.getSheets().find(s => s.getName().trim() === b.sheetName);
      if (!sheet) return;

      const status = getTrackingStatus_(sheet, b.items);
      clearMarks_(sheet, status.filled);       // 송장 들어온 행은 표시 해제
      if (!status.missing.length) return;      // 전부 들어옴 → 감시 종료

      if (!b.bounce && findBounceSince_(b.sentAt)) {
        b.bounce = true; b.late = true;        // 반송 경보를 냈으면 60분 경보는 생략
        markMissing_(sheet, status.missing, '메일 반송');
        sendWatchAlert_('bounce', b, status.missing, ss);
      } else if (!b.late && now - b.sentAt >= WATCH.DEADLINE_MIN * 60000) {
        b.late = true;
        markMissing_(sheet, status.missing, WATCH.DEADLINE_MIN + '분 경과');
        sendWatchAlert_('late', b, status.missing, ss);
      }
      keep.push(b);
    });

    saveWatch_(keep);
  } finally { lock.releaseLock(); }
}

// 감시 대상 행의 송장번호 유무 확인 (행이 밀렸으면 이름으로 다시 찾음)
function getTrackingStatus_(sheet, items) {
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h).trim());
  const c명 = findCol(headers, '받는분성명');
  const c송 = findCol(headers, '송장번호');
  const missing = [], filled = [];
  if (c명 < 0 || c송 < 0) return { missing, filled, col: -1 };

  const used = {};
  items.forEach(it => {
    let idx = it.row - 1;
    const sameName = data[idx] && String(data[idx][c명] || '').trim() === it.name;
    if (!sameName) {
      idx = data.findIndex((r, i) => i > 0 && !used[i] && String(r[c명] || '').trim() === it.name);
      if (idx < 0) return; // 행이 삭제됨 → 감시 제외
    }
    used[idx] = true;
    const entry = { row: idx + 1, name: it.name, col: c송 + 1, nameCol: c명 + 1 };
    if (String(data[idx][c송] || '').trim()) filled.push(entry); else missing.push(entry);
  });
  return { missing, filled };
}

function markMissing_(sheet, missing, reason) {
  const when = Utilities.formatDate(new Date(), 'Asia/Seoul', 'MM/dd HH:mm');
  missing.forEach(m => {
    sheet.getRange(m.row, m.nameCol).setBackground(WATCH.MARK_NAME_BG);
    sheet.getRange(m.row, m.col)
      .setBackground(WATCH.MARK_BG)
      .setNote(`${WATCH.NOTE_PREFIX} (${reason}) ${when}\n에이스아이피 출고 여부 확인 → 안 됐으면 로젠 직접발송 후 이 칸에 로젠 송장번호 입력`);
  });
  SpreadsheetApp.flush();
}

function clearMarks_(sheet, filled) {
  filled.forEach(f => {
    const cell = sheet.getRange(f.row, f.col);
    if (String(cell.getNote() || '').indexOf(WATCH.NOTE_PREFIX) === 0) {
      cell.clearNote().setBackground('#ffff00');
      sheet.getRange(f.row, f.nameCol).setBackground('#ffff00');
    }
  });
}

// 발송 시각 이후 에이스아이피 주소가 들어간 반송 메일이 있는가
function findBounceSince_(sentAtMs) {
  const q = `from:(mailer-daemon OR postmaster) after:${Math.floor(sentAtMs / 1000)}`;
  const target = CONFIG.EMAIL_TO.toLowerCase();
  return GmailApp.search(q, 0, 20).some(t => t.getMessages().some(m =>
    m.getDate().getTime() >= sentAtMs &&
    String(m.getPlainBody() || '').toLowerCase().indexOf(target) !== -1
  ));
}

function sendWatchAlert_(type, b, missing, ss) {
  const sentStr = Utilities.formatDate(new Date(b.sentAt), 'Asia/Seoul', 'MM/dd HH:mm');
  const head = type === 'bounce'
    ? `🚨 에이스아이피 발송요청 메일이 반송되었습니다 (수신함 용량초과 등)`
    : `⏰ 발송요청 후 ${WATCH.DEADLINE_MIN}분이 지났는데 송장번호가 안 들어왔습니다`;
  const list = missing.map(m => `• ${m.row}행  ${m.name}`).join('\n');
  const body =
    `${head}\n\n` +
    `• 시트: ${b.sheetName}\n• 발송요청 시각: ${sentStr}\n• 송장 미입력: ${missing.length}건\n\n${list}\n\n` +
    `[조치]\n` +
    `1) 에이스아이피에 전화로 출고 여부 확인\n` +
    `2) 출고 안 됐으면 로젠으로 직접 발송하고 K열(송장번호)에 로젠 송장번호 입력\n` +
    `   ※ 이 행들은 이미 노란색이라 내일 자동발송에 다시 포함되지 않습니다.\n` +
    `3) 가맹점명(자홍색)·송장번호(빨간색) 표시는 송장번호가 들어오면 자동으로 해제됩니다.\n\n` +
    `시트 바로가기: ${ss.getUrl()}`;

  const subject = `[스카이티제이][긴급] 송장 미수신 ${missing.length}건 — ${type === 'bounce' ? '메일 반송' : '로젠 직접발송 검토'}`;
  getWatchAlertEmails_().forEach(to => { try { GmailApp.sendEmail(to, subject, body); } catch (e) {} });
  sendKakaoTalk(subject + '\n' + list);
  writeLog({ sheetName: b.sheetName, method: '송장감시', total: b.items.length, sent: 0,
             result: type === 'bounce' ? '❌ 메일반송' : '❌ 송장미수신', note: `미입력 ${missing.length}건 (${sentStr} 발송분)` });
}

// ── 메뉴: 노란색인데 송장번호가 빈 행 점검 (최근 2개 시트) ──
function checkMissingTrackingNow() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets()
    .filter(s => CONFIG.SHEET_NAME_PATTERN.test(s.getName().trim()) && !s.isSheetHidden())
    .sort((a, b) => b.getName().trim().localeCompare(a.getName().trim()))
    .slice(0, 2);

  const lines = [];
  sheets.forEach(sheet => {
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return;
    const headers = data[0].map(h => String(h).trim());
    const c명 = findCol(headers, '받는분성명');
    const c송 = findCol(headers, '송장번호');
    const c날 = findCol(headers, '1열');
    if (c명 < 0 || c송 < 0) return;
    const bgs = sheet.getRange(2, 3, data.length - 1, 1).getBackgrounds();
    for (let i = 1; i < data.length; i++) {
      const name = String(data[i][c명] || '').trim();
      if (!name || String(data[i][c송] || '').trim()) continue;
      if (!isYellowColor(String(bgs[i - 1][0] || '').toLowerCase())) continue;
      const d = data[i][c날];
      const dStr = d instanceof Date ? Utilities.formatDate(d, 'Asia/Seoul', 'MM/dd') : String(d || '');
      lines.push(`[${sheet.getName().trim()}] ${i + 1}행  ${dStr}  ${name}`);
    }
  });

  if (!lines.length) { ui.alert('송장 미입력 점검', '노란색인데 송장번호가 빈 행이 없습니다. ✅', ui.ButtonSet.OK); return; }
  ui.alert('⚠️ 송장 미입력 행 ' + lines.length + '건',
    '노란색(발송완료)인데 송장번호(K열)가 비어 있습니다.\n실제 출고됐는지 확인하세요.\n\n' +
    lines.slice(0, 30).join('\n') + (lines.length > 30 ? `\n... 외 ${lines.length - 30}건` : ''),
    ui.ButtonSet.OK);
}

function setupWatchTrigger() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'checkTrackingWatch').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('checkTrackingWatch').timeBased().everyMinutes(WATCH.CHECK_EVERY_MIN).create();
  SpreadsheetApp.getUi().alert('송장 감시 트리거 설정 완료', `${WATCH.CHECK_EVERY_MIN}분마다 반송/송장 미입력을 점검합니다.`, SpreadsheetApp.getUi().ButtonSet.OK);
}
// ══════════════════════════════════════════════════
// SECTION 16. ★ V8 — KIS 무상전표(79*70) 수량 관리
// ══════════════════════════════════════════════════
//   목적: 79*70 은 KIS 무상전표 수량(+여유 박스)까지만 에이스아이피로 보내고,
//         그 이후 건은 사무실에서 로젠택배로 직접 발송한다.
//   - 'KIS무상전표' 시트: 월 | 무상수량 | 여유 | 시작값 | 시작값 기준시각 | 메모
//   - 'KIS발송기록' 시트: 에이스아이피 발송 성공 때마다 한 줄 (79*70 박스 / 전체 수량 / 월누적 / 상태)
//     ※ 노란색에는 로젠 직접발송 건도 섞이므로 색이 아니라 '실제 발송 기록'으로 센다.
//   - 월 누적 = 시작값(기능 도입 전 이미 보낸 양) + 시작값 기준시각 이후의 발송 기록 합
//   - 상태: 🟢 무상 범위 안 / 🟡 무상 소진·여유 구간 / 🔴 무상+여유 초과
//   - 표시와 경보만 한다. 자동발송에서 행을 빼지 않는다.

const KIS_SETTING_HEADERS = ['월', 'KIS 무상전표(박스)', '여유(박스)', '시작값(박스)', '시작값 기준시각', '메모'];
const KIS_RECORD_HEADERS = ['시각', '월', '시트', '79*70(박스)', '전체수량', '행수', '방식', '월누적(박스)', '상태'];

function isKisItem_(name) {
  const s = String(name == null ? '' : name);
  return CONFIG.KIS_ITEM_PATTERN.test(s) && !(CONFIG.KIS_ITEM_EXCLUDE && CONFIG.KIS_ITEM_EXCLUDE.test(s));
}
function qtyOf_(v) { const n = Number(v); return n > 0 ? n : 1; }
function numOrNull_(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v); return isNaN(n) ? null : n;
}
// '26.11' 이 숫자 26.1 로 바뀌어 저장된 경우까지 'yy.mm' 문자열로 되돌림
function monthKey_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') return v.toFixed(2);
  return String(v).trim();
}
function escHtml_(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function ensureKisSheet_(name, headers, textCol) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, textCol, 1000, 1).setNumberFormat('@'); // '26.11' 이 숫자로 바뀌지 않게
    const h = sh.getRange(1, 1, 1, headers.length);
    h.setValues([headers]);
    h.setBackground('#0d47a1').setFontColor('#ffffff').setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}
function kisSettingSheet_() { return ensureKisSheet_(CONFIG.KIS_SETTING_SHEET, KIS_SETTING_HEADERS, 1); }
function kisRecordSheet_() { return ensureKisSheet_(CONFIG.KIS_RECORD_SHEET, KIS_RECORD_HEADERS, 2); }

function getKisSetting_(month) {
  const data = kisSettingSheet_().getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (monthKey_(r[0]) !== month) continue;
    const margin = numOrNull_(r[2]);
    return {
      row: i + 1, month,
      free: numOrNull_(r[1]),
      margin: margin === null ? CONFIG.KIS_DEFAULT_MARGIN : margin,
      base: numOrNull_(r[3]),
      baseAt: r[4] instanceof Date ? r[4] : null,
    };
  }
  return { row: 0, month, free: null, margin: CONFIG.KIS_DEFAULT_MARGIN, base: null, baseAt: null };
}

function saveKisSetting_(month, patch) {
  const sh = kisSettingSheet_();
  const cur = getKisSetting_(month);
  const next = Object.assign({}, cur, patch);
  const row = cur.row || sh.getLastRow() + 1;
  sh.getRange(row, 1).setNumberFormat('@').setValue(month);
  sh.getRange(row, 2, 1, 4).setValues([[
    next.free === null ? '' : next.free,
    next.margin === null ? '' : next.margin,
    next.base === null ? '' : next.base,
    next.baseAt || '',
  ]]);
  if (next.baseAt) sh.getRange(row, 5).setNumberFormat('yyyy-MM-dd HH:mm');
  SpreadsheetApp.flush();
  return getKisSetting_(month);
}

// 월 누적 + 일별 합계
function getKisMonthTotal_(month) {
  const setting = getKisSetting_(month);
  const data = kisRecordSheet_().getDataRange().getValues();
  let total = setting.base === null ? 0 : setting.base;
  const dailyMap = {};
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (monthKey_(r[1]) !== month) continue;
    if (String(r[6] || '').indexOf('테스트') !== -1) continue;       // TEST_MODE 발송은 집계 제외
    const t = r[0] instanceof Date ? r[0] : new Date(r[0]);
    if (setting.baseAt && t.getTime() <= setting.baseAt.getTime()) continue; // 시작값에 이미 포함
    const q79 = Number(r[3]) || 0;
    total += q79;
    const d = isNaN(t.getTime()) ? '(날짜없음)' : ymd_(t);
    if (!dailyMap[d]) dailyMap[d] = { date: d, qty79: 0, qtyAll: 0, rows: 0, sends: 0 };
    dailyMap[d].qty79 += q79;
    dailyMap[d].qtyAll += Number(r[4]) || 0;
    dailyMap[d].rows += Number(r[5]) || 0;
    dailyMap[d].sends++;
  }
  const daily = Object.keys(dailyMap).sort().map(k => dailyMap[k]);
  return { setting, total, daily };
}

function kisStatus_(total, s) {
  if (s.free === null) return { code: 'none', mark: '⚪', label: '무상수량 미입력', bg: '#e0e0e0' };
  if (total > s.free + s.margin) return { code: 'over', mark: '🔴', label: '초과 — 무상+여유 넘음, 로젠 직접발송', bg: '#ffcdd2' };
  if (total >= s.free) return { code: 'margin', mark: '🟡', label: '무상 소진 — 여유 구간', bg: '#fff9c4' };
  return { code: 'ok', mark: '🟢', label: '무상 범위 안', bg: '#c8e6c9' };
}

function kisSummaryText_(month, total, s) {
  if (s.free === null) return `• 월: ${month}\n• 누적 79*70: ${total}박스\n• KIS 무상수량: 미입력`;
  return `• 월: ${month}\n• KIS 무상전표: ${s.free}박스 (+여유 ${s.margin}박스 = 한도 ${s.free + s.margin}박스)\n` +
    `• 에이스아이피 누적 79*70: ${total}박스\n` +
    `• 무상까지 남음: ${Math.max(0, s.free - total)}박스 / 한도까지 남음: ${s.free + s.margin - total}박스`;
}

function sendKisAlert_(subject, body) {
  const url = SpreadsheetApp.getActiveSpreadsheet().getUrl();
  getWatchAlertEmails_().forEach(to => { try { GmailApp.sendEmail(to, subject, body + '\n\n시트 바로가기: ' + url); } catch (e) {} });
  try { sendKakaoTalk(subject + '\n' + body); } catch (e) {}
}

// ── sendToAceIP 발송 성공 직후 호출 ──
//   rows = getRowsToSend().rows  ([2열, 수량, 받는분성명, ...])
function recordKisSend_(sheetName, rows, method) {
  let q79 = 0, qAll = 0;
  rows.forEach(r => { const q = qtyOf_(r[1]); qAll += q; if (isKisItem_(r[0])) q79 += q; });

  const isTest = !!CONFIG.TEST_MODE;
  const before = getKisMonthTotal_(sheetName);
  const s = before.setting;
  const after = isTest ? before.total : before.total + q79;
  const stBefore = kisStatus_(before.total, s);
  const st = kisStatus_(after, s);

  const sh = kisRecordSheet_();
  const row = sh.getLastRow() + 1;
  sh.getRange(row, 2).setNumberFormat('@');
  sh.getRange(row, 1, 1, KIS_RECORD_HEADERS.length).setValues([[
    new Date(), sheetName, sheetName, q79, qAll, rows.length,
    isTest ? method + '(테스트·미집계)' : method, after, st.mark + ' ' + st.label,
  ]]);
  sh.getRange(row, 1).setNumberFormat('yyyy-MM-dd HH:mm');
  sh.getRange(row, 9).setBackground(st.bg);
  SpreadsheetApp.flush();

  if (isTest || q79 === 0) return;
  // 🟡 은 처음 들어설 때 한 번, 🔴 은 초과 상태에서 79*70 을 또 보낼 때마다 경보
  if (st.code === 'over') {
    const overBy = after - (s.free + s.margin);
    sendKisAlert_(`[스카이티제이] 🔴 KIS 무상전표 한도 초과 — ${sheetName} (${overBy}박스 초과)`,
      `오늘 에이스아이피로 79*70 ${q79}박스를 보내 월 누적이 무상+여유 한도를 넘었습니다.\n\n` +
      kisSummaryText_(sheetName, after, s) +
      `\n\n[조치] 이번 달 남은 79*70 은 사무실에서 로젠택배로 직접 발송하세요.\n` +
      `14:50 자동발송 전에 해당 행 C열을 노란색으로 바꾸면 에이스아이피 발송에서 빠집니다.`);
  } else if (st.code === 'margin' && stBefore.code !== 'margin') {
    sendKisAlert_(`[스카이티제이] 🟡 KIS 무상전표 소진 — ${sheetName} (여유 ${s.margin}박스 구간)`,
      `월 누적 79*70 이 KIS 무상수량에 도달했습니다. 지금부터는 여유 구간입니다.\n\n` +
      kisSummaryText_(sheetName, after, s) +
      `\n\n한도(무상+여유)를 넘기 전에 로젠 직접발송 준비를 해주세요.`);
  }
}

// 오늘 14:50에 에이스아이피로 나갈 예정인 79*70 (C열 무색 행)
function getKisPending_(sheet) {
  const { rows, sheetRows } = getRowsToSend(sheet);
  const items = [];
  let qty = 0;
  rows.forEach((r, i) => {
    if (!isKisItem_(r[0])) return;
    const q = qtyOf_(r[1]); qty += q;
    items.push({ row: sheetRows[i], name: String(r[2] || ''), qty: q });
  });
  return { qty, items };
}

// ── 14:00 사전점검: 오늘 대기분까지 보내면 여유 구간/초과인지 미리 경보 ──
function kisPrecheck() {
  const decision = getDeliveryDecision_(new Date());
  if (!decision.canSend) return;
  const sheet = getLatestSheet(SpreadsheetApp.getActiveSpreadsheet());
  if (!sheet) return;
  const month = sheet.getName().trim();
  const sum = getKisMonthTotal_(month);
  const s = sum.setting;
  if (s.free === null) {
    sendKisAlert_(`[스카이티제이] ⚪ ${month} KIS 무상전표 수량 미입력`,
      `이번 달 KIS 무상전표 수량이 아직 입력되지 않아 79*70 초과 여부를 판단할 수 없습니다.\n` +
      `시트 메뉴 📦 용지발송 → 🏦 KIS 무상전표 수량 입력 에서 입력해주세요.\n\n` +
      kisSummaryText_(month, sum.total, s));
    return;
  }
  const pend = getKisPending_(sheet);
  if (!pend.qty) return;
  const after = sum.total + pend.qty;
  const st = kisStatus_(after, s);
  if (st.code === 'ok') return;

  const limit = s.free + s.margin;
  const list = pend.items.slice(0, 40).map(it => `• ${it.row}행  ${it.name}  ${it.qty}박스`).join('\n') +
    (pend.items.length > 40 ? `\n... 외 ${pend.items.length - 40}건` : '');
  if (st.code === 'over') {
    const room = Math.max(0, limit - sum.total);
    sendKisAlert_(`[스카이티제이] 🔴 오늘 79*70 그대로 보내면 한도 초과 — ${month}`,
      `14:50 자동발송 대기 중인 79*70 이 ${pend.qty}박스입니다. 그대로 보내면 누적 ${after}박스로 한도(${limit}박스)를 ${after - limit}박스 넘습니다.\n` +
      `에이스아이피로 더 보낼 수 있는 양: ${room}박스\n\n` +
      kisSummaryText_(month, sum.total, s) +
      `\n\n[대기 중인 79*70]\n${list}\n\n` +
      `[조치] 로젠으로 돌릴 행의 C열을 14:50 전에 노란색으로 바꾸고 사무실에서 로젠택배로 발송하세요.\n` +
      `(아무것도 안 하면 지금처럼 전부 에이스아이피로 발송됩니다.)`);
  } else {
    sendKisAlert_(`[스카이티제이] 🟡 오늘 발송분으로 KIS 무상전표 소진 — ${month}`,
      `14:50 자동발송 대기 중인 79*70 ${pend.qty}박스를 보내면 누적 ${after}박스로 무상수량(${s.free}박스)을 넘어 여유 구간에 들어갑니다.\n` +
      `한도(${limit}박스)까지는 ${limit - after}박스 남습니다.\n\n` +
      kisSummaryText_(month, sum.total, s) + `\n\n[대기 중인 79*70]\n${list}`);
  }
}

function setupKisPrecheckTrigger() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'kisPrecheck').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('kisPrecheck').timeBased().everyDays(1)
    .atHour(CONFIG.KIS_PRECHECK_HOUR).nearMinute(CONFIG.KIS_PRECHECK_MINUTE).create();
  kisSettingSheet_(); kisRecordSheet_();
  const hm = ('0' + CONFIG.KIS_PRECHECK_HOUR).slice(-2) + ':' + ('0' + CONFIG.KIS_PRECHECK_MINUTE).slice(-2);
  SpreadsheetApp.getUi().alert('KIS 사전점검 트리거 설정 완료',
    `발송일마다 ${hm}쯤 오늘 대기 중인 79*70 을 보내면 무상수량/한도를 넘는지 점검해 경보합니다.`,
    SpreadsheetApp.getUi().ButtonSet.OK);
}

function kisDefaultMonth_() {
  const sheet = getLatestSheet(SpreadsheetApp.getActiveSpreadsheet());
  return sheet ? sheet.getName().trim() : Utilities.formatDate(new Date(), 'Asia/Seoul', 'yy.MM');
}

// ── 메뉴: KIS 무상전표 수량 입력 ──
function kisInputFree() {
  const ui = SpreadsheetApp.getUi();
  const defMonth = kisDefaultMonth_();
  const cur = getKisSetting_(defMonth);
  const r1 = ui.prompt('🏦 KIS 무상전표 수량 입력',
    `대상 월: ${defMonth}\n현재 값: ${cur.free === null ? '미입력' : cur.free + '박스'} / 여유 ${cur.margin}박스\n\n` +
    `이번 달 KIS 무상전표(79*70) 수량을 박스 단위 숫자로 입력하세요.\n` +
    `다른 달이면 "26.12 300" 처럼 월을 앞에 붙이세요.`, ui.ButtonSet.OK_CANCEL);
  if (r1.getSelectedButton() !== ui.Button.OK) return;
  const m = r1.getResponseText().trim().match(/^(?:(\d{2}\.\d{2})\s+)?(\d+)$/);
  if (!m) { ui.alert('입력 확인', '숫자만 입력하세요. 예) 300  또는  26.12 300', ui.ButtonSet.OK); return; }
  const month = m[1] || defMonth;
  const free = Number(m[2]);
  const cur2 = getKisSetting_(month);

  const r2 = ui.prompt('여유 박스',
    `KIS 무상수량을 넘은 뒤에도 에이스아이피로 보낼 여유(박스)입니다.\n` +
    `지금 값: ${cur2.margin}박스 — 그대로 두려면 비워두고 확인.`, ui.ButtonSet.OK_CANCEL);
  let margin = cur2.margin;
  const t2 = r2.getResponseText().trim();
  if (r2.getSelectedButton() === ui.Button.OK && t2) {
    if (!/^\d+$/.test(t2)) { ui.alert('입력 확인', '여유 박스는 숫자만 입력하세요. (무상수량도 저장하지 않았습니다)', ui.ButtonSet.OK); return; }
    margin = Number(t2);
  }
  saveKisSetting_(month, { free, margin });
  const sum = getKisMonthTotal_(month);
  const st = kisStatus_(sum.total, sum.setting);
  ui.alert('저장했습니다', kisSummaryText_(month, sum.total, sum.setting) + `\n\n상태: ${st.mark} ${st.label}`, ui.ButtonSet.OK);
}

// 월 시트에서 노란색(발송완료) 79*70 합계 — 기능 도입 전 이미 보낸 양 계산용
function countSentKisFromSheet_(sheet) {
  const data = sheet.getDataRange().getValues();
  const out = { total: 0, rows: 0, byDate: {} };
  if (data.length < 2) return out;
  const headers = data[0].map(h => String(h).trim());
  const c품 = findCol(headers, '2열'), c수 = findCol(headers, '수량'), c명 = findCol(headers, '받는분성명'), c날 = findCol(headers, '1열');
  const bgs = sheet.getRange(2, 3, data.length - 1, 1).getBackgrounds();
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!String(r[c명] || '').trim()) continue;
    if (!isYellowColor(String((bgs[i - 1] && bgs[i - 1][0]) || '').toLowerCase().trim())) continue;
    if (!isKisItem_(c품 >= 0 ? r[c품] : '')) continue;
    const q = qtyOf_(r[c수]);
    out.total += q; out.rows++;
    const d = c날 >= 0 ? (r[c날] instanceof Date ? Utilities.formatDate(r[c날], 'Asia/Seoul', 'MM/dd') : String(r[c날] || '').trim()) : '';
    const k = d || '(날짜없음)';
    out.byDate[k] = (out.byDate[k] || 0) + q;
  }
  return out;
}

// ── 메뉴: 이번 달 이미 보낸 79*70 계산 → 시작값 저장 ──
function kisRecalcBase() {
  const ui = SpreadsheetApp.getUi();
  const sheet = getLatestSheet(SpreadsheetApp.getActiveSpreadsheet());
  if (!sheet) { ui.alert('시트 없음', 'yy.mm 형식 시트를 찾지 못했습니다.', ui.ButtonSet.OK); return; }
  if (String(sheet.getRange(1, 3).getValue() || '').trim() !== COLOR_COL_HEADER) {
    ui.alert('열 구조 확인', `C열 헤더가 '${COLOR_COL_HEADER}'가 아니라 색 판정을 믿을 수 없습니다. 열 순서를 바로잡은 뒤 다시 실행하세요.`, ui.ButtonSet.OK);
    return;
  }
  const month = sheet.getName().trim();
  const c = countSentKisFromSheet_(sheet);
  const dates = Object.keys(c.byDate).sort();
  const byDateTxt = dates.slice(0, 25).map(d => `${d}: ${c.byDate[d]}박스`).join('\n') + (dates.length > 25 ? '\n...' : '');
  const r = ui.prompt(`🔢 ${month} 이미 보낸 79*70 계산`,
    `시트 [${month}]의 노란색(발송완료) 79*70: ${c.rows}행 · ${c.total}박스\n\n${byDateTxt || '(없음)'}\n\n` +
    `이 값을 이번 달 시작값으로 저장합니다. (지금 이후 발송분은 자동 기록으로 더해짐)\n` +
    `로젠 직접발송 등 에이스아이피가 아닌 곳으로 보낸 79*70 이 섞여 있으면 뺀 숫자를 입력하세요.\n` +
    `그대로 저장하려면 비워두고 확인.`, ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const t = r.getResponseText().trim();
  if (t && !/^\d+$/.test(t)) { ui.alert('입력 확인', '숫자만 입력하세요. 저장하지 않았습니다.', ui.ButtonSet.OK); return; }
  const base = t ? Number(t) : c.total;
  saveKisSetting_(month, { base, baseAt: new Date() });
  const sum = getKisMonthTotal_(month);
  const st = kisStatus_(sum.total, sum.setting);
  ui.alert('시작값 저장', kisSummaryText_(month, sum.total, sum.setting) + `\n\n상태: ${st.mark} ${st.label}`, ui.ButtonSet.OK);
}

// ── 메뉴: KIS 무상전표 현황 (일별·월누적) ──
function kisShowStatus() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getLatestSheet(ss);
  const month = kisDefaultMonth_();
  const sum = getKisMonthTotal_(month);
  const s = sum.setting;
  const st = kisStatus_(sum.total, s);
  const pend = sheet ? getKisPending_(sheet) : { qty: 0, items: [] };
  const afterPend = sum.total + pend.qty;
  const stPend = kisStatus_(afterPend, s);

  // 79*70 으로 판정 안 된 품명 (판정 규칙 점검용)
  const others = {};
  if (sheet) {
    const data = sheet.getDataRange().getValues();
    const headers = (data[0] || []).map(h => String(h).trim());
    const c품 = findCol(headers, '2열'), c명 = findCol(headers, '받는분성명');
    for (let i = 1; i < data.length; i++) {
      if (!String(data[i][c명] || '').trim()) continue;
      const p = c품 >= 0 ? String(data[i][c품] || '').trim() : '';
      if (isKisItem_(p)) continue;
      const k = p || '(품명 빈칸)';
      others[k] = (others[k] || 0) + 1;
    }
  }

  let cum = s.base === null ? 0 : s.base;
  const dailyRows = [];
  if (s.base !== null) {
    dailyRows.push(`<tr><td>시작값${s.baseAt ? ' (~' + Utilities.formatDate(s.baseAt, 'Asia/Seoul', 'MM/dd HH:mm') + ')' : ''}</td><td class="n">${s.base}</td><td class="n">-</td><td class="n">${cum}</td></tr>`);
  }
  sum.daily.forEach(d => {
    cum += d.qty79;
    const c = kisStatus_(cum, s);
    dailyRows.push(`<tr style="background:${c.bg}"><td>${escHtml_(d.date)}</td><td class="n">${d.qty79}</td><td class="n">${d.qtyAll}</td><td class="n">${cum}</td></tr>`);
  });

  const limit = s.free === null ? null : s.free + s.margin;
  const card = (label, val, sub, bg) => `<div class="card" style="background:${bg || '#f8f9fa'}"><div class="l">${label}</div><div class="v">${val}</div><div class="s">${sub || ''}</div></div>`;
  const pendHtml = pend.qty
    ? `<p style="background:${stPend.bg};padding:8px;border-radius:6px">오늘 14:50 대기 중 79*70: <b>${pend.qty}박스</b> (${pend.items.length}행) → 보내면 누적 <b>${afterPend}박스</b> ${stPend.mark} ${escHtml_(stPend.label)}` +
      (stPend.code === 'over' ? `<br>한도까지 에이스로 보낼 수 있는 양: <b>${Math.max(0, limit - sum.total)}박스</b> — 나머지는 C열 노란색 처리 후 로젠 직접발송` : '') + `</p>` +
      `<details><summary>대기 중인 79*70 행 보기</summary><table><tr><th>행</th><th>가맹점</th><th>박스</th></tr>` +
      pend.items.map(it => `<tr><td>${it.row}</td><td>${escHtml_(it.name)}</td><td class="n">${it.qty}</td></tr>`).join('') + `</table></details>`
    : `<p style="color:#5f6368">오늘 대기 중인 79*70 없음</p>`;
  const otherKeys = Object.keys(others);

  const html = HtmlService.createHtmlOutput(
    '<style>body{font-family:Arial,"Noto Sans KR",sans-serif;padding:12px;font-size:13px}' +
    '.cards{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:10px}' +
    '.card{border-radius:8px;padding:10px}.l{font-size:11px;color:#5f6368}.v{font-size:20px;font-weight:bold}.s{font-size:11px;color:#5f6368}' +
    'table{border-collapse:collapse;width:100%;margin-top:6px}th,td{border:1px solid #dadce0;padding:5px 7px;text-align:left}th{background:#f1f3f4}.n{text-align:right}' +
    'h4{margin:14px 0 4px}</style>' +
    `<h3 style="margin:0 0 8px">${st.mark} ${escHtml_(month)} KIS 무상전표 — ${escHtml_(st.label)}</h3>` +
    '<div class="cards">' +
    card('KIS 무상전표', s.free === null ? '미입력' : s.free + '박스', '여유 ' + s.margin + '박스' + (limit === null ? '' : ' · 한도 ' + limit + '박스')) +
    card('에이스 누적 79*70', sum.total + '박스', s.base === null ? '발송 기록 합계' : '시작값 ' + s.base + ' 포함', st.bg) +
    card('무상까지 남음', s.free === null ? '-' : Math.max(0, s.free - sum.total) + '박스', '') +
    card('한도까지 남음', limit === null ? '-' : (limit - sum.total) + '박스', '무상+여유 기준') +
    '</div>' + pendHtml +
    '<h4>일별 에이스아이피 발송 (박스)</h4>' +
    '<table><tr><th>날짜</th><th>79*70</th><th>전체수량</th><th>월누적</th></tr>' +
    (dailyRows.join('') || '<tr><td colspan="4" style="color:#5f6368">이번 달 기록 없음 — "이번 달 이미 보낸 79*70 계산"으로 시작값을 넣으세요</td></tr>') + '</table>' +
    (otherKeys.length ? `<h4>79*70 으로 세지 않은 품명 (${escHtml_(month)} 시트)</h4><p style="font-size:11px;color:#5f6368;margin:0">여기에 79*70 이 보이면 품명 표기가 달라서 빠진 것입니다.</p><table>` +
      otherKeys.map(k => `<tr><td>${escHtml_(k)}</td><td class="n">${others[k]}행</td></tr>`).join('') + '</table>' : '')
  ).setWidth(520).setHeight(640);
  SpreadsheetApp.getUi().showModalDialog(html, '📊 KIS 무상전표 현황');
}
