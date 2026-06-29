from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import aiosqlite
import re
import json
import os
from database import get_db
from services.llm import chat_with_context, voice_explain, voice_chat_with_context, clean_voice_text, generate_title
from services.tts import generate_tts, stream_tts, make_wav_header, get_cache_path, generate_voice_timings

router = APIRouter(prefix="/api/sessions", tags=["chat"])


class ChatRequest(BaseModel):
    message: str


async def _fetch_notes_list(db: aiosqlite.Connection, session_id: int) -> list[dict]:
    cursor = await db.execute(
        "SELECT id, title, content FROM notes WHERE session_id = ? ORDER BY created_at",
        (session_id,),
    )
    return [dict(r) for r in await cursor.fetchall()]


def _parse_tool_calls(response: str) -> tuple[str, list[dict]]:
    """Extract JSON tool calls from ```json code blocks. Returns (cleaned_response, tool_calls)."""
    tool_calls = []
    # Match ```json\n{...}\n``` blocks
    pattern = r'```json\s*\n\s*(\{[^`]+?\})\s*\n\s*```'
    matches = list(re.finditer(pattern, response, re.DOTALL))
    clean_response = response
    for m in matches:
        raw = m.group(1).strip()
        try:
            data = json.loads(raw)
            if data.get("tool") == "note":
                action = data.get("action")
                if action == "create":
                    tool_calls.append({
                        "action": "create_note",
                        "title": data.get("title", "Untitled"),
                        "content": data.get("content", ""),
                    })
                elif action == "update":
                    note_id = data.get("id")
                    if note_id and isinstance(note_id, int):
                        tool_calls.append({
                            "action": "update_note",
                            "note_id": note_id,
                            "content": data.get("content", ""),
                        })
                elif action == "delete":
                    note_id = data.get("id")
                    if note_id and isinstance(note_id, int):
                        tool_calls.append({
                            "action": "delete_note",
                            "note_id": note_id,
                        })
        except (json.JSONDecodeError, TypeError):
            pass
        # Remove the matched block from response
        clean_response = clean_response.replace(m.group(0), "", 1)
    return clean_response.strip(), tool_calls


async def _execute_tool_calls(db: aiosqlite.Connection, session_id: int, tool_calls: list[dict]) -> list[dict]:
    """Execute note tool calls and return results."""
    results = []
    for tc in tool_calls:
        action = tc["action"]
        if action == "create_note":
            cursor = await db.execute(
                "INSERT INTO notes (session_id, title, content) VALUES (?, ?, ?)",
                (session_id, tc["title"], tc["content"]),
            )
            await db.commit()
            results.append({"action": "created", "note_id": cursor.lastrowid, "title": tc["title"]})
        elif action == "update_note":
            await db.execute(
                "UPDATE notes SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND session_id = ?",
                (tc["content"], tc["note_id"], session_id),
            )
            await db.commit()
            results.append({"action": "updated", "note_id": tc["note_id"]})
        elif action == "delete_note":
            await db.execute(
                "DELETE FROM notes WHERE id = ? AND session_id = ?",
                (tc["note_id"], session_id),
            )
            await db.commit()
            results.append({"action": "deleted", "note_id": tc["note_id"]})
    return results


@router.post("/{session_id}/chat")
async def chat(
    session_id: int,
    req: ChatRequest,
    db: aiosqlite.Connection = Depends(get_db),
):
    # Get session data
    cursor = await db.execute("SELECT notes, image_context, title FROM sessions WHERE id = ?", (session_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Session not found")

    notes = row["notes"] or ""
    raw_image_context = row["image_context"] or ""
    session_title = row["title"]

    # Parse stored images (JSON array of {mime, b64})
    images = []
    if raw_image_context:
        try:
            images = json.loads(raw_image_context)
        except (json.JSONDecodeError, TypeError):
            images = []

    # Get existing notes list for AI context
    existing_notes = await _fetch_notes_list(db, session_id)

    # Build user notes content for chat context
    user_notes_str = ""
    if existing_notes:
        user_notes_str = "\n\n## User's Notes\nThe user has created these notes. Use them to answer questions.\n\n"
        for n in existing_notes:
            user_notes_str += f"### {n['title']}\n{n['content']}\n\n"

    # Get chat history — last 20 messages only
    msg_cursor = await db.execute(
        "SELECT role, content FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT 20",
        (session_id,),
    )
    rows = await msg_cursor.fetchall()
    history = [{"role": r["role"], "content": r["content"]} for r in reversed(rows)]

    # Save user message
    await db.execute(
        "INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)",
        (session_id, "user", req.message),
    )
    await db.commit()

    # Get AI response — images are sent as multimodal content
    response = await chat_with_context(
        notes, history, req.message,
        existing_notes=existing_notes, user_notes=user_notes_str,
        images=images if images else None,
    )

    # Parse and execute tool calls
    clean_response, tool_calls = _parse_tool_calls(response)
    note_changes = await _execute_tool_calls(db, session_id, tool_calls)

    # Save clean AI response (without tool call lines)
    await db.execute(
        "INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)",
        (session_id, "assistant", clean_response),
    )
    await db.commit()

    # Auto-generate session title after 5 user messages (if still default)
    if session_title == "New Session":
        count_cursor = await db.execute(
            "SELECT COUNT(*) as cnt FROM messages WHERE session_id = ? AND role = 'user'",
            (session_id,),
        )
        count_row = await count_cursor.fetchone()
        if count_row and count_row["cnt"] >= 5:
            all_msgs_cursor = await db.execute(
                "SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at",
                (session_id,),
            )
            all_msgs = [{"role": r["role"], "content": r["content"]} for r in await all_msgs_cursor.fetchall()]
            try:
                new_title = await generate_title(all_msgs)
                if new_title:
                    await db.execute("UPDATE sessions SET title = ? WHERE id = ?", (new_title, session_id))
                    await db.commit()
            except Exception:
                pass  # title generation is best-effort

    return {"response": clean_response, "note_changes": note_changes}


@router.post("/{session_id}/voice-chat")
async def voice_chat(
    session_id: int,
    req: ChatRequest,
    db: aiosqlite.Connection = Depends(get_db),
):
    # Get session data
    cursor = await db.execute("SELECT notes, image_context, title FROM sessions WHERE id = ?", (session_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Session not found")

    notes = row["notes"] or ""
    raw_image_context = row["image_context"] or ""
    session_title = row["title"]

    # Parse stored images (JSON array of {mime, b64})
    images = []
    if raw_image_context:
        try:
            images = json.loads(raw_image_context)
        except (json.JSONDecodeError, TypeError):
            images = []

    # Get existing notes list for AI context
    existing_notes = await _fetch_notes_list(db, session_id)

    # Build user notes content for voice context
    user_notes_str = ""
    if existing_notes:
        user_notes_str = "\n\nThe user has these notes:\n"
        for n in existing_notes:
            user_notes_str += f"### {n['title']}\n{n['content']}\n\n"

    # Get chat history — last 20 messages only
    msg_cursor = await db.execute(
        "SELECT role, content FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT 20",
        (session_id,),
    )
    rows = await msg_cursor.fetchall()
    history = [{"role": r["role"], "content": r["content"]} for r in reversed(rows)]

    # Save user message
    await db.execute(
        "INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)",
        (session_id, "user", req.message),
    )
    await db.commit()

    # Get voice-friendly AI response — images sent as multimodal content
    raw_response = await voice_chat_with_context(
        notes, history, req.message,
        existing_notes=existing_notes, user_notes=user_notes_str,
        images=images if images else None,
    )

    # Parse and execute note tool calls before cleaning text
    clean_response, tool_calls = _parse_tool_calls(raw_response)
    note_changes = await _execute_tool_calls(db, session_id, tool_calls)

    # Strip any remaining formatting from the spoken part
    response = clean_voice_text(clean_response)

    # If text is empty after cleaning (LLM put everything in code blocks),
    # fall back to a natural confirmation if notes were changed, or a generic one
    if not response or len(response.strip()) < 3:
        if note_changes:
            actions = [nc["action"].replace("_", " ") for nc in note_changes]
            response = f"Done! I've {actions[0]} for you."
        else:
            response = "I'm not sure what to say. Could you repeat that?"

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

    # Auto-generate session title after 5 user messages (if still default)
    if session_title == "New Session":
        count_cursor = await db.execute(
            "SELECT COUNT(*) as cnt FROM messages WHERE session_id = ? AND role = 'user'",
            (session_id,),
        )
        count_row = await count_cursor.fetchone()
        if count_row and count_row["cnt"] >= 5:
            all_msgs_cursor = await db.execute(
                "SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at",
                (session_id,),
            )
            all_msgs = [{"role": r["role"], "content": r["content"]} for r in await all_msgs_cursor.fetchall()]
            try:
                new_title = await generate_title(all_msgs)
                if new_title:
                    await db.execute("UPDATE sessions SET title = ? WHERE id = ?", (new_title, session_id))
                    await db.commit()
            except Exception:
                pass

    return {"response": response, "word_timings": timings, "note_changes": note_changes}


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
