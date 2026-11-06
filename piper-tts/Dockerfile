FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN pip install --no-cache-dir "piper-tts[http]==1.8.0"

# La imagen incluye directamente el modelo de voz que ya probaste.
RUN mkdir -p /voices && \
    python -m piper.download_voices \
      --data-dir /voices \
      es_ES-davefx-medium

EXPOSE 5000

CMD ["python", "-m", "piper.http_server", \
     "--host", "0.0.0.0", \
     "--port", "5000", \
     "--data-dir", "/voices", \
     "-m", "es_ES-davefx-medium"]
