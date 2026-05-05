export type TaskStatus =
  | "running"
  | "waiting_for_input"
  | "completed"
  | "failed";

export type MessageRole = "user" | "assistant" | "system";

export type MessageRead = {
  id: number;
  role: MessageRole;
  content: string;
  created_at: string;
  updated_at: string;
};

export type TaskEventRead = {
  id: number;
  event_type: string;
  content: string;
  created_at: string;
  updated_at: string;
};

export type LoginResponse = {
  token: string;
  token_type: string;
  label: string;
  expires_at: string;
};

export type SessionInfo = {
  label: string;
  created_at: string;
  last_used_at: string;
  expires_at: string;
};

export type AppServerStatus = {
  enabled: boolean;
  listen_url: string;
  ready: boolean;
  pid: number | null;
  workspace_root: string;
  model: string;
};
