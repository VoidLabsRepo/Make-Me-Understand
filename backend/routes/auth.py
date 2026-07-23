from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import aiosqlite
from database import get_db
from auth import hash_password, verify_password, create_token

router = APIRouter(prefix="/api/auth", tags=["auth"])


class SignupRequest(BaseModel):
    email: str
    password: str


class LoginRequest(BaseModel):
    email: str
    password: str


@router.post("/signup")
async def signup(body: SignupRequest, db: aiosqlite.Connection = Depends(get_db)):
    email = body.email.strip().lower()
    if not email or not body.password:
        raise HTTPException(status_code=400, detail="Email and password required")
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    cursor = await db.execute("SELECT id FROM users WHERE email = ?", (email,))
    if await cursor.fetchone():
        raise HTTPException(status_code=409, detail="Email already registered")
    hashed = hash_password(body.password)
    cursor = await db.execute("INSERT INTO users (email, password_hash) VALUES (?, ?)", (email, hashed))
    await db.commit()
    user_id = cursor.lastrowid
    token = create_token(user_id)
    return {"token": token, "email": email}


@router.post("/login")
async def login(body: LoginRequest, db: aiosqlite.Connection = Depends(get_db)):
    email = body.email.strip().lower()
    cursor = await db.execute("SELECT id, password_hash FROM users WHERE email = ?", (email,))
    row = await cursor.fetchone()
    if not row or not verify_password(body.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_token(row["id"])
    return {"token": token, "email": email}
