import St from 'gi://St'
import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import Clutter from 'gi://Clutter'
import GObject from 'gi://GObject'

import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js'
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js'
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js'

const UUID = "codex-usage@almighty-shogun";

const REFRESH_INTERVAL_SECONDS = 30;
const MAX_SESSION_FILES = 20;
const PROGRESS_BAR_WIDTH = 220;
const MIN_VISIBLE_FILL_WIDTH = 3;

function clampPercent(value) {
    return Math.max(0, Math.min(100, Math.round(value ?? 0)));
}

const CodexUsageIndicator = GObject.registerClass(
class CodexUsageIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, "Codex Usage");

        this._extension = extension;
        this._refreshTimeoutId = null;
        this._latestSessionFilePath = null;
        this._latestSessionFileModifiedAt = 0;
        this._lastSnapshotSortKey = null;
        this._lastResolvedSnapshot = null;

        const box = new St.BoxLayout({
            style_class: "panel-status-menu-box",
            y_align: Clutter.ActorAlign.CENTER,
        });

        const iconBin = new St.Bin({
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.CENTER,
            style_class: "codex-usage-icon-bin",
        });

        this._icon = new St.Icon({
            gicon: new Gio.FileIcon({
                file: Gio.File.new_for_path(`${this._extension.path}/icons/codex-icon.svg`)
            }),
            icon_size: 16,
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.CENTER,
        });
        iconBin.set_child(this._icon);

        this._label = new St.Label({
            text: "Loading Codex usage...",
            y_align: Clutter.ActorAlign.CENTER,
        });

        box.add_child(iconBin);
        box.add_child(this._label);
        this.add_child(box);

        this._fiveHourItem = this._createUsageMenuItem("5 hour usage limit");
        this._weeklyItem = this._createUsageMenuItem("Weekly usage limit");
        this._creditsItem = this._createValueMenuItem("Credits remaining");
        this._statusItem = this._createCenteredMessageItem();

        this.menu.addMenuItem(this._fiveHourItem.item);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this.menu.addMenuItem(this._weeklyItem.item);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this.menu.addMenuItem(this._creditsItem.item);
        this._limitNoticeSeparator = new PopupMenu.PopupSeparatorMenuItem();
        this._limitNoticeSeparator.visible = false;
        this.menu.addMenuItem(this._limitNoticeSeparator);

        this._limitNoticeItem = this._createCenteredMessageItem("codex-usage-limit-notice");
        this._limitNoticeItem.item.visible = false;
        this.menu.addMenuItem(this._limitNoticeItem.item);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this.menu.addMenuItem(this._statusItem.item);
        this.menu.setSourceAlignment(0.5);

        this.menu.box.add_style_class_name("codex-usage-menu");

        this._refresh();
        this._refreshTimeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            REFRESH_INTERVAL_SECONDS,
            () => this._refresh()
        );
    }

    destroy() {
        if (this._refreshTimeoutId) {
            GLib.Source.remove(this._refreshTimeoutId);
            this._refreshTimeoutId = null;
        }

        super.destroy();
    }

    _refresh() {
        const rawSnapshot = this._readLatestSnapshot();
        const snapshot = this._resolveSnapshot(rawSnapshot);

        if (!snapshot) {
            if (this._lastSnapshotSortKey !== null || this._label.text === "Loading Codex usage...") {
                this._label.text = "Usage unavailable";
                this._statusItem.label.text = "Latest Codex update: unavailable";
                this._limitNoticeItem.item.visible = false;
                this._limitNoticeSeparator.visible = false;

                this._setUsageMenuItemUnavailable(this._fiveHourItem);
                this._setUsageMenuItemUnavailable(this._weeklyItem);

                this._creditsItem.valueLabel.text = "0";
                this._lastSnapshotSortKey = null;
            }
            return GLib.SOURCE_CONTINUE;
        }

        if (rawSnapshot?.unchanged) return GLib.SOURCE_CONTINUE;

        this._label.text = `${this._formatRemainingUsage(snapshot.primary)} - ${this._formatRemainingUsage(snapshot.secondary)}`;

        const nowSeconds = Math.floor(Date.now() / 1000);
        const statusTimestamp = snapshot.timestamp ?? this._getIsoTimestampFromFileModifiedAt(snapshot.fileModifiedAt);

        this._statusItem.label.text = this._formatStatusLine(statusTimestamp, nowSeconds);

        this._setUsageMenuItem(this._fiveHourItem, snapshot.primary, nowSeconds);
        this._setUsageMenuItem(this._weeklyItem, snapshot.secondary, nowSeconds);

        this._creditsItem.valueLabel.text = this._formatCredits(snapshot.credits);
        this._updateLimitNotice(snapshot);
        this._lastSnapshotSortKey = snapshot.sortKey;
        this._lastResolvedSnapshot = snapshot;

        return GLib.SOURCE_CONTINUE;
    }

    _createCenteredMessageItem(styleClass = "codex-usage-status-label") {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });

        const label = new St.Label({
            text: "",
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            style_class: styleClass,
        });

        item.add_child(label);

        return {
            item,
            label
        };
    }

    _createUsageMenuItem(title) {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });

        const layout = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style_class: "codex-usage-menu-item",
        });

        const titleLabel = new St.Label({
            text: title,
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
            style_class: "codex-usage-section-title",
        });

        const valueLabel = new St.Label({
            text: "",
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
            style_class: "codex-usage-section-value",
        });

        const barTrack = new St.BoxLayout({
            style_class: "codex-usage-progress-track",
            x_expand: false,
            x_align: Clutter.ActorAlign.START,
        });

        const barFill = new St.Bin({
            style_class: "codex-usage-progress-fill",
        });

        barTrack.add_child(barFill);

        const resetLabel = new St.Label({
            text: "",
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
            style_class: "codex-usage-section-reset",
        });

        layout.add_child(titleLabel);
        layout.add_child(valueLabel);
        layout.add_child(barTrack);
        layout.add_child(resetLabel);
        item.add_child(layout);

        return {
            item,
            valueLabel,
            barFill,
            resetLabel,
        };
    }

    _createValueMenuItem(title) {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });

        const layout = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style_class: "codex-usage-menu-item",
        });

        const titleLabel = new St.Label({
            text: title,
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
            style_class: "codex-usage-section-title",
        });

        const valueLabel = new St.Label({
            text: "0",
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
            style_class: "codex-usage-section-value",
        });

        layout.add_child(titleLabel);
        layout.add_child(valueLabel);
        item.add_child(layout);

        return {
            item,
            valueLabel,
        };
    }

    _setUsageMenuItem(entry, limit, nowSeconds) {
        if (!limit) {
            this._setUsageMenuItemUnavailable(entry);
            return;
        }

        const remainingPercent = this._getRemainingPercent(limit);
        const usedPercent = this._getUsedPercent(limit);

        entry.valueLabel.text = `${remainingPercent}% remaining`;
        entry.resetLabel.text = `Resets: ${this._formatReset(limit.resets_at)}`;

        const fillWidth = usedPercent === 0 ? 0 : Math.max(MIN_VISIBLE_FILL_WIDTH, Math.round((usedPercent / 100) * PROGRESS_BAR_WIDTH));

        entry.barFill.set_width(fillWidth);
        entry.barFill.remove_style_pseudo_class("warning");
        entry.barFill.remove_style_pseudo_class("critical");

        if (remainingPercent <= 10)
        {
            entry.barFill.add_style_pseudo_class("critical");
        }
        else if (remainingPercent <= 25)
        {
            entry.barFill.add_style_pseudo_class("warning");
        }
    }

    _setUsageMenuItemUnavailable(entry) {
        entry.valueLabel.text = "Unavailable";
        entry.resetLabel.text = "Resets: unavailable";

        entry.barFill.set_width(0);
        entry.barFill.remove_style_pseudo_class("warning");
        entry.barFill.remove_style_pseudo_class("critical");
    }

    _resolveSnapshot(snapshot) {
        if (snapshot?.unchanged)
            return this._lastResolvedSnapshot ? { ...this._lastResolvedSnapshot, unchanged: true } : snapshot;

        if (!snapshot)
            return this._lastResolvedSnapshot;

        const previous = this._lastResolvedSnapshot;
        return {
            ...snapshot,
            primary: snapshot.primary ?? previous?.primary ?? null,
            secondary: snapshot.secondary ?? previous?.secondary ?? null,
            credits: snapshot.credits !== undefined ? snapshot.credits : previous?.credits ?? null,
            timestamp: snapshot.timestamp ?? previous?.timestamp ?? null,
            fileModifiedAt: snapshot.fileModifiedAt ?? previous?.fileModifiedAt ?? 0,
            sortKey: snapshot.sortKey ?? this._getSnapshotSortKey(snapshot),
        };
    }

    _readLatestSnapshot() {
        const sessionRoot = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_home_dir(), ".codex", "sessions"]));

        const sessionFiles = this._listSessionFiles(sessionRoot)
            .sort((a, b) => this._getFileModifiedAt(b) - this._getFileModifiedAt(a))
            .slice(0, MAX_SESSION_FILES);

        const latestSessionFile = sessionFiles[0] ?? null;
        const latestSessionFilePath = latestSessionFile?.get_path() ?? null;
        const latestSessionFileModifiedAt = latestSessionFile ? this._getFileModifiedAt(latestSessionFile) : 0;

        if (latestSessionFilePath && latestSessionFilePath === this._latestSessionFilePath && latestSessionFileModifiedAt === this._latestSessionFileModifiedAt) {
            return {
                unchanged: true
            };
        }

        this._latestSessionFilePath = latestSessionFilePath;
        this._latestSessionFileModifiedAt = latestSessionFileModifiedAt;

        const snapshots = [];

        for (const file of sessionFiles) {
            const snapshot = this._extractSnapshotFromFile(file);

            if (snapshot)
            {
                snapshots.push(snapshot);
            }
        }

        snapshots.sort((a, b) => this._getSnapshotSortKey(b) - this._getSnapshotSortKey(a));

        const latestSnapshot = snapshots[0] ?? null;

        if (!latestSnapshot)
        {
            this._lastSnapshotSortKey = null;
        }

        return latestSnapshot ? { ...latestSnapshot, sortKey: this._getSnapshotSortKey(latestSnapshot) } : null;
    }

    _listSessionFiles(root) {
        const files = [];
        const stack = [root];

        while (stack.length > 0) {
            const current = stack.pop();
            let enumerator;

            try {
                enumerator = current.enumerate_children("standard::name,standard::type", Gio.FileQueryInfoFlags.NONE, null);
            } catch (error) {
                log(`${UUID}: Failed to enumerate ${current.get_path()}: ${error.message}`);

                continue;
            }

            let info;
            while ((info = enumerator.next_file(null)) !== null) {
                const child = current.get_child(info.get_name());
                switch (info.get_file_type()) {
                    case Gio.FileType.DIRECTORY:
                        stack.push(child);
                    break;

                    case Gio.FileType.REGULAR:
                        if (info.get_name().endsWith(".jsonl"))
                            files.push(child);
                    break;

                    default:
                        break;
                }
            }

            enumerator.close(null);
        }

        return files;
    }

    _extractSnapshotFromFile(file) {
        let contents;

        try {
            [, contents] = file.load_contents(null);
        } catch (error) {
            log(`${UUID}: Failed to read ${file.get_path()}: ${error.message}`);

            return null;
        }

        const lines = new TextDecoder().decode(contents).trim().split("\n");
        for (let index = lines.length - 1; index >= 0; index -= 1) {
            const line = lines[index].trim();

            if (!line) continue;

            let parsed;

            try {
                parsed = JSON.parse(line);
            } catch {
                continue;
            }

            const payload = parsed?.payload;
            const rateLimits = payload?.rate_limits;

            if (parsed?.type !== "event_msg" || payload?.type !== "token_count" || !rateLimits) continue;

            return {
                timestamp: parsed.timestamp ?? null,
                fileModifiedAt: this._getFileModifiedAt(file),
                primary: rateLimits.primary ?? null,
                secondary: rateLimits.secondary ?? null,
                credits: rateLimits.credits,
                planType: rateLimits.plan_type ?? null,
            };
        }

        return null;
    }

    _formatRemainingUsage(limit) {
        return !limit ? "--" : `${this._getRemainingPercent(limit)}%`;
    }

    _formatReset(resetSeconds) {
        return !resetSeconds ? "unknown" : this._formatAbsoluteTimeFromEpoch(resetSeconds);
    }

    _formatCredits(credits) {
        if (credits === null || credits === undefined)
            return "0";

        if (typeof credits === "number")
            return `${credits}`;

        if (typeof credits === "object") {
            if (credits.unlimited)
                return "Unlimited";

            if ("remaining" in credits)
                return `${credits.remaining}`;

            if ("balance" in credits)
                return `${credits.balance}`;

            if ("has_credits" in credits && !credits.has_credits)
                return "0";

            return JSON.stringify(credits);
        }

        return String(credits);
    }

    _updateLimitNotice(snapshot) {
        const notices = [];

        if (this._isLimitReached(snapshot?.primary))
            notices.push("You have reached your 5-hour usage.");

        if (this._isLimitReached(snapshot?.secondary))
            notices.push("You have reached your weekly usage.");

        this._limitNoticeItem.label.text = notices.join(" ");
        this._limitNoticeItem.item.visible = notices.length > 0;
        this._limitNoticeSeparator.visible = notices.length > 0;
    }

    _formatStatusLine(value) {
        return `Latest Codex update: ${this._formatAbsoluteTime(value)}`;
    }

    _formatAbsoluteTime(isoTimestamp) {
        if (!isoTimestamp) return "unknown";

        const date = typeof isoTimestamp === "number" ? GLib.DateTime.new_from_unix_local(isoTimestamp) : this._getLocalDateTimeFromIso(isoTimestamp);

        return date ? date.format("%-I:%M %p") : String(isoTimestamp);
    }

    _formatAbsoluteTimeFromEpoch(epochSeconds) {
        const date = GLib.DateTime.new_from_unix_local(epochSeconds);

        return date.format("%B %-d, %Y %-I:%M %p");
    }

    _getRemainingPercent(limit) {
        return clampPercent(100 - (limit?.used_percent ?? 0));
    }

    _getUsedPercent(limit) {
        return clampPercent(limit?.used_percent ?? 0);
    }

    _isLimitReached(limit) {
        return !!limit && this._getUsedPercent(limit) >= 100;
    }

    _getLocalDateTimeFromIso(isoTimestamp) {
        const date = GLib.DateTime.new_from_iso8601(isoTimestamp, null);

        return date ? date.to_local() : null;
    }

    _getTimestampSortKey(isoTimestamp) {
        const date = this._getLocalDateTimeFromIso(isoTimestamp);

        return date ? (date.to_unix() * 1000000) + date.get_microsecond() : 0;
    }

    _getIsoTimestampFromFileModifiedAt(fileModifiedAt) {
        if (!fileModifiedAt) return null;

        const seconds = Math.floor(fileModifiedAt / 1000000);
        const microseconds = fileModifiedAt % 1000000;
        const date = GLib.DateTime.new_from_unix_utc(seconds);

        if (!date) return null;

        return date.add(microseconds).format_iso8601();
    }

    _getFileModifiedAt(file) {
        try {
            const info = file.query_info("time::modified,time::modified-usec", Gio.FileQueryInfoFlags.NONE, null);
            const seconds = info.get_attribute_uint64("time::modified");
            const microseconds = info.get_attribute_uint32("time::modified-usec");

            return (seconds * 1000000) + microseconds;
        } catch {
            return 0;
        }
    }

    _getSnapshotSortKey(snapshot) {
        return this._getTimestampSortKey(snapshot?.timestamp) || snapshot?.fileModifiedAt || 0;
    }
});

export default class CodexUsageExtension extends Extension {
    enable() {
        this._indicator = new CodexUsageIndicator(this);

        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
