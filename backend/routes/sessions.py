from fastapi import APIRouter, UploadFile, File, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
import aiosqlite
import base64
import io
import json
from PIL import Image
from database import get_db, DB_PATH, BACKUP_DB_PATH
import traceback
from datetime import datetime, timedelta

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


def _parse_reasoning_field(raw):
    if not raw:
        return []
    try:
        data = json.loads(raw)
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, TypeError):
        return []


def _compress_image(img_bytes: bytes, max_size: int = 1024, quality: int = 80) -> tuple[str, str]:
    """Compress image and return (mime, base64). Max dimension 1024px, JPEG quality 80."""
    img = Image.open(io.BytesIO(img_bytes))
    # Convert to RGB if needed (JPEG doesn't support alpha)
    if img.mode in ("RGBA", "P"):
        img = img.convert("RGB")
    # Resize if larger than max_size
    if max(img.size) > max_size:
        img.thumbnail((max_size, max_size), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality, optimize=True)
    compressed = buf.getvalue()
    b64 = base64.b64encode(compressed).decode()
    return "image/jpeg", b64


async def process_append_images_background(session_id: int, image_bytes: list[bytes], existing_context: str):
    """Compress and store images permanently."""
    try:
        existing_images = json.loads(existing_context) if existing_context else []
        for img_bytes in image_bytes:
            mime, b64 = _compress_image(img_bytes)
            existing_images.append({"mime": mime, "b64": b64})

        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                "UPDATE sessions SET image_context = ? WHERE id = ?",
                (json.dumps(existing_images), session_id),
            )
            await db.commit()
        print(f"[append-images] Stored {len(image_bytes)} compressed images for session {session_id}")
    except Exception:
        traceback.print_exc()


class CreateSessionRequest(BaseModel):
    title: str | None = None


@router.post("")
async def create_session(
    body: CreateSessionRequest | None = None,
    db: aiosqlite.Connection = Depends(get_db),
):
    title = (body.title if body else None) or "New Session"
    cursor = await db.execute(
        "INSERT INTO sessions (title, notes, image_context) VALUES (?, '', '')",
        (title,),
    )
    await db.commit()
    session_id = cursor.lastrowid
    return {"id": session_id, "title": title, "notes": "", "image_context": ""}


@router.post("/{session_id}/append-images")
async def append_images(
    session_id: int,
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(...),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Upload images — extract text and store permanently in image_context."""
    cursor = await db.execute(
        "SELECT image_context FROM sessions WHERE id = ?", (session_id,)
    )
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Session not found")

    existing_context = row["image_context"] or ""

    image_bytes = []
    for f in files:
        if f.filename:
            content = await f.read()
            image_bytes.append(content)

    if not image_bytes:
        raise HTTPException(status_code=400, detail="No valid images uploaded")

    background_tasks.add_task(
        process_append_images_background, session_id, image_bytes, existing_context
    )

    return {"status": "processing"}


@router.get("")
async def list_sessions(db: aiosqlite.Connection = Depends(get_db)):
    cursor = await db.execute(
        "SELECT id, title, created_at FROM sessions "
        "WHERE id NOT IN (SELECT session_id FROM session_study_spaces) "
        "ORDER BY created_at DESC"
    )
    rows = await cursor.fetchall()
    return [
        {"id": r["id"], "title": r["title"], "created_at": r["created_at"]}
        for r in rows
    ]


@router.get("/{session_id}")
async def get_session(session_id: int, db: aiosqlite.Connection = Depends(get_db)):
    cursor = await db.execute(
        "SELECT id, title, notes, image_context, created_at FROM sessions WHERE id = ?",
        (session_id,),
    )
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Session not found")

    # Get last 7 messages (most recent); older are loaded via paginated endpoint
    msg_cursor = await db.execute(
        "SELECT id, role, content, reasoning FROM messages WHERE session_id = ? "
        "ORDER BY id DESC LIMIT 7",
        (session_id,),
    )
    desc_rows = await msg_cursor.fetchall()
    # Return in chronological order
    messages = [
        {
            "id": r["id"],
            "role": r["role"],
            "content": r["content"],
            "reasoning": _parse_reasoning_field(r["reasoning"]),
        }
        for r in reversed(desc_rows)
    ]

    # Whether older messages exist beyond this window
    count_cursor = await db.execute(
        "SELECT COUNT(*) as cnt, MIN(id) as min_id FROM messages WHERE session_id = ?",
        (session_id,),
    )
    count_row = await count_cursor.fetchone()
    total = count_row["cnt"] or 0
    oldest_id = messages[0]["id"] if messages else None
    has_more = total > len(messages) and oldest_id is not None and count_row["min_id"] < oldest_id

    return {
        "id": row["id"],
        "title": row["title"],
        "notes": row["notes"],
        "image_context": row["image_context"] or "",
        "created_at": row["created_at"],
        "messages": messages,
        "has_more_messages": has_more,
        "total_messages": total,
    }


@router.get("/{session_id}/messages")
async def list_messages(
    session_id: int,
    before: int | None = None,
    limit: int = 7,
    db: aiosqlite.Connection = Depends(get_db),
):
    """Load older messages before a given message id (paged)."""
    limit = max(1, min(limit, 50))
    if before is not None:
        msg_cursor = await db.execute(
            "SELECT id, role, content, reasoning FROM messages "
            "WHERE session_id = ? AND id < ? ORDER BY id DESC LIMIT ?",
            (session_id, before, limit),
        )
    else:
        msg_cursor = await db.execute(
            "SELECT id, role, content, reasoning FROM messages "
            "WHERE session_id = ? ORDER BY id DESC LIMIT ?",
            (session_id, limit),
        )
    desc_rows = await msg_cursor.fetchall()
    messages = [
        {
            "id": r["id"],
            "role": r["role"],
            "content": r["content"],
            "reasoning": _parse_reasoning_field(r["reasoning"]),
        }
        for r in reversed(desc_rows)
    ]
    has_more = len(desc_rows) == limit
    return {"messages": messages, "has_more": has_more}


class RenameRequest(BaseModel):
    title: str


@router.patch("/{session_id}")
async def rename_session(
    session_id: int,
    body: RenameRequest,
    db: aiosqlite.Connection = Depends(get_db),
):
    cursor = await db.execute("SELECT id FROM sessions WHERE id = ?", (session_id,))
    if not await cursor.fetchone():
        raise HTTPException(status_code=404, detail="Session not found")

    await db.execute("UPDATE sessions SET title = ? WHERE id = ?", (body.title, session_id))
    await db.commit()
    return {"id": session_id, "title": body.title}


@router.delete("/{session_id}")
async def delete_session(
    session_id: int,
    db: aiosqlite.Connection = Depends(get_db),
):
    cursor = await db.execute("SELECT id FROM sessions WHERE id = ?", (session_id,))
    if not await cursor.fetchone():
        raise HTTPException(status_code=404, detail="Session not found")

    # Backup to deleted_sessions before removing
    expires = (datetime.utcnow() + timedelta(days=30)).isoformat()

    # Fetch data from main DB for backup
    session_cursor = await db.execute(
        "SELECT title, notes, created_at FROM sessions WHERE id = ?", (session_id,)
    )
    session_row = await session_cursor.fetchone()

    msg_cursor = await db.execute(
        "SELECT role, content, created_at FROM messages WHERE session_id = ?", (session_id,)
    )
    messages = await msg_cursor.fetchall()

    async with aiosqlite.connect(BACKUP_DB_PATH, timeout=10) as backup:
        await backup.execute(
            "INSERT INTO deleted_sessions (original_id, title, notes, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
            (session_id, session_row["title"], session_row["notes"], session_row["created_at"], expires),
        )
        for msg in messages:
            await backup.execute(
                "INSERT INTO deleted_messages (original_session_id, role, content, created_at) VALUES (?, ?, ?, ?)",
                (session_id, msg["role"], msg["content"], msg["created_at"]),
            )
        await backup.commit()

    # Delete from main DB (notes first due to foreign key)
    await db.execute("DELETE FROM notes WHERE session_id = ?", (session_id,))
    await db.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))
    await db.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
    await db.commit()
    return {"ok": True}


@router.get("/deleted")
async def list_deleted_sessions():
    async with aiosqlite.connect(BACKUP_DB_PATH) as backup:
        backup.row_factory = aiosqlite.Row
        cursor = await backup.execute(
            "SELECT original_id, title, created_at, deleted_at, expires_at "
            "FROM deleted_sessions WHERE expires_at > ? ORDER BY deleted_at DESC",
            (datetime.utcnow().isoformat(),),
        )
        rows = await cursor.fetchall()
        return [
            {
                "original_id": r["original_id"],
                "title": r["title"],
                "created_at": r["created_at"],
                "deleted_at": r["deleted_at"],
                "expires_at": r["expires_at"],
            }
            for r in rows
        ]


@router.post("/restore/{original_id}")
async def restore_session(
    original_id: int,
    db: aiosqlite.Connection = Depends(get_db),
):
    async with aiosqlite.connect(BACKUP_DB_PATH) as backup:
        backup.row_factory = aiosqlite.Row
        cursor = await backup.execute(
            "SELECT * FROM deleted_sessions WHERE original_id = ? AND expires_at > ?",
            (original_id, datetime.utcnow().isoformat()),
        )
        session = await cursor.fetchone()
        if not session:
            raise HTTPException(status_code=404, detail="Backup not found or expired")

        # Insert back into main DB
        cursor = await db.execute(
            "INSERT INTO sessions (title, notes, created_at) VALUES (?, ?, ?)",
            (session["title"], session["notes"], session["created_at"]),
        )
        new_id = cursor.lastrowid

        # Restore messages
        msg_cursor = await backup.execute(
            "SELECT role, content, created_at FROM deleted_messages WHERE original_session_id = ?",
            (original_id,),
        )
        messages = await msg_cursor.fetchall()
        for msg in messages:
            await db.execute(
                "INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)",
                (new_id, msg["role"], msg["content"], msg["created_at"]),
            )

        # Remove from backup
        await backup.execute("DELETE FROM deleted_messages WHERE original_session_id = ?", (original_id,))
        await backup.execute("DELETE FROM deleted_sessions WHERE original_id = ?", (original_id,))
        await backup.commit()

    await db.commit()
    return {"id": new_id, "title": session["title"]}


async def cleanup_expired_backups():
    """Remove backups older than 30 days. Called on startup."""
    try:
        async with aiosqlite.connect(BACKUP_DB_PATH) as backup:
            await backup.execute(
                "DELETE FROM deleted_messages WHERE original_session_id IN "
                "(SELECT original_id FROM deleted_sessions WHERE expires_at <= ?)",
                (datetime.utcnow().isoformat(),),
            )
            await backup.execute(
                "DELETE FROM deleted_sessions WHERE expires_at <= ?",
                (datetime.utcnow().isoformat(),),
            )
            await backup.commit()
    except Exception:
        pass  # ponytail: cleanup is best-effort, never block startup

