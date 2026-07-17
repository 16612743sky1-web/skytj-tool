# skytj-tool

핸드폰/PC 브라우저에서 바로 쓰는 사내 관리 도구 모음. 서버 없이 정적 HTML로만 구성되며 **GitHub Pages**로 배포한다.

🔗 **라이브 주소:** https://16612743sky1-web.github.io/skytj-tool/

| 도구 | 주소 |
|---|---|
| 스카이티제이 월말 정산 | https://16612743sky1-web.github.io/skytj-tool/ |
| 펫포커스 재고/원가 관리 | https://16612743sky1-web.github.io/skytj-tool/petfocus/ |
| 펫포커스 상세페이지 생성기 | https://16612743sky1-web.github.io/skytj-tool/petfocus-detail/ |
| 클로드 사용량 대시보드 | https://16612743sky1-web.github.io/skytj-tool/claude-usage/ |

---

## 🚀 배포하는 법 (제일 자주 잊어버리는 것)

이 저장소는 **`main` 브랜치를 GitHub Pages가 자동으로 배포**한다.
→ **핵심 한 줄: 작업 내용을 `main`에 합치면(merge) 자동으로 배포된다.**

작업이 다른 브랜치(예: `claude/...`)에 있으면 **아직 라이브가 아니다.**
저장소 첫 화면에 `This branch is N commits ahead of main` 이라고 뜨면 → 아직 배포 안 됨.

### 순서

1. GitHub 저장소 화면에서 초록색 **`Contribute`** 버튼 → **`Open pull request`**
2. **`Create pull request`** → **`Merge pull request`** 클릭 (= `main`에 합쳐짐)
3. **1~2분 기다린 뒤** 라이브 주소를 새로고침
   - 화면이 안 바뀌면 **강력 새로고침**: `Ctrl`+`F5` (윈도우) / `Cmd`+`Shift`+`R` (맥)
   - 휴대폰은 브라우저를 완전히 껐다 켜거나 시크릿 창으로 확인

### 배포됐는지 확인

- 저장소 오른쪽 **`Deployments` → `github-pages`** 에 ✅ 초록불 + 방금 시각이면 성공.
- **`Actions`** 탭에서 `pages build and deployment` 이 초록불인지도 확인 가능.

> 💡 배포는 **파일을 고치는 것**이 아니라 **`main`에 합치는 것**이다.
> 파일만 고치고 브랜치에 두면 절대 라이브에 안 반영된다.

---

## 개발 메모

- **도구 1개 = HTML 파일 1개.** 빌드 도구·프레임워크·npm 의존성 없음.
- 데이터는 브라우저 `localStorage`에 저장 (서버 없음).
- 자세한 개발 원칙과 사업 컨텍스트는 [`CLAUDE.md`](./CLAUDE.md) 참고.
