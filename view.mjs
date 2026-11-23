// Превращает ответ API в то, что видит менеджер. Чистая функция:
// её использует страница и проверяет тест. Любой исход, кроме успеха,
// возвращает пустые тему и черновик, поэтому старый черновик не остаётся на экране.

const TOPIC_LABELS = new Map([
  ["delivery", "Доставка"],
  ["pricing", "Цены"],
  ["other", "Другое"],
]);

const MANUAL = {
  kind: "manual",
  message: "Автоматический разбор не удался. Разберите заявку вручную: определите тему и напишите ответ сами.",
  topic: "",
  draft: "",
};

const INVALID = {
  kind: "invalid",
  message: "Введите текст заявки.",
  topic: "",
  draft: "",
};

export function viewFor(reply) {
  if (reply?.status === "invalid_input") return INVALID;
  const topic = TOPIC_LABELS.get(reply?.topic);
  const draft = reply?.draft;
  if (reply?.status !== "ready" || !topic || typeof draft !== "string" || draft.trim() === "") {
    return MANUAL;
  }
  return {
    kind: "ready",
    message: "Черновик готов. Проверьте его перед отправкой клиенту.",
    topic,
    draft,
  };
}

export const invalidView = INVALID;
