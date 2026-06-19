"""
SENTINEL AI — Violence Detection Backend
==========================================
Changelog vs original:
[FIX]     @app.on_event("startup") → modern lifespan context manager
[FIX]     Frame sampling bug — indices converted to set for O(1) lookup
[FIX]     File type & size validation on /predict
[FIX]     Confidence threshold — returns "Uncertain" zone instead of forced binary
[FEATURE] /health endpoint — model status, device, CUDA info
[FEATURE] Email alert on violent detection (Gmail SMTP, threshold-gated)
[FEATURE] WebSocket /ws/alerts — pushes live alerts to React frontend
[FEATURE] /history endpoint — in-memory incident log (last 50 events)
[FEATURE] Proper structured logging throughout
"""

# ─── STDLIB ───────────────────────────────────────────────────────────────────
import os
import json
import logging
import smtplib
import tempfile
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import List

# ─── THIRD PARTY ──────────────────────────────────────────────────────────────
import cv2
import numpy as np
import torch
import torch.nn as nn
from fastapi import FastAPI, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from torch.nn import functional as F
from torchvision.models import ConvNeXt_Tiny_Weights, convnext_tiny

# ─── LOGGING ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("sentinel")

# ─── CONFIGURATION  (override via environment variables) ──────────────────────
MODEL_PATH          = os.getenv("MODEL_PATH",          "model/best_violence_detector.pth")
VIOLENCE_THRESHOLD  = float(os.getenv("VIOLENCE_THRESHOLD",  "0.75"))  # alert if confidence >= this
UNCERTAIN_THRESHOLD = float(os.getenv("UNCERTAIN_THRESHOLD", "0.55"))  # below this → uncertain
MAX_UPLOAD_MB       = int(os.getenv("MAX_UPLOAD_MB",   "200"))
ALERT_EMAIL_TO      = os.getenv("ALERT_EMAIL_TO",      "")            # security@college.edu
ALERT_EMAIL_FROM    = os.getenv("ALERT_EMAIL_FROM",    "")            # your@gmail.com
ALERT_EMAIL_PASS    = os.getenv("ALERT_EMAIL_PASS",    "")            # Gmail App Password

ALLOWED_MIME_TYPES  = {"video/mp4", "video/avi", "video/quicktime", "video/x-msvideo",
                       "video/mkv", "video/x-matroska", "video/webm", "application/octet-stream"}
MAX_UPLOAD_BYTES    = MAX_UPLOAD_MB * 1024 * 1024

# ─── IN-MEMORY STORES ─────────────────────────────────────────────────────────
incident_history: List[dict] = []   # last 50 incidents
ws_clients:       List[WebSocket] = []  # connected WebSocket clients


# ══════════════════════════════════════════════════════════════════════════════
# MODEL ARCHITECTURE  (must match training exactly)
# ══════════════════════════════════════════════════════════════════════════════

class FeatureExtractor(nn.Module):
    def __init__(self, pretrained: bool = True):
        super().__init__()
        weights = ConvNeXt_Tiny_Weights.IMAGENET1K_V1 if pretrained else None
        base_model = convnext_tiny(weights=weights)
        self.model = nn.Sequential(*list(base_model.children())[:-1])
        self.feature_dim = 768  # ConvNeXt-Tiny output dimension

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        batch_size, seq_len, c, h, w = x.shape
        features   = []
        chunk_size = 4

        for i in range(0, seq_len, chunk_size):
            end_idx        = min(i + chunk_size, seq_len)
            chunk          = x[:, i:end_idx].reshape(-1, c, h, w)
            chunk_features = self.model(chunk)
            chunk_features = chunk_features.reshape(batch_size, end_idx - i, -1)
            features.append(chunk_features)

        return torch.cat(features, dim=1)


class TemporalAttention(nn.Module):
    def __init__(self, feature_dim: int, num_heads: int = 4, dropout: float = 0.1):
        super().__init__()
        self.self_attn = nn.MultiheadAttention(feature_dim, num_heads,
                                               dropout=dropout, batch_first=True)
        self.norm1    = nn.LayerNorm(feature_dim)
        self.dropout  = nn.Dropout(dropout)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        attn_output, _ = self.self_attn(x, x, x)
        x = x + self.dropout(attn_output)
        return self.norm1(x)


class TemporalSequenceModel(nn.Module):
    def __init__(self, input_dim: int, hidden_dim: int = 384,
                 num_layers: int = 1, dropout: float = 0.5):
        super().__init__()
        self.lstm      = nn.LSTM(input_dim, hidden_dim, num_layers,
                                 batch_first=True, dropout=0)
        self.attention = TemporalAttention(hidden_dim)
        self.fc        = nn.Linear(hidden_dim, 2)
        self.dropout   = nn.Dropout(dropout)
        self.norm      = nn.LayerNorm(hidden_dim)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        lstm_out = self.lstm(x)[0]
        attn_out = self.attention(lstm_out)
        pooled   = torch.mean(attn_out, dim=1)
        pooled   = self.norm(pooled)
        pooled   = self.dropout(pooled)
        return self.fc(pooled)


class ViolenceDetectionModel(nn.Module):
    def __init__(self, feature_dim: int = 768):
        super().__init__()
        # pretrained=False because we load saved weights below
        self.feature_extractor = FeatureExtractor(pretrained=False)
        self.feature_dim       = feature_dim
        self.sequence_model    = TemporalSequenceModel(input_dim=feature_dim)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        features   = self.feature_extractor(x)
        prediction = self.sequence_model(features)
        return prediction


# ══════════════════════════════════════════════════════════════════════════════
# MODEL LOADING
# ══════════════════════════════════════════════════════════════════════════════

device: torch.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
model:  ViolenceDetectionModel | None = None


def load_model() -> None:
    global model
    try:
        if not os.path.exists(MODEL_PATH):
            os.makedirs("model", exist_ok=True)
            log.info("📥 Downloading model from Hugging Face...")
            
            import requests
            HF_URL = os.getenv(
                "MODEL_DOWNLOAD_URL",
                "https://huggingface.co/Mazhar2905/sentinel-violence-detector/resolve/main/best_violence_detector.pth"
            )
            
            response = requests.get(HF_URL, stream=True, timeout=300)
            response.raise_for_status()
            
            total = int(response.headers.get('content-length', 0))
            downloaded = 0
            
            with open(MODEL_PATH, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
                    downloaded += len(chunk)
            
            log.info(f"✅ Model downloaded! Size: {downloaded/1024/1024:.1f} MB")
        
        # Verify file size
        file_size = os.path.getsize(MODEL_PATH)
        if file_size < 1024 * 1024:
            log.error(f"❌ File too small: {file_size} bytes — corrupt download")
            os.remove(MODEL_PATH)
            return
            
        log.info(f"Loading model on {device} from '{MODEL_PATH}' ...")
        m = ViolenceDetectionModel()
        checkpoint = torch.load(MODEL_PATH, map_location=device, weights_only=False)
        state_dict = (checkpoint["model_state_dict"]
                      if isinstance(checkpoint, dict) and "model_state_dict" in checkpoint
                      else checkpoint)
        m.load_state_dict(state_dict)
        m.to(device)
        m.eval()
        model = m
        log.info("✅ Model loaded successfully!")
        
    except FileNotFoundError:
        log.error(f"❌ Model file not found: '{MODEL_PATH}'")
    except Exception as exc:
        log.exception(f"❌ Failed to load model: {exc}")

# ══════════════════════════════════════════════════════════════════════════════
# [FIX] Modern lifespan replaces deprecated @app.on_event("startup")
# ══════════════════════════════════════════════════════════════════════════════

@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── startup ──
    load_model()
    log.info("🚀 Sentinel AI backend ready.")
    yield
    # ── shutdown ──
    log.info("🛑 Sentinel AI backend shutting down.")
    for client in ws_clients:
        await client.close()


# ══════════════════════════════════════════════════════════════════════════════
# FASTAPI APP
# ══════════════════════════════════════════════════════════════════════════════

app = FastAPI(
    title="Sentinel AI — Violence Detection API",
    version="2.0.0",
    description="ConvNeXt + LSTM + Temporal Attention violence detection backend.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # tighten to your frontend domain in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ══════════════════════════════════════════════════════════════════════════════
# HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def preprocess_video(video_path: str, num_frames: int = 16, img_size: int = 224) -> torch.Tensor:
    """
    Uniformly sample `num_frames` frames from the video, resize, normalise,
    and return a tensor of shape [1, T, C, H, W].
    
    [FIX] indices converted to a Python set for O(1) membership testing
          instead of iterating over a numpy array each frame.
    """
    cap         = cv2.VideoCapture(video_path)
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    frames: list = []

    if frame_count <= 0:
        cap.release()
        raise ValueError("Could not read any frames from the video file.")

    # Build the target set of frame indices
    if frame_count <= num_frames:
        raw_indices = list(range(frame_count)) + [frame_count - 1] * (num_frames - frame_count)
    else:
        raw_indices = np.linspace(0, frame_count - 1, num_frames, dtype=int).tolist()

    # [FIX] O(1) lookup — was O(n) before
    indices_set: set = set(raw_indices)

    frame_idx = 0
    while len(frames) < num_frames:
        ret, frame = cap.read()
        if not ret:
            break
        if frame_idx in indices_set:
            frame = cv2.resize(frame, (img_size, img_size))
            frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            frame = frame / 255.0
            frames.append(frame)
        frame_idx += 1
    cap.release()

    # Pad short videos with last frame
    if not frames:
        raise ValueError("No frames could be extracted from the video.")
    last = frames[-1]
    while len(frames) < num_frames:
        frames.append(last)

    frames_np     = np.array(frames, dtype=np.float32)           # [T, H, W, C]
    frames_tensor = torch.tensor(frames_np).permute(0, 3, 1, 2)  # [T, C, H, W]
    return frames_tensor.unsqueeze(0).to(device)                  # [1, T, C, H, W]


def send_email_alert(filename: str, confidence: float, classification: str) -> bool:
    """
    Send an email alert via Gmail SMTP.
    Returns True on success, False if credentials are not configured or on error.
    """
    if not all([ALERT_EMAIL_FROM, ALERT_EMAIL_PASS, ALERT_EMAIL_TO]):
        log.debug("Email alerts not configured — skipping.")
        return False

    try:
        msg              = MIMEMultipart("alternative")
        msg["Subject"]   = f"🚨 SENTINEL ALERT: Violence Detected — {filename}"
        msg["From"]      = ALERT_EMAIL_FROM
        msg["To"]        = ALERT_EMAIL_TO

        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        plain = (
            f"SENTINEL AI — Incident Report\n"
            f"{'─' * 40}\n"
            f"File         : {filename}\n"
            f"Classification: {classification}\n"
            f"Confidence   : {confidence:.1f}%\n"
            f"Timestamp    : {timestamp}\n"
            f"Device       : {device}\n\n"
            f"Please review the footage immediately.\n"
        )

        html = f"""
        <html><body style="font-family:monospace;background:#0f172a;color:#f1f5f9;padding:24px;">
          <div style="max-width:480px;margin:auto;background:#1e293b;border:1px solid #ef4444;
                      border-radius:12px;padding:24px;">
            <h2 style="color:#ef4444;margin-top:0;">🚨 Sentinel AI Alert</h2>
            <table style="width:100%;border-collapse:collapse;">
              <tr><td style="color:#94a3b8;padding:6px 0;">File</td>
                  <td style="color:#f1f5f9;">{filename}</td></tr>
              <tr><td style="color:#94a3b8;padding:6px 0;">Classification</td>
                  <td style="color:#ef4444;font-weight:bold;">{classification}</td></tr>
              <tr><td style="color:#94a3b8;padding:6px 0;">Confidence</td>
                  <td style="color:#fbbf24;">{confidence:.1f}%</td></tr>
              <tr><td style="color:#94a3b8;padding:6px 0;">Timestamp</td>
                  <td style="color:#f1f5f9;">{timestamp}</td></tr>
            </table>
            <p style="color:#94a3b8;font-size:12px;margin-bottom:0;">
              Please review the footage immediately.
            </p>
          </div>
        </body></html>
        """

        msg.attach(MIMEText(plain, "plain"))
        msg.attach(MIMEText(html, "html"))

        with smtplib.SMTP("smtp.gmail.com", 587, timeout=10) as server:
            server.ehlo()
            server.starttls()
            server.login(ALERT_EMAIL_FROM, ALERT_EMAIL_PASS)
            server.sendmail(ALERT_EMAIL_FROM, ALERT_EMAIL_TO, msg.as_string())

        log.info(f"📧 Alert email sent to {ALERT_EMAIL_TO}")
        return True

    except smtplib.SMTPAuthenticationError:
        log.error("❌ Email auth failed. Check ALERT_EMAIL_FROM / ALERT_EMAIL_PASS.")
    except Exception as exc:
        log.error(f"❌ Email send failed: {exc}")
    return False


async def broadcast_alert(payload: dict) -> None:
    """Push a JSON alert to all connected WebSocket clients."""
    if not ws_clients:
        return
    message = json.dumps(payload)
    dead    = []
    for client in ws_clients:
        try:
            await client.send_text(message)
        except Exception:
            dead.append(client)
    for d in dead:
        ws_clients.remove(d)


def record_incident(payload: dict) -> None:
    """Append to the in-memory incident log (max 50 entries)."""
    incident_history.insert(0, payload)
    if len(incident_history) > 50:
        incident_history.pop()


# ══════════════════════════════════════════════════════════════════════════════
# ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/", tags=["System"])
def root():
    return {"message": "Sentinel AI Backend is Running", "version": "2.0.0"}


# ── [FEATURE] Health check ────────────────────────────────────────────────────
@app.get("/health", tags=["System"])
def health_check():
    """
    Returns live system status.
    Useful for frontend connection checks and deployment health probes.
    """
    return {
        "status":          "ok",
        "model_loaded":    model is not None,
        "device":          str(device),
        "cuda_available":  torch.cuda.is_available(),
        "cuda_device_name": (torch.cuda.get_device_name(0)
                             if torch.cuda.is_available() else None),
        "violence_threshold":  VIOLENCE_THRESHOLD,
        "uncertain_threshold": UNCERTAIN_THRESHOLD,
        "timestamp":       datetime.now().isoformat(),
    }


# ── [FEATURE] Incident history ────────────────────────────────────────────────
@app.get("/history", tags=["Incidents"])
def get_history():
    """Returns the last 50 detected incidents (in-memory, resets on restart)."""
    return {"count": len(incident_history), "incidents": incident_history}


# ── [UPDATED] Predict endpoint ────────────────────────────────────────────────
@app.post("/predict", tags=["Inference"])
async def predict_video(file: UploadFile = File(...)):
    """
    Accepts a video file, runs violence detection, returns classification +
    confidence score. Triggers email alert and WebSocket broadcast on danger.

    Changes vs original:
      [FIX] File type & size validation
      [FIX] Confidence threshold with "Uncertain" zone
      [FEATURE] Email alert (threshold-gated)
      [FEATURE] WebSocket broadcast to connected dashboards
      [FEATURE] Incident logged to /history
    """
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded. Check server logs.")

    # ── [FIX] Validate file type ──────────────────────────────────────────────
    content_type = file.content_type or ""
    if content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type '{content_type}'. "
                   f"Allowed: mp4, avi, mov, mkv, webm."
        )

    # ── [FIX] Read & validate file size ───────────────────────────────────────
    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File too large ({len(content)//1024//1024} MB). "
                   f"Limit is {MAX_UPLOAD_MB} MB."
        )

    # ── Save to temp file ─────────────────────────────────────────────────────
    suffix   = os.path.splitext(file.filename or "video")[-1] or ".mp4"
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        # ── Preprocess & infer ────────────────────────────────────────────────
        input_tensor = preprocess_video(tmp_path)

        with torch.no_grad():
            output           = model(input_tensor)
            probs            = F.softmax(output, dim=1)
            confidence, pred = torch.max(probs, 1)

        confidence_score = float(confidence.item())
        raw_class        = "Violent" if pred.item() == 1 else "Non-Violent"

        # ── [FIX] Confidence threshold with uncertain zone ────────────────────
        if raw_class == "Violent" and confidence_score >= VIOLENCE_THRESHOLD:
            classification = "Violent"
            is_danger      = True
        elif raw_class == "Violent" and confidence_score >= UNCERTAIN_THRESHOLD:
            classification = "Uncertain"
            is_danger      = False
        else:
            classification = "Non-Violent"
            is_danger      = False

        confidence_pct = round(confidence_score * 100, 2)
        timestamp      = datetime.now().isoformat()

        # ── Build response payload ────────────────────────────────────────────
        result = {
            "filename":       file.filename,
            "classification": classification,
            "confidence":     confidence_pct,
            "is_danger":      is_danger,
            "alert_sent":     False,
            "timestamp":      timestamp,
        }

        # ── [FEATURE] Email + WebSocket broadcast on danger ───────────────────
        if is_danger:
            log.warning(f"🚨 VIOLENCE DETECTED in '{file.filename}' "
                        f"({confidence_pct}% confidence)")

            # Email alert (non-blocking — run in thread pool)
            alert_sent = await asyncio.get_event_loop().run_in_executor(
                None, send_email_alert, file.filename, confidence_pct, classification
            )
            result["alert_sent"] = alert_sent

            # WebSocket broadcast to all connected dashboard clients
            ws_payload = {
                "id":         int(datetime.now().timestamp() * 1000),
                "camId":      "UPLOAD",
                "location":   "Forensics Lab",
                "time":       datetime.now().strftime("%H:%M:%S"),
                "confidence": str(confidence_pct),
                "type":       "VIOLENCE DETECTED (AI)",
            }
            await broadcast_alert(ws_payload)
        else:
            log.info(f"✅ '{file.filename}' → {classification} ({confidence_pct}%)")

        # ── [FEATURE] Log to incident history ────────────────────────────────
        if classification != "Non-Violent":
            record_incident(result)

        return result

    except ValueError as ve:
        raise HTTPException(status_code=422, detail=str(ve))
    except Exception as exc:
        log.exception(f"Inference error: {exc}")
        raise HTTPException(status_code=500, detail=f"Inference failed: {exc}")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)


# ── [FEATURE] WebSocket alert stream ──────────────────────────────────────────
@app.websocket("/ws/alerts")
async def websocket_alerts(websocket: WebSocket):
    """
    Persistent WebSocket connection for the React dashboard.
    The frontend connects here to receive real-time violence alerts
    without polling /predict.
    """
    await websocket.accept()
    ws_clients.append(websocket)
    client_host = websocket.client.host if websocket.client else "unknown"
    log.info(f"🔌 WebSocket client connected: {client_host}  "
             f"(total: {len(ws_clients)})")

    # Send a handshake confirmation
    await websocket.send_text(json.dumps({
        "type":    "connected",
        "message": "Sentinel WebSocket stream active.",
        "timestamp": datetime.now().isoformat(),
    }))

    try:
        # Keep connection alive — wait for client close or ping frames
        while True:
            data = await websocket.receive_text()
            # Echo ping/pong to keep connection alive behind proxies
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        log.info(f"🔌 WebSocket client disconnected: {client_host}")
    except Exception as exc:
        log.warning(f"WebSocket error ({client_host}): {exc}")
    finally:
        if websocket in ws_clients:
            ws_clients.remove(websocket)