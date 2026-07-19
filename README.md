<a href="https://shogun.ms" target="_blank" rel="noopener">
	<img src="https://cdn.shogun.ms/assets/branding/app-icon-256.svg" alt="Shogun app-icon" height="62"/>
</a>

---

# Codex Usage GNOME Extension

This GNOME Shell extension adds a Codex usage indicator to the top bar. It reads Codex usage snapshots from `~/.codex/sessions` and shows the remaining usage windows that Codex reports locally.

When both usage windows are current, the panel label is rendered as:

`<codex-icon> <5-hour-remaining> - <weekly-remaining>`

Example:

`<icon> 91% - 95%`

If Codex currently reports only one usage window, the label names that window instead, for example:

`<icon> Weekly 64%`

Selecting the indicator opens a popup with:

- 5-hour usage remaining, when Codex reports or has previously reported it
- Weekly usage remaining, when Codex reports or has previously reported it
- Reset timestamps for current limits
- Last-reported timestamps for limits that are no longer present in the latest Codex update
- Credits remaining, shown as `0` when Codex does not report a credit value
- A notice when the 5-hour or weekly usage window has been exhausted
- A status line showing when the latest Codex update was seen

## Requirements

- GNOME Shell 46
- A working Codex CLI setup that writes session files to `~/.codex/sessions`

## What It Does

The extension gives GNOME Shell a lightweight view of Codex rate-limit data without opening the CLI. It is intended for users already running Codex locally, where session data is being written under `~/.codex/sessions`.

## How It Works

On a normal cycle, every 30 seconds the extension:

1. Scans `~/.codex/sessions` for recent `.jsonl` session files.
2. Checks each recent file by path and microsecond-precision modified time, reusing cached parse results for unchanged files.
3. Reads changed files and extracts `event_msg` records with a `token_count` payload containing `rate_limits`.
4. Classifies each reported limit by `window_minutes`, where `300` is the 5-hour window and `10080` is the weekly window.
5. Keeps the newest known value for each active window independently, so a weekly-only update does not overwrite or masquerade as 5-hour usage.
6. Updates the panel label and popup contents from the newest locally reported data.

The refresh loop catches and logs refresh errors inside the timer callback, then always returns `GLib.SOURCE_CONTINUE` so a parsing or filesystem error does not stop future updates.

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

- The extension reads Codex session data from `~/.codex/sessions`; it does not query a live API directly.
- The extension displays `Usage unavailable` until a valid Codex usage snapshot is found.
- If Codex stops reporting a specific window, the popup keeps the last known value while that usage window is still relevant and marks when it was last reported.
- Credits are always shown and normalized before display. Missing credits and `has_credits: false` are rendered as `0`; fields like `balance`, `remaining`, or `unlimited` are rendered as simple readable values.
- When a limit reaches `100%` used, the popup shows an explicit notice for the exhausted 5-hour or weekly window.
- The menu width is intentionally compact and the progress bars are sized to match.
