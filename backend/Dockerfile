FROM python:3.12-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends libsndfile1 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download Kokoro TTS model during build
RUN python -c "from kokoro import KPipeline; KPipeline(lang_code='a')"

COPY . .

RUN mkdir -p /app/data

EXPOSE 8007

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8007"]
