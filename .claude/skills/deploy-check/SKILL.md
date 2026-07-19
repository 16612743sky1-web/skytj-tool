---
name: deploy-check
description: skytj-tool의 정적 HTML 도구(월말정산 index.html, claude-usage)를 수정한 뒤 GitHub Pages에 올리기 전 점검하는 체크리스트. "배포", "올려줘", "커밋", "확인해줘", HTML 수정 마무리 시점에 사용.
---

# 배포 전 점검 (deploy-check)

skytj-tool은 서버 없이 정적 HTML만으로 GitHub Pages에 배포된다.
빌드 과정이 없어서 문법 실수나 깨진 화면이 그대로 라이브로 나간다.
그래서 커밋/푸시 전에 아래를 반드시 확인한다.

> 이 저장소는 **회사업무(카드밴대리점) 도구** 전용이다.
> `index.html`(스카이티제이 월말정산)과 `claude-usage/`(개인 사용량 대시보드)만 있다.
> 펫포커스 도구는 별도 저장소(`petfocus-inventory`)로 이관됨. `petfocus/`·`petfocus-detail/`에
> 남은 것은 옛 주소를 새 주소로 넘겨주는 **리다이렉트 페이지**뿐이다.

## 1. 무엇을 고쳤는지 먼저 확인
- `git status` 와 `git diff` 로 실제 바뀐 파일과 내용을 본다.
- 의도한 파일만 바뀌었는지 확인한다. (실수로 다른 도구 파일을 건드리지 않았는지)

## 2. 브라우저로 실제 열어서 확인 (가장 중요)
자동 테스트가 없으므로 눈으로 확인하는 것이 유일한 안전장치다.
Playwright로 파일을 직접 열어 콘솔 오류와 핵심 흐름을 점검한다.
(executablePath: '/opt/pw-browsers/chromium')

- **콘솔에 빨간 오류(Error)가 없는지** — 있으면 배포 금지.
- 수정한 도구의 **핵심 흐름이 실제로 동작하는지**:
  - `index.html` (스카이티제이 월말정산): 에이스아이피 발송 파일 + 택배 기록 업로드 → 대사 결과·불일치·KIS 키핑재고 차감·최종 정산액 표시
  - `claude-usage/index.html`: 사용량 입력 → 링 게이지/카운트다운 표시 → PNG 저장
- 모바일 폭(390px)에서 레이아웃이 깨지지 않는지.

## 3. 리다이렉트 페이지를 건드렸다면
- `petfocus/index.html`·`petfocus-detail/index.html`은 새 주소로 넘겨주는 리다이렉트 stub이다.
  수정했다면 새 주소(`petfocus-inventory/stock-cost/`, `.../detail/`)로 실제로 이동하는지 확인한다.

## 4. 커밋 & 배포
위가 모두 통과하면:
- 명확한 한글 커밋 메시지로 커밋한다. (무엇을 왜 바꿨는지)
- 푸시하면 GitHub Pages가 자동 반영한다. 1~2분 뒤 실제 URL에서 다시 확인한다.

## 하지 말 것
- 확인 없이 "될 거예요" 하고 푸시하지 않는다.
- 콘솔 오류가 남아있는 채로 배포하지 않는다.
- 여러 도구를 한 커밋에 섞지 않는다. (한 커밋 = 한 가지 변경)
