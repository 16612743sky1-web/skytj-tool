# 저장소 4개 정리 계획서 (2026-07-19)

## 목표
용도별로 뒤섞인 저장소를 "1 사업/용도 = 1 저장소"로 정리한다.

| 저장소 | 정리 후 용도 |
|---|---|
| skytj-tool | 회사업무 / 카드밴대리점 **전용** |
| petfocus-inventory | 한우 강아지간식 제조·통신판매 **전용** (펫포커스 도구 모음) |
| osaka-trip | 개인 여행 (변경 없음) |
| desktop-tutorial | 안 쓰는 튜토리얼 찌꺼기 (삭제는 사용자가 직접) |

## 현재 문제
`skytj-tool`이 회사 전용이 아니라 잡동사니 창고가 됨 — 펫포커스 도구 2종 + 마케팅 문서 + 개인 대시보드까지 섞여 있음.

## 바꿀 파일 (이동)

### skytj-tool → petfocus-inventory 로 이동
- `petfocus/` (재고/원가 앱 + GUIDELINES.md) → `petfocus-inventory/stock-cost/`
- `petfocus-detail/` (상세페이지 생성기 + GUIDELINES.md) → `petfocus-inventory/detail/`
- `docs/2026-07-17-petfocus-detail-page-prompt-generator.md` → `petfocus-inventory/docs/`
- `docs/2026-07-17-pure-baby-chewing-tone-keep.md` → `petfocus-inventory/docs/`
- `docs/pure-baby-chewing-copy.md` → `petfocus-inventory/docs/`
- `.claude/skills/marketing/` → `petfocus-inventory/.claude/skills/marketing/`

### skytj-tool 에 남김 (회사 것)
- `index.html` (월말정산), `README.md`, `CLAUDE.md`(카드밴 전용으로 재작성),
  `.claude/`의 deploy-check·plan·deploy (공용 개발도구), `claude-usage/`(아래 참고)

## 방법
1. 각 저장소 브랜치 `claude/organize-github-repos-u5dwap`에서 작업.
2. petfocus-inventory 로 파일 복사 → 커밋/푸시.
3. skytj-tool 에서 해당 파일 제거. **단, 옛 URL 북마크가 끊기지 않도록 이동한 도구 자리에
   "새 주소로 자동 이동" 리다이렉트 index.html 을 남긴다** (제대로 이전 + 북마크 보호).
4. 양쪽 README/CLAUDE.md 를 새 구조에 맞게 수정.
5. petfocus-inventory 는 다도구 저장소가 되므로 루트에 README 신규 작성.
   기존 `현장재고`(index.html)는 루트 유지 → **라이브 주소 안 바뀜**.

## 내용 청소 (위치 이동만으론 부족 — 파일 안 내용도 섞임)

사용자 지적으로 추가 확인함. 아래는 내용까지 고친다:

- `skytj-tool/CLAUDE.md` → 카드밴(월말정산) 전용으로 재작성. 펫포커스 사업 컨텍스트/단가/재고규칙은
  petfocus-inventory 로 이관.
- `skytj-tool/README.md` → 카드밴 + 개인 claude-usage 만 남기고 재작성.
- `.claude/skills/deploy-check` → skytj판은 정산·claude-usage 만 점검. petfocus 점검 항목은
  petfocus-inventory 로 복사해 그 저장소용으로 수정.
- `.claude/commands/deploy.md`·`plan.md` → skytj판에서 petfocus 특화 문구 제거.
  petfocus-inventory 에 같은 커맨드의 펫포커스판을 둔다.
- `petfocus-detail/GUIDELINES.md` → 하드코딩된 옛 주소를 새 주소로 수정.
- `petfocus-inventory` → 다도구 저장소가 되므로 루트 README 신규 + 펫포커스 사업 컨텍스트 반영.
- osaka-trip 내부는 여행 내용만 확인됨 → 손대지 않음.

## 미결정 → 확정됨
- 펫포커스 앱 2개: **둘 다 보관** (사용자 승인).
- claude-usage: **skytj-tool 에 유지** (회사 PC 표시용, 사용자 승인). README에 개인용 표기.

## (구) 미결정 (사용자 확인 필요)
- **펫포커스 재고앱 2개**: `현장재고`(루트, 실제 클라우드 연결됨)와 `재고/원가`(stock-cost, 클라우드 미설정)를
  **둘 다 보관**. 나중에 하나로 합치거나 폐기 결정. 지금은 아무것도 안 지움.
- **claude-usage(개인 대시보드)**: 회사도 펫포커스도 아님. 일단 skytj-tool 에 그대로 두되
  README에 "개인용"으로 표기. (원하면 나중에 별도/삭제)

## 리스크
- 옛 라이브 주소(`github.io/skytj-tool/petfocus/` 등) 변경 → 3번 리다이렉트로 완화.
- 저장소 간 이동이라 git 이력은 이어지지 않음(파일은 그대로, 커밋 히스토리만 새로 시작).
- desktop-tutorial 저장소 삭제는 권한 밖 → 사용자에게 방법 안내만.

## 검증
- 각 HTML 을 Playwright(chromium)로 열어 콘솔 오류·핵심 흐름 점검.
- 리다이렉트 stub 이 새 주소로 잘 넘어가는지 확인.
- 각 저장소 `git status`로 의도한 파일만 바뀌었는지 확인.
