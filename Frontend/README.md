🛡️ Sentinel: Intelligent SOC Dashboard

AI-Powered Violence Detection System

📖 Overview

Sentinel is a comprehensive security dashboard designed to enhance surveillance capabilities through Artificial Intelligence. It addresses the critical challenge of monitoring extensive CCTV networks by automating the detection of violent activities.

The system features a React-based Command Center for real-time monitoring and a Python/FastAPI backend that processes video feeds using a custom-trained Spatial-Temporal Neural Network.

🚀 Key Features

🧠 Advanced AI Core: Utilizes a hybrid ConvNeXt + LSTM architecture to analyze both spatial features and temporal motion patterns, achieving 96.5% accuracy on test data.

⚡ Real-Time Analysis: Process video footage instantly via a RESTful API.

🖥️ Interactive Dashboard: A modern, dark-mode interface built with React 19 and Tailwind CSS for monitoring camera feeds and alert logs.

🔬 Forensics Lab: Dedicated interface for security operators to manually upload suspicious footage for detailed AI diagnosis with confidence scoring.

🚨 Dynamic Alerting: Immediate visual feedback (Red/Green indicators) and logging upon threat detection.

🏗️ System Architecture

The project follows a decoupled Client-Server architecture:

Frontend (Client):

Built with React.js, Recharts, and Lucide Icons.

Handles UI rendering, file uploads, and result visualization.

Communicates with the backend via fetch API calls.

Backend (Server):

Built with FastAPI and Uvicorn.

Loads the trained PyTorch model (.pth).

Performs preprocessing (OpenCV) and inference.

Returns classification (Violent/Non-Violent) and confidence scores.

🛠️ Tech Stack

Component

Technology

Frontend

React 19, Tailwind CSS v3, Recharts

Backend

Python 3.11, FastAPI, Uvicorn

AI / ML

PyTorch, Torchvision, OpenCV, NumPy

Model

ConvNeXt-Tiny (Spatial) + LSTM (Temporal)

⚙️ Installation & Setup Guide

Follow these steps to run the project locally.

Prerequisites

Node.js (LTS Version)

Python 3.10+

Git

Step 1: Clone the Repository

git clone <your-repo-url>
cd Major_project


Step 2: Setup the Backend (The Brain)

Navigate to the backend folder:

cd backend


Create and activate a virtual environment:

python -m venv sentinel-env
# Windows:
.\sentinel-env\Scripts\activate
# Mac/Linux:
source sentinel-env/bin/activate


Install Python dependencies:

pip install -r requirements.txt


Start the Python Server:

uvicorn main:app --reload --port 8000


You should see: ✅ Model loaded successfully!

Step 3: Setup the Frontend (The Interface)

Open a new terminal and navigate to the frontend folder:

cd ../sentinel-final


Install Node dependencies:

npm install


Start the React App:

npm start
