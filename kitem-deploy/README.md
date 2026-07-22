# K-ITEM PMF LAB — Netlify 배포 (Claude API 연동)

창업아이템 3축 진단 도구 + Claude AI 심층 분석.
정적 프론트엔드(`index.html`) + 서버리스 함수(`netlify/functions/analyze.js`) 구조입니다.

---

## 폴더 구조

```
kitem-deploy/
├─ index.html                    # 앱 (정적, OG 태그 포함)
├─ k-item-og-image.png           # 카카오톡 공유 이미지 (직접 추가 필요)
├─ netlify.toml                  # Netlify 설정
├─ .gitignore
└─ netlify/
   └─ functions/
      └─ analyze.js              # Claude API 프록시 (API Key 서버 보관)
```

> **k-item-og-image.png** 는 이전에 만든 OG 이미지 파일을 이 폴더 루트에 복사해 넣으세요.

---

## 보안 구조 (중요)

```
브라우저(index.html) → /.netlify/functions/analyze → Claude API
                              [API Key는 여기서만 사용]
```

- **API Key는 절대 브라우저에 넣지 않습니다.** Netlify 환경변수에만 저장됩니다.
- 브라우저는 우리 함수만 호출하고, 함수가 키를 붙여 Claude를 호출합니다.
- 이렇게 해야 키 탈취·무단 과금·CORS 문제가 모두 해결됩니다.

---

## 배포 방법 (Git 연동 — 권장)

### 1단계 — GitHub에 올리기
이 폴더를 GitHub 저장소로 만들어 푸시합니다.

```bash
cd kitem-deploy
git init
git add .
git commit -m "K-ITEM PMF LAB with Claude AI"
git branch -M main
git remote add origin https://github.com/<계정>/<저장소>.git
git push -u origin main
```

### 2단계 — Netlify에 저장소 연결
1. Netlify → **Add new site → Import an existing project**
2. GitHub 저장소 선택
3. 빌드 설정은 `netlify.toml`이 자동 적용 (publish=`.`, functions=`netlify/functions`)
4. **Deploy** 클릭

### 3단계 — 환경변수 설정 (필수)
Netlify 대시보드 → **Site configuration → Environment variables → Add a variable**

| Key | Value |
|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-...` (Anthropic 콘솔에서 발급한 키) |

저장 후 **Deploys → Trigger deploy → Deploy site**로 재배포하면 키가 함수에 적용됩니다.

### 4단계 — 확인
- 사이트 접속 → 진단 진행 → 결과 화면의 **"AI 심층 분석 실행"** 버튼 클릭
- 10~20초 후 종합분석·영역별 코멘트·관점별 제언에 AI 결과가 반영됨

---

## API Key 발급

1. https://console.anthropic.com 접속 → 로그인
2. **API Keys → Create Key**
3. 생성된 `sk-ant-...` 키를 위 환경변수에 입력
4. **Billing에 크레딧이 있어야** 호출됩니다 (없으면 함수가 오류 반환)

---

## 사용 모델

`netlify/functions/analyze.js` 안에서 `claude-sonnet-4-5-20250929`를 호출합니다.
모델명을 바꾸려면 해당 파일의 `model:` 값을 수정하세요.

---

## 비용 관리 팁

- AI 분석은 **버튼을 눌러야만** 호출됩니다 (자동 호출 없음 → 불필요한 과금 방지)
- Anthropic 콘솔에서 **사용량 한도(Usage limits)** 설정을 권장합니다
- 필요시 함수에 호출 횟수 제한(rate limit)을 추가할 수 있습니다

---

## 문제 해결

| 증상 | 원인·해결 |
|---|---|
| "함수가 배포되지 않았습니다" | `netlify.toml`의 functions 경로 확인, 재배포 |
| "ANTHROPIC_API_KEY가 설정되지 않았습니다" | 환경변수 설정 후 **재배포** 필요 |
| "Claude API 오류(401)" | 키가 틀렸거나 만료됨 |
| "Claude API 오류(400/404)" | 모델명 확인 |
| 크레딧 부족 오류 | Anthropic Billing에 크레딧 충전 |
| 카카오톡 이미지 안 뜸 | `k-item-og-image.png` 업로드 확인 + 카카오 공유 디버거에서 캐시 초기화 |

---

*그로스벤처스 주식회사 · 중소벤처기업부 공식 인증 중소기업상담회사 제2025-684호*
