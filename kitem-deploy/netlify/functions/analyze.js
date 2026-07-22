// netlify/functions/analyze.js
// Claude API 프록시 — 종합분석 + 영역별 맞춤 코멘트·개선점 + 시장현황 + 전문가 코멘트 생성
// API Key는 Netlify 환경변수(ANTHROPIC_API_KEY)에만 저장.

exports.handler = async (event) => {
  const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "POST만 허용됩니다." }) };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "서버에 ANTHROPIC_API_KEY가 설정되지 않았습니다. Netlify 환경변수를 확인하고 재배포하세요." }) };

  let payload;
  try { payload = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "요청 본문이 올바른 JSON이 아닙니다." }) }; }

  const { profile, scores, dimScores, evidence } = payload;
  if (!scores || !dimScores) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "진단 데이터가 없습니다." }) };

  const rated = dimScores.filter((d) => d.raw != null);
  const dimText = rated.map((d) => `${d.id} ${d.name}: ${d.raw}점`).join("\n");
  const ratedIds = rated.map((d) => d.id).join(", ");
  const evText = (evidence || []).length ? evidence.map((e) => `- ${e.claim} (${e.level})`).join("\n") : "(증거 없음)";

  const systemPrompt = `당신은 15년 경력의 창업·사업화 전문 컨설턴트입니다. 그로스벤처스(BECONIC)의 진단 결과를 해석해 창업자에게 실질적 도움을 줍니다. 한국어 대화체로 씁니다.

절대 규칙:
1) 점수·등급은 이미 코드가 계산했습니다. 숫자를 바꾸거나 새로 만들지 말고 '해석·조언'만 하세요.
2) 시장규모·성장률·경쟁사 점유율 등 확인되지 않은 구체 수치를 지어내지 마세요. 수치가 필요하면 '무엇을 조사해야 하는지'로 제시하세요. market.overview에도 임의 숫자 금지.
3) 근거가 약하면 약하다고 정직하게. 낙관 편향 경계.
4) 반드시 아래 JSON만 출력. 마크다운·설명·인사말 금지. 모든 코멘트는 아이템 맥락에 구체적으로.

출력 JSON 스키마:
{
  "summary": "종합 심층 분석 4~5문장. 세 축 관계·현재 국면·가장 중요한 다음 과제.",
  "dimensions": [ {"id":"P1","comment":"이 영역 맞춤 해석 2문장","improve":["맞춤 개선점1","2","3"]} ],
  "market": {
    "overview":"시장·산업 맥락 정성 서술 3문장(숫자 없이)",
    "drivers":["기회요인1","2"],
    "risks":["위협·장벽1","2"],
    "checklist":["직접 조사할 항목1(예: OO 시장규모를 통계청/보고서로 확인)","2","3"]
  },
  "perspectives": [ {"who":"투자","comment":"2~3문장"},{"who":"컨설턴트","comment":"2~3문장"},{"who":"창업자","comment":"2~3문장"} ],
  "expert": "전문가 심화 코멘트 4~5문장. 이 아이템의 핵심 성패 요인과 흔한 실패 패턴, 지금 집중할 지점을 컨설턴트 시각에서."
}
dimensions에는 점수가 있는 영역(${ratedIds})만 포함. improve는 각 영역 2~3개, 아이템에 맞게 구체적으로.`;

  const userPrompt = `[아이템]
기업: ${profile?.company || "미입력"}
한줄설명: ${profile?.oneLiner || "미입력"}
단계: ${profile?.stage || "?"} / 사업유형: ${profile?.industry || "?"}
업종·업태: ${profile?.bizType || "미입력"} / 진입산업: ${profile?.targetIndustry || "미입력"}

[진단 결과 — 코드 계산값]
사업잠재력 ${scores.potential} · 증거신뢰도 ${scores.evidence} · 준비단계 R${scores.readiness} · 등급 ${scores.grade} · 진단신뢰도 ${scores.confidence}

[영역별 점수]
${dimText}

[등록 증거]
${evText}

위 진단을 해석해 지정된 JSON으로만 응답하세요. 특히 이 아이템(${profile?.oneLiner || ""})의 산업·고객 맥락을 반영해 구체적으로.`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 24000);

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 3000,
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
    let parsed = null;
    const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
    try { parsed = JSON.parse(cleaned); }
    catch { const s = cleaned.indexOf("{"), e = cleaned.lastIndexOf("}"); if (s !== -1 && e !== -1 && e > s) { try { parsed = JSON.parse(cleaned.slice(s, e + 1)); } catch { parsed = null; } } }

    if (parsed && parsed.summary) return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, analysis: parsed }) };
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, analysis: { summary: text || "분석 결과가 비어 있습니다.", dimensions: [], perspectives: [] } }) };
  } catch (e) {
    clearTimeout(timer);
    if (e.name === "AbortError") return { statusCode: 504, headers: CORS, body: JSON.stringify({ error: "AI 응답이 지연되어 시간 초과됐습니다. 다시 시도해 주세요." }) };
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "서버 오류가 발생했습니다.", detail: String(e).slice(0, 200) }) };
  }
};
