const assert = require("node:assert/strict");
const http = require("node:http");
const { ApiResponseError, sendApiRequest } = require("../test-dist/api-transport.js");
const {
  isUnsupportedTaskDeadlineError,
  resolveCreateTaskPayload,
  TASK_DEADLINE_UNSUPPORTED_MESSAGE,
  TaskFormValidationError,
  taskListForDeadline,
} = require("../test-dist/create-task-form.js");

const requests = [];
const server = http.createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  request.on("end", () => {
    const bodyText = Buffer.concat(chunks).toString("utf8");
    requests.push({
      path: request.url,
      method: request.method,
      headers: request.headers,
      bodyText,
    });

    if (request.url === "/v1/unauthorized") {
      response.writeHead(401, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "UNAUTHORIZED" }));
      return;
    }
    if (request.url === "/v1/unsupported-task-deadline") {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "INVALID_TASK" }));
      return;
    }
    if (request.url === "/v1/slow") {
      setTimeout(() => {
        if (!response.destroyed) {
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ ok: true }));
        }
      }, 1_000);
      return;
    }

    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
  });
});

function assertNoBrowserHeaders(headers) {
  for (const name of [
    "origin",
    "referer",
    "sec-fetch-site",
    "sec-fetch-mode",
    "sec-fetch-dest",
  ]) {
    assert.equal(
      headers[name],
      undefined,
      `native request must not send ${name}`,
    );
  }
}

async function main() {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;

  try {
    await sendApiRequest("/pair", {
      method: "POST",
      body: { code: "1234567890" },
      baseUrl,
    });
    const pairing = requests.at(-1);
    assert.equal(pairing.method, "POST");
    assert.equal(
      pairing.headers.authorization,
      undefined,
      "pairing must not send an existing token",
    );
    assert.equal(JSON.parse(pairing.bodyText).code, "1234567890");
    assertNoBrowserHeaders(pairing.headers);

    const testToken = "a".repeat(64);
    await sendApiRequest("/notes?query=termo%20com%20espa%C3%A7o", {
      token: testToken,
      baseUrl,
    });
    const search = requests.at(-1);
    assert.equal(search.path, "/v1/notes?query=termo%20com%20espa%C3%A7o");
    assert.equal(search.headers.authorization, `Bearer ${testToken}`);
    assertNoBrowserHeaders(search.headers);

    await assert.rejects(
      () => sendApiRequest("/unauthorized", { token: testToken, baseUrl }),
      (error) =>
        error instanceof Error &&
        error.message.includes("expirou ou foi revogado") &&
        !error.message.includes(testToken),
    );

    await assert.rejects(
      () => sendApiRequest("/unsupported-task-deadline", { method: "POST", body: { dueAt: 1 }, token: testToken, baseUrl }),
      (error) => error instanceof ApiResponseError && error.statusCode === 400 && error.code === "INVALID_TASK",
      "the extension retains the response code needed to explain an older Caderno bridge",
    );

    const pickedLocalDate = new Date(2030, 1, 3, 14, 37, 12, 345);
    const fallback = { title: "  tarefa controlada  ", priority: "normal", dueAt: pickedLocalDate };
    assert.deepEqual(resolveCreateTaskPayload("note-id", {}, fallback), {
      noteId: "note-id", title: "tarefa controlada", priority: "normal", dueAt: pickedLocalDate.getTime(),
    }, "submit falls back to the latest controlled title, priority, and local Date when Raycast omits values");
    assert.deepEqual(resolveCreateTaskPayload("note-id", { dueAt: null, priority: "high" }, fallback), {
      noteId: "note-id", title: "tarefa controlada", priority: "high",
    }, "explicitly empty deadline is omitted and priority is still read from submit values");
    assert.deepEqual(resolveCreateTaskPayload("note-id", { title: "abc", priority: "normal" }, { ...fallback, dueAt: null }), {
      noteId: "note-id", title: "abc", priority: "normal",
    }, "a task with no deadline does not send dueAt");
    assert.throws(() => resolveCreateTaskPayload("note-id", { title: "  " }, fallback), TaskFormValidationError);
    assert.throws(() => resolveCreateTaskPayload("note-id", { priority: "urgent" }, fallback), /prioridade válida/);
    assert.throws(() => resolveCreateTaskPayload("note-id", { dueAt: "2030-02-03" }, fallback), /data e hora válidas/);
    assert.equal(isUnsupportedTaskDeadlineError({ statusCode: 400, code: "INVALID_TASK" }), true);
    assert.equal(isUnsupportedTaskDeadlineError({ statusCode: 400, code: "NOTE_NOT_FOUND" }), false);
    assert.equal(isUnsupportedTaskDeadlineError({ statusCode: 500, code: "INVALID_TASK" }), false);
    assert.match(TASK_DEADLINE_UNSUPPORTED_MESSAGE, /Caderno instalado ainda não aceita prazos.*Atualize o app/i);

    const todayStart = new Date(2030, 1, 3).getTime();
    assert.equal(taskListForDeadline(undefined, todayStart + 12 * 60 * 60 * 1000), "Todas");
    assert.equal(taskListForDeadline(todayStart + 20 * 60 * 60 * 1000, todayStart + 12 * 60 * 60 * 1000), "Hoje");
    assert.equal(taskListForDeadline(todayStart + 24 * 60 * 60 * 1000, todayStart + 12 * 60 * 60 * 1000), "Próximas");
    assert.equal(taskListForDeadline(todayStart - 1, todayStart + 12 * 60 * 60 * 1000), "Atrasadas");

    const controller = new AbortController();
    const slowRequest = sendApiRequest("/slow", {
      token: testToken,
      baseUrl,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 25);
    await assert.rejects(slowRequest, /Busca cancelada/);

    console.log(
      "PASS cliente HTTP e formulário: pareamento sem Bearer, autenticação, sem headers de navegador, erro compatível com ponte antiga, fallback controlado, validação e filtros do prazo",
    );
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

main().catch((error) => {
  console.error(
    "FAIL cliente HTTP",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
