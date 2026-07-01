from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import aiosqlite
import re
import json
import os
from database import get_db
from services.llm import chat_with_context, voice_explain, voice_chat_with_context, clean_voice_text, generate_title, chat_completion_stream, build_chat_system_prompt
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


async def _fetch_canvases_list(db: aiosqlite.Connection, session_id: int) -> list[dict]:
    cursor = await db.execute(
        "SELECT id, title FROM canvases WHERE session_id = ? ORDER BY created_at",
        (session_id,),
    )
    return [dict(r) for r in await cursor.fetchall()]


def _safe_int_id(data: dict, key: str = "id") -> int | None:
    """Parse an int ID from JSON data. Returns None if missing or invalid."""
    raw = data.get(key)
    if raw is None:
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _parse_tool_calls(response: str) -> tuple[str, list[dict]]:
    """Extract JSON tool calls from ```json code blocks. Returns (cleaned_response, tool_calls)."""
    tool_calls = []
    # Match ```json\n{...}\n``` blocks (but not ```json reasoning blocks)
    pattern = r'```json\s*\n\s*(\{(?!\s*"reasoning")[^`]+?\})\s*\n\s*```'
    matches = list(re.finditer(pattern, response, re.DOTALL))
    clean_response = response
    for m in matches:
        raw = m.group(1).strip()
        try:
            data = json.loads(raw)
            tool = data.get("tool")
            if tool == "note":
                tc = _parse_note_tool_call(data)
                if tc:
                    tool_calls.append(tc)
            elif tool == "canvas":
                tc = _parse_canvas_tool_call(data)
                if tc:
                    tool_calls.append(tc)
        except (json.JSONDecodeError, TypeError):
            pass
        # Remove the matched block from response
        clean_response = clean_response.replace(m.group(0), "", 1)
    return clean_response.strip(), tool_calls


def _parse_note_tool_call(data: dict) -> dict | None:
    action = data.get("action")
    if action == "create":
        return {
            "action": "create_note",
            "title": data.get("title", "Untitled"),
            "content": data.get("content", ""),
        }
    note_id = _safe_int_id(data)
    if note_id and action == "update":
        return {"action": "update_note", "note_id": note_id, "content": data.get("content", "")}
    if note_id and action == "delete":
        return {"action": "delete_note", "note_id": note_id}
    return None


def _parse_canvas_tool_call(data: dict) -> dict | None:
    action = data.get("action")
    if action == "create":
        return {
            "action": "create_canvas",
            "title": data.get("title", "Untitled"),
            "elements": data.get("elements", []),
        }
    canvas_id = _safe_int_id(data)
    if canvas_id and action == "update":
        update_kwargs: dict = {"canvas_id": canvas_id}
        if "title" in data:
            update_kwargs["title"] = data["title"]
        if "elements" in data:
            update_kwargs["elements"] = data["elements"]
        return {"action": "update_canvas", **update_kwargs}
    if canvas_id and action == "delete":
        return {"action": "delete_canvas", "canvas_id": canvas_id}
    return None


def _parse_reasoning(response: str) -> tuple[str, list[dict]]:
    """Extract ```json reasoning blocks. Returns (cleaned_response, reasoning_steps)."""
    pattern = r'```json(?:\s*reasoning)?\s*\n\s*(\[[\s\S]+?\])\s*\n\s*```'
    reasoning_steps: list[dict] = []
    clean = response
    for m in list(re.finditer(pattern, response)):
        try:
            steps = json.loads(m.group(1))
            if not isinstance(steps, list):
                continue
            for s in steps:
                if not isinstance(s, dict):
                    continue
                label = str(s.get("label", "")).strip()
                if not label:
                    continue
                reasoning_steps.append({
                    "label": label,
                    "description": str(s.get("description", "")).strip(),
                    "status": s.get("status", "complete"),
                })
        except (json.JSONDecodeError, TypeError):
            pass
        clean = clean.replace(m.group(0), "", 1)
    return clean.strip(), reasoning_steps


async def _execute_tool_calls(db: aiosqlite.Connection, session_id: int, tool_calls: list[dict]) -> dict:
    """Execute note + canvas tool calls. Returns {note_changes, canvas_changes}."""
    note_changes: list[dict] = []
    canvas_changes: list[dict] = []
    for tc in tool_calls:
        action = tc["action"]
        if action == "create_note":
            cursor = await db.execute(
                "INSERT INTO notes (session_id, title, content) VALUES (?, ?, ?)",
                (session_id, tc["title"], tc["content"]),
            )
            await db.commit()
            note_changes.append({"action": "created", "note_id": cursor.lastrowid, "title": tc["title"]})
        elif action == "update_note":
            await db.execute(
                "UPDATE notes SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND session_id = ?",
                (tc["content"], tc["note_id"], session_id),
            )
            await db.commit()
            note_changes.append({"action": "updated", "note_id": tc["note_id"]})
        elif action == "delete_note":
            await db.execute(
                "DELETE FROM notes WHERE id = ? AND session_id = ?",
                (tc["note_id"], session_id),
            )
            await db.commit()
            note_changes.append({"action": "deleted", "note_id": tc["note_id"]})
        elif action == "create_canvas":
            elements_json = json.dumps(tc["elements"])
            cursor = await db.execute(
                "INSERT INTO canvases (session_id, title, elements) VALUES (?, ?, ?)",
                (session_id, tc["title"], elements_json),
            )
            await db.commit()
            canvas_changes.append({
                "action": "created",
                "canvas_id": cursor.lastrowid,
                "title": tc["title"],
            })
        elif action == "update_canvas":
            updates = []
            params: list = []
            if "title" in tc:
                updates.append("title = ?")
                params.append(tc["title"])
            if "elements" in tc:
                updates.append("elements = ?")
                params.append(json.dumps(tc["elements"]))
            if updates:
                updates.append("updated_at = CURRENT_TIMESTAMP")
                params.append(tc["canvas_id"])
                # ponytail: S608 false positive — `updates` keys are hardcoded, not user input
                await db.execute(
                    f"UPDATE canvases SET {', '.join(updates)} WHERE id = ? AND session_id = ?",
                    [*params, session_id],
                )
                await db.commit()
            canvas_changes.append({"action": "updated", "canvas_id": tc["canvas_id"]})
        elif action == "delete_canvas":
            await db.execute(
                "DELETE FROM canvases WHERE id = ? AND session_id = ?",
                (tc["canvas_id"], session_id),
            )
            await db.commit()
            canvas_changes.append({"action": "deleted", "canvas_id": tc["canvas_id"]})
    return {"note_changes": note_changes, "canvas_changes": canvas_changes}


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

    # Get existing canvases list for AI context
    existing_canvases = await _fetch_canvases_list(db, session_id)

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
        existing_canvases=existing_canvases,
    )

    # Parse and execute tool calls
    clean_response, tool_calls = _parse_tool_calls(response)
    clean_response, reasoning = _parse_reasoning(clean_response)
    tool_results = await _execute_tool_calls(db, session_id, tool_calls)
    note_changes = tool_results["note_changes"]
    canvas_changes = tool_results["canvas_changes"]

    # Save clean AI response (without tool call lines)
    await db.execute(
        "INSERT INTO messages (session_id, role, content, reasoning) VALUES (?, ?, ?, ?)",
        (session_id, "assistant", clean_response, json.dumps(reasoning)),
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
                pass  # ponytail: title generation is best-effort, never block the response

    return {"response": clean_response, "reasoning": reasoning, "note_changes": note_changes, "canvas_changes": canvas_changes}


@router.post("/{session_id}/chat/stream")
async def chat_stream(
    session_id: int,
    req: ChatRequest,
    db: aiosqlite.Connection = Depends(get_db),
):
    """Stream chat response via SSE. Events: text, reasoning, canvas, note, done, error."""
    cursor = await db.execute("SELECT notes, image_context, title FROM sessions WHERE id = ?", (session_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Session not found")

    notes = row["notes"] or ""
    raw_image_context = row["image_context"] or ""
    session_title = row["title"]

    images = []
    if raw_image_context:
        try:
            images = json.loads(raw_image_context)
        except (json.JSONDecodeError, TypeError):
            images = []

    existing_notes = await _fetch_notes_list(db, session_id)
    existing_canvases = await _fetch_canvases_list(db, session_id)

    user_notes_str = ""
    if existing_notes:
        user_notes_str = "\n\n## User's Notes\nThe user has created these notes. Use them to answer questions.\n\n"
        for n in existing_notes:
            user_notes_str += f"### {n['title']}\n{n['content']}\n\n"

    msg_cursor = await db.execute(
        "SELECT role, content FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT 20",
        (session_id,),
    )
    rows = await msg_cursor.fetchall()
    history = [{"role": r["role"], "content": r["content"]} for r in reversed(rows)]

    # Save user message while connection is still alive
    await db.execute(
        "INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)",
        (session_id, "user", req.message),
    )
    await db.commit()

    system = build_chat_system_prompt(notes, existing_notes, user_notes_str, existing_canvases)

    if images:
        user_content = []
        for img in images:
            url = "data:" + img["mime"] + ";base64," + img["b64"]
            user_content.append({"type": "image_url", "image_url": {"url": url}})
        user_content.append({"type": "text", "text": req.message})
    else:
        user_content = req.message

    messages_for_llm = [
        {"role": "system", "content": system},
        *history,
        {"role": "user", "content": user_content},
    ]

    async def event_generator():
        import json as _json  # ponytail: scoped import avoids name clash with module-level json
        from database import DB_PATH  # ponytail: scoped import, connection must outlive Depends
        full_text = ""
        reasoning_steps = []
        executed_tool_call_ids: set[str] = set()
        note_changes_all: list[dict] = []
        canvas_changes_all: list[dict] = []

        # Open a fresh DB connection for the generator's lifetime
        gen_db = await aiosqlite.connect(DB_PATH, timeout=10)
        gen_db.row_factory = aiosqlite.Row

        try:
            async for token in chat_completion_stream(messages_for_llm):
                full_text += token

                # Check for complete tool call blocks
                tc_pattern = r'```json\s*\n\s*(\{(?!\s*"reasoning")[^`]+?\})\s*\n\s*```'
                tc_matches = list(re.finditer(tc_pattern, full_text, re.DOTALL))
                if tc_matches:
                    for m in tc_matches:
                        raw = m.group(1).strip()
                        block_id = m.group(0)
                        if block_id in executed_tool_call_ids:
                            continue
                        try:
                            data = _json.loads(raw)
                            tool = data.get("tool")
                            if tool in ("note", "canvas"):
                                _, tool_calls = _parse_tool_calls(full_text)
                                if tool_calls:
                                    tool_results = await _execute_tool_calls(gen_db, session_id, tool_calls)
                                    for nc in tool_results.get("note_changes", []):
                                        note_changes_all.append(nc)
                                        yield f"event: note\ndata: {_json.dumps(nc)}\n\n"
                                    for cc in tool_results.get("canvas_changes", []):
                                        canvas_changes_all.append(cc)
                                        yield f"event: canvas\ndata: {_json.dumps(cc)}\n\n"
                                executed_tool_call_ids.add(block_id)
                                full_text = full_text.replace(m.group(0), "", 1)
                                break
                        except (_json.JSONDecodeError, TypeError):
                            pass

                # Parse and emit reasoning if present
                if "```json reasoning" in full_text or ('```json\n[' in full_text and '"label"' in full_text):
                    clean_r, reasoning = _parse_reasoning(full_text)
                    if reasoning and len(reasoning) > len(reasoning_steps):
                        reasoning_steps = reasoning
                        yield f"event: reasoning\ndata: {_json.dumps(reasoning_steps)}\n\n"
                        full_text = clean_r

                # Stream the text content
                clean_text = _strip_special_blocks(full_text)
                if clean_text:
                    yield f"event: text\ndata: {_json.dumps(clean_text)}\n\n"

            # Final parse after stream completes
            clean_response = _strip_special_blocks(full_text)
            clean_response, final_reasoning = _parse_reasoning(clean_response)
            _, tool_calls = _parse_tool_calls(full_text)

            # Execute any remaining tool calls not caught during streaming
            if tool_calls:
                tool_results = await _execute_tool_calls(gen_db, session_id, tool_calls)
                for nc in tool_results.get("note_changes", []):
                    note_changes_all.append(nc)
                    yield f"event: note\ndata: {_json.dumps(nc)}\n\n"
                for cc in tool_results.get("canvas_changes", []):
                    canvas_changes_all.append(cc)
                    yield f"event: canvas\ndata: {_json.dumps(cc)}\n\n"

            # Use reasoning_steps from streaming (more reliable than re-parsing)
            best_reasoning = final_reasoning if final_reasoning else reasoning_steps

            # Save the clean response
            await gen_db.execute(
                "INSERT INTO messages (session_id, role, content, reasoning) VALUES (?, ?, ?, ?)",
                (session_id, "assistant", clean_response, _json.dumps(best_reasoning)),
            )
            await gen_db.commit()

            # Auto-generate title
            if session_title == "New Session":
                count_cursor = await gen_db.execute(
                    "SELECT COUNT(*) as cnt FROM messages WHERE session_id = ? AND role = 'user'",
                    (session_id,),
                )
                count_row = await count_cursor.fetchone()
                if count_row and count_row["cnt"] >= 5:
                    all_msgs_cursor = await gen_db.execute(
                        "SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at",
                        (session_id,),
                    )
                    all_msgs = [{"role": r["role"], "content": r["content"]} for r in await all_msgs_cursor.fetchall()]
                    try:
                        new_title = await generate_title(all_msgs)
                        if new_title:
                            await gen_db.execute("UPDATE sessions SET title = ? WHERE id = ?", (new_title, session_id))
                            await gen_db.commit()
                    except Exception:
                        pass  # ponytail: title generation is best-effort

            done_data = {
                "response": clean_response,
                "reasoning": best_reasoning,
                "note_changes": note_changes_all,
                "canvas_changes": canvas_changes_all,
            }
            yield f"event: done\ndata: {_json.dumps(done_data)}\n\n"

        except Exception as e:
            print(f"[chat_stream] Error: {e}")
            import traceback
            traceback.print_exc()
            yield f"event: error\ndata: {_json.dumps({'error': str(e)})}\n\n"
        finally:
            await gen_db.close()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


def _strip_special_blocks(text: str) -> str:
    """Remove ```json reasoning blocks and ```json tool call blocks from text for streaming display."""
    # Remove reasoning blocks
    text = re.sub(r'```json(?:\s*reasoning)?\s*\n\s*\[[\s\S]*?\]\s*\n\s*```', '', text)
    # Remove tool call blocks (but not reasoning)
    text = re.sub(r'```json\s*\n\s*\{(?!\s*"reasoning")[^`]+?\}\s*\n\s*```', '', text)
    return text.strip()


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

    # Get existing canvases list for AI context
    existing_canvases = await _fetch_canvases_list(db, session_id)

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
        existing_canvases=existing_canvases,
    )

    # Parse and execute note + canvas tool calls before cleaning text
    clean_response, tool_calls = _parse_tool_calls(raw_response)
    clean_response, reasoning = _parse_reasoning(clean_response)
    tool_results = await _execute_tool_calls(db, session_id, tool_calls)
    note_changes = tool_results["note_changes"]
    canvas_changes = tool_results["canvas_changes"]

    # Strip any remaining formatting from the spoken part
    response = clean_voice_text(clean_response)

    # If text is empty after cleaning (LLM put everything in code blocks),
    # fall back to a natural confirmation if any tool ran, or a generic one
    if not response or len(response.strip()) < 3:
        changes = note_changes or canvas_changes
        if changes:
            actions = [nc["action"].replace("_", " ") for nc in changes]
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
        "INSERT INTO messages (session_id, role, content, reasoning) VALUES (?, ?, ?, ?)",
        (session_id, "assistant", response, json.dumps(reasoning)),
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
                pass  # ponytail: title generation is best-effort

    return {"response": response, "reasoning": reasoning, "word_timings": timings, "note_changes": note_changes, "canvas_changes": canvas_changes}


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
