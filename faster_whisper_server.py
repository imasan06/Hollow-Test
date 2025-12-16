#!/usr/bin/env python3
"""
Faster-Whisper Local Server
Ejecuta este script en tu computadora para tener un servidor de transcripción local.
"""

from fastapi import FastAPI, File, UploadFile
from faster_whisper import WhisperModel
import uvicorn
import io
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# Permitir CORS para que la app móvil pueda conectarse
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # En producción, especifica los orígenes permitidos
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Cargar modelo una vez al iniciar
# Opciones: tiny, base, small, medium, large-v3
# "base" es un buen balance velocidad/precisión
MODEL_SIZE = "base"  # Cambia esto si quieres otro modelo
print(f"🔄 Cargando modelo Whisper '{MODEL_SIZE}'...")
print("   (La primera vez puede tardar mientras descarga el modelo)")
model = WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8")
print("✅ Modelo cargado!")

@app.get("/health")
async def health():
    """Endpoint de salud para verificar que el servidor está funcionando"""
    return {"status": "ok", "model": MODEL_SIZE}

@app.post("/v1/audio/transcriptions")
async def transcribe_audio(file: UploadFile = File(...)):
    """
    Transcribe audio usando faster-whisper.
    
    Compatible con el formato OpenAI:
    - POST /v1/audio/transcriptions
    - Content-Type: multipart/form-data
    - Body: file (audio), model (opcional), language (opcional)
    """
    try:
        # Leer audio
        audio_bytes = await file.read()
        print(f"📥 Audio recibido: {len(audio_bytes)} bytes")
        
        # Transcribir
        print("🔄 Transcribiendo...")
        segments, info = model.transcribe(
            io.BytesIO(audio_bytes),
            beam_size=5,
            language="es"  # Español (puedes cambiar a "en" para inglés o None para auto-detectar)
        )
        
        # Concatenar segmentos
        text = " ".join([segment.text for segment in segments])
        print(f"✅ Transcripción: {text[:50]}...")
        
        return {"text": text}
    except Exception as e:
        print(f"❌ Error: {e}")
        return {"error": str(e)}, 500

if __name__ == "__main__":
    print("=" * 60)
    print("🚀 Servidor Faster-Whisper Local")
    print("=" * 60)
    print(f"📝 Modelo: {MODEL_SIZE}")
    print("🌐 URL: http://localhost:8000")
    print("📡 Endpoint: POST /v1/audio/transcriptions")
    print("❤️  Health check: GET /health")
    print("=" * 60)
    print("\n💡 Para usar desde tu app móvil:")
    print("   1. Encuentra tu IP local (ipconfig en Windows, ifconfig en Mac/Linux)")
    print("   2. Configura en .env: VITE_FASTER_WHISPER_ENDPOINT=http://TU_IP:8000")
    print("   3. Asegúrate de que tu móvil y PC estén en la misma red WiFi")
    print("\n⏹️  Presiona Ctrl+C para detener el servidor\n")
    
    uvicorn.run(app, host="0.0.0.0", port=8000)

