export interface Task {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
}

export type CreateTaskInput = Pick<Task, "title" | "description">;
export type UpdateTaskInput = Partial<Pick<Task, "title" | "description" | "completed">>;

// In-memory store — sufficient for a benchmark fixture.
const tasks = new Map<string, Task>();
let nextId = 1;

export function getAllTasks(): Task[] {
  return Array.from(tasks.values());
}

export function getTaskById(id: string): Task | undefined {
  return tasks.get(id);
}

export function createTask(input: CreateTaskInput): Task {
  const now = new Date().toISOString();
  const task: Task = {
    id: String(nextId++),
    title: input.title,
    description: input.description,
    completed: false,
    createdAt: now,
    updatedAt: now,
  };
  tasks.set(task.id, task);
  return task;
}

// TODO: Implement updateTask
export function updateTask(_id: string, _input: UpdateTaskInput): Task | undefined {
  return undefined;
}

// TODO: Implement deleteTask
export function deleteTask(_id: string): boolean {
  return false;
}

export function clearTasks(): void {
  tasks.clear();
  nextId = 1;
}
