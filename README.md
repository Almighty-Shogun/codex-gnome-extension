<a href="https://shogun.ms" target="_blank" rel="noopener">
	<img src="https://cdn.shogun.ms/assets/branding/app-icon-256.svg" alt="Shogun app-icon" height="62"/>
</a>

---

# Codex Usage GNOME Extension

This GNOME Shell extension adds a Codex usage indicator to the top bar. It reads the latest usage snapshot from `~/.codex/sessions` and shows the remaining 5-hour and weekly quota at a glance.

The panel label is rendered as:

`<codex-icon> <5-hour-remaining> - <weekly-remaining>`

Example:

`<icon> 91% - 95%`

Selecting the indicator opens a popup with:

- 5-hour usage remaining
- Weekly usage remaining
- Reset timestamps for both limits
- Remaining credits, when present in the Codex session data
- A status line showing when the latest Codex update was seen

## Requirements

- GNOME Shell 46
- A working Codex CLI setup that writes session files to `~/.codex/sessions`

## What It Does

The extension gives GNOME Shell a lightweight view of Codex rate-limit data without opening the CLI. It is intended for users already running Codex locally, where session data is being written under `~/.codex/sessions`.

## How It Works

Every 30 seconds the extension:

1. Scans `~/.codex/sessions` for recent `.jsonl` session files.
2. Checks whether the newest session file has changed since the last poll, using microsecond-precision file timestamps.
3. If it changed, reads recent session files and finds the newest `event_msg` with a `token_count` payload containing `rate_limits`, ordered by the event timestamp from the payload.
4. Updates the panel label and popup contents from that snapshot.

## Installation & Updating

```bash
git clone https://github.com/Almighty-Shogun/codex-gnome-extension.git
cd codex-gnome-extension
./install
```

Then reload GNOME Shell:

- On X11: press `Alt+F2`, type `r`, and press `Enter`
- On Wayland: log out and log back in

Enable the extension:

```bash
gnome-extensions enable codex-usage@almighty-shogun
```

## Notes
- The extension reads Codex session data from `~/.codex/sessions`, it does not query a live API directly.
- The extension displays `Usage unavailable` until a valid Codex usage snapshot is found.
- Credits are shown exactly as reported by Codex. If credits are absent, the value falls back to `0`.
- The menu width is intentionally compact and the progress bars are sized to match.
