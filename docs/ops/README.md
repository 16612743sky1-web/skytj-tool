# 운영·백업 기준

이 저장소와 클로드 자동작업을 **어떻게 지키고, 기록하고, 점검하는지** 적어 둔 문서.
(공개 저장소이므로 시트 ID·메일주소·가맹점 정보는 여기에 쓰지 않는다.)

## 1. 백업 — "한 군데에만 있으면 안 된다"

| 무엇 | 1차 보관 | 2차 보관 (자동) |
|---|---|---|
| 도구 코드·문서 (이 저장소) | **GitHub** (`main` + 작업 브랜치) | **Google Drive** `내 드라이브 > Claude 백업 (skytj)` 에 매주 `git bundle` (전체 변경이력 포함 1파일) |
| 자동작업(예약 작업) 지시문 | Anthropic 서버 (예약 작업 목록) | **Google Drive** 같은 폴더에 매주 `예약작업-YYYY-MM-DD.md` (비공개 — 시트 ID 등이 들어 있어 GitHub 에는 올리지 않음) |
| 용지관리 Apps Script | 구글시트 Apps Script 편집기 (실제 키 포함) | 이 저장소 `apps-script/` (키는 자리표시) |
| 세션 대화 요약 | `docs/sessions/` (이 저장소 → GitHub·Drive 로 같이 백업) | — |

- Cloudflare R2 는 지금은 쓰지 않는다. GitHub + Drive 두 곳이면 충분하고, R2 는 API 키 관리가 하나 더 늘어난다.
  필요해지면 키를 환경의 네트워크 시크릿으로 넣고 주간 점검에 업로드 단계만 추가한다.
- **복구하는 법:** Drive 에서 `.bundle` 을 받아 `git clone skytj-tool-YYYY-MM-DD.bundle skytj-tool` → 전체 이력 그대로 복원.

## 2. git

- 클라우드 세션에는 git 이 기본 설치돼 있다 (2026-11-25 기준 2.43).
- 내 PC(Windows)에서 직접 받을 때: PowerShell 에서 `winget install --id Git.Git -e` → 새 창에서 `git --version` 확인.
  그다음 `git clone https://github.com/16612743sky1-web/skytj-tool`.
- 작업은 `claude/...` 브랜치에서 하고, **`main` 에 합쳐야 라이브(GitHub Pages)에 반영**된다 (README "배포하는 법").

## 3. 대화 기록 (세션은 30일 뒤 사라짐)

- 한 세션에서 길게 이어가도 auto-compact 로 계속되지만, **대화 자체는 30일 후 사라진다.**
- 그래서 의미 있는 작업을 끝낼 때마다 `docs/sessions/YYYY-MM-DD-<주제>.md` 에 요약을 남긴다
  (무엇을 했나 · 결정한 것 · 남은 일 · 관련 커밋/PR). 형식은 `docs/sessions/README.md`.
- 계획서는 계속 `docs/plans/` 에 둔다. 세션 기록은 "무엇을 했나", 계획서는 "왜/어떻게".

## 4. 작업 환경 (ADE)

- 기본: **Claude 데스크톱 앱** (GUI 라 보기 편함, Remote Control 로 PC 폴더 연결 — 수금방 점검이 이 방식).
- 휴대폰: Claude 앱 (클라우드 세션 + 예약 작업 알림).
- orca·herdr 같은 다른 에이전트 환경은 지금은 도입하지 않는다 (관리 포인트만 늘어남).

## 5. 주간 점검 (예약 작업 "주간 세팅점검·백업")

매주 월요일 아침 자동 실행 → 결과를 휴대폰 알림으로 보냄.
1. 저장소 백업 — `git bundle` 을 Drive 폴더에 올림 (최근 8개만 유지, 오래된 것은 휴지통)
2. 예약 작업 지시문 백업 — 전체 목록을 md 로 Drive 에 올림
3. 예약 작업 상태 — 꺼진 것·실패한 것·크레딧 부족으로 멈춘 것
4. 저장소 상태 — `main` 에 안 합쳐진 브랜치(= 아직 라이브 아님), 공개 저장소에 키·메일·전화번호가 새로 들어갔는지
5. 세션 기록 — 최근 7일 커밋이 있는데 `docs/sessions/` 기록이 없으면 알림
