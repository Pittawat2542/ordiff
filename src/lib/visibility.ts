export function isPageHidden() {
  return document.hidden || document.documentElement.dataset.desktopHidden === 'true';
}

export function installVisibilityHandling() {
  const update = () => {
    const hidden = isPageHidden();
    document.documentElement.dataset.pageHidden = String(hidden);
    if (hidden) document.querySelectorAll<HTMLMediaElement>('audio, video').forEach(media => media.pause());
  };
  document.addEventListener('visibilitychange', update);
  window.addEventListener('ordiff:visibility', update);
  update();
  return () => {
    document.removeEventListener('visibilitychange', update);
    window.removeEventListener('ordiff:visibility', update);
  };
}
