# 🛡️ Sentinel AI — Violence Detection System

Detects violence in video clips with a ConvNeXt-Tiny + LSTM + temporal-attention model, served through a FastAPI backend and a React security dashboard. When a clip is classified as violent, the system pushes a live alert over WebSocket and sends an email.

![Python](https://img.shields.io/badge/Python-3.11-3776AB?logo=python&logoColor=white)
![PyTorch](https://img.shields.io/badge/PyTorch-2.1-EE4C2C?logo=pytorch&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)

<!-- Add a dashboard screenshot or short GIF here, e.g. ![Dashboard](docs/dashboard.png) -->

## Results

| Metric | Value |
|---|---|
| Test accuracy | **96.5%** |
| False-positive rate | **0.8%** (2 false alarms in 250 test samples) |
| Inference time | about **42 ms** per 16-frame clip (GPU) |
| Holdout check | 10 violent + 10 non-violent unseen videos |
| F1 / ROC AUC | 0.9645 / 0.9805 |

## How it works

```
Video upload ──► sample 16 frames ──► resize 224×224, normalise
                                            │
                                            ▼
                        ConvNeXt-Tiny (per-frame features, 768-d)
                                            │
                                            ▼
                      LSTM (hidden 384) ──► 4-head temporal self-attention
                                            │
                                            ▼
                        mean-pool ──► LayerNorm ──► Linear ──► softmax
                                            │
                                            ▼
              three-zone decision ──► Violent / Uncertain / Non-Violent
```

- **Spatial features:** ConvNeXt-Tiny (ImageNet-pretrained backbone, 28.6M parameters) turns each frame into a 768-d vector.
- **Temporal reasoning:** an LSTM reads the frame sequence and multi-head self-attention weights the frames that matter most.
- **Three-zone confidence** (thresholds configurable, see below), so borderline clips are flagged for review instead of forced into a binary label:

| Zone | Rule | Action |
|---|---|---|
| Violent | predicted violent and confidence ≥ 75% | alert (WebSocket + email) and log |
| Uncertain | predicted violent and 55% ≤ confidence < 75% | log for human review, no alert |
| Non-Violent | everything else | no action |

## Features

- **REST API** for video classification, with file-type and size validation
- **Real-time alerts** over WebSocket (`/ws/alerts`) with auto-reconnect on the dashboard
- **Email alerts** through Gmail SMTP, sent only when confidence crosses the violence threshold
- **Incident history** (last 50 events, in memory)
- **Health endpoint** reporting model status, device and CUDA info
- **React dashboard** with a Forensics Lab (upload and analyse a clip), a geo-spatial camera map (Leaflet / OpenStreetMap), a model-metrics page and a configuration page
- Auto-generated API docs at `/docs`

## Project structure

```
.
├── Backend/
│   ├── main.py            # FastAPI app: model, inference, alerts, WebSocket
│   ├── requirements.txt
│   └── runtime.txt        # Python 3.11
└── Frontend/
    ├── src/App.js         # React dashboard
    └── package.json
```

## Getting started

### 1. Backend

```bash
cd Backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

On first start the backend downloads the trained weights (`best_violence_detector.pth`) from Hugging Face into `Backend/model/`. To use your own file, set `MODEL_PATH`, or point `MODEL_DOWNLOAD_URL` at another host. Open <http://localhost:8000/docs> for the interactive API docs.

**Configuration** (environment variables, all optional):

| Variable | Default | Purpose |
|---|---|---|
| `MODEL_PATH` | `model/best_violence_detector.pth` | Where the weights are stored |
| `MODEL_DOWNLOAD_URL` | Hugging Face URL | Where to fetch weights if missing |
| `VIOLENCE_THRESHOLD` | `0.75` | Confidence needed to raise an alert |
| `UNCERTAIN_THRESHOLD` | `0.55` | Below this the clip counts as non-violent |
| `MAX_UPLOAD_MB` | `200` | Maximum upload size |
| `ALERT_EMAIL_FROM` | – | Sender Gmail address |
| `ALERT_EMAIL_PASS` | – | Gmail **App Password** (not your account password) |
| `ALERT_EMAIL_TO` | – | Alert recipient |

Email alerts are skipped silently unless all three `ALERT_EMAIL_*` variables are set.

### 2. Frontend

```bash
cd Frontend
npm install
npm start
```

The dashboard opens at <http://localhost:3000>. Set `API_URL` and `WS_URL` at the top of `src/App.js` to your backend (for example `http://localhost:8000` and `ws://localhost:8000`). Replace the values that are in the file now, which point to a temporary ngrok tunnel.

## API

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Service banner and version |
| `GET` | `/health` | Model loaded, device, CUDA, thresholds |
| `POST` | `/predict` | Upload a video (`multipart/form-data`, field `file`) and get a classification |
| `GET` | `/history` | Last 50 non-benign incidents (Violent and Uncertain) |
| `WS` | `/ws/alerts` | Live alert stream for dashboards |

Example:

```bash
curl -X POST http://localhost:8000/predict -F "file=@sample.mp4"
```

```json
{
  "filename": "sample.mp4",
  "classification": "Violent",
  "confidence": 93.41,
  "is_danger": true,
  "alert_sent": true,
  "timestamp": "2026-05-12T14:03:27.481920"
}
```

Supported formats: MP4, AVI, MOV, MKV, WebM. Errors: `415` unsupported type, `413` file too large, `422` unreadable video, `503` model not loaded.

## Current limitations

Worth knowing before you use or build on it:

- **The camera grid on the Live Dashboard is simulated.** The four cameras and their threat levels are generated in the browser to demo the UI. Real inference happens when you upload a clip in the **Forensics Lab** (or call `/predict`).
- **Camera map coordinates are placeholders** and should be replaced with real locations.
- **The training-curve charts on the Model Metrics page use illustrative values**, not logs from the actual training run.
- **Incident history is in memory** and resets when the server restarts.
- **CORS is open (`*`)** for development. Restrict it to your frontend origin before deploying.
- Training code and the dataset are not included in this repository.

## Roadmap

- [ ] Live RTSP / webcam stream inference
- [ ] Persistent incident storage (PostgreSQL) and authentication
- [ ] Docker image and CI pipeline with tests
- [ ] Training notebook and evaluation report (confusion matrix, ROC curve)
- [ ] Replace simulated cameras with real streams

## Tech stack

Python 3.11 · PyTorch · TorchVision · OpenCV · FastAPI · Uvicorn · WebSockets · React 19 · Tailwind CSS · Recharts · Leaflet.js

## Author

**Vinit Sarnaik**: B.Tech Computer Science, Khandesh College of Engineering & Management
GitHub: [@sarvinit25](https://github.com/sarvinit25) · sarvinit25@gmail.com
