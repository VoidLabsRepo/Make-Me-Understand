from fastapi import APIRouter, UploadFile, File, Depends, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse
import aiosqlite
from database import get_db, DB_PATH
from services.llm import extract_images, synthesize_notes
import traceback

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


async def process_session_background(session_id: int, image_bytes: list[bytes]):
    try:
        extracted = await extract_images(image_bytes)
        notes = await synthesize_notes(extracted)

        # Try to find a good title from the notes
        title = "Untitled Session"
        for line in notes.split("\n"):
            clean = line.strip().lstrip("#").strip()
            if clean and len(clean) > 3:
                title = clean[:100]
                break

        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                "UPDATE sessions SET title = ?, notes = ? WHERE id = ?",
                (title, notes, session_id),
            )
            await db.commit()
    except Exception as e:
        traceback.print_exc()
        error_msg = f"ERROR: Failed to process study material. {str(e)}"
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                "UPDATE sessions SET notes = ? WHERE id = ?",
                (error_msg, session_id),
            )
            await db.commit()


@router.post("")
async def create_session(
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(...),
    db: aiosqlite.Connection = Depends(get_db),
):
    # Read all uploaded images
    image_bytes = []
    for f in files:
        content = await f.read()
        image_bytes.append(content)

    title = files[0].filename.split(".")[0] if files else "Untitled Session"

    # Insert immediate session with null notes
    cursor = await db.execute(
        "INSERT INTO sessions (title, notes) VALUES (?, NULL)",
        (title,),
    )
    await db.commit()
    session_id = cursor.lastrowid

    # Queue background task
    background_tasks.add_task(process_session_background, session_id, image_bytes)

    return {
        "id": session_id,
        "title": title,
        "notes": None,
    }


@router.post("/{session_id}/append-images")
async def append_images(
    session_id: int,
    files: list[UploadFile] = File(...),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Append new images to an existing session — extract text, synthesize
    additional notes, and merge them with the current notes."""
    cursor = await db.execute(
        "SELECT notes FROM sessions WHERE id = ?", (session_id,)
    )
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Session not found")

    existing_notes = row["notes"] or ""

    image_bytes = []
    for f in files:
        content = await f.read()
        image_bytes.append(content)

    try:
        extracted = await extract_images(image_bytes)
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(
            status_code=502,
            content={"detail": f"Image extraction failed: {e}"},
        )

    try:
        new_notes = await synthesize_notes(extracted)
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(
            status_code=502,
            content={"detail": f"Note synthesis failed: {e}"},
        )

    merged = existing_notes + "\n\n---\n\n" + new_notes if existing_notes else new_notes

    await db.execute(
        "UPDATE sessions SET notes = ? WHERE id = ?",
        (merged, session_id),
    )
    await db.commit()

    return {"notes": merged}


@router.get("")
async def list_sessions(db: aiosqlite.Connection = Depends(get_db)):
    cursor = await db.execute(
        "SELECT id, title, created_at FROM sessions ORDER BY created_at DESC"
    )
    rows = await cursor.fetchall()
    return [
        {"id": r["id"], "title": r["title"], "created_at": r["created_at"]}
        for r in rows
    ]


@router.get("/{session_id}")
async def get_session(session_id: int, db: aiosqlite.Connection = Depends(get_db)):
    cursor = await db.execute(
        "SELECT id, title, notes, created_at FROM sessions WHERE id = ?",
        (session_id,),
    )
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Session not found")

    # Get chat history
    msg_cursor = await db.execute(
        "SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at",
        (session_id,),
    )
    messages = [{"role": r["role"], "content": r["content"]} for r in await msg_cursor.fetchall()]

    return {
        "id": row["id"],
        "title": row["title"],
        "notes": row["notes"],
        "created_at": row["created_at"],
        "messages": messages,
    }

