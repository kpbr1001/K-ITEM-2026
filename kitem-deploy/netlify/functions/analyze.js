// netlify/functions/analyze.js
// Claude API 프록시 — API Key는 Netlify 환경변수(ANTHROPIC_API_KEY)에만 저장.
// 504(시간초과) 방지를 위해 출력량을 조절하고 타임아웃을 관리합니다.

exports.handler = async (event) => {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "POST만 허용됩니다." }) };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "서버에 ANTHROPIC_API_KEY가 설정되지 않았습니다. Netlify 환경변수를 확인하고 재배포하세요." }) };

  let payload;
  try { payload = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "요청 본문이 올바른 JSON이 아닙니다." }) }; }

  const { profile, scores, dimScores, evidence } = payload;
  if (!scores || !dimScores) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "진단 데이터가 없습니다." }) };

  // 미확인 아닌 영역만 (출력량 감소)
  const rated = dimScores.filter((d) => d.raw != null);
  const dimText = rated.map((d) => `${d.id} ${d.name}: ${d.raw}점`).join("\n");
  const evText = (evidence || []).length ? evidence.map((e) => `- ${e.claim} (${e.level})`).join("\n") : "(증거 없음)";

  // 간결한 프롬프트 — 핵심만 요청해 응답 시간 단축
  const systemPrompt = `당신은 15년 경력의 창업 컨설턴트입니다. 그로스벤처스(BECONIC)의 진단 결과를 해석합니다.
규칙: (1)점수는 이미 계산됐으니 바꾸지 말고 해석만. (2)없는 통계·수치 지어내지 말 것. (3)근거 약하면 정직하게. (4)반드시 아래 JSON만 출력. 다른 텍스트·마크다운 금지. 각 코멘트는 간결하게 2문장 이내.
{"summary":"종합분석 4문장","dimensions":[{"id":"P1","comment":"2문장"}],"perspectives":[{"who":"투자","comment":"2문장"},{"who":"컨설턴트","comment":"2문장"},{"who":"창업자","comment":"2문장"}]}
dimensions는 제시된 영역만 포함.`;

  const userPrompt = `[아이템] ${profile?.company || "미입력"} / ${profile?.oneLiner || "미입력"} / 단계:${profile?.stage} 업종:${profile?.industry}
[결과] 잠재력 ${scores.potential} · 증거 ${scores.evidence} · 준비단계 R${scores.readiness} · 등급 ${scores.grade} · 진단신뢰도 ${scores.confidence}
[영역별]
${dimText}
[증거]
${evText}
위를 해석해 지정 JSON으로만 응답.`;

  // 22초 타임아웃 (함수 26초 한도 내에서 여유)
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 22000);

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-3-5-haiku-20241022", // 빠른 모델로 504 방지
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
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
    let parsed;
    try { parsed = JSON.parse(text.replace(/```json/gi, "").replace(/```/g, "").trim()); }
    catch { return { statusCode: 200, headers: CORS, body: JSON.stringify({ raw: text, parseError: true }) }; }
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, analysis: parsed }) };
  } catch (e) {
    clearTimeout(timer);
    if (e.name === "AbortError") return { statusCode: 504, headers: CORS, body: JSON.stringify({ error: "AI 응답이 지연되어 시간 초과됐습니다. 다시 시도해 주세요." }) };
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "서버 오류가 발생했습니다.", detail: String(e).slice(0, 200) }) };
  }
};
