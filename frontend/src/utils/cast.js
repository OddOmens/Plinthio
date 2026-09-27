// Google Cast sender SDK. It's third-party script running with full access to the page (and
// so to the session in localStorage), so it's only fetched when it can actually be used:
// a Chromium browser on a secure origin, and only once a video is opened — not on every
// page load in every browser as before.
let loadPromise = null;

export function isCastCapableBrowser() {
  if (!window.isSecureContext || !window.chrome) return false;
  if (/iPhone|iPad|iPod/.test(navigator.userAgent)) return false;
  const brands = navigator.userAgentData?.brands;
  if (brands) return brands.some((b) => b.brand === 'Chromium' || b.brand === 'Google Chrome');
  return /Chrome\//.test(navigator.userAgent);
}

export function loadCastSdk() {
  if (!isCastCapableBrowser()) return Promise.resolve(false);
  if (window.cast?.framework) return Promise.resolve(true);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve) => {
    window.__onGCastApiAvailable = (isAvailable) => {
      if (!isAvailable || !window.cast?.framework) return resolve(false);
      window.cast.framework.CastContext.getInstance().setOptions({
        receiverApplicationId: window.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
        autoJoinPolicy: window.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
      });
      window.dispatchEvent(new Event('plinthio-cast-ready'));
      resolve(true);
    };
    const script = document.createElement('script');
    script.src = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
    script.async = true;
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
  return loadPromise;
}
