import { useEffect, useRef } from "react";

const BG_VIDEO =
  "https://id-preview--a0033055-dead-4c27-b52b-8118cb332010.lovable.app/videos/how-it-works-bg.mp4";

/**
 * Full-viewport looping background video.
 * Hardened for iOS Safari + Android Chrome autoplay policies:
 * - muted + defaultMuted (set imperatively; iOS ignores late React prop application)
 * - playsInline + webkit-playsinline (iOS < 10 / WebViews)
 * - retries play() on mount, on canplay, on visibility change and on first user gesture
 */
const BackgroundVideo = ({ src = BG_VIDEO }: { src?: string }) => {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;

    // iOS only honors the muted *property*, not just the attribute.
    video.muted = true;
    video.defaultMuted = true;
    video.volume = 0;

    let cancelled = false;
    const tryPlay = () => {
      if (cancelled || !video) return;
      const p = video.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    };

    tryPlay();
    video.addEventListener("canplay", tryPlay);
    video.addEventListener("loadeddata", tryPlay);
    // Some browsers pause background video when the tab/app is backgrounded.
    const onVisible = () => {
      if (document.visibilityState === "visible") tryPlay();
    };
    document.addEventListener("visibilitychange", onVisible);
    // Last resort: first user gesture unlocks playback on strict Low Power Mode iOS.
    const gestures: (keyof DocumentEventMap)[] = ["touchstart", "click", "keydown"];
    const onGesture = () => tryPlay();
    gestures.forEach((g) => document.addEventListener(g, onGesture, { once: true, passive: true }));

    return () => {
      cancelled = true;
      video.removeEventListener("canplay", tryPlay);
      video.removeEventListener("loadeddata", tryPlay);
      document.removeEventListener("visibilitychange", onVisible);
      gestures.forEach((g) => document.removeEventListener(g, onGesture));
    };
  }, [src]);

  return (
    <>
      <video
        ref={ref}
        className="absolute inset-0 h-full w-full object-cover"
        src={src}
        autoPlay
        muted
        loop
        playsInline
        // @ts-expect-error legacy iOS/WebView attribute
        webkit-playsinline="true"
        x5-playsinline="true"
        disablePictureInPicture
        disableRemotePlayback
        controls={false}
        tabIndex={-1}
        preload="auto"
        aria-hidden="true"
      />
      <div
        className="absolute inset-0 bg-gradient-to-br from-[hsl(204,100%,20%)]/80 via-[hsl(204,100%,16%)]/80 to-[hsl(216,58%,8%)]/90"
        aria-hidden="true"
      />
    </>
  );
};

export default BackgroundVideo;
