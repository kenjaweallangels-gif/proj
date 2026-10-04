import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .db import SessionLocal, engine
from .migrate import upgrade_to_head
from .routers import auth, ecn, items, misc, planning, purchasing, simple, stock
from .seed import seed

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    upgrade_to_head(engine)
    with SessionLocal() as db:
        seed(db, demo=settings.seed_demo)
    yield


app = FastAPI(title=settings.app_name, version="1.0.0", docs_url="/api/docs", openapi_url="/api/openapi.json", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins.split(","), allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def security_headers(request: Request, call_next):
    t = time.perf_counter()
    resp = await call_next(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "same-origin"
    resp.headers["X-Response-Time-ms"] = f"{(time.perf_counter() - t) * 1000:.1f}"
    return resp


for r in (auth.router, auth.admin, items.router, items.wc, ecn.router, planning.router, stock.router, purchasing.router,
          misc.analytics_r, misc.import_r, misc.integr_r, misc.ai_r, simple.router):
    app.include_router(r)


@app.get("/api/health")
def health():
    return {"status": "ok", "app": settings.app_name}


static = os.path.join(os.path.dirname(__file__), settings.static_dir)
if os.path.isdir(static):
    app.mount("/assets", StaticFiles(directory=os.path.join(static, "assets")), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        full = os.path.join(static, path)
        if path and os.path.isfile(full):
            return FileResponse(full)
        return FileResponse(os.path.join(static, "index.html"))
