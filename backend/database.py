import aiosqlite
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "data.db")
BACKUP_DB_PATH = os.path.join(os.path.dirname(__file__), "data_backup.db")


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
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL DEFAULT 0,
                title TEXT NOT NULL,
                notes TEXT,
                image_context TEXT DEFAULT '',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
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
        if "user_id" not in columns:
            await db.execute("ALTER TABLE sessions ADD COLUMN user_id INTEGER NOT NULL DEFAULT 0")

        await db.execute("""
            CREATE TABLE IF NOT EXISTS study_spaces (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL DEFAULT 0,
                name TEXT NOT NULL,
                emoji TEXT DEFAULT '',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        """)
        # Migration: add user_id to study_spaces
        ss_cursor = await db.execute("PRAGMA table_info(study_spaces)")
        ss_columns = [row[1] for row in await ss_cursor.fetchall()]
        if "user_id" not in ss_columns:
            await db.execute("ALTER TABLE study_spaces ADD COLUMN user_id INTEGER NOT NULL DEFAULT 0")

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
            CREATE TABLE IF NOT EXISTS canvases (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL,
                title TEXT NOT NULL DEFAULT 'Untitled',
                elements TEXT NOT NULL DEFAULT '[]',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (session_id) REFERENCES sessions(id)
            )
        """)
        # Migration: add reasoning column to messages
        msg_cursor = await db.execute("PRAGMA table_info(messages)")
        msg_columns = [row[1] for row in await msg_cursor.fetchall()]
        if "reasoning" not in msg_columns:
            await db.execute("ALTER TABLE messages ADD COLUMN reasoning TEXT DEFAULT '[]'")
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
