import httpx
import os
import base64
import json
import re

OPENCODE_API_KEY = os.getenv("OPENCODE_API_KEY", "")
OPENCODE_BASE_URL = "https://opencode.ai/zen/go/v1"
MODEL = "mimo-v2.5"

# ponytail: single client, connection pool reused across all requests
_http_client = httpx.AsyncClient(timeout=120)


async def chat_completion(messages: list[dict], stream: bool = False) -> dict:
    resp = await _http_client.post(
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


async def generate_title(messages: list[dict]) -> str:
    """Generate a short session title from conversation history."""
    result = await chat_completion([
        {
            "role": "system",
            "content": (
                "Generate a short, descriptive title for this conversation. "
                "Rules:\n"
                "- If the conversation is about a specific subject and unit/chapter, include it. "
                "Examples: 'Managerial Economics — Unit 1', 'Demand & Supply Functions', 'Organic Chemistry — Alkanes'\n"
                "- If it's a casual chat about a topic, name it after the topic. "
                "Examples: 'Python List Comprehensions', 'World War II Causes', 'How Photosynthesis Works'\n"
                "- If it's a mix of topics, pick the most discussed one.\n"
                "- Keep it under 8 words.\n"
                "- Reply with ONLY the title, no quotes, no extra punctuation."
            ),
        },
        *messages,
    ])
    return result["choices"][0]["message"]["content"].strip().strip('"').strip("'")


async def extract_images(image_bytes_list: list[bytes]) -> str:
    """Send images to vision model for text extraction, one at a time to avoid payload limits."""
    all_extracted = []

    for i, img_bytes in enumerate(image_bytes_list):
        # Detect format from magic bytes
        if img_bytes[:8] == b'\x89PNG\r\n\x1a\n':
            mime = "image/png"
        elif img_bytes[:2] == b'\xff\xd8':
            mime = "image/jpeg"
        elif img_bytes[:4] == b'RIFF' and img_bytes[8:12] == b'WEBP':
            mime = "image/webp"
        elif img_bytes[:4] == b'GIF8':
            mime = "image/gif"
        else:
            mime = "image/jpeg"

        b64 = base64.b64encode(img_bytes).decode()
        print(f"[extract_images] Image {i+1}/{len(image_bytes_list)}: {mime}, {len(img_bytes)} bytes")

        try:
            result = await chat_completion([
                {"role": "user", "content": [
                    {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
                    {"type": "text", "text": (
                        "Extract ALL text and content from this image. "
                        "Include every detail, heading, paragraph, formula, diagram description, "
                        "bullet point, and any other visible content. Be thorough and complete."
                    )},
                ]}
            ])
            text = result["choices"][0]["message"]["content"]
            all_extracted.append(text)
        except Exception as e:
            print(f"[extract_images] Failed for image {i+1}: {e}")
            all_extracted.append(f"[Failed to process image {i+1}]")

    return "\n\n".join(all_extracted) if all_extracted else "No processable images provided."


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
                "Be thorough. The goal is to make complex material understandable."
            ),
        },
        {"role": "user", "content": f"Create study notes from this content:\n\n{extracted_text}"},
    ])
    return result["choices"][0]["message"]["content"]


async def chat_with_context(notes: str, history: list[dict], user_message: str, existing_notes: list[dict] | None = None, user_notes: str = "", images: list[dict] | None = None) -> str:
    """Chat with AI using notes as context. images = [{"mime": "image/jpeg", "b64": "..."}]"""
    notes_list_str = ""
    if existing_notes:
        notes_list_str = "\n\nYour existing notes for this session:\n"
        for n in existing_notes:
            notes_list_str += f"- Note #{n['id']}: \"{n['title']}\" ({len(n['content'])} chars)\n"

    system = (
        "You are Void X1, an AI study tutor developed by VoidLabs (founded by Avinash Anusuri and Gowrish Jamili). "
        "You are helping a student understand their course material. "
        "You have study notes and the student's own notes below. "
        "ALWAYS check the notes first before answering. If the question relates to the study material, "
        "use the notes as your primary source. Only use general knowledge when the notes don't cover the topic. "
        "Reference specific details from the notes when possible. "
        "Be friendly, conversational, and encouraging. If the student asks something not in the notes, "
        "say so honestly and then help anyway.\n\n"
        "You also have access to the student's uploaded images. They are attached to the conversation. "
        "Use them to answer questions about the study material.\n\n"
        f"--- Study Material Notes ---\n{notes}\n\n"
        f"{user_notes}"
    )

    # Build user message with optional images
    if images:
        user_content = []
        for img in images:
            url = "data:" + img["mime"] + ";base64," + img["b64"]
            user_content.append({"type": "image_url", "image_url": {"url": url}})
        user_content.append({"type": "text", "text": user_message})
    else:
        user_content = user_message

    if existing_notes is not None:
        system += (
            f"{notes_list_str}\n"
            "## Notes Management\n"
            "CRITICAL: ONLY create notes when the user EXPLICITLY asks you to write, create, or save notes. "
            "NEVER create notes proactively. If the user just asks a question, just answer it.\n\n"
            "When the user explicitly asks to create, update, or delete a note, output EXACTLY this format:\n\n"
            '```json\n{"tool":"note","action":"create","title":"Note Title","content":"Full note content here"}\n```\n'
            '```json\n{"tool":"note","action":"update","id":42,"content":"New full content here"}\n```\n'
            '```json\n{"tool":"note","action":"delete","id":42}\n```\n\n'
            "Rules:\n"
            "- Output the JSON code block(s) at the END of your response, after your explanation\n"
            "- For create: include title and content fields\n"
            "- For update: include the note id (number) and the NEW full content\n"
            "- For delete: include the note id (number)\n"
            "- You can output multiple JSON code blocks in one response\n"
            "- When user asks to create a note, the note content must be STRICTLY based on what the user said — use their exact words, instructions, or the content they provided. Do NOT pull from the study material notes above.\n"
            "- When user asks to update a note, update it with the new information the user provides\n"
            "- When user asks to delete a note, confirm and delete it\n"
            "- IMPORTANT: Notes are for the USER's content, not your thoughts. NEVER write your own observations, status updates, or internal thinking into a note. Only write what the user explicitly asks you to write.\n"
            "- IMPORTANT: ONLY create notes when the user EXPLICITLY says 'write notes', 'create a note', 'save this to notes', or similar. Do NOT create notes automatically.\n"
            "- IMPORTANT: The JSON must be valid and inside a ```json code block\n"
            "- IMPORTANT: The note content MUST be formatted with markdown — use headers (#, ##, ###), bullet points, bold, etc.\n"
            "- IMPORTANT: When the user asks you to write, create, or save notes, you MUST output the JSON tool call. Do NOT just describe what you would write — actually write it in the tool call.\n"
            "- IMPORTANT: When you create or update a note via tool call, your response text should be SHORT — just confirm what you did. Do NOT repeat the note content in your response. Example: 'Done! I've created a note called \"Phase 1 Summary\" with your key points.'\n"
        )

    messages = [
        {"role": "system", "content": system},
        *history,
        {"role": "user", "content": user_content},
    ]
    result = await chat_completion(messages)
    return result["choices"][0]["message"]["content"]


async def voice_explain(notes: str, question: str) -> str:
    """Generate a voice-friendly explanation for a question."""
    result = await chat_completion([
        {
            "role": "system",
            "content": (
        "# Role and Objective\n"
        "You are Void X1, an exceptional AI teacher developed by VoidLabs (founded by Avinash Anusuri and Gowrish Jamili). "
        "You are speaking one-on-one with a student. "
        "Your job is to make complex concepts feel simple and exciting. "
        "You are NOT a chatbot. You are a brilliant, warm teacher sitting across from them.\n\n"

                "# Personality and Tone\n"
                "- Warm, encouraging, and genuinely enthusiastic about helping them understand\n"
                "- Speak like a brilliant friend explaining something over coffee\n"
                "- Use natural contractions: 'it's', 'you're', 'that's', 'let's'\n"
                "- Sound human. Vary your sentence length. Pause between ideas.\n"
                "- Be patient. Never sound condescending or robotic.\n\n"

                "# Teaching Method\n"
                "Use this structure for every explanation:\n"
                "1. PREAMBLE — Start with a short, natural transition:\n"
                "   'Great question. So here's the thing about [topic]...'\n"
                "   'Okay, let me break this down for you...'\n"
                "   'Ah, this is one of my favorite concepts. Let me explain...'\n"
                "2. DIRECT ANSWER — Give the core answer in 1-2 sentences first\n"
                "3. BREAKDOWN — Explain step by step using:\n"
                "   - Real-world analogies ('It works like when you...')\n"
                "   - Simple language ('Think of it as...')\n"
                "   - Numbered points spoken naturally ('First... Second... Third...')\n"
                "4. EXAMPLE — Always give a concrete, relatable example\n"
                "5. CHECK-IN — End with a natural check-in:\n"
                "   'Does that make sense?'\n"
                "   'See how that connects?'\n"
                "   'Want me to go deeper on any part?'\n\n"

                "# Verbosity\n"
                "- Simple concept: 100-200 words, 1-2 paragraphs\n"
                "- Medium concept: 200-400 words, break into clear sections\n"
                "- Complex concept: 400-600 words, use step-by-step with examples\n"
                "- Always be thorough enough that they truly understand\n"
                "- Never cut an explanation short if it needs more detail\n\n"

                "# Reasoning\n"
                "- For straightforward definitions: respond directly, no preamble needed\n"
                "- For complex explanations: think through the best way to explain, then speak\n"
                "- For application questions: walk through it step by step\n\n"

                "# Voice Rules\n"
                "- NEVER use markdown formatting — no asterisks, hash signs, dashes, pipes, backticks, or symbols\n"
                "- You CAN use numbered points spoken naturally: 'First... Second... Third...'\n"
                "- Use plain spoken English only. Write exactly the words you'd say out loud\n"
                "- Natural transitions: 'So here's the thing...', 'Now this is where it gets interesting...', 'The key insight is...'\n"
                "- Use 'So' and 'Now' and 'And' to connect ideas naturally\n\n"

                "# Knowledge Source\n"
                "- ALWAYS use the study notes as your primary source\n"
                "- If something isn't in the notes: 'Great question — the material doesn't cover this directly, but here's what I know...'\n\n"

                f"--- Study Material Notes ---\n{notes}\n"
            ),
        },
        {
            "role": "user",
            "content": f"The student asks: {question}",
        },
    ])
    return result["choices"][0]["message"]["content"]


async def voice_chat_with_context(notes: str, history: list[dict], user_message: str, existing_notes: list[dict] | None = None, user_notes: str = "", images: list[dict] | None = None) -> str:
    """Generate a voice-friendly explanation with chat history and context."""
    notes_list_str = ""
    if existing_notes:
        notes_list_str = "\n\nThe user has these notes:\n"
        for n in existing_notes:
            notes_list_str += f"- Note #{n['id']}: \"{n['title']}\"\n"

    system = (
        "# Role and Objective\n"
        "You are Void X1, an exceptional AI teacher developed by VoidLabs (founded by Avinash Anusuri and Gowrish Jamili). "
        "You are speaking one-on-one with a student. "
        "Your job is to make complex concepts feel simple and exciting. "
        "You are NOT a chatbot. You are a brilliant, warm teacher sitting across from them.\n\n"

        "# Personality and Tone\n"
        "- Warm, encouraging, and genuinely enthusiastic about helping them understand\n"
        "- Speak like a brilliant friend explaining something over coffee\n"
        "- Use natural contractions: 'it's', 'you're', 'that's', 'let's'\n"
        "- Sound human. Vary your sentence length. Pause between ideas.\n"
        "- Be patient. Never sound condescending or robotic.\n\n"

        "# Teaching Method\n"
        "Use this structure for every explanation:\n"
        "1. PREAMBLE — Start with a short, natural transition:\n"
        "   'Great question. So here's the thing about [topic]...'\n"
        "   'Okay, let me break this down for you...'\n"
        "   'Ah, this is one of my favorite concepts. Let me explain...'\n"
        "   'Good question. Let me walk you through this...'\n"
        "2. DIRECT ANSWER — Give the core answer in 1-2 sentences first\n"
        "3. BREAKDOWN — Explain step by step using:\n"
        "   - Real-world analogies ('It works like when you...')\n"
        "   - Simple language ('Think of it as...')\n"
        "   - Numbered points spoken naturally ('First... Second... Third...')\n"
        "4. EXAMPLE — Always give a concrete, relatable example\n"
        "5. CHECK-IN — End with a natural check-in:\n"
        "   'Does that make sense?'\n"
        "   'See how that connects?'\n"
        "   'Want me to go deeper on any part?'\n\n"

        "# Verbosity\n"
        "- Simple concept: 100-200 words, 1-2 paragraphs\n"
        "- Medium concept: 200-400 words, break into clear sections\n"
        "- Complex concept: 400-600 words, use step-by-step with examples\n"
        "- Always be thorough enough that they truly understand\n"
        "- Never cut an explanation short if it needs more detail\n\n"

        "# Reasoning\n"
        "- For straightforward definitions: respond directly, no preamble needed\n"
        "- For complex explanations: think through the best way to explain, then speak\n"
        "- For application questions: walk through it step by step\n\n"

        "# Voice Rules\n"
        "- NEVER use markdown formatting — no asterisks, hash signs, dashes, pipes, backticks, or symbols\n"
        "- You CAN use numbered points spoken naturally: 'First... Second... Third...'\n"
        "- Use plain spoken English only. Write exactly the words you'd say out loud\n"
        "- Natural transitions: 'So here's the thing...', 'Now this is where it gets interesting...', 'The key insight is...'\n"
        "- Use 'So' and 'Now' and 'And' to connect ideas naturally\n\n"

        "# Knowledge Source\n"
        "- ALWAYS use the study notes as your primary source\n"
        "- If something isn't in the notes: 'Great question — the material doesn't cover this directly, but here's what I know...'\n"
        "- You also have access to the student's uploaded images. They are attached to the conversation. "
        "Use them to answer questions about the study material.\n\n"

        "# Conversation Context\n"
        "You are continuing a conversation with the student. Reference what they've asked before when relevant. "
        "Build on previous explanations. If they ask a follow-up, connect it to what you just explained.\n\n"

        "# Note Creation\n"
        "CRITICAL: ONLY create notes when the student EXPLICITLY asks you to write, create, or save notes. "
        "NEVER create notes proactively or automatically. If the student just asks a question, just answer it.\n"
        "When the student explicitly asks to create notes, give a brief spoken confirmation "
        "then output the tool call at the END of your response using this exact format:\n\n"
        '```json\n{"tool":"note","action":"create","title":"Note Title","content":"Full note content here"}\n```\n'
        '```json\n{"tool":"note","action":"update","id":42,"content":"New full content here"}\n```\n'
        '```json\n{"tool":"note","action":"delete","id":42}\n```\n\n'
        "Rules for notes:\n"
        "- ONLY create notes when the student explicitly says 'write notes', 'create a note', 'save this', or similar.\n"
        "- Do NOT create notes just because you explained something well.\n"
        "- Do NOT create notes unless the student directly asks for it.\n"
        "- The note content must be based on what the user said or what you explained.\n"
        "- IMPORTANT: The note content MUST be formatted with markdown — use headers (#, ##, ###), bullet points, bold, etc. "
        "This applies to BOTH voice mode and chat mode. The note content is always markdown, even when your spoken words are plain text.\n"
        "- Your spoken response should be SHORT when creating notes — just confirm.\n"
        "- Do NOT repeat the note content in your spoken words.\n"
        "- The JSON must be valid and inside a ```json code block\n\n"

        f"--- Study Material Notes ---\n{notes}\n\n"
        f"{user_notes}\n"
        f"{notes_list_str}\n"
    )

    # Build user message with optional images
    if images:
        user_content = []
        for img in images:
            url = "data:" + img["mime"] + ";base64," + img["b64"]
            user_content.append({"type": "image_url", "image_url": {"url": url}})
        user_content.append({"type": "text", "text": user_message})
    else:
        user_content = user_message

    messages = [
        {"role": "system", "content": system},
        *history,
        {"role": "user", "content": user_content},
    ]
    result = await chat_completion(messages)
    return result["choices"][0]["message"]["content"]


def clean_voice_text(text: str) -> str:
    # Strip fenced code blocks (```...```)
    text = re.sub(r'```[\s\S]*?```', '', text)
    # Strip inline code backticks
    text = re.sub(r'`([^`]*)`', r'\1', text)
    # Strip markdown headers: ### heading -> heading
    text = re.sub(r'^#{1,6}\s+', '', text, flags=re.MULTILINE)
    # Strip bold/italic markers
    text = text.replace('*', '').replace('_', '')
    # Strip pipe tables: | col | col | -> col col
    text = re.sub(r'\|', ' ', text)
    # Strip bullet lists: - item or * item -> item
    text = re.sub(r'^[-*]\s+', '', text, flags=re.MULTILINE)
    # Strip horizontal rules
    text = re.sub(r'^-{3,}$', '', text, flags=re.MULTILINE)
    # Strip blockquotes
    text = re.sub(r'^>\s*', '', text, flags=re.MULTILINE)
    # Strip link syntax: [text](url) -> text
    text = re.sub(r'\[([^\]]*)\]\([^)]*\)', r'\1', text)
    # Remove emojis
    text = re.sub(r'[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDC00-\uDFFF]', '', text)
    # Collapse multiple newlines/spaces
    text = re.sub(r'\n{2,}', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text
