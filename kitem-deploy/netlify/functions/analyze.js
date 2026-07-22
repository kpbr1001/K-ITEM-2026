// netlify/functions/analyze.js
// Claude API 프록시 — API Key는 Netlify 환경변수(ANTHROPIC_API_KEY)에만 저장되며
// 브라우저에 절대 노출되지 않습니다. 브라우저는 이 함수만 호출합니다.

exports.handler = async (event) => {
  // CORS 프리플라이트 대응
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "POST만 허용됩니다." }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "서버에 ANTHROPIC_API_KEY가 설정되지 않았습니다. Netlify 환경변수를 확인하세요." }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "요청 본문이 올바른 JSON이 아닙니다." }) };
  }

  const { profile, scores, dimScores, evidence } = payload;
  if (!scores || !dimScores) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "진단 데이터(scores, dimScores)가 없습니다." }) };
  }

  // 프롬프트 구성 — 점수는 이미 계산돼 있고, AI는 '설명·서술'만 함
  const dimText = dimScores.map((d) => `${d.id} ${d.name}: ${d.raw == null ? "미확인" : d.raw + "점"}`).join("\n");
  const evText = (evidence || []).length
    ? evidence.map((e) => `- ${e.claim} (증거수준 ${e.level})`).join("\n")
    : "(등록된 증거 없음)";

  const systemPrompt = `당신은 15년 경력의 창업 컨설턴트입니다. 그로스벤처스(BECONIC)의 창업아이템 진단 도구가 산출한 결과를 해석해, 창업자에게 실질적 도움이 되는 분석을 한국어 대화체로 제공합니다.

절대 규칙:
1. 점수·등급은 이미 코드가 계산했습니다. 당신은 그 숫자를 바꾸거나 새 점수를 만들지 마세요. 오직 '해석·설명·조언'만 합니다.
2. 통계·시장규모·경쟁사 등 확인되지 않은 수치를 지어내지 마세요. 사용자가 제공한 정보 범위 안에서만 서술합니다.
3. 낙관 편향을 경계하고, 근거가 약하면 약하다고 정직하게 말합니다.
4. 반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트·마크다운·설명을 절대 붙이지 마세요.

응답 JSON 형식:
{
  "summary": "종합 심층 분석 4~6문장. 세 축(잠재력·증거·준비단계)의 관계와 이 아이템의 현재 국면, 가장 중요한 다음 과제를 서술.",
  "dimensions": [
    { "id": "P1", "comment": "이 영역에 대한 맥락 기반 서술형 코멘트 2~3문장" }
  ],
  "perspectives": [
    { "who": "투자·심사역", "comment": "이 결과에 대한 해당 관점의 구체적 제언 2~3문장" },
    { "who": "컨설턴트", "comment": "..." },
    { "who": "창업자", "comment": "..." }
  ]
}
dimensions에는 미확인이 아닌 영역만 포함하세요.`;

  const userPrompt = `[기업/아이템]
- 기업: ${profile?.company || "미입력"}
- 아이템: ${profile?.oneLiner || "미입력"}
- 단계: ${profile?.stage || "미입력"} / 업종: ${profile?.industry || "미입력"}
- 업종·업태: ${profile?.bizType || "미입력"} / 진입산업: ${profile?.targetIndustry || "미입력"}

[진단 결과 — 코드가 계산한 값]
- 사업 잠재력: ${scores.potential}점
- 증거 신뢰도: ${scores.evidence}점
- 사업화 준비단계: R${scores.readiness}
- 의사결정 등급: ${scores.grade}
- 진단 신뢰도: ${scores.confidence}점

[영역별 점수]
${dimText}

[등록된 증거]
${evText}

위 결과를 해석해 지정된 JSON 형식으로 분석을 제공하세요.`;

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return { statusCode: resp.status, headers: CORS, body: JSON.stringify({ error: `Claude API 오류(${resp.status}). 키·크레딧·모델명을 확인하세요.`, detail: errText.slice(0, 300) }) };
    }

    const data = await resp.json();
    const text = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();

    // JSON 파싱 (코드펜스 제거)
    let parsed;
    try {
      const clean = text.replace(/```json/gi, "").replace(/```/g, "").trim();
      parsed = JSON.parse(clean);
    } catch {
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ raw: text, parseError: true }) };
    }

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, analysis: parsed }) };
  } catch (e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "서버에서 Claude 호출 중 오류가 발생했습니다.", detail: String(e).slice(0, 200) }) };
  }
};
