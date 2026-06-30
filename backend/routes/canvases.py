from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import aiosqlite
import json
from database import get_db

router = APIRouter(prefix="/api/canvases", tags=["canvases"])


class CreateCanvasRequest(BaseModel):
    session_id: int
    title: str = "Untitled"
    elements: list = []


class UpdateCanvasRequest(BaseModel):
    title: str | None = None
    elements: list | None = None


def _parse_elements(raw: str) -> list:
    if not raw:
        return []
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return []


@router.get("/session/{session_id}")
async def list_canvases(session_id: int, db: aiosqlite.Connection = Depends(get_db)):
    cursor = await db.execute(
        "SELECT id, session_id, title, created_at, updated_at "
        "FROM canvases WHERE session_id = ? ORDER BY created_at ASC",
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


@router.get("/{canvas_id}")
async def get_canvas(canvas_id: int, db: aiosqlite.Connection = Depends(get_db)):
    cursor = await db.execute(
        "SELECT id, session_id, title, elements, created_at, updated_at "
        "FROM canvases WHERE id = ?",
        (canvas_id,),
    )
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Canvas not found")
    return {
        "id": row["id"],
        "session_id": row["session_id"],
        "title": row["title"],
        "elements": _parse_elements(row["elements"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


@router.post("")
async def create_canvas(body: CreateCanvasRequest, db: aiosqlite.Connection = Depends(get_db)):
    elements_json = json.dumps(body.elements)
    cursor = await db.execute(
        "INSERT INTO canvases (session_id, title, elements) VALUES (?, ?, ?)",
        (body.session_id, body.title, elements_json),
    )
    await db.commit()
    canvas_id = cursor.lastrowid
    return {
        "id": canvas_id,
        "session_id": body.session_id,
        "title": body.title,
        "elements": body.elements,
    }


@router.patch("/{canvas_id}")
async def update_canvas(
    canvas_id: int,
    body: UpdateCanvasRequest,
    db: aiosqlite.Connection = Depends(get_db),
):
    cursor = await db.execute("SELECT id FROM canvases WHERE id = ?", (canvas_id,))
    if not await cursor.fetchone():
        raise HTTPException(status_code=404, detail="Canvas not found")

    updates = []
    params = []
    if body.title is not None:
        updates.append("title = ?")
        params.append(body.title)
    if body.elements is not None:
        updates.append("elements = ?")
        params.append(json.dumps(body.elements))
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")

    updates.append("updated_at = CURRENT_TIMESTAMP")
    params.append(canvas_id)
    await db.execute(f"UPDATE canvases SET {', '.join(updates)} WHERE id = ?", params)
    await db.commit()
    return {"ok": True}


@router.delete("/{canvas_id}")
async def delete_canvas(canvas_id: int, db: aiosqlite.Connection = Depends(get_db)):
    cursor = await db.execute("SELECT id FROM canvases WHERE id = ?", (canvas_id,))
    if not await cursor.fetchone():
        raise HTTPException(status_code=404, detail="Canvas not found")
    await db.execute("DELETE FROM canvases WHERE id = ?", (canvas_id,))
    await db.commit()
    return {"ok": True}
