# Windows Deploy Guide

## 1) Build portable EXE (recommended for current environment)

```bash
npm install
npm run pack:win
```

Output folder:
- `release-portable/BremenBackyardExhibition-win32-x64`

Run file:
- `release-portable/BremenBackyardExhibition-win32-x64/BremenBackyardExhibition.exe`

Distribute the entire folder, not only the `.exe` file.

## 2) Installer build (Setup.exe)

```bash
npm run dist:win
```

Expected output:
- `release/*.exe` (NSIS installer)

Note:
- In some Windows environments, installer build may fail due to symbolic-link permission while extracting `winCodeSign` cache.
- If that happens, use portable build (`pack:win`) or run installer build on a machine with proper symlink privileges (Developer Mode or elevated admin policy).

## 3) End-user operation

- User only needs to double-click `BremenBackyardExhibition.exe`.
- No Node.js/npm/Chrome setup is required on user PCs when using the portable Electron build.