# My Brush 개발·빌드 안내

실행 진입점은 `electron/main.cjs`이며 로컬 `electron/renderer/`를 로드합니다. `preview/index.html`은 이전 브라우저 시안입니다. 실제 앱의 실행이나 검증에 사용하지 않습니다.

## 준비와 소스 실행

Node.js 22.12 이상과 npm이 필요합니다. 정확한 조건은 `package.json`의 `engines`, 의존성 버전은 `package-lock.json`을 따릅니다. Python은 필요하지 않습니다.

저장소 루트에서 실행합니다.

```sh
npm ci
npm start
```

macOS의 `run-mac.command`, Windows의 `run-windows.cmd`도 같은 소스 앱을 실행합니다. macOS 스크립트는 현재 Node 버전이 낮으면 설치된 nvm의 24·22 버전을 순서대로 확인합니다. Windows 스크립트는 현재 활성 Node가 조건을 만족해야 합니다.

첫 의존성 설치에는 인터넷이 필요합니다. 설치 후 앱은 로컬 파일로 동작하며 별도 웹 개발 서버를 사용하지 않습니다. `ELECTRON_RUN_AS_NODE`가 설정되어 있으면 Electron GUI 실행을 방해할 수 있으므로 실행 환경을 확인합니다.

```sh
npm start -- --start-hidden
```

위 옵션은 필기를 끈 상태로 시작합니다. 이미 실행 중인 앱이 있으면 두 번째 실행은 기존 앱을 표시합니다. 검사는 임시 `MY_BRUSH_USER_DATA`를 사용해 일반 사용자 설정과 분리합니다.

## 검사

```sh
npm test
npm run test:electron
npm run test:pointer
npm audit --ignore-scripts
```

| 명령 | 검증 범위 |
|---|---|
| `test` | 기하·설정·단축키 실패 복구·renderer 상태·포인터 수명주기·진단 정보 제한 |
| `test:electron` | 데스크톱 세션에서 실제 Electron 창 입력, 전역키 등록·충돌, 설정 저장, 숨김·복귀 |
| `test:pointer` | 빠른 연속 입력과 통제된 release 전달 누락·지연 회귀 |
| `npm audit` | 조회 시점 레지스트리가 보고하는 알려진 의존성 취약점 |

`MY_BRUSH_EXECUTABLE`에 패키징 앱의 실행 파일을 지정하면 `test:pointer`를 해당 번들에 수행합니다. GUI 검사는 화면에 접근할 수 있는 환경이 필요합니다. 테스트 실행 시 도구·전역키를 사용할 수 있으므로 다른 앱과의 충돌도 확인합니다.

이 검사들은 다른 앱에서 누른 물리 전역키, 실제 한글 IME 조합·후보 선택, 바탕화면 합성·포커스 복귀, 모든 모니터 구성을 입증하지 않습니다. OS별 확인 결과는 [검증 기록](design/native-verification.md)에서 관리합니다.

## 앱 패키징

```sh
npm run pack
npm run dist
```

electron-builder가 현재 OS의 결과물을 `dist/electron/`에 생성합니다.

- `pack`: 설치 전 실행 가능한 앱 디렉터리
- `dist`: macOS DMG 또는 Windows NSIS 설치 파일

패키징 앱에는 Electron이 포함되므로 사용자가 Node.js나 Python을 설치할 필요는 없습니다. Windows 폴더 결과물은 실행 파일과 의존성을 함께 유지합니다. 다른 OS의 `node_modules`·바이너리를 재사용하지 않습니다.

앱 식별자는 `dev.mybrush.desktop`, 표시 이름은 `My Brush`입니다. 배포 포함물은 Electron 소스와 패키지 메타데이터로 제한합니다. 사용자 설정·진단·테스트 자료는 포함하지 않습니다.

현재 macOS 빌드는 배포용 서명·공증을 완료하지 않았습니다. `mac.identity`는 `null`, hardened runtime은 비활성 상태입니다. 로컬 실행·빌드 성공과 정식 배포 검증을 구분하세요. Windows의 실제 설치·빌드·입력 확인도 남아 있습니다.

## 관련 문서

- [앱 소개](../README.md) · [사용 안내](guide/usage.md)
- [요구사항](requirements/first-version.md) · [입력 설계](design/interaction-design.md)
