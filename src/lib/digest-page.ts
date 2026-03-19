import { initDigestPage } from "./digest-client";

function boot(attempt = 0): void {
  const ready =
    document.getElementById("digest-title") &&
    document.getElementById("digest-sections");

  if (ready) {
    initDigestPage();
    return;
  }

  if (attempt >= 20) {
    console.warn("Digest page bootstrap timed out waiting for DOM elements.");
    return;
  }

  window.setTimeout(() => {
    boot(attempt + 1);
  }, 100);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
