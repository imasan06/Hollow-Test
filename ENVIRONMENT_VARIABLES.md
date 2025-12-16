# Environment Variables Configuration

## Frontend (React/Vite App)

Create a `.env` file in the root directory with the following variables:

### Required Variables

```env
VITE_API_ENDPOINT=https://your-backend-name.fly.dev
VITE_BACKEND_SHARED_TOKEN=your_backend_shared_token_here
```

### Variable Descriptions

1. **VITE_API_ENDPOINT**
   - Description: The URL of your backend API deployed on Fly.io
   - Example: `https://hollow-backend.fly.dev`
   - Required: Yes
   - Note: Must use HTTPS for production

2. **VITE_BACKEND_SHARED_TOKEN**
   - Description: Shared authentication token for backend API requests
   - Example: `1ed9c7f52a48b306`
   - Required: Yes
   - Note: Must match the token configured in your backend

## Backend (Fly.io Deployment)

Set these environment variables in your Fly.io app:

```bash
fly secrets set BACKEND_SHARED_TOKEN=your_backend_shared_token_here
```

### Backend Environment Variables

1. **BACKEND_SHARED_TOKEN**
   - Description: Shared token that must match `VITE_BACKEND_SHARED_TOKEN` in frontend
   - Required: Yes
   - How to set: `fly secrets set BACKEND_SHARED_TOKEN=your_token`

## Setup Instructions

### Frontend Setup

1. Create `.env` file in the root directory
2. Set `VITE_API_ENDPOINT` to your Fly.io backend URL
3. Set `VITE_BACKEND_SHARED_TOKEN` to match your backend token
4. Rebuild the app: `npm run build`
5. Sync with Capacitor: `npx cap sync`

### Backend Setup (Fly.io)

1. Deploy your backend to Fly.io
2. Set the shared token: `fly secrets set BACKEND_SHARED_TOKEN=your_token`
3. Ensure your backend has these endpoints:
   - `POST /transcribe/base64` - For audio transcription
   - `POST /v1/chat` - For AI chat responses
   - `GET /health` - For health checks

## Important Notes

- Security: Never commit `.env` files to version control
- Build Time: Vite environment variables are injected at build time
- Token Matching: `VITE_BACKEND_SHARED_TOKEN` must match `BACKEND_SHARED_TOKEN` in backend
- HTTPS Required: Production endpoints must use HTTPS

