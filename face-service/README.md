# GAES local face engine — first stage

This service belongs to the GAES project and runs on infrastructure you manage.
Images are not sent to an external biometric API. OpenCV YuNet detects faces;
SFace compares one capture against one explicitly selected reference. The ONNX
models, their upstream licenses and SHA-256 manifest are included. No model
is downloaded at runtime. The implementation has NO face gallery search, person
identification, attribute classification or 1:N endpoint.

Source references:
- https://docs.opencv.org/4.x/d0/dd4/tutorial_dnn_face.html
- https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet
- https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface

## What first stage implements
- Anonymous face-presence detection (face count only, no identification).
- Exactly-one-face and minimum size/sharpness checks.
- Reference enrollment from one to three consistent photographs.
- Single-reference face comparison, returning score and configured threshold.
- AES-256-GCM encrypted embeddings in a local SQLite database. No raw photos
  are stored by this engine. Enrollment originals remain in restricted Firebase
  Storage through the existing portal workflow.
- Authenticated server-to-server HTTP endpoints and a Node adapter integrated
  into the existing Netlify Function. The browser cannot call the engine directly.
- Model-file integrity validation on engine startup.

**Liveness is not implemented or claimed.** The first-stage engine always returns
`livenessPassed: false` and `livenessStatus: NOT_EVALUATED`. A still image match,
including a genuine same-person comparison, is insufficient to approve an
unattended gate. The UI displays “Face matches the reference” and asks for staff
confirmation. The authorization layer does not issue a gate command for that
result. A subsequent stage needs evaluated presentation-attack/liveness checks
and actual gate hardware integration. Do not switch this boolean to true to
bypass that stage.

The default cosine threshold is 0.5 and is configurable through
GAES_FACE_THRESHOLD. It is a development starting point, not a measured
operational false-accept/false-reject guarantee. Calibrate with consented
representative camera/reference data before operational use.

## Run on your server
For GitHub browser uploads, first extract both delivery ZIPs into the same
directory and upload their contents with paths preserved. See `../GITHUB_UPLOAD.md`.
SFace is stored as `models/sface.onnx.part01` (20 MiB) and
`models/sface.onnx.part02` (about 16.9 MiB), both below 25 MiB. Docker build runs
`python prepare_models.py` automatically. Non-Docker engine startup also assembles
missing models automatically. Each part and the final model must match the
manifest size and SHA-256; missing/corrupt parts stop the build/startup. No model
download or external image transfer is performed. The generated full model is
excluded from Git and Docker build context. To assemble manually on the server:
`python prepare_models.py`.

The corporate workstation does not need Node/Netlify CLI. Deploy this service
on a server/container host you control. The existing Next.js UI stays on its
current deployment. The engine is a separate process because it loads the
computer-vision runtime and local model weights.

1. Generate two separate secrets and keep them out of the repository:
   `python -c "import secrets; print(secrets.token_urlsafe(48))"`
   for GAES_FACE_SERVICE_KEY, and
   `python -c "import secrets,base64; print(base64.b64encode(secrets.token_bytes(32)).decode())"`
   for GAES_FACE_ENCRYPTION_KEY. Store them in your server's secret manager or
   an untracked .env following .env.example. Keep the encryption key available
   for the lifetime of encrypted references and their backups.
2. In this directory run `docker compose up --build -d`, or install
   requirements.txt in a Python 3.12 virtual environment and run server.py.
3. The supplied Compose port binds to 127.0.0.1:8765 only. Expose an authenticated
   TLS reverse proxy controlled by your organization that the existing Netlify
   backend can reach. Never put the service key in the browser or NEXT_PUBLIC_*.
4. In the existing Netlify server environment set:
   GAES_FACE_SERVICE_URL=https://<your-engine-host>/
   GAES_FACE_SERVICE_KEY=<same service key>
   The adapter allows plaintext HTTP only for loopback development. It refuses
   HTTP to other hosts and refuses redirects. Redeploy the existing PR preview.
5. In Seamless Access choose “Check connections”. Identity readiness is checked
   against the actual engine /health endpoint. Upload photos or use the camera,
   submit them and approve enrollment to produce a real encrypted reference.
6. Prepare a single-identity session in operator/check-in controls, then open the
   display. No identity entry or passenger/staff selector appears on that display.
   The operator can prepare subsequent sessions from another authenticated portal
   tab. One queued session exists per operator + lounge; do not overwrite a lane's
   session while another person is being verified. Hardware/card/check-in event
   integration should call the same scoped claim action.

For non-Docker execution set GAES_FACE_DATA_DIR, GAES_FACE_SERVICE_KEY and
GAES_FACE_ENCRYPTION_KEY before startup. GAES_FACE_BIND defaults to 127.0.0.1;
GAES_FACE_PORT defaults to 8765. Persist and restrict access to the data directory.
Keep encryption material and database backups together in your managed recovery
process. Reference retirement/expiry cleanup must be configured by the operator;
revoked portal access cannot use its reference, but local references are not
physically deleted automatically in this first stage.

## Local protocol (owned by this project)
POST requests require Authorization: Bearer <service key>. Request/response bodies
are JSON. No request body or identity reference is logged by the service.

- /health `{}` → ready, ONE_TO_ONE mode, livenessReady=false.
- /detect `{capture:<image data URL>}` → faceCount only.
- /enroll `{subjectKey,photos:[<image data URL>]}` → verified, referenceId.
- /verify `{subjectKey,referenceId,sessionId,capture}` → matched, score,
  threshold, same referenceId/sessionId, livenessPassed=false.

The Node adapter obtains private photo bytes from Firebase Storage; object paths
or arbitrary public URLs are not accepted as reference-image sources by the
Python transport. The session ID and reference are rechecked in the portal
backend. A linked portal account being disabled also blocks staff face sessions.

## Verification performed
Eight Python tests exercised the real shipped models, including a real reference
image and its brightness-adjusted copy, no-face/multi-face rejection, subject
binding, input rejection, encrypted storage and ciphertext tampering. The test
image came from OpenCV's public sample dataset and is not bundled as staff data.
This is model inference smoke coverage, not live camera/PAD accuracy validation.

Run with a local consented/test image:
`GAES_FACE_TEST_IMAGE=/path/to/reference.jpg PYTHONPATH=. python -m unittest discover -s tests -v`

A separate HTTP/Node integration test starts the actual local engine, enrolls a
reference and exercises GAES's single-identity verification flow:
`GAES_FACE_TEST_IMAGE=/path/to/reference.jpg node tests/integration.mjs`
The Python interpreter must have requirements installed; PYTHON_BIN optionally
selects it. The test verifies that a real face match without liveness cannot
open a gate. Temporary test state is created outside the repository.
