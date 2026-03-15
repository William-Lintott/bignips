import { readFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

const SOUND_MESSAGE = "discord-notification.wav";
const SOUND_JOIN = "discord-call-join.wav";
const SOUND_LEAVE = "discord-call-leave.wav";

function loadSound(filename: string): string {
    const soundPath = app.isPackaged
        ? join(process.resourcesPath, "sounds", filename)
        : join(app.getAppPath(), "assets", "desktop", "sounds", filename);
    return `data:audio/wav;base64,${readFileSync(soundPath).toString("base64")}`;
}

export function injectSounds(webContents: Electron.WebContents) {
    const sounds = {
        message: loadSound(SOUND_MESSAGE),
        joinCall: loadSound(SOUND_JOIN),
        leaveCall: loadSound(SOUND_LEAVE),
    };
    webContents.on("did-finish-load", () => {
        webContents.executeJavaScript(`
      (function() {
        if (window.__soundsInjected) return;
        window.__soundsInjected = true;
        const sounds = ${JSON.stringify(sounds)};
        let currentUserId = null;
        let currentChannelId = null;
        let notificationSettings = null;

        function parseNotificationSettings(raw) {
          try { return JSON.parse(raw[1]); } catch { return null; }
        }

        function shouldPlayMessageSound(data) {
          const serverId = data.member?._id?.server;

          // No server = DM, always play
          if (!serverId) return true;

          // No settings loaded yet, default to playing
          if (!notificationSettings) return true;

          // Muted server
          if (serverId in (notificationSettings.server_mutes ?? {})) return false;

          const level = notificationSettings.server?.hasOwnProperty(serverId)
            ? notificationSettings.server[serverId]
            : "all";

          if (level === "none") return false;

          if (level === "mention") {
            return typeof data.content === "string" &&
              data.content.includes(\`<@\${currentUserId}>\`);
          }

          return true;
        }

        function playSound(dataUrl) {
          try {
            const audio = new Audio(dataUrl);
            audio.volume = 0.5;
            audio.play();
          } catch(e) {}
        }

        const OriginalWebSocket = window.WebSocket;
        window.WebSocket = class extends OriginalWebSocket {
          constructor(...args) {
            super(...args);
            this.addEventListener("message", (event) => {
              try {
                const data = JSON.parse(event.data);
                console.log(data);

                // Grab own user ID from the ready payload
                if (data.type === "Ready" && data.users) {
                  const self = data.users.find(u => u.relationship === "User");
                  if (self) currentUserId = self._id;
                }

                // Track notification settings updates
                if (data.type === "UserSettingsUpdate" && data.update?.notifications) {
                  notificationSettings = parseNotificationSettings(data.update.notifications);
                }

                // You joined a voice channel
                if (data.type === "VoiceChannelJoin" && data.state?.id === currentUserId) {
                  currentChannelId = data.id;
                  playSound(sounds.joinCall);
                }

                // You left a voice channel
                if (data.type === "VoiceChannelLeave" && data.user === currentUserId) {
                  currentChannelId = null;
                  playSound(sounds.leaveCall);
                }

                // Someone else joined the current voice channel
                if (data.type === "VoiceChannelJoin" && data.state?.id !== currentUserId && currentChannelId && data.id === currentChannelId) {
                  playSound(sounds.joinCall);
                }

                // Someone else left the current voice channel
                if (data.type === "VoiceChannelLeave" && data.user !== currentUserId && currentChannelId && data.id === currentChannelId) {
                  playSound(sounds.leaveCall);
                }

                // New message — check notification settings before playing
                if (data.type === "Message" && shouldPlayMessageSound(data)) {
                  playSound(sounds.message);
                }
              } catch {}
            });
          }
        };
      })();
    `);
    });
}