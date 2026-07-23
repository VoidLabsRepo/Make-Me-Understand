from dotenv import load_dotenv
import os as _os
load_dotenv(_os.path.join(_os.path.dirname(__file__), ".env"))

from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from database import init_db
from routes.sessions import router as sessions_router, cleanup_expired_backups
from routes.notes import router as notes_router
from routes.chat import router as chat_router
from routes.study_spaces import router as study_spaces_router
from routes.canvases import router as canvases_router
from routes.auth import router as auth_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await cleanup_expired_backups()
    yield


fastapi_app = FastAPI(title="Make Me Understand", lifespan=lifespan)

fastapi_app.include_router(sessions_router)
fastapi_app.include_router(notes_router)
fastapi_app.include_router(chat_router)
fastapi_app.include_router(study_spaces_router)
fastapi_app.include_router(canvases_router)
fastapi_app.include_router(auth_router)

# Wrap app so CORS headers apply even on 500s (official Starlette recommendation)
app = CORSMiddleware(
    fastapi_app,
    allow_origins=["http://localhost:3007", "http://localhost:3008", "https://mmu.voidlabs.in"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
