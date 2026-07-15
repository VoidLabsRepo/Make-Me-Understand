const API_BASE = "";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("mmu_token");
}

export function setToken(token: string) {
  localStorage.setItem("mmu_token", token);
}

export function clearToken() {
  localStorage.removeItem("mmu_token");
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ponytail: fetch + 120s abort, kills 3x AbortController boilerplate
async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 240_000);
  try {
    const res = await fetch(url, { ...init, signal: ac.signal });
    clearTimeout(t);
    return res;
  } catch (e: any) {
    clearTimeout(t);
    console.error(`[api] fetch failed: ${init.method || "GET"} ${url}`, e?.name || e);
    throw e;
  }
}

// ponytail: check response + throw with status, kills 15 identical if/throw blocks
function checkOk(res: Response, msg: string): Response {
  if (!res.ok) {
    console.error(`[api] ${msg} failed: ${res.status}`);
    throw new Error(`${msg} (${res.status})`);
  }
  return res;
}

export interface Session {
  id: number;
  title: string;
  notes: string | null;
  image_context: string;
  created_at: string;
  messages: { id: number; role: string; content: string }[];
  has_more_messages: boolean;
  total_messages: number;
}

export interface SessionListItem {
  id: number;
  title: string;
  created_at: string;
}

export async function createSession(
  title?: string,
): Promise<Session> {
  const res = await fetch(`${API_BASE}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ title: title || "New Session" }),
  });
  return checkOk(res, "create session").json();
}

export async function listSessions(): Promise<SessionListItem[]> {
  const res = await fetch(`${API_BASE}/api/sessions`, { headers: authHeaders() });
  return checkOk(res, "list sessions").json();
}

export async function getSession(id: number): Promise<Session> {
  const res = await fetch(`${API_BASE}/api/sessions/${id}`, { headers: authHeaders() });
  return checkOk(res, "get session").json();
}

export async function getMessages(
  sessionId: number,
  beforeId?: number,
  limit: number = 7,
): Promise<{ messages: { id: number; role: string; content: string }[]; has_more: boolean }> {
  const params = new URLSearchParams();
  if (beforeId != null) params.set("before", String(beforeId));
  params.set("limit", String(limit));
  const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/messages?${params}`, { headers: authHeaders() });
  return checkOk(res, "get messages").json();
}

export interface ReasoningStep {
  label: string;
  description: string;
  status?: "complete" | "active" | "pending";
}

export async function sendMessage(
  sessionId: number,
  message: string,
): Promise<{
  response: string;
  reasoning: ReasoningStep[];
  note_changes: NoteChange[];
  canvas_changes: CanvasChange[];
}> {
  const res = await fetchWithTimeout(`${API_BASE}/api/sessions/${sessionId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ message }),
  });
  console.log("[api] sendMessage:", res.status);
  return checkOk(res, "send message").json();
}

export interface StreamEvent {
  type: "text" | "reasoning" | "canvas" | "note" | "done" | "error";
  data: any;
}

export async function* sendMessageStream(
  sessionId: number,
  message: string,
): AsyncGenerator<StreamEvent, void, unknown> {
  const res = await fetchWithTimeout(`${API_BASE}/api/sessions/${sessionId}/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ message }),
  });
  console.log("[api] sendMessageStream:", res.status);
  checkOk(res, "stream message");

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    let eventType = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) {
        eventType = line.slice(7).trim();
      } else if (line.startsWith("data: ")) {
        const raw = line.slice(6);
        try {
          const data = JSON.parse(raw);
          yield { type: (eventType || "text") as StreamEvent["type"], data };
        } catch {
          // partial JSON, skip
        }
      } else if (line.trim() === "") {
        // Empty line resets event type (SSE spec)
        eventType = "";
      }
    }
  }
}

export interface WordTiming {
  word: string;
  start: number;
  end: number;
}

export interface VoiceResponse {
  response: string;
  reasoning: ReasoningStep[];
  word_timings: WordTiming[];
  note_changes: NoteChange[];
  canvas_changes: CanvasChange[];
}

export async function sendVoiceMessage(sessionId: number, message: string): Promise<VoiceResponse> {
  const res = await fetchWithTimeout(`/api/sessions/${sessionId}/voice-chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ message }),
  });
  console.log("[api] sendVoiceMessage:", res.status);
  return checkOk(res, "send voice message").json();
}

export async function appendImages(sessionId: number, files: File[]): Promise<string | null> {
  const form = new FormData();
  for (const file of files) {
    form.append("files", file);
  }
  const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/append-images`, {
    method: "POST",
    headers: authHeaders(),
    body: form,
  });
  const data = await checkOk(res, "append images").json();
  return data.notes;
}

export async function renameSession(id: number, title: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/sessions/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ title }),
  });
  checkOk(res, "rename session");
}

export async function deleteSession(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/sessions/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  checkOk(res, "delete session");
}

export interface Note {
  id: number;
  session_id: number;
  title: string;
  content?: string;
  created_at: string;
  updated_at: string;
}

export interface NoteChange {
  action: "created" | "updated" | "deleted";
  note_id: number;
  title?: string;
}

export async function listNotes(sessionId: number): Promise<Note[]> {
  const res = await fetch(`${API_BASE}/api/notes/session/${sessionId}`, { headers: authHeaders() });
  return checkOk(res, "list notes").json();
}

export async function getNote(noteId: number): Promise<Note> {
  const res = await fetch(`${API_BASE}/api/notes/${noteId}`, { headers: authHeaders() });
  return checkOk(res, "get note").json();
}

export async function createNote(sessionId: number, title: string, content: string): Promise<Note> {
  console.log("[api] createNote:", title);
  const res = await fetch(`${API_BASE}/api/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ session_id: sessionId, title, content }),
  });
  return checkOk(res, "create note").json();
}

export async function updateNote(noteId: number, data: { title?: string; content?: string }): Promise<void> {
  console.log("[api] updateNote:", noteId);
  const res = await fetch(`${API_BASE}/api/notes/${noteId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(data),
  });
  checkOk(res, "update note");
}

export async function deleteNote(noteId: number): Promise<void> {
  console.log("[api] deleteNote:", noteId);
  const res = await fetch(`${API_BASE}/api/notes/${noteId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  checkOk(res, "delete note");
}

// Canvas

export type CanvasElementType = "definition" | "formula" | "flowchart" | "note" | "example" | "heading";

export interface CanvasElement {
  id: string;
  type: CanvasElementType;
  label: string;
  content: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  connections?: string[];
}

export interface Canvas {
  id: number;
  session_id: number;
  title: string;
  elements?: CanvasElement[];
  created_at: string;
  updated_at: string;
}

export interface CanvasChange {
  action: "created" | "updated" | "deleted";
  canvas_id: number;
  title?: string;
}

export async function listCanvases(sessionId: number): Promise<Canvas[]> {
  const res = await fetch(`${API_BASE}/api/canvases/session/${sessionId}`, { headers: authHeaders() });
  return checkOk(res, "list canvases").json();
}

export async function getCanvas(canvasId: number): Promise<Canvas> {
  const res = await fetch(`${API_BASE}/api/canvases/${canvasId}`, { headers: authHeaders() });
  return checkOk(res, "get canvas").json();
}

export async function createCanvas(sessionId: number, title: string, elements: CanvasElement[]): Promise<Canvas> {
  console.log("[api] createCanvas:", title, elements.length, "elements");
  const res = await fetch(`${API_BASE}/api/canvases`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ session_id: sessionId, title, elements }),
  });
  return checkOk(res, "create canvas").json();
}

export async function updateCanvas(canvasId: number, data: { title?: string; elements?: CanvasElement[] }): Promise<void> {
  console.log("[api] updateCanvas:", canvasId);
  const res = await fetch(`${API_BASE}/api/canvases/${canvasId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(data),
  });
  checkOk(res, "update canvas");
}

export async function deleteCanvas(canvasId: number): Promise<void> {
  console.log("[api] deleteCanvas:", canvasId);
  const res = await fetch(`${API_BASE}/api/canvases/${canvasId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  checkOk(res, "delete canvas");
}

// Study Spaces

export interface StudySpace {
  id: number;
  name: string;
  emoji: string;
  created_at: string;
  session_count: number;
  sessions: { id: number; title: string }[];
}

export interface StudySpaceDetail extends StudySpace {
  sessions: { id: number; title: string; created_at: string }[];
}

export async function listStudySpaces(): Promise<StudySpace[]> {
  const res = await fetch(`${API_BASE}/api/study-spaces`, { headers: authHeaders() });
  return checkOk(res, "list study spaces").json();
}

export async function getStudySpace(id: number): Promise<StudySpaceDetail> {
  const res = await fetch(`${API_BASE}/api/study-spaces/${id}`, { headers: authHeaders() });
  return checkOk(res, "get study space").json();
}

export async function createStudySpace(name: string, emoji: string = ""): Promise<StudySpace> {
  const res = await fetch(`${API_BASE}/api/study-spaces`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ name, emoji }),
  });
  return checkOk(res, "create study space").json();
}

export async function renameStudySpace(id: number, name: string, emoji: string = ""): Promise<void> {
  const res = await fetch(`${API_BASE}/api/study-spaces/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ name, emoji }),
  });
  checkOk(res, "rename study space");
}

export async function deleteStudySpace(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/study-spaces/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  checkOk(res, "delete study space");
}

export async function addSessionToSpace(spaceId: number, sessionId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/study-spaces/${spaceId}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ session_id: sessionId }),
  });
  checkOk(res, "add session to space");
}

export async function removeSessionFromSpace(spaceId: number, sessionId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/study-spaces/${spaceId}/sessions/${sessionId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  checkOk(res, "remove session from space");
}

export async function signup(email: string, password: string): Promise<{ token: string; email: string }> {
  const res = await fetch(`${API_BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return checkOk(res, "signup").json();
}

export async function login(email: string, password: string): Promise<{ token: string; email: string }> {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return checkOk(res, "login").json();
}

