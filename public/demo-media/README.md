# Seamless Access demo media

Copy this directory to `<repository-root>/public/demo-media/`, including manifest.json and all subdirectories. Next.js serves these files at `/demo-media/...` after rebuilding and deploying. They are publicly downloadable: synthetic demonstration data only.

- `manifest.json`: 14 fictional passenger/staff scenarios and expected results; also imported by the server simulator. Change only as a source change, test, and redeploy the application and Functions together.
- `layout/access-point.svg`: illustrative access-point layout, not a construction or security plan.
- `passenger/illustration.svg`, `staff/illustration.svg`: drawn fictional silhouettes, not photographs, biometric templates, or enrollment records.
- `camera/illustration.svg`: camera placeholder, explicitly simulated; no camera stream is captured.

No real passenger, employee, boarding pass, secret, embedding, or biometric reference belongs here. Uploading a photograph does not enroll a biometric identity. These assets cannot identify people or establish real lounge entitlement.
