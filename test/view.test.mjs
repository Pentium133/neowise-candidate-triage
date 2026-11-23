import { test } from "node:test";
import assert from "node:assert/strict";
import { viewFor } from "../view.mjs";

test("ready: показываем тему по-русски и черновик", () => {
  const view = viewFor({ status: "ready", topic: "delivery", draft: "Здравствуйте" });
  assert.equal(view.kind, "ready");
  assert.equal(view.topic, "Доставка");
  assert.equal(view.draft, "Здравствуйте");
});

test("manual_review: сообщение менеджеру, тема и черновик пустые", () => {
  const view = viewFor({ status: "manual_review", topic: null, draft: null });
  assert.equal(view.kind, "manual");
  assert.match(view.message, /вручную/);
  assert.equal(view.topic, "");
  assert.equal(view.draft, "");
});

test("invalid_input: просим ввести текст, черновика нет", () => {
  const view = viewFor({ status: "invalid_input" });
  assert.equal(view.kind, "invalid");
  assert.match(view.message, /текст заявки/i);
  assert.equal(view.draft, "");
});

for (const [name, reply] of [
  ["сеть недоступна (ответа нет)", undefined],
  ["server_error", { status: "server_error" }],
  ["ready без черновика", { status: "ready", topic: "delivery", draft: "" }],
  ["ready с неизвестной темой", { status: "ready", topic: "refund", draft: "текст" }],
]) {
  test(`${name}: ручной разбор без черновика`, () => {
    const view = viewFor(reply);
    assert.equal(view.kind, "manual");
    assert.equal(view.topic, "");
    assert.equal(view.draft, "");
  });
}
