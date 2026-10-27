# My Brush

macOS와 Windows에서 다른 앱 화면 위에 필기하기 위한 Electron 데스크톱 앱이다. 투명 창 위에 Canvas로 필기하고 HTML 도구 막대를 표시한다. Python 설치는 필요하지 않다. ScreenBrush의 코드·이미지 자산을 복사하지 않고 선택한 기능을 새로 구현한다.

## 첫 버전 범위

1. 화면 위 자유 필기
2. 선 굵기 변경
3. 색상 변경
4. 단축키 설정
5. 테두리 사각형
6. 화면 텍스트와 글자 크기 조절
7. Control+드래그 영역과 일부라도 겹친 오브젝트 전체 삭제

사용자가 확정한 범위는 [첫 버전 요구사항](docs/requirements/first-version.md), 기본값과 세부 조작은 [입력 설계](docs/design/interaction-design.md)에서 관리한다. `preview/index.html`은 이전 조작 시안이며 앱은 `electron/main.cjs`에서 시작한다.

## 소스에서 실행

소스 실행에는 Node.js 22.12 이상과 npm이 필요하다. 정확한 버전 조건은 `package.json`의 `engines`를 따른다. 저장소 루트에서 의존성을 설치한 뒤 실행한다.

```sh
npm ci
npm start
```

macOS에서는 `run-mac.command`, Windows에서는 `run-windows.cmd`로도 실행할 수 있다. 첫 의존성 설치에는 인터넷 연결이 필요하며, 설치 후에는 로컬 파일을 로드한다. 별도 웹 개발 서버는 사용하지 않는다. 패키징된 앱에는 Electron 실행 환경이 포함되므로 사용자에게 Node.js나 Python 설치를 요구하지 않는다.

`npm start -- --start-hidden`으로 필기를 끈 상태에서 시작할 수 있다. 이미 실행 중인 앱이 있으면 두 번째 실행은 기존 앱의 필기 화면을 표시한다.

## 조작

| 동작 | 기본 입력 |
|---|---|
| 필기 켜기 / 끄기 | macOS: Control+Command+Tab · Windows: Control+Shift+Space · 앱 메뉴 |
| 펜 / 사각형 / 텍스트 | B / R / T |
| 선 굵기 감소 / 증가 | [ / ] |
| 단축키 설정 | Control+, |
| 영역 삭제 | Control을 누른 채 왼쪽 버튼으로 드래그 |
| 텍스트 줄바꿈 / 확정 | Enter / Control+Enter |
| 현재 편집·제스처 취소, 그 외 작업 복귀 | Escape |

**macOS에서도 Control은 ⌃ 키이며 Command(⌘) 키가 아니다.** 도구 키는 필기 중에만 사용하고, 텍스트 편집 중에는 문자 입력에 맡긴다. 전역 조합을 OS에 등록하지 못하면 오류를 표시하고 앱 메뉴를 통해 필기를 시작한다.

도구 막대에서 색상·선 굵기·글자 크기를 바꾼다. 텍스트 도구로 기존 텍스트를 클릭하면 내용과 크기를 다시 편집한다. Control+드래그 삭제는 경계에 일부만 닿아도 한 획·사각형·텍스트 오브젝트 전체를 제거한다. 채움 없는 사각형의 빈 내부만 선택한 경우에는 테두리를 지우지 않는다.

앱을 실행해 둔 채 **Control+Command+Tab(⌃⌘⇥)**을 누르면 필기 화면과 도구 막대가 함께 꺼지고, 다시 누르면 함께 켜진다. 도구 막대의 `필기 끄기`도 같은 숨김 동작을 수행한다. OFF 상태는 앱의 활성화 여부가 바뀌어도 유지하며, 다시 켜려면 토글 단축키나 메뉴를 사용한다. 앱 종료는 메뉴의 `My Brush 종료`로 구분한다.

필기를 끄면 앱 창을 숨겨 다른 앱에서 작업할 수 있다. 필기 내용은 실행 중 메모리에 유지하며 앱 종료 시 보존하지 않는다. 기본 글꼴은 OS 기본 산세리프이므로 macOS와 Windows의 글자 모양·줄 폭은 다를 수 있다. 색상·굵기·텍스트 크기·단축키는 Electron의 사용자별 `userData` 디렉터리에 있는 `preferences.json`에 저장한다. 새 설정 파일이 없을 때는 기존 Python·Qt 버전의 설정을 읽어 이전한다. 원본 설정 파일은 유지한다.

macOS의 이전 설정은 `~/Library/Preferences/MyBrush/MyBrush/preferences.json`, Windows는 로컬·로밍 앱 데이터 아래 `MyBrush/MyBrush/preferences.json`을 확인한다. 유효한 기존 사용자 단축키는 기본값보다 우선하며 설정 창에서 변경할 수 있다.

## 앱으로 빌드

electron-builder로 현재 운영체제의 앱을 만든다. 해당 OS에서 빌드하고 실제 실행을 확인한다.

```sh
npm run pack
# 배포 파일 생성
npm run dist
```

결과는 `dist/electron/`에 생성된다. `pack`은 설치 전 실행 가능한 앱 디렉터리를, `dist`는 macOS DMG 또는 Windows NSIS 설치 파일을 만든다. 폴더 형태의 Windows 결과물은 실행 파일과 의존성을 함께 유지한다. 앱 식별자는 `dev.mybrush.desktop`, 표시 이름은 `My Brush`다. macOS 공증·배포용 서명 완료 여부는 별도로 확인해야 하며 로컬 빌드 성공과 구분한다.

## 검증 기록

`npm test`로 로직·상태 자동 검사를 실행한다. 실제 Electron 창 입력 검사는 데스크톱 세션에서 `npm run test:electron`으로 실행한다. 빠른 연속 마우스 입력·마우스업 복구·Control 상태 회귀 검사는 `npm run test:pointer`로 실행한다. 이 검사는 임시 사용자 설정으로 실행하며 종료 후 테스트 설정을 정리한다. 자동 검사와 실제 전역키·IME·화면 합성·포커스 복귀 확인은 구분한다.

Electron 전환 후 실행·빌드·검사 결과와 OS별 미확인 항목은 [데스크톱 구현·검증 기록](docs/design/native-verification.md)을 따른다. 이전 Python·Qt의 54개 검사 및 사용자 전역키 확인, [브라우저 시안 검증 기록](docs/design/preview-verification.md)은 현재 Electron 앱의 검증 결과로 대체하지 않는다.
