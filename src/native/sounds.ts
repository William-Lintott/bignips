import { readFileSync } from "node:fs";
import { join } from "node:path";

import { app } from "electron";

// --- Sound file configuration -------------------------------------------------
// Set each variable to the filename of an wav in assets/desktop/sounds/
const SOUND_MESSAGE = "discord-notification.wav";
const SOUND_JOIN = "discord-call-join.wav";
const SOUND_LEAVE = "discord-call-leave.wav";
// ------------------------------------------------------------------------------

function loadSound(filename: string): string {
    const soundPath = app.isPackaged
        ? join(process.resourcesPath, "sounds", filename)
        : join(app.getAppPath(), "assets", "desktop", "sounds", filename);
    return `data:audio/wav;base64,${readFileSync(soundPath).toString("base64")}`;
}

/**
 * Inject sound playback into the renderer page via WebSocket interception.
 * Only plays sounds relevant to the current user.
 */
export function injectSounds(webContents: Electron.WebContents) {
    // load all sounds once at startup
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

                // grab your own user ID from the ready payload
                if (data.type === "Ready" && data.users) {
                  const self = data.users.find(u => u.relationship === "User");
                  if (self) currentUserId = self._id;
                }

                // you joined a voice channel
                if (data.type === "VoiceChannelJoin" && data.state?.id === currentUserId) {
                  currentChannelId = data.id;
                  playSound(sounds.joinCall);
                }

                // you left a voice channel
                if (data.type === "VoiceChannelLeave" && data.user === currentUserId) {
                  currentChannelId = null;
                  playSound(sounds.leaveCall);
                }

                // someone else joined the current voice channel
                if (data.type === "VoiceChannelJoin" && data.state?.id !== currentUserId && currentChannelId && data.id === currentChannelId) {
                  playSound(sounds.joinCall);
                }

                // someone else left the current voice channel
                if (data.type === "VoiceChannelLeave" && data.user !== currentUserId && currentChannelId && data.id === currentChannelId) {
                  playSound(sounds.leaveCall);
                }

                // new message
                if (data.type === "Message") {
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
