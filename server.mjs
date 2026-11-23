import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { classify as mockClassify } from "./mock-ai.mjs";

const MODEL_TIMEOUT_MS = 300;
const MAX_BODY_BYTES = 100_000;
const TOPICS = new Set(["delivery", "pricing", "other"]);
const MANUAL_REVIEW = { status: "manual_review", topic: null, draft: null };

const assets = {
  "/": ["text/html; charset=utf-8", await readFile(new URL("./index.html", import.meta.url))],
  "/view.mjs": ["text/javascript; charset=utf-8", await readFile(new URL("./view.mjs", import.meta.url))],
};

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

// Возвращает непустой текст заявки или null, если ввод некорректен.
async function readText(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk);
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
  const text = body?.text;
  return typeof text === "string" && text.trim() !== "" ? text : null;
}

// Ждёт модель не дольше лимита. Гонка с таймером нужна на случай,
// если модель не реагирует на signal.
async function askModel(classify, text, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("Model timeout"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([classify(text, { signal: controller.signal }), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// Единственное место, где проверяется ответ AI. Наружу уходят только
// проверенные topic и draft, остальные поля модели отбрасываются.
function parseModelOutput(output) {
  if (typeof output !== "string") return null;
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const { topic, draft } = parsed;
  if (!TOPICS.has(topic)) return null;
  if (typeof draft !== "string" || draft.trim() === "") return null;
  return { topic, draft: draft.trim() };
}

async function triage(classify, text, timeoutMs) {
  let output;
  try {
    output = await askModel(classify, text, timeoutMs);
  } catch {
    return MANUAL_REVIEW;
  }
  const result = parseModelOutput(output);
  return result ? { status: "ready", ...result } : MANUAL_REVIEW;
}

export function createTriageServer({ classify = mockClassify, timeoutMs = MODEL_TIMEOUT_MS } = {}) {
  return createServer(async (request, response) => {
    try {
      const asset = request.method === "GET" && Object.hasOwn(assets, request.url) && assets[request.url];
      if (asset) {
        response.writeHead(200, { "Content-Type": asset[0] });
        response.end(asset[1]);
        return;
      }
      if (request.method !== "POST" || request.url !== "/api/triage") {
        return json(response, 404, { status: "not_found" });
      }
      const text = await readText(request);
      if (text === null) return json(response, 400, { status: "invalid_input" });
      json(response, 200, await triage(classify, text, timeoutMs));
    } catch {
      if (!response.headersSent) json(response, 500, { status: "server_error" });
      else response.end();
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createTriageServer().listen(Number(process.env.PORT || 3000), "127.0.0.1");
}
