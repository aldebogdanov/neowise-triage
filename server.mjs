import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { classify } from "./mock-ai.mjs";
import { setTimeout } from 'node:timers/promises';

const html = await readFile(new URL("./index.html", import.meta.url));

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function validateText(text) {
  return typeof text === "string" && text.trim().length > 0;
}

const manualReview = { status: "manual_review", topic: null, draft: null };

function validateResult(result) {
  return typeof result === "object" && result !== null && 
    ["delivery", "pricing", "other"].includes(result["topic"]) && 
    typeof result["draft"] === "string" && result["draft"].trim().length > 0 ?
    { status: "ready", ...result } : manualReview;
}

async function classifyWithTimeout(text, ms = 300) {
  const controller = new AbortController();
  try {
    const json = await Promise.race([
      classify(text, { signal: controller.signal }),
      setTimeout(ms, JSON.stringify(manualReview), { signal: controller.signal })
    ])
    return JSON.parse(json);
  } catch (e) {
    console.log(e);
    return manualReview;
  } finally {
    controller.abort();
  }
}

async function handleTriage(request, response) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const jsonString = Buffer.concat(chunks).toString("utf8");
  let text = undefined;
  try {
    text = JSON.parse(jsonString).text;
    console.log("Received text:", text)
    if (!validateText(text)) throw new Error("Invalid input");
  } catch (e) {
    return json(response, 400, { status: "invalid_input" });
  }
  const result = validateResult(await classifyWithTimeout(text));
  return json(response, 200, result);
}

createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(html);
    return;
  }
  if (request.method !== "POST" || request.url !== "/api/triage") {
    return json(response, 404, { status: "not_found" });
  }
  try {
    await handleTriage(request, response);
  } catch (e) {
    console.log(e)
    json(response, 500, { status: "server_error" });
  }
}).listen(Number(process.env.PORT || 3000), "127.0.0.1");
