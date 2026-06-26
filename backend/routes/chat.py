from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import aiosqlite
import os
from database import get_db
from services.llm import chat_with_context, voice_explain, voice_chat_with_context, clean_voice_text
from services.tts import generate_tts, stream_tts, make_wav_header, get_cache_path, generate_voice_timings

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


@router.post("/{session_id}/voice-chat")
async def voice_chat(
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

    # Get voice-friendly AI response
    raw_response = await voice_chat_with_context(notes, history, req.message)
    response = clean_voice_text(raw_response)

    # Generate audio and word timings
    wav_bytes, timings = await generate_voice_timings(response)

    # Cache the audio bytes on disk
    cache_path = get_cache_path(session_id)
    with open(cache_path, "wb") as f:
        f.write(wav_bytes)

    # Save AI response
    await db.execute(
        "INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)",
        (session_id, "assistant", response),
    )
    await db.commit()

    return {"response": response, "word_timings": timings}


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


@router.get("/{session_id}/tts")
async def tts_get(
    session_id: int,
    question: str | None = None,
    text: str | None = None,
    db: aiosqlite.Connection = Depends(get_db),
):
    # 1. If cached WAV file exists, stream it immediately
    cache_path = get_cache_path(session_id)
    if os.path.exists(cache_path):
        def iter_file():
            with open(cache_path, "rb") as f:
                yield f.read()
        return StreamingResponse(
            iter_file(),
            media_type="audio/wav",
            headers={"Content-Disposition": "attachment; filename=tts.wav"},
        )

    # 2. Fallback to dynamic generation
    cursor = await db.execute("SELECT notes FROM sessions WHERE id = ?", (session_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Session not found")

    notes = row["notes"] or ""
    text_to_speak = text

    if question and not text_to_speak:
        text_to_speak = await voice_explain(notes, question)

    if not text_to_speak:
        raise HTTPException(status_code=400, detail="Provide text or question")

    async def generate_audio_stream():
        yield make_wav_header(sample_rate=24000, num_channels=1, bits_per_sample=16)
        async for chunk in stream_tts(text_to_speak):
            yield chunk

    return StreamingResponse(
        generate_audio_stream(),
        media_type="audio/wav",
        headers={"Content-Disposition": "attachment; filename=tts.wav"},
    )
