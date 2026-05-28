import { Router } from "express";
import { createTask, deleteTask, getAllTasks, getTaskById, updateTask } from "../models/task.js";

export const tasksRouter = Router();

// GET /tasks — list all tasks
tasksRouter.get("/", (_req, res) => {
  const tasks = getAllTasks();
  res.json(tasks);
});

// GET /tasks/:id — get a single task
tasksRouter.get("/:id", (req, res) => {
  const task = getTaskById(req.params.id);
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  res.json(task);
});

// POST /tasks — create a new task
tasksRouter.post("/", (req, res) => {
  const { title, description } = req.body as { title?: string; description?: string };
  if (!title || !description) {
    res.status(400).json({ error: "title and description are required" });
    return;
  }
  const task = createTask({ title, description });
  res.status(201).json(task);
});

// PUT /tasks/:id — update an existing task
tasksRouter.put("/:id", (req, res) => {
  const result = updateTask(req.params.id, req.body);
  if (!result) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  res.json(result);
});

// DELETE /tasks/:id — delete a task
tasksRouter.delete("/:id", (req, res) => {
  const deleted = deleteTask(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  res.status(204).send();
});
