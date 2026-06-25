from fastapi import APIRouter, UploadFile, File, Depends, HTTPException
from fastapi.responses import JSONResponse
import aiosqlite
from database import get_db
from services.llm import extract_images, synthesize_notes
import traceback

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


@router.post("")
async def create_session(
    files: list[UploadFile] = File(...),
    db: aiosqlite.Connection = Depends(get_db),
):
    # Read all uploaded images
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
        notes = await synthesize_notes(extracted)
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(
            status_code=502,
            content={"detail": f"Note synthesis failed: {e}"},
        )

    title = files[0].filename.split(".")[0] if files else "Untitled Session"
    for line in notes.split("\n"):
        clean = line.strip().lstrip("#").strip()
        if clean and len(clean) > 3:
            title = clean[:100]
            break

    cursor = await db.execute(
        "INSERT INTO sessions (title, notes) VALUES (?, ?)",
        (title, notes),
    )
    await db.commit()
    session_id = cursor.lastrowid

    return {
        "id": session_id,
        "title": title,
        "notes": notes,
    }


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
