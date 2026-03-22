# Win11 Desktop OS Dashboard — Build Instructions

**Target directory:** `/root/.openclaw/workspace/dashboard/`
**Entry point:** `index.html` (new file)
**Approach:** Vanilla JS + CSS, no bundler, no new dependencies. Tailwind via CDN for test pages only.

---

## What to Build

Transform the OpenClaw Project Dashboard into a Windows 11-style desktop environment. The existing dashboard pages remain untouched — the new shell wraps them in a desktop OS UI.

### Core Components

1. **Desktop** — Full-viewport canvas with gradient wallpaper, no body scroll
2. **Window Manager** — Create/drag/resize/minimize/maximize/close floating windows that contain iframes pointing to existing pages
3. **Taskbar** — Fixed bottom bar with Start button, pinned app icons, system tray
4. **Start Menu** — Slides up from taskbar, shows all 20 apps in a grid grouped by category
5. **Win11 Theme** — Mica/Acrylic glass effects, rounded corners, proper shadows, light/dark mode
6. **Test Pages** — Tailwind CSS CDN-based test pages that verify each component

---

## App Registry

20 apps total. Each gets a distinct icon. Load via iframes pointing to existing URLs:

### Work (8 apps)
| App ID | Label | Icon Description | URL |
|--------|-------|-----------------|-----|
| tasks | Tasks | Clipboard/checklist | `/?view=list` |
| board | Board | Kanban columns | `/?view=board` |
| timeline | Timeline | Calendar/gantt | `/?view=timeline` |
| agents | Agents | Robot head | `/agents` |
| requests | Requests | Envelope/inbox | `/?view=service-requests` |
| publish | Publish | Paper plane/rocket | `/?view=publish` |
| approvals | Approvals | Shield with checkmark | `/?view=approvals` |
| artifacts | Artifacts | Cube/package | `/?view=artifacts` |

### Operations (8 apps)
| App ID | Label | Icon Description | URL |
|--------|-------|-----------------|-----|
| dependencies | Dependencies | Chain links | `/?view=dependencies` |
| health | Health | Heartbeat pulse | `/?view=health` |
| metrics | Metrics | Bar chart | `/?view=metrics` |
| runbooks | Runbooks | Open book | `/?view=runbooks` |
| memory | Memory | Brain | `/?view=memory` |
| handoffs | Handoffs | Arrow exchange | `/?view=handoffs` |
| audit | Audit | Eye/magnifier | `/?view=audit` |
| cron | Cron | Timer/clock | `/?view=cron` |

### Admin (4 apps)
| App ID | Label | Icon Description | URL |
|--------|-------|-----------------|-----|
| departments | Departments | Building/org | `/?view=departments` |
| skills-tools | Skills & Tools | Wrench/toolbox | `/skills-tools` |
| workflows | Workflows | Lightning bolt | `/workflows` |
| operations | Operations | Gear/cog | `/operations` |

---

## Files to Create

### 1. `src/shell/app-registry.mjs`
Export an array of app objects with: id, label, icon (SVG string or emoji), url, category, defaultWidth, defaultHeight. All 20 apps.

### 2. `src/shell/window-manager.mjs`
Class `WindowManager` that manages window lifecycle:
- `openWindow(appId)` — creates a window div with: title bar (icon + label + minimize/maximize/close buttons), iframe for content
- Windows are absolutely positioned on the desktop
- **Drag:** mousedown on title bar → track mousemove → update position
- **Resize:** 8px resize handles on edges and corners (use CSS `resize` or custom mouse handlers)
- **Minimize:** animate window down + out, hide it, show active indicator on taskbar
- **Maximize:** animate to fill viewport minus taskbar (48px bottom), toggle back on second click
- **Close:** animate out + remove DOM element
- **Focus:** click anywhere on window → bring to front (increment z-index counter)
- **State persistence:** save {id, x, y, width, height, minimized, maximized, zIndex} to localStorage on every change. Restore on boot.
- Each iframe loads the app URL. The iframe should have `sandbox="allow-scripts allow-same-origin allow-forms"` and `loading="lazy"`.
- Window title bar styling: rounded top corners, subtle gradient background, inline icon + label

### 3. `src/shell/taskbar.mjs`
Class `Taskbar`:
- Renders a fixed-bottom bar, 48px tall, full width
- Left section: Start button (use a ⬡ or grid icon, styled like Win11 start button)
- Center section: pinned app icons (rendered from app-registry, show first 8-10 most-used)
- Each icon shows the app icon + tooltip on hover
- Active apps get a small dot indicator below the icon
- Clicking pinned icon: if window open → focus/restore it; if minimized → restore; if not open → open it
- Right section: system tray
  - Clock showing current time (updates every second)
  - Theme toggle button (sun/moon icon)
  - Notification bell icon (for future use)
- **Styling:** `backdrop-filter: blur(20px)` glass effect, semi-transparent background, rounded top corners (8px), subtle top border

### 4. `src/shell/start-menu.mjs`
Class `StartMenu`:
- Panel that slides up from taskbar, ~500px wide, ~600px tall (or viewport-adjusted)
- Search input at top that filters the app list
- "Pinned" section: 6-8 most-used apps as large tiles
- "All Apps" section: grid of all 20 apps grouped by category (Work, Operations, Admin) with section headers
- Each app tile: icon + label, click → openWindow + close menu
- Click outside menu → close it
- Animation: transform translateY + opacity, 200ms ease
- Glass effect background matching taskbar

### 5. `src/shell/shell-main.mjs`
Orchestrator that:
- On DOMContentLoaded: creates the desktop, taskbar, and window manager
- Boots with a welcome state (maybe show a centered welcome widget or open Tasks by default)
- Listens for keyboard shortcuts (Meta → toggle start menu, Meta+D → minimize all, Alt+F4 → close active)
- Coordinates between components (taskbar tells window manager to open/focus, etc.)

### 6. `src/styles/win11-shell.css`
Desktop base styles:
- Body: overflow hidden, full viewport
- Desktop container: absolute positioning context
- Wallpaper: CSS gradient (mesh gradient with blues and purples, like Win11 default)
- Dark mode: darker wallpaper gradient
- CSS variables for shell colors (surface, border, shadow, glass)

### 7. `src/styles/win11-windows.css`
Window chrome styles:
- Window container: absolute positioned, rounded corners (8px), box-shadow for depth, overflow hidden
- Title bar: 32px height, flex layout (icon + title + buttons), subtle gradient
- Title bar buttons (minimize/maximize/close): 46x32px, hover effects, close button turns red on hover (Win11 style)
- Content area: fills remaining height, contains iframe (width/height 100%, border none)
- Active window gets stronger shadow
- Animations: @keyframes for open/close/minimize/maximize

### 8. `src/styles/win11-taskbar.css`
- Fixed bottom: 0, left: 0, right: 0, height: 48px, z-index: 9999
- Glass: background rgba(...) with backdrop-filter
- Pinned icons: 40x40px, rounded, hover scale effect, active dot indicator (3px dot, accent color)
- System tray: right-aligned, flex row

### 9. `src/styles/win11-start.css`
- Positioned above taskbar, centered horizontally
- Rounded corners (8px), glass background
- Search input: full width at top, rounded pill shape
- App tiles: grid of ~80x80px icons with labels below
- Category headers: small uppercase text, muted color

### 10. `src/styles/win11-theme.css`
- CSS custom properties for the Win11 look
- Light mode: --win11-surface: rgba(255,255,255,0.85), --win11-surface-solid: #f3f3f3, --win11-border: rgba(0,0,0,0.08), --win11-accent: #0078d4 (Win11 blue), --win11-text: #1a1a1a, --win11-text-secondary: #606060
- Dark mode: --win11-surface: rgba(44,44,44,0.85), --win11-surface-solid: #2d2d2d, --win11-border: rgba(255,255,255,0.08), --win11-accent: #60cdff, --win11-text: #ffffff, --win11-text-secondary: #9e9e9e
- Glass effect mixin: backdrop-filter: blur(20px) saturate(125%)

### 11. `index.html` (the entry point)
```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>OpenClaw Desktop</title>
    <link rel="stylesheet" href="/src/styles/win11-theme.css">
    <link rel="stylesheet" href="/src/styles/win11-shell.css">
    <link rel="stylesheet" href="/src/styles/win11-windows.css">
    <link rel="stylesheet" href="/src/styles/win11-taskbar.css">
    <link rel="stylesheet" href="/src/styles/win11-start.css">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body>
    <div id="desktop"></div>
    <div id="taskbar-root"></div>
    <script type="module" src="/src/shell/shell-main.mjs"></script>
</body>
</html>
```

### 12. Test Pages (Tailwind CDN)

#### `tests/win11-shell-test.html`
- Loads Tailwind CSS via CDN: `<script src="https://cdn.tailwindcss.com"></script>`
- Tests desktop renders, wallpaper shows, taskbar appears, start menu works
- Grid of test cards with pass/fail indicators
- Auto-runs checks on load, highlights failures in red

#### `tests/win11-window-test.html`  
- Tests window open/close/minimize/maximize
- Tests drag (simulated mouse events)
- Tests resize
- Tests z-index stacking
- Tests multiple simultaneous windows
- Tests localStorage save/restore

#### `tests/win11-taskbar-test.html`
- Tests pinned icons render
- Tests active indicators
- Tests clock updates
- Tests theme toggle

#### `tests/win11-startmenu-test.html`
- Tests open/close
- Tests search filtering
- Tests all 20 apps present
- Tests category grouping
- Tests click-to-open behavior

Each test page should:
1. Import the module under test
2. Run automated assertions
3. Show results in a Tailwind-styled grid (green = pass, red = fail)
4. Be viewable standalone at `/tests/win11-*-test.html`

---

## Important Constraints

- Do NOT modify any existing files (dashboard.html, agents.html, operations.html, etc.)
- Do NOT add npm dependencies
- Do NOT use a bundler
- Use vanilla JS (ES modules) and CSS only
- The iframe approach means existing pages keep working with zero changes
- All new files go in `src/shell/` and `src/styles/` and `tests/`
- The task server already serves static files from the dashboard directory, so new files will be accessible immediately

## When Finished

After creating all files, run this command to notify completion:
```bash
openclaw system event --text "Done: Built Win11 desktop shell with taskbar, window manager, start menu, and Tailwind test pages" --mode now
```
