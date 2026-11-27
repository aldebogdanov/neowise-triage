import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";

let server;
let baseUrl;

before(async () => {
  const port = await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

  server = spawn(process.execPath, [fileURLToPath(new URL("./server.mjs", import.meta.url))], {
    env: { ...process.env, PORT: String(port) },
    stdio: "ignore",
  });
  baseUrl = `http://127.0.0.1:${port}`;

  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(baseUrl);
      await response.text();
      if (response.ok) return;
    } catch {}
    await delay(50);
  }

  server.kill();
  throw new Error("Server did not start");
});

after(() => new Promise((resolve) => {
  if (!server || server.exitCode !== null) return resolve();
  server.once("exit", resolve);
  server.kill();
}));

async function postTriage(body) {
  const response = await fetch(`${baseUrl}/api/triage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test("returns ready responses for every supported topic", async () => {
  const cases = [
    ["Доставка заказа", "delivery"],
    ["Какая стоимость?", "pricing"],
    ["Общий вопрос", "other"],
  ];

  for (const [text, topic] of cases) {
    const response = await postTriage({ text });
    assert.equal(response.status, 200, text);
    assert.deepEqual(response.body, {
      status: "ready",
      topic,
      draft: "Спасибо за обращение. Уточним детали заявки.",
    });
  }
});

test("returns manual_review for every mock failure", async () => {
  const cases = ["[timeout]", "[error]", "[bad-json]", "[bad-topic]", "[empty-draft]"];

  for (const text of cases) {
    const response = await postTriage({ text });
    assert.equal(response.status, 200, text);
    assert.deepEqual(response.body, {
      status: "manual_review",
      topic: null,
      draft: null,
    }, text);
  }
});

test("rejects malformed JSON and invalid text with 400", async () => {
  const cases = [
    "{broken",
    "null",
    {},
    { text: "" },
    { text: "   " },
    { text: null },
    { text: 42 },
    { text: [] },
    { text: {} },
  ];

  for (const body of cases) {
    const response = await postTriage(body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.deepEqual(response.body, { status: "invalid_input" }, JSON.stringify(body));
  }
});
