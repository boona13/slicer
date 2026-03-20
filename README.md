# Slicer

`Slicer` is a Lens Studio mini-game where the player slices 3D food objects and gets scored on how close each cut is to a perfect 50/50 split.

## Built With

- Lens Studio `5.19.2`
- JavaScript scripts inside `Assets/`

## How It Works

- A random food model is spawned in front of the camera.
- Drag on screen to draw a trim box across the object.
- The mesh is clipped in real time and scored based on the removed percentage.
- The game runs for five rounds and ends with a final grade.

## Open The Project

1. Install Lens Studio `5.19.2` or a compatible newer version.
2. Clone this repository.
3. Open `slicer.esproj` in Lens Studio.
4. Let Lens Studio rebuild generated data such as `Cache/`.

## Important Files

- `slicer.esproj`: Lens Studio project file
- `Assets/Scene.scene`: main scene
- `Assets/GAME_CONTROLLER.js`: round flow, scoring, feedback, and shatter VFX
- `Assets/BOX TRIM/BOX_TRIM_CONTROLLER.js`: box-based mesh trimming logic
- `Assets/touch blocking.js`: touch blocking setup

## Repository Notes

This repository tracks the publishable project sources only. Generated and machine-local Lens Studio folders such as `Cache/`, `Workspaces/`, `PluginsUserPreferences/`, `Support/`, and `.agents/` are intentionally excluded.

Third-party assets are documented in `ASSETS.md`. If you redistribute this project, verify those asset licenses and attribution requirements still match your intended use.
