import io
import numpy as np
import soundfile as sf
from kokoro import KPipeline

_pipeline = None


def _get_pipeline():
    global _pipeline
    if _pipeline is None:
        import torch
        device = "cuda" if torch.cuda.is_available() else "cpu"
        _pipeline = KPipeline(lang_code="a", device=device)
    return _pipeline


async def generate_tts(text: str) -> bytes:
    """Generate TTS audio from text using Kokoro."""
    pipeline = _get_pipeline()
    generator = pipeline(text, voice="af_heart")

    all_audio = []
    for _, _, audio in generator:
        import torch
        if isinstance(audio, torch.Tensor):
            audio = audio.cpu().numpy()
        all_audio.append(audio)

    combined = np.concatenate(all_audio)

    buf = io.BytesIO()
    sf.write(buf, combined, 24000, format="WAV")
    buf.seek(0)
    return buf.read()
