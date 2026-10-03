FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY pkg1-sim-vm/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY pkg1-sim-vm/core core
COPY pkg1-sim-vm/server server
COPY schemas schemas
ENV PYTHONPATH=/app/core:/app AR_SCHEMA=/app/schemas/operation.schema.json
CMD ["uvicorn", "--factory", "server.app:create_app", "--host", "0.0.0.0", "--port", "8080"]
