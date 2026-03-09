import { ok, text, type HTTPSendRequester } from "@chainlink/cre-sdk";

const OPENROUTER_URL =
  "https://openrouter.ai/api/v1/chat/completions";

const MODEL = "google/gemini-2.0-flash-001";

export type GeminiConfig = {
  apiKey:   string;   
  question: string;
};

export type GeminiSettlementResult = {
  outcome:    "Yes" | "No";
  confidence: number;    // 0–100
  reasoning:  string;
  sources:    string[];
};


export function buildGeminiRequest(
  sendRequester: HTTPSendRequester,
  config: GeminiConfig
): GeminiSettlementResult {
  const prompt = buildPrompt(config.question);

  const bodyString = JSON.stringify({
    model: MODEL,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
    temperature: 0.1,               // low temp → deterministic output
    max_tokens:  512,
  });

  // ── POST to OpenRouter (OpenAI-compatible) ────────────────────────────────
  const response = sendRequester
    .sendRequest({
      url:     OPENROUTER_URL,
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${config.apiKey}`,
        "HTTP-Referer":  "https://github.com/Hassan1004/ppm",  
        "X-Title":       "CRE Prediction Market",
      },
      body: Buffer.from(bodyString).toString("base64"),
    })
    .result();

  // ── HTTP error check ──────────────────────────────────────────────────────
  if (!ok(response)) {
    return safeDefault(`OpenRouter HTTP ${response.statusCode}`);
  }

  // ── Extract text from OpenRouter response JSON ────────────────────────────
  const rawText = extractOpenRouterText(text(response));
  return parseGeminiJSON(rawText);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildPrompt(question: string): string {
  return `You are a prediction market resolver. Determine the factual outcome of:

Question: "${question}"

Rules:
1. Use your knowledge to verify the outcome.
2. Return ONLY valid JSON — no extra text, no markdown fences:
{
  "outcome": "Yes" | "No",
  "confidence": <integer 0-100>,
  "reasoning": "<1-2 sentence explanation with sources>",
  "sources": ["<url or citation>"]
}
3. If confidence is below 60%, set outcome to "No" as a safe default.`;
}

/**
 * OpenRouter returns an OpenAI-compatible response:
 * { choices: [{ message: { content: "..." } }] }
 */
function extractOpenRouterText(responseBody: string): string {
  try {
    const data = JSON.parse(responseBody) as {
      choices?: Array<{
        message?: { content?: string };
      }>;
    };
    return data?.choices?.[0]?.message?.content ?? "";
  } catch {
    return "";
  }
}

function parseGeminiJSON(rawText: string): GeminiSettlementResult {
  // Model sometimes wraps output in markdown code fences — strip them
  const cleaned = rawText
    .replace(/```json\s*/g, "")
    .replace(/```\s*/g, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as GeminiSettlementResult;

    if (!["Yes", "No"].includes(parsed.outcome)) {
      throw new Error(`Unexpected outcome value: "${parsed.outcome}"`);
    }
    if (typeof parsed.confidence !== "number") {
      throw new Error("Missing or non-numeric confidence field");
    }

    return parsed;
  } catch (e) {
    return safeDefault(`JSON parse failed: ${rawText.slice(0, 80)}`);
  }
}

function safeDefault(reason: string): GeminiSettlementResult {
  return {
    outcome:    "No",
    confidence: 0,
    reasoning:  reason,
    sources:    [],
  };
}