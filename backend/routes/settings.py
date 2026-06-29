from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import httpx
from database import get_setting, set_setting, encrypt_value, decrypt_value
from services.llm import invalidate_llm_config

router = APIRouter(prefix="/api", tags=["settings"])

PROVIDER_DEFAULTS = {
    "openai": {"api_base": "https://api.openai.com/v1"},
    "anthropic": {"api_base": "https://api.anthropic.com/v1"},
    "gemini": {"api_base": "https://generativelanguage.googleapis.com/v1beta"},
    "ollama": {"api_base": "http://localhost:11434"},
    "opencode_zen": {"api_base": "https://opencode.ai/zen/v1"},
    "opencode_go": {"api_base": "https://opencode.ai/zen/go/v1"},
}

# ponytail: map provider → LiteLLM model prefix
PROVIDER_MODEL_PREFIX = {
    "openai": "openai/",
    "anthropic": "anthropic/",
    "gemini": "gemini/",
    "ollama": "ollama/",
    # opencode_zen/opencode_go: no prefix, uses api_base directly
}


class SettingsRequest(BaseModel):
    provider: str
    model: str
    api_key: str | None = None
    api_base: str | None = None


class ModelsRequest(BaseModel):
    provider: str
    api_key: str | None = None
    api_base: str | None = None


@router.get("/settings")
async def get_settings():
    raw = await get_setting("llm_provider")
    if not raw:
        return {"configured": False}
    import json
    config = json.loads(raw)
    api_key = config.get("api_key", "")
    return {
        "configured": True,
        "provider": config.get("provider"),
        "model": config.get("model"),
        "api_key_masked": f"••••{api_key[-4:]}" if api_key and len(api_key) >= 4 else "",
        "api_base": config.get("api_base"),
    }


@router.put("/settings")
async def put_settings(body: SettingsRequest):
    prefix = PROVIDER_MODEL_PREFIX.get(body.provider, "")
    model = body.model if body.model.startswith(prefix) else f"{prefix}{body.model}"
    config = {
        "provider": body.provider,
        "model": model,
        "api_key": encrypt_value(body.api_key) if body.api_key else "",
        "api_base": body.api_base or PROVIDER_DEFAULTS.get(body.provider, {}).get("api_base", ""),
    }
    import json
    await set_setting("llm_provider", json.dumps(config))
    invalidate_llm_config()
    return {"ok": True}


@router.post("/models")
async def list_models(body: ModelsRequest):
    api_base = body.api_base or PROVIDER_DEFAULTS.get(body.provider, {}).get("api_base", "")
    if not api_base:
        raise HTTPException(status_code=400, detail="No API base URL for this provider")

    provider = body.provider
    api_key = body.api_key or ""

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            if provider == "ollama":
                resp = await client.get(f"{api_base}/api/tags")
                resp.raise_for_status()
                data = resp.json()
                models = [m["name"] for m in data.get("models", [])]
            elif provider == "gemini":
                resp = await client.get(
                    f"{api_base}/models",
                    headers={"x-goog-api-key": api_key},
                )
                resp.raise_for_status()
                data = resp.json()
                raw_models = data.get("models", [])
                models = [
                    m["name"].removeprefix("models/")
                    for m in raw_models
                    if "generateContent" in m.get("supportedGenerationMethods", [])
                ]
            elif provider == "anthropic":
                resp = await client.get(
                    f"{api_base}/models",
                    headers={
                        "x-api-key": api_key,
                        "anthropic-version": "2023-06-01",
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                models = [m["id"] for m in data.get("data", [])]
            else:
                # OpenAI-compatible (openai, opencode_zen, opencode_go, any custom)
                resp = await client.get(
                    f"{api_base}/models",
                    headers={"Authorization": f"Bearer {api_key}"},
                )
                resp.raise_for_status()
                data = resp.json()
                models = [m["id"] for m in data.get("data", [])]

        return {"models": models, "provider": provider}

    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=f"Provider API error: {e.response.text[:200]}")
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail=f"Cannot connect to {api_base} — is it running?")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
