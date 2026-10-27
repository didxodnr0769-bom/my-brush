# My Brush Agent Instructions

- 사용자에게는 한국어로 설명한다. 사용자의 최신 지시가 아래 기록보다 우선한다.
- 작업 전 `.agents/README.md`와 관련 지식·작업 절차를 읽는다. 다른 컴퓨터에서 이어갈 때는 현재 OS, Git 상태, Node.js·npm 환경부터 확인한다.
- 제품 범위는 `docs/requirements/first-version.md`, 조작 설계는 `docs/design/interaction-design.md`, 검증 사실은 `docs/design/native-verification.md`가 관리한다. Agent 메모가 이를 대체하지 않는다.
- 실제 제품은 Electron 데스크톱 화면 오버레이다. `electron/main.cjs`가 실행 진입점이며 `preview/index.html`은 이전 시안이다. Python 런타임을 다시 요구하지 않는다.
- macOS에서 성공한 실행·빌드·입력을 Windows에서 확인한 것으로 보고하지 않는다. 자동 검사와 실제 전역키·IME·화면 합성 검증도 구분한다. 이전 Python·Qt 검증은 Electron 검증을 대체하지 않는다.
- 변경 후에는 해당 동작을 확인하고, 후속 Agent에게 필요한 결정·주의점만 `.agents`의 기존 담당 문서에 갱신한다.
