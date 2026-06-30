from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import aiosqlite
from database import get_db

router = APIRouter(prefix="/api/notes", tags=["notes"])


class CreateNoteRequest(BaseModel):
    session_id: int
    title: str = "Untitled"
    content: str = ""


class UpdateNoteRequest(BaseModel):
    title: str | None = None
    content: str | None = None


@router.get("/session/{session_id}")
async def list_notes(session_id: int, db: aiosqlite.Connection = Depends(get_db)):
    cursor = await db.execute(
        "SELECT id, session_id, title, created_at, updated_at "
        "FROM notes WHERE session_id = ? ORDER BY created_at ASC",
        (session_id,),
    )
    rows = await cursor.fetchall()
    return [
        {
            "id": r["id"],
            "session_id": r["session_id"],
            "title": r["title"],
            "created_at": r["created_at"],
            "updated_at": r["updated_at"],
        }
        for r in rows
    ]


@router.get("/{note_id}")
async def get_note(note_id: int, db: aiosqlite.Connection = Depends(get_db)):
    cursor = await db.execute(
        "SELECT id, session_id, title, content, created_at, updated_at "
        "FROM notes WHERE id = ?",
        (note_id,),
    )
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Note not found")
    return {
        "id": row["id"],
        "session_id": row["session_id"],
        "title": row["title"],
        "content": row["content"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


@router.post("")
async def create_note(body: CreateNoteRequest, db: aiosqlite.Connection = Depends(get_db)):
    cursor = await db.execute(
        "INSERT INTO notes (session_id, title, content) VALUES (?, ?, ?)",
        (body.session_id, body.title, body.content),
    )
    await db.commit()
    note_id = cursor.lastrowid
    return {
        "id": note_id,
        "session_id": body.session_id,
        "title": body.title,
        "content": body.content,
    }


@router.patch("/{note_id}")
async def update_note(
    note_id: int,
    body: UpdateNoteRequest,
    db: aiosqlite.Connection = Depends(get_db),
):
    cursor = await db.execute("SELECT id FROM notes WHERE id = ?", (note_id,))
    if not await cursor.fetchone():
        raise HTTPException(status_code=404, detail="Note not found")

    updates = []
    params = []
    if body.title is not None:
        updates.append("title = ?")
        params.append(body.title)
    if body.content is not None:
        updates.append("content = ?")
        params.append(body.content)
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")

    updates.append("updated_at = CURRENT_TIMESTAMP")
    params.append(note_id)
    await db.execute(f"UPDATE notes SET {', '.join(updates)} WHERE id = ?", params)
    await db.commit()
    return {"ok": True}


@router.delete("/{note_id}")
async def delete_note(note_id: int, db: aiosqlite.Connection = Depends(get_db)):
    cursor = await db.execute("SELECT id FROM notes WHERE id = ?", (note_id,))
    if not await cursor.fetchone():
        raise HTTPException(status_code=404, detail="Note not found")
    await db.execute("DELETE FROM notes WHERE id = ?", (note_id,))
    await db.commit()
    return {"ok": True}
