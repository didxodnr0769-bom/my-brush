# OS별 개발·검증 절차

2026-10-27 Electron 전환 기준. 명령은 저장소 루트에서 실행한다. 준비된 명령과 실제 실행 결과를 구분하며 최신 증거는 `docs/design/native-verification.md`에서 확인한다.

## 시작

- `AGENTS.md`, `.agents/README.md`와 관련 문서를 읽는다. `git status --short --branch`, `git remote -v`를 확인하고 로컬 변경을 보존한다. 원격 갱신·커밋·푸시는 요청받은 범위에서만 한다.
- OS·아키텍처·Node.js·npm 버전을 확인한다. Node.js 조건은 `package.json`의 `engines`, 의존성은 `package-lock.json`을 따른다. 다른 OS의 `node_modules/`·Electron 바이너리는 재사용하지 않는다.
- Python 가상환경·Qt 설치는 필요하지 않다. 이전 My Brush의 전역키 점유 가능성을 확인한다. 종료 시 필기가 사라지므로 무관한 프로세스를 일괄 종료하지 않는다.

## 설치·실행

macOS 터미널과 Windows PowerShell에서 같은 npm 명령을 사용한다.

```sh
npm ci
npm start
```

간편 실행은 macOS `run-mac.command`, Windows `run-windows.cmd`다. 별도 웹 개발 서버는 띄우지 않는다. `npm start -- --start-hidden`은 OFF로 시작하며 두 번째 실행은 기존 앱의 필기 화면을 표시한다.

외부 `ELECTRON_RUN_AS_NODE` 환경변수가 Electron GUI 실행을 막는지 확인한다. 오류를 숨기거나 Python 앱으로 대체하지 않는다.

## 검사·빌드

```sh
npm test
npm run test:pointer
npm run pack
npm run dist
```

- `test`: 순수 로직·설정 자동 검사. 실제 전역키·IME·화면 합성을 입증하지 않는다.
- `pack`: 현재 OS의 설치 전 실행 가능한 앱 디렉터리 생성.
- `dist`: macOS 배포 파일 또는 Windows NSIS 설치 파일 생성. 산출 디렉터리는 `dist/electron/`이며 아키텍처별 경로는 `package.json` 및 빌드 출력으로 확인한다.
- Windows 폴더 결과물을 옮길 때 exe와 의존성을 함께 유지한다. Windows 실제 설치·실행 검증은 Windows에서 한다.
- macOS 로컬 빌드·ad hoc 서명과 배포용 서명·공증은 구분한다. 새 번들을 실행하기 전 기존 단일 인스턴스 여부를 확인한다.

## 실제 앱에서 확인

1. 다른 앱 위 투명 화면·도구 막대와 빈 영역의 펜·사각형 그리기.
2. 다른 앱 사용 중 macOS **Control+Command+Tab**, Windows **Control+Shift+Space**로 ON/OFF. OFF 유지·일반 앱 조작·재표시 시 필기 유지.
3. 실제 Control+왼쪽 드래그의 일부 교차·복수 전체 삭제, 빈 사각형 내부 제외, Ctrl 선해제·Esc·포커스 상실 취소.
4. 실제 한글 IME 조합·후보, Enter 줄바꿈·Ctrl+Enter 완료·Esc 취소, 기존 텍스트 크기 변경. 붙여넣기·합성 composition 이벤트로 실제 IME 성공을 대신하지 않는다.
5. 단축키 변경·중복·OS 등록 실패 시 기존 조합 유지·재시작 후 복원, 최초 등록 실패 시 메뉴 대체 진입.
6. OFF 후 다른 앱 포커스, 여러 모니터·배율·전체 화면 앱에서 표시·입력.
7. 소스와 패키징 앱을 각각 확인한다. Qt의 검사·사용자 확인을 현재 결과로 복사하지 않는다.

## 마칠 때

- `docs/design/native-verification.md`에 날짜·OS·아키텍처·검사 방식·실제 확인·미검증을 구분해 기록한다. `output/native/verification.json`도 같은 경계를 유지한다.
- 새 결정·함정은 `.agents` 담당 문서에, 제품 범위·일반 사용법은 기존 담당 문서에 반영한다.
- 문서만 수정했다면 앱 테스트·재빌드를 반복할 필요는 없다. `git diff --check`, 링크·소스 경로를 확인한다.
- 생성물·개인 기록 제외를 유지한다. 커밋·푸시는 명시적으로 요청받은 경우에만 수행한다.
