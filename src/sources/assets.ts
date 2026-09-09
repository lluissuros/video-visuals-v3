// Client side of the assets folder (see vite.config.ts): the dev server owns
// assets/input (sources, served under /media) and assets/output (recordings).

/** Writes a recording into assets/output. False when no server took it. */
export async function saveRecording(blob: Blob, name: string): Promise<boolean> {
  try {
    const res = await fetch(`/__assets/recording?name=${encodeURIComponent(name)}`, {
      method: 'POST', body: blob,
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Opens the assets folder in Finder. */
export function openAssetsFolder() {
  fetch('/__assets/open', { method: 'POST' }).catch(() => { /* no server */ });
}
