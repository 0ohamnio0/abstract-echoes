# 인수인계 — Bremen Start Screen (`bremen-start-screen`)

## 로컬에서 `http://localhost:5173/` 로 띄우는 프로젝트 경로

절대 경로:

```text
/Users/songhaemin/Archive/2. Business/3. 에이플랜컴퍼니/10. 브레멘 백야드/bremen-start-screen
```

이 폴더가 Vite 개발 서버 기본 포트 **5173**으로 열리는 앱의 루트입니다. (`vite.config.ts`의 `server.port`)

---

## 이 프로젝트가 하는 일

- **Bremen Backyard** 전시용 스타트/사운드 캔버스 앱입니다.
- 동일 부모 폴더의 **`abstract-echoes`**에 있던 React + `SoundCanvas` 흐름을 이 리포로 가져와 합친 상태입니다.
- **idle**: `title.svg` + Simplex 노이즈 변형, 그레이스케일 필터, 하단 힌트 SVG(`floor_pad_hint_text.svg`, `by_oh_bremen_logo.svg`).
- **오프닝 시작**: 화면 클릭/탭 또는 키보드 **B** → 인트로 시퀀스 → 마이크 → **listening** 단계에서 캔버스 제너러티브 반응 + 문구 **「너의 목소리를 들려줘」** (영문 부제 포함).
- **Ctrl+Shift+K**: 키오스크/전시 모드 토글(커서 숨김 등, `SoundCanvas` 내부 로직).

핵심 엔트리: `src/main.tsx` → `src/App.tsx` → `src/pages/Index.tsx` → `src/components/SoundCanvas.tsx`.

---

## 실행 방법

```bash
cd "/Users/songhaemin/Archive/2. Business/3. 에이플랜컴퍼니/10. 브레멘 백야드/bremen-start-screen"
npm install
npm run setup    # 최초 1회 또는 클론 직후 — MediaPipe WASM + YAMNet 모델
npm run dev
```

- **`npm run setup`**: `node_modules`의 WASM을 `public/wasm`·`dist/wasm`에 복사하고, `yamnet.tflite`를 내려받아 `public/models`·`dist/models`에 둡니다. **dev에서 오디오 분류가 동작하려면 필요합니다.**
- Vite는 **`server.host: true`** 로 바인딩합니다(IPv4/다른 기기 접속 이슈 완화).

---

## 빌드·미리보기

```bash
npm run build
npm run preview
```

---

## 구조 메모

| 경로 | 설명 |
|------|------|
| `src/components/SoundCanvas.tsx` | 페이즈(idle / intro / listening), 캔버스, 마이크, UI |
| `src/lib/generativeEngine.ts` | 캔버스 제너러티브 렌더 |
| `src/lib/audioAnalyzer.ts` | 마이크 + 스펙트럼 등 |
| `src/lib/yamnetClassifier.ts` | YAMNet(MediaPipe tasks-audio) |
| `public/` | 정적 에셋(SVG, PNG, favicon 등) |
| `scripts/setup-local-assets.mjs` | WASM/모델 배치 |
| `vite.config.ts` | `@` → `./src`, `base: "./"`, 포트 5173 |

`.gitignore`에 **`public/wasm`**, **`public/models`** 가 있어 큰 바이너리는 저장소에 안 올라갈 수 있습니다. 새 환경에서는 반드시 `npm run setup`을 다시 실행하세요.

---

## 관련 프로젝트

- **`…/abstract-echoes`**: 내용상 쌍둥이에 가깝습니다. 한쪽만 고치면 다른 쪽과 어긋날 수 있으니, “어느 쪽이 소스 오브 트루스인지” 팀에서 정하면 좋습니다.
- 예전에 언급된 **`/Users/songhaemin/office_backup/work/user_test_aplan_0227`** 등은 백업/포터블 빌드용으로 쓰이던 경로일 수 있으며, **현재 5173으로 띄우는 작업 트리는 위 `bremen-start-screen` 경로**입니다.

---

## 알려진 이슈·메모

- `SoundCanvas` 안 **`SHOW_DEBUG_UI`** 가 `false`이면 하단 디버그 버튼(오프닝 시작, 정지, 튜닝 등)은 숨겨집니다. 전시는 클릭/B 키 중심입니다.
- idle 때 **캔버스 제너러티브 “프리뷰”**를 항상 돌리는 코드는 기본 설계에 없을 수 있습니다(대부분 listening 이후 `GenerativeEngine`이 돕니다). 요구사항이 바뀌면 그때 별도 구현이 필요할 수 있습니다.

---

*이 문서는 에이전트 인수인계용으로 작성되었습니다. 날짜: 2026-03-24.*
