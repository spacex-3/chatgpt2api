"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { Clock3, ImageIcon, LoaderCircle, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ImageConversation, ImageTurnStatus, StoredImage, StoredReferenceImage } from "@/store/image-conversations";

export type ImageLightboxItem = {
  id: string;
  src: string;
  sizeLabel?: string;
  dimensions?: string;
};

type ImageResultsProps = {
  selectedConversation: ImageConversation | null;
  viewportRef: RefObject<HTMLDivElement | null>;
  onOpenLightbox: (images: ImageLightboxItem[], index: number) => void;
  onContinueEdit: (conversationId: string, image: StoredImage | StoredReferenceImage) => void;
  onHydrateTaskVisible: (taskId: string) => void;
  formatConversationTime: (value: string) => string;
};

type HydrationTriggerProps = {
  taskId: string;
  viewportRef: RefObject<HTMLDivElement | null>;
  onVisible: (taskId: string) => void;
};

type LazyResultPreviewProps = {
  src: string;
  alt: string;
  size: string;
  viewportRef: RefObject<HTMLDivElement | null>;
  onClick: () => void;
  onLoad: (width: number, height: number) => void;
};

function getStoredImageSrc(image: StoredImage) {
  if (image.b64_json) {
    return `data:image/png;base64,${image.b64_json}`;
  }
  return image.url || "";
}

function getPreviewAspectClass(size: string) {
  if (size === "1024x1024") {
    return "aspect-square";
  }
  if (size === "1536x1024") {
    return "aspect-[3/2]";
  }
  if (size === "1024x1536") {
    return "aspect-[2/3]";
  }
  return "aspect-square";
}

function HydrationTrigger({ taskId, viewportRef, onVisible }: HydrationTriggerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const triggeredRef = useRef(false);

  useEffect(() => {
    const target = ref.current;
    if (!target) {
      return;
    }
    if (triggeredRef.current || typeof IntersectionObserver === "undefined") {
      if (!triggeredRef.current) {
        triggeredRef.current = true;
        onVisible(taskId);
      }
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) {
          return;
        }
        if (triggeredRef.current) {
          return;
        }
        triggeredRef.current = true;
        onVisible(taskId);
        observer.disconnect();
      },
      {
        root: viewportRef.current,
        rootMargin: "320px 0px",
        threshold: 0.01,
      },
    );

    observer.observe(target);
    return () => {
      observer.disconnect();
    };
  }, [onVisible, taskId, viewportRef]);

  return <div ref={ref} className="h-px w-full" aria-hidden />;
}

function LazyResultPreview({
  src,
  alt,
  size,
  viewportRef,
  onClick,
  onLoad,
}: LazyResultPreviewProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const [shouldLoad, setShouldLoad] = useState(false);

  useEffect(() => {
    const target = ref.current;
    if (!target || shouldLoad) {
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      setShouldLoad(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) {
          return;
        }
        setShouldLoad(true);
        observer.disconnect();
      },
      {
        root: viewportRef.current,
        rootMargin: "320px 0px",
        threshold: 0.01,
      },
    );

    observer.observe(target);
    return () => {
      observer.disconnect();
    };
  }, [shouldLoad, viewportRef]);

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className="group block w-full cursor-zoom-in"
      aria-label={alt}
    >
      {shouldLoad ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          className="block h-auto w-full transition duration-200 group-hover:brightness-90"
          onLoad={(event) => {
            onLoad(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight);
          }}
        />
      ) : (
        <div
          className={cn(
            "flex items-center justify-center border border-stone-200/80 bg-stone-100/70 text-stone-500",
            getPreviewAspectClass(size),
          )}
        >
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-xs">
            <ImageIcon className="size-4" />
            <span>滚动到此处后加载图片</span>
          </div>
        </div>
      )}
    </button>
  );
}

export function ImageResults({
  selectedConversation,
  viewportRef,
  onOpenLightbox,
  onContinueEdit,
  onHydrateTaskVisible,
  formatConversationTime,
}: ImageResultsProps) {
  const [imageDimensions, setImageDimensions] = useState<Record<string, string>>({});

  const updateImageDimensions = (id: string, width: number, height: number) => {
    const dimensions = formatImageDimensions(width, height);
    setImageDimensions((current) => {
      if (current[id] === dimensions) {
        return current;
      }
      return { ...current, [id]: dimensions };
    });
  };

  if (!selectedConversation) {
    return (
      <div className="flex h-full min-h-[260px] items-center justify-center text-center sm:min-h-[420px]">
        <div className="w-full max-w-4xl">
          <h1
            className="text-2xl font-semibold tracking-tight text-stone-950 sm:text-3xl md:text-5xl"
            style={{
              fontFamily: '"Palatino Linotype","Book Antiqua","URW Palladio L","Times New Roman",serif',
            }}
          >
            Turn ideas into images
          </h1>
          <p
            className="mx-auto mt-3 max-w-[280px] text-sm italic tracking-[0.01em] text-stone-500 sm:mt-4 sm:max-w-none sm:text-[15px]"
            style={{
              fontFamily: '"Palatino Linotype","Book Antiqua","URW Palladio L","Times New Roman",serif',
            }}
          >
            在同一窗口里保留本地历史与任务状态，并从已有结果图继续发起新的无状态编辑。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[980px] flex-col gap-5 sm:gap-8">
      {selectedConversation.turns.map((turn, turnIndex) => {
        const referenceLightboxImages = turn.referenceImages.map((image, index) => ({
          id: `${turn.id}-reference-${index}`,
          src: image.dataUrl,
        }));
        const successfulTurnImages = turn.images.flatMap((image) => {
          const src = image.status === "success" ? getStoredImageSrc(image) : "";
          return src
            ? [
                {
                  id: image.id,
                  src,
                  sizeLabel: image.b64_json ? formatBase64ImageSize(image.b64_json) : undefined,
                  dimensions: imageDimensions[image.id],
                },
              ]
            : [];
        });
        const needsHydration =
          turn.status === "success"
          && turn.images.length > 0
          && turn.images.every((image) => !image.b64_json && !image.url && image.status !== "error");

        return (
          <div key={turn.id} className="flex flex-col gap-3 sm:gap-4">
            <div className="flex justify-end">
              <div className="max-w-[90%] px-1 py-1 text-[14px] leading-6 text-stone-900 sm:max-w-[82%] sm:text-[15px] sm:leading-7">
                <div className="mb-1.5 flex flex-wrap justify-end gap-2 text-[11px] text-stone-400 sm:mb-2">
                  <span>第 {turnIndex + 1} 轮</span>
                  <span>{turn.mode === "edit" ? "编辑图" : "文生图"}</span>
                  <span>{turn.size || "未指定尺寸"}</span>
                  <span>{getTurnStatusLabel(turn.status)}</span>
                  <span>{formatConversationTime(turn.createdAt)}</span>
                </div>
                <div className="text-right">{turn.prompt}</div>
              </div>
            </div>

            <div className="flex justify-start">
              <div className="w-full p-1">
                {turn.referenceImages.length > 0 ? (
                  <div className="mb-4 flex flex-col items-end">
                    <div className="mb-3 text-xs font-medium text-stone-500">本轮参考图</div>
                    <div className="flex flex-wrap justify-end gap-3">
                      {turn.referenceImages.map((image, index) => (
                        <div key={`${turn.id}-${image.name}-${index}`} className="flex flex-col items-end gap-2">
                          <button
                            type="button"
                            onClick={() => onOpenLightbox(referenceLightboxImages, index)}
                            className="group relative h-24 w-24 overflow-hidden border border-stone-200/80 bg-stone-100/60 text-left transition hover:border-stone-300"
                            aria-label={`预览参考图 ${image.name || index + 1}`}
                          >
                            <img
                              src={image.dataUrl}
                              alt={image.name || `参考图 ${index + 1}`}
                              loading="lazy"
                              className="absolute inset-0 h-full w-full object-cover transition duration-200 group-hover:scale-[1.02]"
                            />
                          </button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="rounded-full border-stone-200 bg-white text-stone-700 hover:bg-stone-50"
                            onClick={() => onContinueEdit(selectedConversation.id, image)}
                          >
                            <Sparkles className="size-4" />
                            加入编辑
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[11px] text-stone-500 sm:mb-4 sm:gap-2 sm:text-xs">
                  <span className="rounded-full bg-stone-100 px-3 py-1">{turn.count} 张</span>
                  <span className="rounded-full bg-stone-100 px-3 py-1">{getTurnStatusLabel(turn.status)}</span>
                  {turn.status === "queued" ? (
                    <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700">等待服务端处理</span>
                  ) : null}
                  {needsHydration ? (
                    <span className="rounded-full bg-sky-50 px-3 py-1 text-sky-700">仅在可见区域加载历史图片</span>
                  ) : null}
                </div>

                {needsHydration ? (
                  <HydrationTrigger
                    taskId={turn.taskId || turn.id}
                    viewportRef={viewportRef}
                    onVisible={onHydrateTaskVisible}
                  />
                ) : null}

                <div className="columns-1 gap-3 space-y-3 sm:columns-2 sm:gap-4 sm:space-y-4 xl:columns-3">
                  {turn.images.map((image, index) => {
                    const imageSrc = image.status === "success" ? getStoredImageSrc(image) : "";
                    if (image.status === "success" && imageSrc) {
                      const currentIndex = successfulTurnImages.findIndex((item) => item.id === image.id);
                      const sizeLabel = image.b64_json ? formatBase64ImageSize(image.b64_json) : "";
                      const dimensions = imageDimensions[image.id];
                      const imageMeta = [sizeLabel, dimensions].filter(Boolean).join(" · ");

                      return (
                        <div key={image.id} className="break-inside-avoid overflow-hidden">
                          <LazyResultPreview
                            src={imageSrc}
                            alt={`Generated result ${index + 1}`}
                            size={turn.size}
                            viewportRef={viewportRef}
                            onClick={() => onOpenLightbox(successfulTurnImages, currentIndex)}
                            onLoad={(width, height) => updateImageDimensions(image.id, width, height)}
                          />
                          <div className="flex items-center justify-between gap-2 px-3 py-3">
                            <div className="min-w-0 text-xs text-stone-500">
                              <span>结果 {index + 1}</span>
                              {imageMeta ? <span className="ml-2 text-stone-400">{imageMeta}</span> : null}
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              className="rounded-full border-stone-200 bg-white text-stone-700 hover:bg-stone-50"
                              onClick={() => onContinueEdit(selectedConversation.id, image)}
                            >
                              <Sparkles className="size-4" />
                              加入编辑
                            </Button>
                          </div>
                        </div>
                      );
                    }

                    if (image.status === "error") {
                      return (
                        <div
                          key={image.id}
                          className={cn(
                            "break-inside-avoid overflow-hidden rounded-2xl border border-rose-200 bg-rose-50 sm:rounded-none",
                            turn.size === "1024x1024" && "sm:aspect-square",
                            turn.size === "1536x1024" && "sm:aspect-[3/2]",
                            turn.size === "1024x1536" && "sm:aspect-[2/3]",
                            !["1024x1024", "1536x1024", "1024x1536"].includes(turn.size) && "sm:aspect-square",
                          )}
                        >
                          <div className="flex h-full min-h-16 items-center justify-center px-4 py-4 text-center text-sm leading-6 text-rose-600 sm:px-6 sm:py-8">
                            {image.error || "生成失败"}
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={image.id}
                        className={cn(
                          "break-inside-avoid overflow-hidden border border-stone-200/80 bg-stone-100/80",
                          turn.size === "1024x1024" && "aspect-square",
                          turn.size === "1536x1024" && "aspect-[3/2]",
                          turn.size === "1024x1536" && "aspect-[2/3]",
                          !["1024x1024", "1536x1024", "1024x1536"].includes(turn.size) && "aspect-square",
                        )}
                      >
                        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-8 text-center text-stone-500">
                          <div className="rounded-full bg-white p-3 shadow-sm">
                            {turn.status === "queued" ? (
                              <Clock3 className="size-5" />
                            ) : (
                              <LoaderCircle className="size-5 animate-spin" />
                            )}
                          </div>
                          <p className="text-sm">
                            {turn.status === "queued"
                              ? "等待处理图片..."
                              : turn.status === "success"
                                ? "滚动到此处后读取历史图片..."
                                : "正在处理图片..."}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {turn.status === "error" && turn.error ? (
                  <div className="mt-4 border-l-2 border-amber-300 bg-amber-50/70 px-4 py-3 text-sm leading-6 text-amber-700">
                    {turn.error}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function getTurnStatusLabel(status: ImageTurnStatus) {
  if (status === "queued") {
    return "排队中";
  }
  if (status === "generating") {
    return "处理中";
  }
  if (status === "success") {
    return "已完成";
  }
  return "失败";
}

function formatBase64ImageSize(base64: string) {
  const normalized = base64.replace(/\s/g, "");
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  const bytes = Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);

  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

function formatImageDimensions(width: number, height: number) {
  return `${width} x ${height}`;
}
