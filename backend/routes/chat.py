from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import aiosqlite
from database import get_db
from services.llm import chat_with_context, voice_explain
from services.tts import generate_tts

router = APIRouter(prefix="/api/sessions", tags=["chat"])


class ChatRequest(BaseModel):
    message: str


@router.post("/{session_id}/chat")
async def chat(
    session_id: int,
    req: ChatRequest,
    db: aiosqlite.Connection = Depends(get_db),
):
    # Get session notes
    cursor = await db.execute("SELECT notes FROM sessions WHERE id = ?", (session_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Session not found")

    notes = row["notes"] or ""

    # Get chat history
    msg_cursor = await db.execute(
        "SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at",
        (session_id,),
    )
    history = [{"role": r["role"], "content": r["content"]} for r in await msg_cursor.fetchall()]

    # Save user message
    await db.execute(
        "INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)",
        (session_id, "user", req.message),
    )

    # Get AI response
    response = await chat_with_context(notes, history, req.message)

    # Save AI response
    await db.execute(
        "INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)",
        (session_id, "assistant", response),
    )
    await db.commit()

    return {"response": response}


class TTSRequest(BaseModel):
    text: str | None = None
    question: str | None = None


@router.post("/{session_id}/tts")
async def tts(
    session_id: int,
    req: TTSRequest,
    db: aiosqlite.Connection = Depends(get_db),
):
    cursor = await db.execute("SELECT notes FROM sessions WHERE id = ?", (session_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Session not found")

    notes = row["notes"] or ""
    text_to_speak = req.text

    if req.question and not text_to_speak:
        text_to_speak = await voice_explain(notes, req.question)

    if not text_to_speak:
        raise HTTPException(status_code=400, detail="Provide text or question")

    audio_bytes = await generate_tts(text_to_speak)
    return StreamingResponse(
        iter([audio_bytes]),
        media_type="audio/wav",
        headers={"Content-Disposition": "attachment; filename=tts.wav"},
    )
