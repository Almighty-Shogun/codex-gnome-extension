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
const FIVE_HOUR_WINDOW_MINUTES = 300;
const WEEKLY_WINDOW_MINUTES = 10080;

function clampPercent(value) {
    return Math.max(0, Math.min(100, Math.round(value ?? 0)));
}

const CodexUsageIndicator = GObject.registerClass(
class CodexUsageIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, "Codex Usage");

        this._extension = extension;
        this._refreshTimeoutId = null;
        this._sessionFileCache = new Map();
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

        this._fiveHourItem = this._createUsageMenuItem("5-hour usage limit");
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

        this._refreshSafely();
        this._refreshTimeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            REFRESH_INTERVAL_SECONDS,
            () => this._refreshSafely()
        );
    }

    destroy() {
        if (this._refreshTimeoutId) {
            GLib.Source.remove(this._refreshTimeoutId);
            this._refreshTimeoutId = null;
        }

        super.destroy();
    }

    _refreshSafely() {
        try {
            this._refresh();
        } catch (error) {
            logError(error, "Codex usage refresh failed");
        }

        return GLib.SOURCE_CONTINUE;
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

            return;
        }

        this._label.text = this._formatPanelLabel(snapshot);

        const statusTimestamp = snapshot.timestamp ?? this._getIsoTimestampFromFileModifiedAt(snapshot.fileModifiedAt);
        this._statusItem.label.text = this._formatStatusLine(statusTimestamp);

        this._setUsageMenuItem(this._fiveHourItem, snapshot.fiveHour, snapshot);
        this._setUsageMenuItem(this._weeklyItem, snapshot.weekly, snapshot);

        this._creditsItem.valueLabel.text = this._formatCredits(snapshot.credits);
        this._updateLimitNotice(snapshot);
        this._lastSnapshotSortKey = snapshot.sortKey;
        this._lastResolvedSnapshot = snapshot;
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

    _setUsageMenuItem(entry, limit, snapshot) {
        if (!limit) {
            this._setUsageMenuItemUnavailable(entry);
            return;
        }

        const remainingPercent = this._getRemainingPercent(limit);
        const usedPercent = this._getUsedPercent(limit);
        const isCurrent = this._isCurrentLimit(limit, snapshot);

        entry.valueLabel.text = `${remainingPercent}% remaining`;
        entry.resetLabel.text = isCurrent
            ? `Resets: ${this._formatReset(limit.resets_at)}`
            : `Last reported: ${this._formatLimitSeenAt(limit)}`;

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
        entry.valueLabel.text = "Not reported";
        entry.resetLabel.text = "Resets: unavailable";

        entry.barFill.set_width(0);
        entry.barFill.remove_style_pseudo_class("warning");
        entry.barFill.remove_style_pseudo_class("critical");
    }

    _resolveSnapshot(snapshot) {
        if (!snapshot)
            return this._lastResolvedSnapshot;

        const previous = this._lastResolvedSnapshot;
        return {
            ...snapshot,
            fiveHour: this._resolveLimit(snapshot.fiveHour, previous?.fiveHour),
            weekly: this._resolveLimit(snapshot.weekly, previous?.weekly),
            credits: snapshot.credits !== undefined ? snapshot.credits : previous?.credits ?? null,
            timestamp: snapshot.timestamp ?? previous?.timestamp ?? null,
            fileModifiedAt: snapshot.fileModifiedAt ?? previous?.fileModifiedAt ?? 0,
            sortKey: snapshot.sortKey ?? previous?.sortKey ?? this._getSnapshotSortKey(snapshot),
        };
    }

    _resolveLimit(currentLimit, previousLimit) {
        const limit = currentLimit ?? previousLimit ?? null;

        return this._isLimitRelevant(limit) ? limit : null;
    }

    _readLatestSnapshot() {
        const sessionRoot = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_home_dir(), ".codex", "sessions"]));

        const sessionFiles = this._listSessionFiles(sessionRoot)
            .map(file => ({
                file,
                path: file.get_path(),
                modifiedAt: this._getFileModifiedAt(file),
            }))
            .sort((a, b) => b.modifiedAt - a.modifiedAt)
            .slice(0, MAX_SESSION_FILES);

        const snapshots = [];
        const activeSessionFilePaths = new Set();

        for (const sessionFile of sessionFiles) {
            activeSessionFilePaths.add(sessionFile.path);

            const cached = this._sessionFileCache.get(sessionFile.path);
            if (cached && cached.modifiedAt === sessionFile.modifiedAt) {
                snapshots.push(...cached.snapshots);
                continue;
            }

            const fileSnapshots = this._extractSnapshotsFromFile(sessionFile.file, sessionFile.modifiedAt);
            this._sessionFileCache.set(sessionFile.path, {
                modifiedAt: sessionFile.modifiedAt,
                snapshots: fileSnapshots,
            });
            snapshots.push(...fileSnapshots);
        }

        for (const cachedPath of this._sessionFileCache.keys()) {
            if (!activeSessionFilePaths.has(cachedPath))
                this._sessionFileCache.delete(cachedPath);
        }

        let latestSnapshot = null;
        let latestFiveHour = null;
        let latestWeekly = null;
        let latestCredits = undefined;
        let latestCreditsSortKey = 0;

        for (const snapshot of snapshots) {
            if (!latestSnapshot || snapshot.sortKey > latestSnapshot.sortKey)
                latestSnapshot = snapshot;

            if (snapshot.credits !== undefined && snapshot.sortKey > latestCreditsSortKey) {
                latestCredits = snapshot.credits;
                latestCreditsSortKey = snapshot.sortKey;
            }

            if (snapshot.fiveHour && this._isLimitRelevant(snapshot.fiveHour) && (!latestFiveHour || snapshot.fiveHour.sortKey > latestFiveHour.sortKey))
                latestFiveHour = snapshot.fiveHour;

            if (snapshot.weekly && this._isLimitRelevant(snapshot.weekly) && (!latestWeekly || snapshot.weekly.sortKey > latestWeekly.sortKey))
                latestWeekly = snapshot.weekly;
        }

        if (!latestSnapshot)
        {
            this._lastSnapshotSortKey = null;
            return null;
        }

        return {
            timestamp: latestSnapshot.timestamp,
            fileModifiedAt: latestSnapshot.fileModifiedAt,
            sortKey: latestSnapshot.sortKey,
            fiveHour: latestFiveHour,
            weekly: latestWeekly,
            credits: latestCredits,
            planType: latestSnapshot.planType,
        };
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

    _extractSnapshotsFromFile(file, fileModifiedAt) {
        let contents;

        try {
            [, contents] = file.load_contents(null);
        } catch (error) {
            log(`${UUID}: Failed to read ${file.get_path()}: ${error.message}`);

            return [];
        }

        const snapshots = [];
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

            const timestamp = parsed.timestamp ?? null;
            const sortKey = this._getTimestampSortKey(timestamp) || fileModifiedAt;
            const snapshot = {
                timestamp,
                fileModifiedAt,
                sortKey,
                fiveHour: null,
                weekly: null,
                credits: rateLimits.credits,
                planType: rateLimits.plan_type ?? null,
            };
            const limits = this._getLimitsByWindow(rateLimits, {
                timestamp,
                fileModifiedAt,
                sortKey,
            });

            snapshot.fiveHour = limits.fiveHour;
            snapshot.weekly = limits.weekly;
            snapshots.push(snapshot);
        }

        return snapshots;
    }

    _getLimitsByWindow(rateLimits, metadata) {
        const limits = {
            fiveHour: null,
            weekly: null,
        };

        for (const key of ["primary", "secondary"]) {
            const limit = this._withLimitMetadata(rateLimits?.[key], metadata);

            if (!limit) continue;

            if (limit.window_minutes === FIVE_HOUR_WINDOW_MINUTES)
                limits.fiveHour = limit;

            if (limit.window_minutes === WEEKLY_WINDOW_MINUTES)
                limits.weekly = limit;
        }

        return limits;
    }

    _withLimitMetadata(limit, metadata) {
        if (!limit || typeof limit !== "object")
            return null;

        const windowMinutes = Number(limit.window_minutes);

        if (!Number.isFinite(windowMinutes))
            return null;

        return {
            ...limit,
            window_minutes: windowMinutes,
            timestamp: metadata.timestamp,
            fileModifiedAt: metadata.fileModifiedAt,
            sortKey: metadata.sortKey,
        };
    }

    _formatPanelLabel(snapshot) {
        const fiveHour = snapshot?.fiveHour ?? null;
        const weekly = snapshot?.weekly ?? null;
        const fiveHourCurrent = this._isCurrentLimit(fiveHour, snapshot);
        const weeklyCurrent = this._isCurrentLimit(weekly, snapshot);

        if (fiveHourCurrent && weeklyCurrent)
            return `${this._formatRemainingUsage(fiveHour)} - ${this._formatRemainingUsage(weekly)}`;

        if (fiveHourCurrent)
            return `5h ${this._formatRemainingUsage(fiveHour)}`;

        if (weeklyCurrent)
            return `Weekly ${this._formatRemainingUsage(weekly)}`;

        if (fiveHour || weekly)
            return `${this._formatRemainingUsage(fiveHour)} - ${this._formatRemainingUsage(weekly)}*`;

        return "Usage unavailable";
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

        if (this._isLimitReached(snapshot?.fiveHour)) {
            notices.push(this._isCurrentLimit(snapshot.fiveHour, snapshot)
                ? "You have reached your 5-hour usage."
                : "Last reported 5-hour usage was exhausted.");
        }

        if (this._isLimitReached(snapshot?.weekly)) {
            notices.push(this._isCurrentLimit(snapshot.weekly, snapshot)
                ? "You have reached your weekly usage."
                : "Last reported weekly usage was exhausted.");
        }

        this._limitNoticeItem.label.text = notices.join(" ");
        this._limitNoticeItem.item.visible = notices.length > 0;
        this._limitNoticeSeparator.visible = notices.length > 0;
    }

    _formatStatusLine(value) {
        return `Latest Codex update: ${this._formatAbsoluteTime(value)}`;
    }

    _formatLimitSeenAt(limit) {
        return this._formatAbsoluteTime(limit.timestamp ?? this._getIsoTimestampFromFileModifiedAt(limit.fileModifiedAt));
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

    _isCurrentLimit(limit, snapshot) {
        return !!limit && !!snapshot && limit.sortKey === snapshot.sortKey;
    }

    _isLimitRelevant(limit) {
        if (!limit)
            return false;

        const nowSeconds = Math.floor(Date.now() / 1000);
        const resetSeconds = Number(limit.resets_at);

        if (Number.isFinite(resetSeconds) && resetSeconds <= nowSeconds)
            return false;

        const windowSeconds = Number(limit.window_minutes) * 60;
        const seenSortKey = limit.sortKey || this._getSnapshotSortKey(limit);
        const seenSeconds = Math.floor(seenSortKey / 1000000);

        if (Number.isFinite(windowSeconds) && windowSeconds > 0 && seenSeconds > 0 && nowSeconds - seenSeconds > windowSeconds)
            return false;

        return true;
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
