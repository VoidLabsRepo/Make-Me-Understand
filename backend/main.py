from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from database import init_db
from routes.sessions import router as sessions_router
from routes.chat import router as chat_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


fastapi_app = FastAPI(title="Make Me Understand", lifespan=lifespan)

fastapi_app.include_router(sessions_router)
fastapi_app.include_router(chat_router)

# Wrap app so CORS headers apply even on 500s (official Starlette recommendation)
app = CORSMiddleware(
    fastapi_app,
    allow_origins=["http://localhost:3007"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
