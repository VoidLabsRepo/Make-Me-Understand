import httpx
import os
import base64
import json
import re

OPENCODE_API_KEY = os.getenv("OPENCODE_API_KEY", "")
OPENCODE_BASE_URL = "https://opencode.ai/zen/go/v1"
MODEL = "mimo-v2.5"


async def chat_completion(messages: list[dict], stream: bool = False) -> dict:
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            f"{OPENCODE_BASE_URL}/chat/completions",
            headers={
                "Authorization": f"Bearer {OPENCODE_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": MODEL,
                "messages": messages,
                "stream": stream,
            },
        )
        if resp.status_code != 200:
            print(f"API ERROR {resp.status_code}: {resp.text[:500]}")
        resp.raise_for_status()
        return resp.json()


async def extract_images(image_bytes_list: list[bytes]) -> str:
    """Send images to MiMo Vision for text extraction."""
    content = []
    for img_bytes in image_bytes_list:
        b64 = base64.b64encode(img_bytes).decode()
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
        })

    content.append({
        "type": "text",
        "text": (
            "Extract ALL text and content from these images. "
            "Include every detail, heading, paragraph, formula, diagram description, "
            "bullet point, and any other visible content. Be thorough and complete."
        ),
    })

    result = await chat_completion([
        {"role": "user", "content": content}
    ])
    return result["choices"][0]["message"]["content"]


async def synthesize_notes(extracted_text: str) -> str:
    """Generate structured learning notes from extracted text."""
    result = await chat_completion([
        {
            "role": "system",
            "content": (
                "You are an expert educator. Given extracted text from study materials, "
                "create comprehensive, easy-to-understand notes. Structure them as:\n\n"
                "## Q&A\nCreate clear question-answer pairs covering key concepts.\n\n"
                "## Main Points\nBulleted list of the most important takeaways.\n\n"
                "## Simplifying Complex Topics\nTake the hardest concepts and explain them simply, "
                "using analogies and plain language.\n\n"
                "## Pattern-Based Remembering Methods\nCreate mnemonics, patterns, or memory "
                "techniques to help remember the material.\n\n"
                "Be thorough. The goal is to make complex material understandable."
            ),
        },
        {"role": "user", "content": f"Create study notes from this content:\n\n{extracted_text}"},
    ])
    return result["choices"][0]["message"]["content"]


async def chat_with_context(notes: str, history: list[dict], user_message: str) -> str:
    """Chat with AI using notes as context."""
    messages = [
        {
            "role": "system",
            "content": (
                f"You are a helpful study assistant. You have these notes about the user's study material:\n\n{notes}\n\n"
                "Use the notes to answer questions when relevant. You are also happy to chat casually, "
                "answer off-topic questions, and explain things not covered in the notes. Be friendly, engaging, "
                "and conversational."
            ),
        },
        *history,
        {"role": "user", "content": user_message},
    ]
    result = await chat_completion(messages)
    return result["choices"][0]["message"]["content"]


async def voice_explain(notes: str, question: str) -> str:
    """Generate a voice-friendly explanation for a question."""
    result = await chat_completion([
        {
            "role": "system",
            "content": (
                "You are a helpful study assistant talking to the user. Give a clear, spoken explanation. "
                "Use natural speech patterns. Be conversational, friendly, and informative. "
                "Keep responses under 300 words for voice output. "
                "Output PLAIN TEXT ONLY. No markdown, no formatting symbols, no tables, no bullet points, "
                "no emojis, no special characters. Just write as if you are speaking naturally to someone. "
                "A single paragraph is ideal. "
                "Use the notes if the question is relevant to them, but also feel free to chat casually, "
                "answer off-topic questions, and discuss general topics using your general knowledge."
            ),
        },
        {
            "role": "user",
            "content": f"The study notes are:\n{notes}\n\nAnswer or explain this question (can be off-topic or casual): {question}",
        },
    ])
    return result["choices"][0]["message"]["content"]


async def voice_chat_with_context(notes: str, history: list[dict], user_message: str) -> str:
    """Generate a voice-friendly explanation with chat history and context."""
    messages = [
        {
            "role": "system",
            "content": (
                f"You are a helpful study assistant talking to the user. You have these notes about the user's study material:\n\n{notes}\n\n"
                "Use the notes to answer questions when relevant, but also feel free to chat casually, answer off-topic questions, and discuss general topics. "
                "Give a clear, spoken explanation. Use natural speech patterns. Be conversational and friendly.\n"
                "CRITICAL: Keep responses under 150 words for voice output. A single paragraph is ideal. "
                "Output PLAIN TEXT ONLY. Do NOT use markdown (no asterisks, no hash signs, no bullet points), "
                "no emojis, no dashes/separators, no formatting symbols. Just write the exact words as they should be spoken naturally."
            ),
        },
        *history,
        {"role": "user", "content": user_message},
    ]
    result = await chat_completion(messages)
    return result["choices"][0]["message"]["content"]


def clean_voice_text(text: str) -> str:
    # 1. Remove markdown bold/italic asterisks
    text = text.replace("*", "")
    # 2. Remove emojis
    text = re.sub(r'[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDC00-\uDFFF]', '', text)
    # 3. Remove dashes/separators like "--", "---"
    text = re.sub(r'-{2,}', ' ', text)
    # 4. Clean up any extra whitespaces
    text = re.sub(r'\s+', ' ', text).strip()
    return text
