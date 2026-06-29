import aiosqlite
import os
import base64
import hashlib
import json
from cryptography.fernet import Fernet

DB_PATH = os.path.join(os.path.dirname(__file__), "data.db")
BACKUP_DB_PATH = os.path.join(os.path.dirname(__file__), "data_backup.db")


# ponytail: machine-derived Fernet key from hostname+user, good enough for local SQLite
def _get_fernet_key() -> Fernet:
    seed = f"{os.uname().nodename}:{os.getlogin()}:{DB_PATH}".encode()
    key = base64.urlsafe_b64encode(hashlib.sha256(seed).digest()[:32])
    return Fernet(key)


_fernet = None


def _get_fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        _fernet = _get_fernet_key()
    return _fernet


def encrypt_value(plaintext: str) -> str:
    if not plaintext:
        return ""
    return _get_fernet().encrypt(plaintext.encode()).decode()


def decrypt_value(ciphertext: str) -> str:
    if not ciphertext:
        return ""
    return _get_fernet().decrypt(ciphertext.encode()).decode()


async def get_setting(key: str) -> str | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT value FROM settings WHERE key = ?", (key,))
        row = await cursor.fetchone()
        return row["value"] if row else None


async def set_setting(key: str, value: str):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?",
            (key, value, value),
        )
        await db.commit()


async def get_db():
    db = await aiosqlite.connect(DB_PATH, timeout=10)
    db.row_factory = aiosqlite.Row
    try:
        yield db
    finally:
        await db.close()


async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                notes TEXT,
                image_context TEXT DEFAULT '',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (session_id) REFERENCES sessions(id)
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL,
                title TEXT NOT NULL DEFAULT 'Untitled',
                content TEXT NOT NULL DEFAULT '',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (session_id) REFERENCES sessions(id)
            )
        """)
        # Migration: add image_context column if missing
        cursor = await db.execute("PRAGMA table_info(sessions)")
        columns = [row[1] for row in await cursor.fetchall()]
        if "image_context" not in columns:
            await db.execute("ALTER TABLE sessions ADD COLUMN image_context TEXT DEFAULT ''")

        await db.execute("""
            CREATE TABLE IF NOT EXISTS study_spaces (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                emoji TEXT DEFAULT '',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS session_study_spaces (
                session_id INTEGER NOT NULL,
                study_space_id INTEGER NOT NULL,
                added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (session_id, study_space_id),
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
                FOREIGN KEY (study_space_id) REFERENCES study_spaces(id) ON DELETE CASCADE
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        """)
        await db.commit()

    # Backup DB: stores deleted sessions for 30 days
    async with aiosqlite.connect(BACKUP_DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS deleted_sessions (
                original_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                notes TEXT,
                created_at TIMESTAMP,
                deleted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP NOT NULL
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS deleted_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                original_session_id INTEGER NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TIMESTAMP,
                deleted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.commit()
