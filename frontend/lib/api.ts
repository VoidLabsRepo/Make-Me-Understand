const API_BASE = "";

export interface Session {
  id: number;
  title: string;
  notes: string | null;
  image_context: string;
  created_at: string;
  messages: { role: string; content: string }[];
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: title || "New Session" }),
  });
  if (!res.ok) throw new Error("Failed to create session");
  return res.json();
}

export async function listSessions(): Promise<SessionListItem[]> {
  const res = await fetch(`${API_BASE}/api/sessions`);
  if (!res.ok) throw new Error("Failed to list sessions");
  return res.json();
}

export async function getSession(id: number): Promise<Session> {
  const res = await fetch(`${API_BASE}/api/sessions/${id}`);
  if (!res.ok) throw new Error("Failed to get session");
  return res.json();
}

export async function sendMessage(sessionId: number, message: string): Promise<{ response: string; note_changes: NoteChange[] }> {
  const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) throw new Error("Failed to send message");
  return res.json();
}

export interface WordTiming {
  word: string;
  start: number;
  end: number;
}

export interface VoiceResponse {
  response: string;
  word_timings: WordTiming[];
  note_changes: NoteChange[];
}

export async function sendVoiceMessage(sessionId: number, message: string): Promise<VoiceResponse> {
  const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/voice-chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) throw new Error("Failed to send voice message");
  return res.json();
}

export async function generateTTS(sessionId: number, question: string): Promise<Blob> {
  const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
  if (!res.ok) throw new Error("Failed to generate TTS");
  return res.blob();
}

export async function appendImages(sessionId: number, files: File[]): Promise<string | null> {
  const form = new FormData();
  for (const file of files) {
    form.append("files", file);
  }
  const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/append-images`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error("Failed to append images");
  const data = await res.json();
  return data.notes;
}

export async function renameSession(id: number, title: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/sessions/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error("Failed to rename session");
}

export async function deleteSession(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/sessions/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete session");
}

export interface DeletedSession {
  original_id: number;
  title: string;
  created_at: string;
  deleted_at: string;
  expires_at: string;
}

export async function listDeletedSessions(): Promise<DeletedSession[]> {
  const res = await fetch(`${API_BASE}/api/sessions/deleted`);
  if (!res.ok) throw new Error("Failed to list deleted sessions");
  return res.json();
}

export async function restoreSession(originalId: number): Promise<{ id: number; title: string }> {
  const res = await fetch(`${API_BASE}/api/sessions/restore/${originalId}`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Failed to restore session");
  return res.json();
}

export interface Note {
  id: number;
  session_id: number;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface NoteChange {
  action: "created" | "updated" | "deleted";
  note_id: number;
  title?: string;
}

export async function listNotes(sessionId: number): Promise<Note[]> {
  const res = await fetch(`${API_BASE}/api/notes/session/${sessionId}`);
  if (!res.ok) throw new Error("Failed to list notes");
  return res.json();
}

export async function createNote(sessionId: number, title: string, content: string): Promise<Note> {
  const res = await fetch(`${API_BASE}/api/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, title, content }),
  });
  if (!res.ok) throw new Error("Failed to create note");
  return res.json();
}

export async function updateNote(noteId: number, data: { title?: string; content?: string }): Promise<void> {
  const res = await fetch(`${API_BASE}/api/notes/${noteId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update note");
}

export async function deleteNote(noteId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/notes/${noteId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete note");
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
  const res = await fetch(`${API_BASE}/api/study-spaces`);
  if (!res.ok) throw new Error("Failed to list study spaces");
  return res.json();
}

export async function getStudySpace(id: number): Promise<StudySpaceDetail> {
  const res = await fetch(`${API_BASE}/api/study-spaces/${id}`);
  if (!res.ok) throw new Error("Failed to get study space");
  return res.json();
}

export async function createStudySpace(name: string, emoji: string = ""): Promise<StudySpace> {
  const res = await fetch(`${API_BASE}/api/study-spaces`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, emoji }),
  });
  if (!res.ok) throw new Error("Failed to create study space");
  return res.json();
}

export async function renameStudySpace(id: number, name: string, emoji: string = ""): Promise<void> {
  const res = await fetch(`${API_BASE}/api/study-spaces/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, emoji }),
  });
  if (!res.ok) throw new Error("Failed to rename study space");
}

export async function deleteStudySpace(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/study-spaces/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete study space");
}

export async function addSessionToSpace(spaceId: number, sessionId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/study-spaces/${spaceId}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId }),
  });
  if (!res.ok) throw new Error("Failed to add session to space");
}

export async function removeSessionFromSpace(spaceId: number, sessionId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/study-spaces/${spaceId}/sessions/${sessionId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to remove session from space");
}

// Settings

export interface LLMSettings {
  configured: boolean;
  provider?: string;
  model?: string;
  api_key_masked?: string;
  api_base?: string;
}

export async function getSettings(): Promise<LLMSettings> {
  const res = await fetch(`${API_BASE}/api/settings`);
  if (!res.ok) throw new Error("Failed to get settings");
  return res.json();
}

export async function saveSettings(data: {
  provider: string;
  model: string;
  api_key?: string;
  api_base?: string;
}): Promise<void> {
  const res = await fetch(`${API_BASE}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to save settings");
}

export async function listModels(provider: string, api_key?: string, api_base?: string): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/models`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, api_key, api_base }),
  });
  if (!res.ok) throw new Error("Failed to list models");
  const data = await res.json();
  return data.models;
}

