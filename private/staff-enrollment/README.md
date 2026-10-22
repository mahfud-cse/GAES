# Private staff enrollment assets
Optional source for photos already maintained in a PRIVATE repository.
Use folders beneath this directory; enter a relative folder and filename in the registration UI.
Allowed files: JPEG, PNG and WebP, max 1 MB. Files are imported server-side into restricted Firebase Storage.
Do not put photos or passports in public/, demo-media/, a public repository, or a public image URL.
This directory is bundled only with the seamless-operations Function. Do not add real personal data to sample assets.
Prefer direct Firebase Storage upload for personal photos.

Filenames can contain spaces, Unicode letters, parentheses, underscores and hyphens; supported extensions are case-insensitive. Enter the exact filename and case. Example: source `private/staff-enrollment/CGK/Staff photo 3x4.png` uses Folder `CGK` and Filename `Staff photo 3x4.png`. Do not enter a GitHub URL or the full root path in Folder.

The function reads the deployed snapshot. Adding a photo on another branch does not make it available to an older production deployment. Wait for the matching branch deployment to finish. Missing files now produce a specific message; invalid path syntax, size and image format errors are distinct.
