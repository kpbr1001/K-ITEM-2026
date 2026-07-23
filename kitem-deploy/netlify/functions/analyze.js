// netlify/functions/analyze.js
// Claude API 프록시 — 2단계 호출로 504(시간초과) 방지
//  step 1: 종합분석 + 시장현황 + 전문가코멘트 + 관점별 제언 (빠름)
//  step 2: 영역별 맞춤 코멘트·개선점 (분량 큼, 별도 호출)

exports.handler = async (event) => {
  const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  // 상태 확인용 GET — 실제 Claude 호출 없이 함수 생존 + 키 설정 여부만 반환 (크레딧 미사용)
  if (event.httpMethod === "GET") {
    const hasKey = !!process.env.ANTHROPIC_API_KEY;
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, ready: hasKey, service: "K-ITEM analyze", message: hasKey ? "AI 분석 사용 가능" : "API Key 미설정" }) };
  }
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "POST만 허용됩니다." }) };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "서버에 ANTHROPIC_API_KEY가 설정되지 않았습니다. Netlify 환경변수를 확인하고 재배포하세요." }) };

  let payload;
  try { payload = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "요청 본문이 올바른 JSON이 아닙니다." }) }; }

  const { profile, scores, dimScores, evidence, step } = payload;
  if (!scores || !dimScores) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "진단 데이터가 없습니다." }) };

  const rated = dimScores.filter((d) => d.raw != null);
  const dimText = rated.map((d) => `${d.id} ${d.name}: ${d.raw}점`).join("\n");
  const ratedIds = rated.map((d) => d.id).join(", ");
  const evText = (evidence || []).length ? evidence.map((e) => `- ${e.claim} (${e.level})`).join("\n") : "(증거 없음)";
  const ctx = `[아이템] ${profile?.company || "미입력"} / ${profile?.oneLiner || "미입력"} / 단계:${profile?.stage || "?"} 유형:${profile?.industry || "?"} / 업종:${profile?.bizType || "-"} 진입산업:${profile?.targetIndustry || "-"}
[지역] ${profile?.region || "미입력"}
[목표고객] ${profile?.targetCustomer || "미입력"}
[경쟁사·대체재] ${profile?.competitors || "미입력"}
[핵심가설] ${profile?.hypothesis || "미입력"}
[결과] 잠재력 ${scores.potential} · 증거 ${scores.evidence} · 준비단계 R${scores.readiness} · 등급 ${scores.grade} · 진단신뢰도 ${scores.confidence}
[영역별 점수]
${dimText}
[증거]
${evText}`;

  const common = `당신은 15년 경력의 창업·사업화 전문 컨설턴트입니다. 그로스벤처스(BECONIC)의 진단 결과를 해석합니다. 한국어 대화체.
규칙: (1)점수는 코드가 이미 계산했으니 바꾸지 말고 해석만. (2)시장규모·성장률 등 확인 안 된 구체 수치를 지어내지 말 것(필요하면 '조사할 항목'으로). (3)근거 약하면 정직하게. (4)아래 JSON만 출력, 마크다운·인사말 금지, 완결된 JSON으로.`;

  let systemPrompt, userPrompt, maxTokens;

  if (step === 4) {
    // 4단계: 실행계획만
    systemPrompt = `${common}
출력 스키마(반드시 완결된 JSON):
{"actionplan":{"w4":[{"act":"행동","metric":"측정지표","goal":"성공기준"}],"w8":[{"act":"","metric":"","goal":""}],"w12":[{"act":"","metric":"","goal":""}]}}
각 기간 1~2개. 이 아이템의 약점·준비단계를 반영해 '무엇을·어떻게·성공기준(수치)'까지 구체적으로. 간결하게.`;
    userPrompt = `${ctx}\n\n4·8·12주 실행계획을 JSON으로만.`;
    maxTokens = 1300;
  } else if (step === 3) {
    // 3단계: 영역별 코멘트·개선점만
    systemPrompt = `${common}
출력 스키마(반드시 완결된 JSON):
{"dimensions":[{"id":"P1","comment":"1문장","improve":["개선점1","개선점2"]}]}
영역은 ${ratedIds}만. comment 1문장(짧게), improve 2개(각 한 줄). 매우 간결하게, 반드시 완결.`;
    userPrompt = `${ctx}\n\n영역별 맞춤 코멘트와 개선점을 JSON으로만.`;
    maxTokens = 2400;
  } else if (step === 2) {
    // 2단계: 시장현황 + 경쟁구도
    systemPrompt = `${common}
출력 스키마(반드시 완결된 JSON):
{"market":{"overview":"시장 맥락 2문장(숫자 없이)","drivers":["기회1","기회2"],"risks":["위협1","위협2"],"checklist":["조사항목1","2","3"]},"competition":{"note":"경쟁 구도 2문장","checklist":["확인할 경쟁 정보1","2","3"]}}
수치·경쟁사 정보를 지어내지 말고 '확인할 항목' 중심으로. 간결하게.`;
    userPrompt = `${ctx}\n\n이 아이템의 시장 현황과 경쟁 구도를 JSON으로만.`;
    maxTokens = 1300;
  } else {
    // 1단계: 종합분석 + 관점별 + 전문가
    systemPrompt = `${common}
출력 스키마(반드시 완결된 JSON):
{"summary":"종합분석 3문장(세 축 관계·현재 국면·핵심 과제)","perspectives":[{"who":"투자","comment":"1~2문장"},{"who":"컨설턴트","comment":"1~2문장"},{"who":"창업자","comment":"1~2문장"}],"expert":"전문가 코멘트 3문장(성패요인·실패패턴·집중지점)","consultant":"컨설턴트 총평 3~4문장. 중소기업 컨설턴트가 대표에게 직접 말하듯, 이 아이템의 현재 위치와 앞으로 3개월 집중할 것을 담백하게. 존댓말."}
간결하게.`;
    userPrompt = `${ctx}\n\n이 아이템(${profile?.oneLiner || ""})의 맥락을 반영해 JSON으로만.`;
    maxTokens = 1400;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 22000);

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-4-5", max_tokens: maxTokens, system: systemPrompt, messages: [{ role: "user", content: userPrompt }] }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) {
      const errText = await resp.text();
      let hint = "";
      if (resp.status === 401) hint = " (API Key가 틀렸습니다)";
      else if (resp.status === 400) hint = " (모델명 또는 요청 형식 확인)";
      else if (resp.status === 429) hint = " (요청 한도 초과, 잠시 후 재시도)";
      else if (resp.status === 402 || errText.includes("credit")) hint = " (크레딧이 부족합니다)";
      return { statusCode: resp.status, headers: CORS, body: JSON.stringify({ error: `Claude API 오류(${resp.status})${hint}`, detail: errText.slice(0, 200) }) };
    }

    const data = await resp.json();
    const text = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
    const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();

    let parsed = null;
    try { parsed = JSON.parse(cleaned); }
    catch { const s = cleaned.indexOf("{"), e = cleaned.lastIndexOf("}"); if (s !== -1 && e !== -1 && e > s) { try { parsed = JSON.parse(cleaned.slice(s, e + 1)); } catch { parsed = null; } } }

    if (parsed) return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, analysis: parsed }) };

    if (step === 2) return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, analysis: {} }) };
    if (step === 3) return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, analysis: { dimensions: [] } }) };
    if (step === 4) return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, analysis: {} }) };
    let summaryOnly = "";
    const m = cleaned.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (m && m[1]) summaryOnly = m[1].replace(/\\n/g, " ").replace(/\\"/g, '"').trim();
    if (!summaryOnly) { summaryOnly = cleaned.replace(/[{}\[\]]/g, " ").replace(/"[a-zA-Z_]+"\s*:/g, " ").replace(/"/g, "").replace(/\s+/g, " ").trim(); if (summaryOnly.length > 500) summaryOnly = summaryOnly.slice(0, 500) + " …(다시 분석을 눌러 재시도해 주세요.)"; }
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, analysis: { summary: summaryOnly || "분석 결과를 불러오지 못했습니다.", perspectives: [] } }) };
  } catch (e) {
    clearTimeout(timer);
    if (e.name === "AbortError") return { statusCode: 504, headers: CORS, body: JSON.stringify({ error: "AI 응답이 지연되어 시간 초과됐습니다. 다시 시도해 주세요." }) };
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "서버 오류가 발생했습니다.", detail: String(e).slice(0, 200) }) };
  }
};
