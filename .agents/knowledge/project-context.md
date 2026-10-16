# 프로젝트 맥락과 구현 주의점

## 현재 상태

2026-10-16 소스 확인 기준. 기능 구현 기준 커밋은 `68da2d5`다. 비공개 원격은 `https://github.com/didxodnr0769-bom/my-brush`, 기본 브랜치는 `main`이다. 새 작업에서는 원격·작업 트리 상태를 다시 확인한다.

사용자는 macOS와 Windows 각각에서 같은 기능과 사용감으로 화면 필기를 하려 한다. 전체 ScreenBrush 복제나 기기 간 필기·설정 동기화는 현재 범위가 아니다. 초기 웹 시안 이후 실제 데스크톱 앱으로 방향을 확정했다. `preview/index.html`을 실제 앱으로 오인하거나 브라우저 개발 서버부터 띄우지 않는다.

확정 기능은 자유 필기, 굵기, 색상, 단축키 설정, 사각형, 텍스트·글자 크기, Ctrl+드래그 영역 삭제다. 삭제 영역과 일부라도 겹치면 획·사각형·텍스트 오브젝트 전체를 삭제한다. 테두리 사각형의 빈 내부만 선택한 경우는 제외한다. 추가 도형·Undo/Redo·전체 지우기·내보내기는 자동으로 범위에 넣지 않는다.

## 코드 안내

| 담당 | 소스 |
|---|---|
| 앱 진입·단일 인스턴스 | `desktop_main.py`, `my_brush/app.py`의 `main()` |
| 투명 창·도구 막대·텍스트·ON/OFF | `my_brush/app.py`의 `Controller`, `Overlay`, `Toolbar`, `TextEditor` |
| 오브젝트와 교차 판정 | `my_brush/model.py` |
| 물리 키 매핑·설정 저장 | `my_brush/preferences.py` |
| macOS Carbon/AppKit·Windows Win32 | `my_brush/platform.py` |
| 자동 검사 | `tests/test_model.py`, `tests/test_desktop_ui.py` |
| 실행·패키징 | `run-mac.command`, `run-windows.cmd`, `scripts/build.py` |

Qt Widgets·QPainter로 실행하며 브라우저·웹뷰·서버를 사용하지 않는다. 의존성은 `PySide6-Essentials==6.12.0`, `PyInstaller==6.22.3`이다. 맥 검증 때 Python 3.12.14를 사용했으며 새 컴퓨터에서도 우선 Python 3.12로 재현한다. 소스 구현 작업에 REA·Hopper 설치가 필수는 아니다.

## 유지할 입력·상태 규칙

- macOS 기본 전역 토글은 물리 **Control+Command+Tab**, Windows 기본값은 **Control+Shift+Space**다. Windows 조합을 맥 키의 단순 치환으로 바꾸지 않는다.
- ON/OFF는 필기 화면과 도구 막대를 함께 표시·숨긴다. OFF여도 앱·메뉴 막대/트레이는 살아 있다. 필기는 세션 메모리에 유지되지만 앱 종료 시 사라지며 파일 복원 기능은 없다.
- `ApplicationActive` 이벤트만으로 OFF를 해제하지 않는다. 이를 다시 넣으면 끈 도구 막대가 재등장한다. 명시적인 토글·메뉴·재실행은 별도 진입이다.
- macOS Qt 보조키 의미가 물리 키와 뒤바뀌므로 `physical_modifiers()`를 사용한다. Ctrl+드래그·Ctrl+Enter의 Control을 Command로 바꾸지 않는다. `meta`는 macOS Command / Windows Win이다.
- macOS Ctrl+왼쪽 클릭이 Qt 오른쪽 버튼으로 전달될 수 있어 `native_left_button_down()`으로 구분한다. 실제 Ctrl+드래그 확인은 아직 남아 있다.
- 키코드 0을 무조건 A로 해석하지 않는다. 보조키·고정키 제외와 Tab의 native/fallback 매핑에 회귀 검사가 있다.
- 글자 입력·IME 조합 중 도구 단축키가 문자를 가로채면 안 된다. Ctrl+Enter 확정, Esc 취소·숨김의 우선순위를 유지한다.
- 설정은 기기별 `preferences.json`에 저장된다. 유효한 저장값은 코드의 기본값보다 우선한다. `QStandardPaths.AppConfigLocation`으로 위치를 찾고 맥 절대 경로를 Windows에 하드코딩하지 않는다.

## 검증 경계와 함정

- **2026-10-15 결과:** macOS 26.6.2·Apple Silicon에서 모델 20개와 Qt 위젯 34개, 총 54개가 통과했다. 이 수치를 새 컴퓨터의 현재 결과로 복사하지 않는다. Windows에서는 맥 전용 검사의 skip도 따로 기록한다.
- 맥 앱 펜·색·굵기·사각형·한글 붙여넣기·텍스트 크기·설정·숨김을 UI에서 확인했다. 다른 앱에서 실제 Control+Command+Tab으로 ON/OFF는 **사용자가 직접 정상 동작을 확인**했다.
- **Windows 설치·실행·exe 생성·전역키·입력·포커스는 아직 실제 미검증**이다. 맥의 실제 Ctrl+드래그, 실제 한글 IME 조합, 여러 모니터·배율·전체 화면도 남아 있다.
- 위젯 검사는 `FakeDesktopIntegration`과 offscreen을 사용한다. 통과해도 OS 전역키·IME·투명 합성·포커스 복귀를 입증하지 않는다. Windows `SetForegroundWindow` 요청과 실제 복귀도 구분한다.
- 투명 창의 빈 부분 알파는 **1**이다. Windows 빈 영역에서도 입력을 받기 위한 의도이므로 0으로 단순 변경하지 않는다.
- 맥 Qt `Tool` 창의 접근성 읽기가 시간 초과했고 `Window` 생성 타입으로 바꾼 뒤 해소됐다. 현재 프레임 없는 최상위 투명 창을 되돌릴 때는 실제 앱에서 재검증한다.
- 자동화 전역 조합 입력은 실패했지만 사용자의 물리 키 입력은 성공했다. 자동화에서 콜백을 못 봤다는 이유만으로 Carbon 구현을 교체하지 않는다. `output/native/carbon-delivery-smoke.py`는 맥 전용 OS 메시지 배선 시험이며 물리 키 검증이 아니다.
- 앱은 단일 인스턴스다. 기존 프로세스가 살아 있으면 수정 소스·새 번들을 실행해도 기존 창만 열릴 수 있다. My Brush만 종료하고 새 버전을 실행하며, 종료 시 세션 필기가 사라지는 점을 고려한다.

## 저장소에 없는 것

`.venv/`, `build/`, `dist/`, 원시 진단 로그는 로컬 생성물이다. 다른 컴퓨터에서는 의존성과 해당 OS 번들을 다시 만든다. 개인 컴퓨터 활동 분석 두 파일도 `.gitignore`로 제외되어 clone에 없어도 복구 대상으로 삼지 않는다. 활동 기록·진단 입력 로그를 Agent 메모에 복사하지 않는다.
