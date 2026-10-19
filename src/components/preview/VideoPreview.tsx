"use client";
import React, { useEffect, useRef, useState, useCallback } from "react";
import { useEditorStore } from "@/store/editor-store";
import { formatTimecode, formatTime } from "@/lib/time";
import { loadMediaFile } from "@/lib/idb";
import { VideoClip, ImageClip, TextClip, Clip, Caption, MediaAsset, Track } from "@/types/project";

const EMPTY_CLIPS: Clip[] = [];
const EMPTY_CAPTIONS: Caption[] = [];
const EMPTY_ASSETS: MediaAsset[] = [];
const EMPTY_TRACKS: Track[] = [];
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  RotateCcw,
} from "lucide-react";

export function VideoPreview() {
  const project = useEditorStore((s) => s.project);
  const playheadPosition = useEditorStore((s) => s.playheadPosition);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const setPlayheadPosition = useEditorStore((s) => s.setPlayheadPosition);
  const setIsPlaying = useEditorStore((s) => s.setIsPlaying);

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);

  // Map of assetId -> object URL
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const animationFrameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);

  const settings = project?.settings;
  const clips = project?.clips ?? EMPTY_CLIPS;
  const captions = project?.captions ?? EMPTY_CAPTIONS;
  const assets = project?.assets ?? EMPTY_ASSETS;
  const tracks = project?.tracks ?? EMPTY_TRACKS;
  const projectDuration = settings?.duration || 1;

  // Active visual clips sorted by track order
  const trackOrderMap = React.useMemo(() => {
    const map = new Map<string, number>();
    tracks.forEach((t) => map.set(t.id, t.order));
    return map;
  }, [tracks]);

  const activeVisualClips = React.useMemo(() => {
    return clips
      .filter((c) => {
        const isVisual = c.kind === "video" || c.kind === "image";
        const inRange =
          playheadPosition >= c.timelineStart &&
          playheadPosition < c.timelineStart + c.timelineDuration;
        return isVisual && inRange;
      })
      .sort((a, b) => {
        const orderA = trackOrderMap.get(a.trackId) ?? 0;
        const orderB = trackOrderMap.get(b.trackId) ?? 0;
        return orderA - orderB;
      }) as (VideoClip | ImageClip)[];
  }, [clips, playheadPosition, trackOrderMap]);

  // Primary video clip (the first video clip among active visual clips)
  const primaryVideoClip = activeVisualClips.find(
    (c): c is VideoClip => c.kind === "video"
  );

  // Active captions at current playhead
  const activeCaptions = React.useMemo(() => {
    return captions.filter(
      (cap) => playheadPosition >= cap.startTime && playheadPosition <= cap.endTime
    );
  }, [captions, playheadPosition]);

  // Active text overlays at current playhead
  const activeTextClips = React.useMemo(() => {
    return clips.filter(
      (c): c is TextClip =>
        c.kind === "text" &&
        playheadPosition >= c.timelineStart &&
        playheadPosition <= c.timelineStart + c.timelineDuration
    );
  }, [clips, playheadPosition]);

  // Load media URLs for all active clips from IDB
  useEffect(() => {
    let isCancelled = false;
    const activeAssetIds = Array.from(new Set(activeVisualClips.map((c) => c.assetId)));

    async function loadActiveUrls() {
      const newUrls: Record<string, string> = {};
      for (const assetId of activeAssetIds) {
        if (mediaUrls[assetId]) {
          newUrls[assetId] = mediaUrls[assetId];
          continue;
        }
        const asset = assets.find((a) => a.id === assetId);
        if (asset) {
          try {
            const blob = await loadMediaFile(asset.idbKey);
            if (blob && !isCancelled) {
              newUrls[assetId] = URL.createObjectURL(blob);
            }
          } catch (err) {
            console.error("Failed to load asset blob:", asset.name, err);
          }
        }
      }
      if (!isCancelled) {
        setMediaUrls((prev) => ({ ...prev, ...newUrls }));
      }
    }

    if (activeAssetIds.length > 0) {
      loadActiveUrls();
    }

    return () => {
      isCancelled = true;
    };
  }, [activeVisualClips, assets, mediaUrls]);

  // Synchronize HTML5 video element time with playhead
  useEffect(() => {
    if (!videoRef.current || !primaryVideoClip) return;
    const targetSourceTime =
      primaryVideoClip.sourceStart +
      (playheadPosition - primaryVideoClip.timelineStart) * primaryVideoClip.speed;

    if (Math.abs(videoRef.current.currentTime - targetSourceTime) > 0.15) {
      videoRef.current.currentTime = Math.max(0, targetSourceTime);
    }
  }, [playheadPosition, primaryVideoClip]);

  // Playback loop via requestAnimationFrame
  useEffect(() => {
    if (!isPlaying) {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      lastTimeRef.current = null;
      if (videoRef.current) videoRef.current.pause();
      return;
    }

    if (videoRef.current && primaryVideoClip) {
      videoRef.current.play().catch(() => {});
    }

    const step = (timestamp: number) => {
      if (!lastTimeRef.current) lastTimeRef.current = timestamp;
      const deltaSec = (timestamp - lastTimeRef.current) / 1000;
      lastTimeRef.current = timestamp;

      const nextPos = playheadPosition + deltaSec;
      if (nextPos >= projectDuration && projectDuration > 0) {
        setPlayheadPosition(0);
        setIsPlaying(false);
      } else {
        setPlayheadPosition(nextPos);
        animationFrameRef.current = requestAnimationFrame(step);
      }
    };

    animationFrameRef.current = requestAnimationFrame(step);

    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isPlaying, playheadPosition, projectDuration, primaryVideoClip, setIsPlaying, setPlayheadPosition]);

  const togglePlay = useCallback(() => {
    setIsPlaying(!isPlaying);
  }, [isPlaying, setIsPlaying]);

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setPlayheadPosition(val);
  };

  const stepFrame = (deltaSeconds: number) => {
    setPlayheadPosition(Math.max(0, Math.min(projectDuration, playheadPosition + deltaSeconds)));
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  if (!project || !settings) return null;

  // Determine aspect ratio class
  const getAspectRatioStyle = () => {
    switch (settings.aspectRatio) {
      case "9:16":
        return "aspect-[9/16] max-h-[85%]";
      case "1:1":
        return "aspect-square max-h-[85%]";
      case "4:3":
        return "aspect-[4/3] max-h-[85%]";
      default:
        return "aspect-video max-h-[85%]";
    }
  };

  return (
    <div
      ref={containerRef}
      className="flex-1 bg-zinc-950 flex flex-col justify-between overflow-hidden relative select-none"
    >
      {/* Canvas Viewport Area */}
      <div className="flex-1 flex items-center justify-center p-3 md:p-4 min-h-0 relative">
        <div
          className={`relative bg-black rounded-lg overflow-hidden shadow-2xl border border-zinc-800 flex items-center justify-center transition-all ${getAspectRatioStyle()}`}
        >
          {/* Active visual clips layer */}
          {activeVisualClips.length > 0 ? (
            activeVisualClips.map((clip) => {
              const url = mediaUrls[clip.assetId];
              if (!url) return null;

              if (clip.kind === "video") {
                const vClip = clip as VideoClip;
                const { brightness, contrast, saturation } = vClip.color;
                const b = 1 + brightness / 100;
                const c = 1 + contrast / 100;
                const s = 1 + saturation / 100;

                return (
                  <video
                    key={clip.id}
                    ref={clip.id === primaryVideoClip?.id ? videoRef : undefined}
                    src={url}
                    muted={isMuted || vClip.audio.muted}
                    style={{
                      filter: `brightness(${b}) contrast(${c}) saturate(${s})`,
                      opacity: vClip.transform.opacity,
                      transform: `scale(${vClip.transform.scale}) rotate(${vClip.transform.rotation}deg) scaleX(${
                        vClip.transform.flipH ? -1 : 1
                      }) scaleY(${vClip.transform.flipV ? -1 : 1})`,
                    }}
                    className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                    playsInline
                  />
                );
              } else {
                const imgClip = clip as ImageClip;
                return (
                  <img
                    key={clip.id}
                    src={url}
                    alt={imgClip.label || "Image Clip"}
                    style={{
                      opacity: imgClip.transform.opacity ?? 1,
                      transform: `scale(${imgClip.transform.scale ?? 1})`,
                    }}
                    className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                  />
                );
              }
            })
          ) : (
            <div className="flex flex-col items-center justify-center text-zinc-600 gap-2 p-6 text-center">
              <div className="w-12 h-12 rounded-full border border-zinc-800 flex items-center justify-center">
                <Play className="w-5 h-5 text-zinc-700 ml-0.5" />
              </div>
              <span className="text-xs font-medium text-zinc-500">
                {clips.length === 0 ? "Timeline is empty" : "No clip at playhead"}
              </span>
              <span className="text-[10px] text-zinc-600">
                Import and add media to start editing
              </span>
            </div>
          )}

          {/* Text Overlays */}
          {activeTextClips.map((tc) => (
            <div
              key={tc.id}
              style={{
                fontFamily: tc.style.fontFamily,
                fontSize: `${tc.style.fontSize}px`,
                color: tc.style.color,
                backgroundColor: tc.style.backgroundColor,
                opacity: tc.transform.opacity,
                fontWeight: tc.style.bold ? "bold" : "normal",
                fontStyle: tc.style.italic ? "italic" : "normal",
              }}
              className="absolute px-4 py-2 rounded pointer-events-none z-10 text-center max-w-[80%]"
            >
              {tc.text}
            </div>
          ))}

          {/* Captions Overlay */}
          {activeCaptions.map((cap) => (
            <div
              key={cap.id}
              style={{
                fontFamily: cap.style.fontFamily,
                fontSize: `${cap.style.fontSize}px`,
                color: cap.style.color,
                backgroundColor: cap.style.backgroundColor,
                fontWeight: cap.style.bold ? "bold" : "normal",
                textShadow: "0 2px 4px rgba(0,0,0,0.8)",
              }}
              className="absolute bottom-6 px-4 py-1.5 rounded text-center pointer-events-none z-10 max-w-[90%]"
            >
              {cap.text}
            </div>
          ))}

          {/* Aspect Ratio Badge */}
          <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-sm text-[10px] text-zinc-400 font-mono border border-white/10">
            {settings.aspectRatio} â€¢ {settings.width}x{settings.height}
          </div>
        </div>
      </div>

      {/* Scrubber & Player Controls Bar */}
      <div className="bg-zinc-900/90 border-t border-zinc-800/80 px-3 md:px-4 py-2 flex flex-col gap-1.5 shrink-0">
        {/* Scrubber Bar */}
        <div className="flex items-center gap-2 md:gap-3">
          <span className="text-xs font-mono text-blue-400 font-semibold w-20 md:w-24">
            {formatTimecode(playheadPosition)}
          </span>

          <input
            type="range"
            min={0}
            max={Math.max(projectDuration, 1)}
            step={0.01}
            value={playheadPosition}
            onChange={handleSeek}
            className="flex-1 h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-blue-500 hover:accent-blue-400 transition"
          />

          <span className="text-xs font-mono text-zinc-500 w-14 md:w-16 text-right">
            {formatTime(projectDuration)}
          </span>
        </div>

        {/* Action Controls */}
        <div className="flex items-center justify-between">
          {/* Left: Frame Navigation */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => stepFrame(-1)}
              className="p-1.5 text-zinc-400 hover:text-white rounded hover:bg-zinc-800 transition"
              title="Step Back 1s (J)"
            >
              <SkipBack className="w-3.5 h-3.5 md:w-4 md:h-4" />
            </button>

            <button
              onClick={togglePlay}
              className="p-2 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white rounded-full shadow-md shadow-blue-500/20 transition mx-0.5 md:mx-1"
              title={isPlaying ? "Pause (Space)" : "Play (Space)"}
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5 md:w-4 md:h-4" /> : <Play className="w-3.5 h-3.5 md:w-4 md:h-4 ml-0.5" />}
            </button>

            <button
              onClick={() => stepFrame(1)}
              className="p-1.5 text-zinc-400 hover:text-white rounded hover:bg-zinc-800 transition"
              title="Step Forward 1s (L)"
            >
              <SkipForward className="w-3.5 h-3.5 md:w-4 md:h-4" />
            </button>

            <button
              onClick={() => setPlayheadPosition(0)}
              className="p-1.5 text-zinc-500 hover:text-zinc-300 rounded hover:bg-zinc-800 transition ml-0.5"
              title="Return to start"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Right: Audio & Fullscreen */}
          <div className="flex items-center gap-2 md:gap-3">
            <div className="flex items-center gap-1 md:gap-1.5">
              <button
                onClick={() => setIsMuted(!isMuted)}
                className="text-zinc-400 hover:text-white transition"
              >
                {isMuted ? <VolumeX className="w-3.5 h-3.5 md:w-4 md:h-4 text-red-400" /> : <Volume2 className="w-3.5 h-3.5 md:w-4 md:h-4" />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                onChange={(e) => {
                  setVolume(parseFloat(e.target.value));
                  if (isMuted) setIsMuted(false);
                }}
                className="w-12 md:w-16 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
              />
            </div>

            <button
              onClick={toggleFullscreen}
              className="p-1.5 text-zinc-400 hover:text-white rounded hover:bg-zinc-800 transition"
              title="Toggle Fullscreen"
            >
              {isFullscreen ? <Minimize className="w-3.5 h-3.5 md:w-4 md:h-4" /> : <Maximize className="w-3.5 h-3.5 md:w-4 md:h-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

