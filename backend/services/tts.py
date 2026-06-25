import io
import numpy as np
import soundfile as sf
from kokoro import KPipeline

_pipeline = None


def _get_pipeline():
    global _pipeline
    if _pipeline is None:
        _pipeline = KPipeline(lang_code="a")
    return _pipeline


async def generate_tts(text: str) -> bytes:
    """Generate TTS audio from text using Kokoro."""
    pipeline = _get_pipeline()
    generator = pipeline(text, voice="af_heart")

    all_audio = []
    for _, _, audio in generator:
        all_audio.append(audio)

    combined = np.concatenate(all_audio)

    buf = io.BytesIO()
    sf.write(buf, combined, 24000, format="WAV")
    buf.seek(0)
    return buf.read()
