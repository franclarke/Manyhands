import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { requestJson, ExperimentHttpError } from "./run-experiment-http.mjs";

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

test("requestJson attributes an HTTP failure to method and endpoint", async () => {
  const { server, baseUrl } = await listen((_request, response) => {
    response.writeHead(503, { "content-type": "text/plain" });
    response.end("workspace repository unavailable");
  });
  try {
    await assert.rejects(
      requestJson(baseUrl, "/api/workspaces", { token: "test-token", timeoutMs: 1000 }),
      (error) => {
        assert.ok(error instanceof ExperimentHttpError);
        assert.match(error.message, /^GET \/api\/workspaces -> 503/);
        assert.match(error.message, /workspace repository unavailable/);
        return true;
      }
    );
  } finally {
    server.close();
  }
});

test("requestJson turns a header timeout into an attributed failure", async () => {
  const { server, baseUrl } = await listen(() => {
    // Deliberately leave headers pending to reproduce the observed preflight
    // failure without waiting for the driver's global wall-clock limit.
  });
  try {
    await assert.rejects(
      requestJson(baseUrl, "/api/workspaces", { token: "test-token", timeoutMs: 20 }),
      (error) => {
        assert.ok(error instanceof ExperimentHttpError);
        assert.match(error.message, /^GET \/api\/workspaces failed:/);
        assert.match(error.message, /timed out|abort|fetch failed/i);
        return true;
      }
    );
  } finally {
    server.close();
  }
});
