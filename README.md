# Vendor Project Backend

## Run locally

1. Open `C:\Users\LAKSHITA\Desktop\vendor-project\backend`
2. Keep `.env` in local test mode:

```env
LOCAL_TEST_MODE=true
ENABLE_DRIVE_UPLOAD=false
ENABLE_SUBMISSION_EMAIL=false
ENABLE_REVIEW_EMAIL=false
```

3. Start the server:

```powershell
node server.js
```

4. Open [http://localhost:5000/](http://localhost:5000/)

This mode supports the full form flow and document processing locally, but skips Google Drive and email delivery.

## Run the full live journey

1. Copy `backend/.env.live.example`
2. Replace the placeholder values with real credentials
3. Update `backend/.env` with those values
4. Start the server again with `node server.js`
5. Open `http://localhost:5000/`
6. Check the startup logs. If a service is enabled but not fully configured, the server prints a warning before you start testing submissions.
