import { randomUUID } from "node:crypto";

export type WorkspaceIdFactory = () => string;

export const defaultWorkspaceIdFactory: WorkspaceIdFactory = () => randomUUID();
