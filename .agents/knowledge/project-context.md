# 프로젝트 맥락과 구현 주의점

## 현재 상태

2026-10-27 사용자 요청으로 Python·Qt에서 Electron으로 전환한다. 비공개 원격은 `https://github.com/didxodnr0769-bom/my-brush`, 기본 브랜치는 `main`이다. 새 작업에서는 실제 원격·작업 트리 상태를 확인한다. 과거 Qt 구현 기준 커밋 `68da2d5`와 당시 검증 수치는 현재 Electron 결과가 아니다.

사용자는 macOS와 Windows 각각에서 같은 기능과 사용감으로 화면 필기를 하려 한다. 전체 ScreenBrush 복제·기기 간 동기화는 범위 밖이다. `preview/index.html`은 이전 조작 시안이며 실제 앱은 `electron/main.cjs`에서 로컬 렌더러를 로드한다. 별도 웹 개발 서버를 띄우지 않는다.

확정 기능은 자유 필기, 굵기, 색상, 단축키 설정, 사각형, 텍스트·글자 크기, Ctrl+드래그 영역 삭제다. 일부라도 겹치면 오브젝트 전체를 삭제하고 빈 사각형 내부만 선택하면 제외한다. 추가 도형·Undo/Redo·전체 지우기·내보내기는 자동으로 범위에 넣지 않는다.

## 코드 안내

| 담당 | 소스 |
|---|---|
| 진입·단일 인스턴스·투명 창·전역키·메뉴 | `electron/main.cjs` |
| 전역키 등록·설정 저장 실패 복구 | `electron/hotkeys.cjs` |
| 제한된 renderer/main 통신 | `electron/preload.cjs` |
| 도구 막대·필기·텍스트·설정 UI | `electron/renderer/index.html`, `styles.css`, `app.js` |
| 오브젝트와 교차 판정 | `electron/model.cjs` |
| 키 바인딩·설정 검증·저장·이전 | `electron/preferences.cjs` |
| 자동 검사 | `tests/*.test.cjs`, `package.json`의 `test` |
| 실행·패키징 | `package.json`, `run-mac.command`, `run-windows.cmd` |

Node.js 22.12 이상이 필요하며 정확한 조건은 `package.json`의 `engines`, 의존성 버전은 잠금 파일을 따른다. 소스 실행은 `npm ci` 후 `npm start`, 패키징은 electron-builder를 사용한다. Python·PySide6·PyInstaller는 현재 실행·빌드 의존성이 아니다.

## 유지할 입력·상태 규칙

- macOS 기본 전역 토글은 물리 **Control+Command+Tab**, Windows 기본값은 **Control+Shift+Space**다.
- ON/OFF는 필기 화면과 도구 막대를 함께 표시·숨긴다. OFF여도 앱·메뉴 막대/트레이는 살아 있다. 필기는 세션 메모리에 유지되지만 종료 시 사라진다.
- 단순 활성화·포커스 이벤트만으로 OFF를 해제하지 않는다. 전역 토글·메뉴·두 번째 실행은 명시적 진입이다.
- Ctrl+드래그·Ctrl+Enter의 Control을 Command로 바꾸지 않는다. `ctrlKey`는 물리 Control, `metaKey`는 macOS Command / Windows Win이다. 도구 키는 `event.code`로 물리 위치를 처리한다.
- macOS Control+왼쪽 클릭의 보조 클릭 취급과 컨텍스트 메뉴는 실제 앱에서 확인한다. 일반 오른쪽 클릭을 삭제로 처리하지 않는다.
- 글자 입력·IME 조합 중 도구 단축키가 문자를 가로채면 안 된다. Ctrl+Enter·Escape의 우선순위를 유지한다.
- 숨김 전 텍스트는 확정하고 미완료 그리기·삭제 제스처는 취소한다. 숨김 뒤 버튼 해제로 오브젝트가 확정되면 안 된다.
- 설정은 Electron `app.getPath('userData')` 아래 `preferences.json`에 저장한다. 새 파일이 없을 때만 이전 Qt 설정을 읽고 원본은 유지한다. OS별 이전 경로는 `electron/main.cjs`, 읽기·변환은 `electron/preferences.cjs`가 관리한다.
- renderer Node 통합을 켜지 않고 제한된 preload/IPC만 사용한다. 임의 파일 접근·외부 페이지 탐색을 추가하지 않는다.

## 검증 경계와 함정

- 현재 결과와 미검증은 `docs/design/native-verification.md`, `output/native/verification.json`을 따른다. 명령·코드가 있다는 사실을 실행 성공으로 보고하지 않는다.
- **2026-10-15 Qt 이력:** macOS 26.6.2·Apple Silicon에서 모델 20개와 위젯 34개, 총 54개가 통과했고 사용자가 실제 전역키 ON/OFF를 확인했다. Electron 검증을 대체하지 않는다.
- 기하 검사·renderer 입력 자동화와 OS 전역키·실제 한글 IME·다른 앱 위 합성·이전 앱 포커스 복귀는 별도 증거다.
- Windows 설치·exe 생성·전역키·입력·포커스는 Windows에서 실행하기 전까지 미검증이다. macOS 성공을 복사하지 않는다.
- 투명 창의 빈 부분에서 실제 입력을 받는지 확인한다. Windows 입력을 macOS·renderer 스크린샷만으로 판단하지 않는다.
- 단일 인스턴스로 인해 새 소스·번들을 실행해도 기존 창만 열릴 수 있다. 현재 프로세스 경로를 확인하고 My Brush만 종료한다. 종료 시 세션 필기가 사라진다.
- 이전 Python My Brush가 같은 전역키를 점유할 수 있다. 다른 Python 프로세스를 일괄 종료하지 않는다.

## 저장소에 없는 것

`node_modules/`, `dist/`, 기존 `.venv/`·`build/`, 원시 진단 로그는 로컬 생성물이다. 다른 컴퓨터에서는 해당 OS 의존성과 번들을 다시 만든다. 개인 활동 분석 두 파일도 `.gitignore`로 제외되어 clone에 없어도 복구 대상으로 삼지 않는다. 활동 기록·진단 입력 로그를 Agent 메모에 복사하지 않는다.

## Electron 전환 시 주의점

- macOS 창 배치에서 `enableLargerThanScreen: true`를 유지한다. 없으면 메뉴 막대 높이만큼 y가 밀리고 화면 아래가 잘렸다.
- 모달·IME owner는 main의 `interactions`가 화면 간에 공유한다. 전역 토글을 활성 renderer만 보고 처리하지 않는다.
- 설정 IPC는 변경 필드 patch와 revision으로 동기화한다. pending 저장 중 최신 원격 설정을 버리거나 전체 snapshot을 덮어쓰지 않는다.
- `npm run test:electron`은 실제 GUI에서 Playwright 입력을 사용한다. `MY_BRUSH_USER_DATA`로 임시 설정을 분리하며 물리 전역키·실제 IME 검증과 구분한다.

## 빠른 마우스 입력 보완 (0.2.1)

- mouse pointerdown에서 preventDefault하면 Chromium compatibility mouseup이 억제된다. 창 capture release + mouseup 보조 경로를 유지한다. 펜 장치와 다른 버튼을 mouseup으로 끝내지 않는다.
- lostpointercapture/cancel은 pointerId·제스처 시작 시각·재획득 여부를 확인한다. 0.2.1의 한 프레임 capture loss 유예는 0.2.2에서 release 대기 상태로 교체했다. 프레임 수로 정상 release를 폐기하지 않는다. 실제 blur·Escape·Control 선해제·숨김의 취소는 유지한다.
- macOS Control latch는 blur/숨김/keyup에서 해제한다. 마우스 플래그 누락 보완이 Windows의 고정 입력을 바꾸지 않게 한다.
- `npm run test:pointer`는 기본적으로 임시 설정 소스 앱을 실행한다. `MY_BRUSH_EXECUTABLE`에 빌드 실행 파일을 지정하면 같은 회귀 검사를 번들에 수행한다.
- 실제 마우스·주 모니터에서 빠를수록 빈번하다는 사용자 보고는 원인이 완전히 재현됐다는 뜻이 아니다. 통제된 pointerup 전달 차단 비교와 일반 자동 입력/실제 물리 재현을 구분한다. 상세 근거는 `docs/design/native-verification.md`.

## 잔여 입력 문제 보완 (0.2.2)

- capture loss 버튼 0 뒤 awaitingRelease 상태에서는 hover를 추가하지 않는다. 같은 마우스·버튼의 다음 down은 이전 gesture를 마지막 샘플에서 닫고 새 gesture를 시작한다. 이전 down을 무시해 획을 연결하지 않는다.
- 버튼 해제가 먼저 관찰된 삭제는 Control keyup에서 당시 releaseCtrl로 완료한다. 버튼을 누른 채 Control 선해제는 여전히 취소한다.
- `input-diagnostics.jsonl`은 Electron userData의 제한된 로컬 진단이며 renderer16/native12 이벤트와 최근32 보고만 저장한다. 텍스트·좌표·일반 키를 추가하지 않는다. 취소 사유와 native 포커스를 대조하고 사용자 물리 입력 원인으로 자동화 결과를 대체하지 않는다.
- native pointer 검사 창은 사용자 마우스 혼입을 막기 위해 화면 밖에서 webContents 입력을 받는다. 레이아웃·실제 바탕화면 합성 검증과 구분한다.

- 0.2.2 실사용 로그에서는 native mouseUp은 있으나 renderer 확정 전 capture loss가 나온 사례를 확인했다(창/document focus 유지). 늦은 전달인지 완전 누락인지와 Electron/OS 내부 근원은 미확정이다. 사용자는 개선을 체감하고 푸시를 요청했으며 장기 무재발로 확대하지 않는다. 진단 원시 파일은 커밋하지 않는다.
