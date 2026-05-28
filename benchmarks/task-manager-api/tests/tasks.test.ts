import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../src/index.js";
import { clearTasks } from "../src/models/task.js";

// NOTE: This fixture is designed so that GET/POST tests pass but PUT/DELETE
// tests fail until an agent implements updateTask and deleteTask.

beforeEach(() => {
  clearTasks();
});

describe("GET /health", () => {
  it("returns ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("GET /tasks", () => {
  it("returns empty array initially", async () => {
    const res = await request(app).get("/tasks");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns created tasks", async () => {
    await request(app).post("/tasks").send({ title: "Test", description: "A task" });
    const res = await request(app).get("/tasks");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe("Test");
  });
});

describe("GET /tasks/:id", () => {
  it("returns 404 for non-existent task", async () => {
    const res = await request(app).get("/tasks/999");
    expect(res.status).toBe(404);
  });

  it("returns the task by id", async () => {
    const created = await request(app).post("/tasks").send({ title: "Find me", description: "desc" });
    const res = await request(app).get(`/tasks/${created.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Find me");
  });
});

describe("POST /tasks", () => {
  it("creates a task with title and description", async () => {
    const res = await request(app).post("/tasks").send({ title: "New", description: "A new task" });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.title).toBe("New");
    expect(res.body.completed).toBe(false);
  });

  it("returns 400 without title", async () => {
    const res = await request(app).post("/tasks").send({ description: "No title" });
    expect(res.status).toBe(400);
  });

  it("returns 400 without description", async () => {
    const res = await request(app).post("/tasks").send({ title: "No desc" });
    expect(res.status).toBe(400);
  });
});

describe("PUT /tasks/:id", () => {
  it("updates title of an existing task", async () => {
    const created = await request(app).post("/tasks").send({ title: "Old", description: "desc" });
    const res = await request(app).put(`/tasks/${created.body.id}`).send({ title: "Updated" });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Updated");
    expect(res.body.description).toBe("desc");
  });

  it("marks a task as completed", async () => {
    const created = await request(app).post("/tasks").send({ title: "Do it", description: "desc" });
    const res = await request(app).put(`/tasks/${created.body.id}`).send({ completed: true });
    expect(res.status).toBe(200);
    expect(res.body.completed).toBe(true);
  });

  it("returns 404 for non-existent task", async () => {
    const res = await request(app).put("/tasks/999").send({ title: "Nope" });
    expect(res.status).toBe(404);
  });

  it("updates updatedAt timestamp", async () => {
    const created = await request(app).post("/tasks").send({ title: "Time", description: "desc" });
    // Small delay to ensure timestamp differs
    await new Promise((r) => setTimeout(r, 10));
    const res = await request(app).put(`/tasks/${created.body.id}`).send({ title: "Updated" });
    expect(res.status).toBe(200);
    expect(res.body.updatedAt).not.toBe(created.body.createdAt);
  });
});

describe("DELETE /tasks/:id", () => {
  it("deletes an existing task", async () => {
    const created = await request(app).post("/tasks").send({ title: "Delete me", description: "desc" });
    const res = await request(app).delete(`/tasks/${created.body.id}`);
    expect(res.status).toBe(204);

    // Verify it's gone
    const check = await request(app).get(`/tasks/${created.body.id}`);
    expect(check.status).toBe(404);
  });

  it("returns 404 for non-existent task", async () => {
    const res = await request(app).delete("/tasks/999");
    expect(res.status).toBe(404);
  });
});
