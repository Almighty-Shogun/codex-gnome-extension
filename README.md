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
- A notice when the 5-hour or weekly usage window has been exhausted
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
4. Merges that snapshot with the last known usable values so temporary missing fields do not wipe the display.
5. Updates the panel label and popup contents from the resolved snapshot.

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

To update an existing clone and reinstall the extension:

```bash
cd codex-gnome-extension
./update
```

The update script fetches changes from GitHub, fast-forwards the current branch, and runs the installer.

## Notes
- The extension reads Codex session data from `~/.codex/sessions`, it does not query a live API directly.
- The extension displays `Usage unavailable` until a valid Codex usage snapshot is found.
- Credits are normalized before display. For example, credit objects with fields like `balance`, `has_credits`, or `unlimited` are rendered as a simple readable value.
- The extension keeps the last known usable usage values if a newer poll cannot produce a complete snapshot, which avoids dropping back to `--` after a limit is reached.
- When a limit reaches `100%` used, the popup shows an explicit notice for the exhausted 5-hour or weekly window.
- The menu width is intentionally compact and the progress bars are sized to match.
