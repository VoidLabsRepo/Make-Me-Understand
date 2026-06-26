const API_BASE = "";

export interface Session {
  id: number;
  title: string;
  notes: string | null;
  created_at: string;
  messages: { role: string; content: string }[];
}

export interface SessionListItem {
  id: number;
  title: string;
  created_at: string;
}

export async function createSession(
  files: File[],
  onStep?: (step: "uploading" | "extracting" | "synthesizing") => void,
  signal?: AbortSignal,
): Promise<Session> {
  const form = new FormData();
  if (files.length === 0) {
    // Append dummy field to ensure browser constructs a valid multipart/form-data payload
    form.append("empty", "true");
  } else {
    for (const file of files) {
      form.append("files", file);
    }
  }
  onStep?.("uploading");
  const res = await fetch(`${API_BASE}/api/sessions`, {
    method: "POST",
    body: form,
    signal,
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

export async function sendMessage(sessionId: number, message: string): Promise<string> {
  const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) throw new Error("Failed to send message");
  const data = await res.json();
  return data.response;
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

