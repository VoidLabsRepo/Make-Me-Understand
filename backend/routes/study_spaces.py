from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import aiosqlite
from database import get_db

router = APIRouter(prefix="/api/study-spaces", tags=["study-spaces"])


class CreateSpaceRequest(BaseModel):
    name: str
    emoji: str = ""


class AddSessionRequest(BaseModel):
    session_id: int


@router.post("")
async def create_space(body: CreateSpaceRequest, db: aiosqlite.Connection = Depends(get_db)):
    cursor = await db.execute(
        "INSERT INTO study_spaces (name, emoji) VALUES (?, ?)",
        (body.name, body.emoji),
    )
    await db.commit()
    return {"id": cursor.lastrowid, "name": body.name, "emoji": body.emoji}


@router.get("")
async def list_spaces(db: aiosqlite.Connection = Depends(get_db)):
    cursor = await db.execute(
        "SELECT id, name, emoji, created_at FROM study_spaces ORDER BY created_at DESC"
    )
    spaces = [dict(r) for r in await cursor.fetchall()]

    # Attach session count and first 3 session titles for each space
    for space in spaces:
        count_cursor = await db.execute(
            "SELECT COUNT(*) as cnt FROM session_study_spaces WHERE study_space_id = ?",
            (space["id"],),
        )
        row = await count_cursor.fetchone()
        space["session_count"] = row["cnt"] if row else 0

        sessions_cursor = await db.execute(
            "SELECT s.id, s.title FROM sessions s "
            "JOIN session_study_spaces sss ON s.id = sss.session_id "
            "WHERE sss.study_space_id = ? ORDER BY sss.added_at DESC LIMIT 3",
            (space["id"],),
        )
        space["sessions"] = [dict(r) for r in await sessions_cursor.fetchall()]

    return spaces


@router.get("/{space_id}")
async def get_space(space_id: int, db: aiosqlite.Connection = Depends(get_db)):
    cursor = await db.execute(
        "SELECT id, name, emoji, created_at FROM study_spaces WHERE id = ?",
        (space_id,),
    )
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Study space not found")

    space = dict(row)

    sessions_cursor = await db.execute(
        "SELECT s.id, s.title, s.created_at FROM sessions s "
        "JOIN session_study_spaces sss ON s.id = sss.session_id "
        "WHERE sss.study_space_id = ? ORDER BY sss.added_at DESC",
        (space_id,),
    )
    space["sessions"] = [dict(r) for r in await sessions_cursor.fetchall()]

    return space


@router.delete("/{space_id}")
async def delete_space(space_id: int, db: aiosqlite.Connection = Depends(get_db)):
    cursor = await db.execute("SELECT id FROM study_spaces WHERE id = ?", (space_id,))
    if not await cursor.fetchone():
        raise HTTPException(status_code=404, detail="Study space not found")
    await db.execute("DELETE FROM study_spaces WHERE id = ?", (space_id,))
    await db.commit()
    return {"ok": True}


@router.patch("/{space_id}")
async def rename_space(space_id: int, body: CreateSpaceRequest, db: aiosqlite.Connection = Depends(get_db)):
    cursor = await db.execute("SELECT id FROM study_spaces WHERE id = ?", (space_id,))
    if not await cursor.fetchone():
        raise HTTPException(status_code=404, detail="Study space not found")
    await db.execute(
        "UPDATE study_spaces SET name = ?, emoji = ? WHERE id = ?",
        (body.name, body.emoji, space_id),
    )
    await db.commit()
    return {"id": space_id, "name": body.name, "emoji": body.emoji}


@router.post("/{space_id}/sessions")
async def add_session_to_space(space_id: int, body: AddSessionRequest, db: aiosqlite.Connection = Depends(get_db)):
    # Verify space exists
    cursor = await db.execute("SELECT id FROM study_spaces WHERE id = ?", (space_id,))
    if not await cursor.fetchone():
        raise HTTPException(status_code=404, detail="Study space not found")

    # Verify session exists
    cursor = await db.execute("SELECT id FROM sessions WHERE id = ?", (body.session_id,))
    if not await cursor.fetchone():
        raise HTTPException(status_code=404, detail="Session not found")

    try:
        await db.execute(
            "INSERT INTO session_study_spaces (session_id, study_space_id) VALUES (?, ?)",
            (body.session_id, space_id),
        )
        await db.commit()
    except aiosqlite.IntegrityError:
        pass  # Already in space

    return {"ok": True}


@router.delete("/{space_id}/sessions/{session_id}")
async def remove_session_from_space(space_id: int, session_id: int, db: aiosqlite.Connection = Depends(get_db)):
    await db.execute(
        "DELETE FROM session_study_spaces WHERE session_id = ? AND study_space_id = ?",
        (session_id, space_id),
    )
    await db.commit()
    return {"ok": True}
