---
name: iOS audio routing — playsInline root cause
description: Why iOS PWA calls always route to speaker despite speakerMode=false; the fix and how to verify it.
---

## Root cause

`remoteAudio.ts` created the hidden `<audio>` element with `playsInline = true`:

```js
(_el as ...).playsInline = true;
```

On iOS, `playsInline` signals to AVAudioSession that the element is in **media-player / inline-playback** mode. This overrides the PlayAndRecord session opened by `getUserMedia()` and forces audio output to the **speaker**, regardless of what `applyRouting()` sets.

**Diagnostic evidence (from `diagnostic_events` MongoDB collection):**
- `applyRouting` logged `path: ios_earpiece, speakerMode: false` — code believed it routed to earpiece.
- User still heard speakerphone — iOS ignored the intent because of `playsInline = true`.

## Fix

In `getEl()` in `remoteAudio.ts`: only set `playsInline = true` on non-iOS. On iOS, omit it entirely so AVAudioSession keeps PlayAndRecord → earpiece routing.

```js
if (!isIOS()) {
  (_el as ...).playsInline = true;
}
```

**Why:** Without `playsInline`, iOS treats the WebRTC audio stream as phone-call audio and routes to earpiece by default in a PlayAndRecord session. With it, iOS overrides to speaker.

## Verification

After fix, query `diagnostic_events` for `event: applyRouting` and confirm `path: ios_earpiece` AND user confirms earpiece audio. If still speaker, next candidate: switch `<audio>` to `<video playsInline=false>` element.

## Speaker toggle (vivavoce)

The speakertrick (playing a file-src silent audio element) still works for toggling to speaker — its routing effect comes from it being a file-src play, not from `playsInline`.
