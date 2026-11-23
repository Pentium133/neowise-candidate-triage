import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTriageServer } from "../server.mjs";

const MANUAL = { status: "manual_review", topic: null, draft: null };
const INVALID = { status: "invalid_input" };

async function start(options) {
  const server = createTriageServer(options);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/triage`;
  return {
    close: () => new Promise((resolve) => server.close(resolve)),
    async post(body) {
      const reply = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body),
      });
      return { status: reply.status, body: await reply.json() };
    },
  };
}

// Основной набор идёт через выданный имитатор без подмен.
let app;
before(async () => { app = await start(); });
after(() => app.close());

for (const [text, topic] of [
  ["Когда будет доставка?", "delivery"],
  ["Какая цена у тарифа?", "pricing"],
  ["Здравствуйте, есть вопрос", "other"],
]) {
  test(`обычная заявка (${topic}): 200, тема и черновик`, async () => {
    const reply = await app.post({ text });
    assert.equal(reply.status, 200);
    assert.deepEqual(reply.body, {
      status: "ready",
      topic,
      draft: "Спасибо за обращение. Уточним детали заявки.",
    });
  });
}

for (const [name, body] of [
  ["пустая строка", { text: "" }],
  ["только пробелы", { text: " \n\t " }],
  ["поле text отсутствует", {}],
  ["text — число", { text: 42 }],
  ["text — null", { text: null }],
  ["тело — null", "null"],
  ["тело — массив", "[]"],
  ["битый JSON", "{\"text\": "],
  ["пустое тело", ""],
]) {
  test(`некорректный ввод (${name}): 400 invalid_input`, async () => {
    const reply = await app.post(body);
    assert.equal(reply.status, 400);
    assert.deepEqual(reply.body, INVALID);
  });
}

for (const marker of ["[error]", "[bad-json]", "[bad-topic]", "[empty-draft]"]) {
  test(`сбой имитатора ${marker}: 200 manual_review без темы и черновика`, async () => {
    const reply = await app.post({ text: `Вопрос по доставке ${marker}` });
    assert.equal(reply.status, 200);
    assert.deepEqual(reply.body, MANUAL);
  });
}

test("таймаут [timeout]: manual_review раньше, чем имитатор ответит", async () => {
  const started = performance.now();
  const reply = await app.post({ text: "Где заказ? [timeout]" });
  const elapsed = performance.now() - started;
  assert.equal(reply.status, 200);
  assert.deepEqual(reply.body, MANUAL);
  // Имитатор молчит 1200 мс, лимит 300 мс. Запас оставлен на медленный CI.
  assert.ok(elapsed >= 290 && elapsed < 900, `ответ пришёл через ${elapsed.toFixed(0)} мс`);
});

// Ответы, которых имитатор не даёт, но настоящая модель может.
async function withModel(classify, run, timeoutMs) {
  const custom = await start({ classify, timeoutMs });
  try { return await run(custom); } finally { await custom.close(); }
}

for (const [name, output] of [
  ["не строка", { topic: "delivery", draft: "ок" }],
  ["JSON-массив", "[]"],
  ["JSON null", "null"],
  ["черновик — число", JSON.stringify({ topic: "delivery", draft: 5 })],
  ["нет черновика", JSON.stringify({ topic: "delivery" })],
  ["тема из прототипа объекта", JSON.stringify({ topic: "toString", draft: "ок" })],
]) {
  test(`неподходящий ответ модели (${name}): manual_review`, async () => {
    const reply = await withModel(async () => output, (custom) => custom.post({ text: "Заявка" }));
    assert.equal(reply.status, 200);
    assert.deepEqual(reply.body, MANUAL);
  });
}

test("модель игнорирует отмену: ответ всё равно приходит по лимиту", async () => {
  const neverAnswers = () => new Promise(() => {});
  const reply = await withModel(neverAnswers, (custom) => custom.post({ text: "Заявка" }), 50);
  assert.deepEqual(reply.body, MANUAL);
});

test("лишние поля модели не попадают в ответ, черновик без пробелов по краям", async () => {
  const output = JSON.stringify({ topic: "other", draft: "  Здравствуйте  ", status: "hacked", note: "x" });
  const reply = await withModel(async () => output, (custom) => custom.post({ text: "Заявка" }));
  assert.deepEqual(reply.body, { status: "ready", topic: "other", draft: "Здравствуйте" });
});
