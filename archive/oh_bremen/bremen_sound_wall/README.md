# Bremen Backyard - Sound Reactive Web App

This is a sound-reactive web application built with **Three.js** and **Vanilla JavaScript**. It visualizes microphone input as floating ink particles in a 3D space.

## Project Structure

```
bremen_sound_wall/
├── index.html      # Main entry point (UI + Canvas)
├── css/
│   └── style.css   # Styling for UI overlay
├── js/
│   ├── main.js     # Main 3D scene & particle logic
│   ├── audio.js    # Audio analysis (FFT)
│   └── brushes.js  # Texture generation
└── assets/         # (Optional) Images
```

## How to Run Locally

1. Open this folder in VS Code.
2. You need a local server to avoid CORS issues with modules/audio.
   - Using Python: `python -m http.server`
   - Using Node: `npx serve .`
   - Using Live Server extension in VS Code.
3. Open `http://localhost:8000` (or the port provided).
4. Click "Start Experience" and allow Microphone access.

## How to Deploy to GitHub Pages

1. **Create a Repository**: Create a new repository on GitHub.
2. **Push Code**:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin <YOUR_REPO_URL>
   git push -u origin main
   ```
3. **Settings**:
   - Go to Repository **Settings** > **Pages**.
   - Under **Build and deployment**, select **Source** as `Deploy from a branch`.
   - Select `main` branch and `/ (root)` folder.
   - Click **Save**.
4. Wait a few minutes, and your site will be live at `https://<username>.github.io/<repo-name>/`.

## Customization

- **Logo**: Replace `assets/bremen_logo.png` or edit the SVG in `index.html`.
- **Colors**: Edit `css/style.css` for background/UI colors.
- **Sensitivity**: Adjust thresholds in `js/main.js` (`spawnParticles` function).
