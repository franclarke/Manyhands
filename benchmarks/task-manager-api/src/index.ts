import express from "express";
import { tasksRouter } from "./routes/tasks.js";

export const app = express();

app.use(express.json());
app.use("/tasks", tasksRouter);

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Only start listening when run directly (not imported for tests)
const isDirectRun = process.argv[1]?.endsWith("index.ts") || process.argv[1]?.endsWith("index.js");
if (isDirectRun) {
  const port = process.env["PORT"] ?? 3001;
  app.listen(port, () => {
    console.log(`task-manager-api listening on port ${port}`);
  });
}
