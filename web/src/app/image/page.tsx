"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { History, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ImageComposer } from "@/app/image/components/image-composer";
import { ImageResults, type ImageLightboxItem } from "@/app/image/components/image-results";
import { ImageSidebar } from "@/app/image/components/image-sidebar";
import { ImageLightbox } from "@/components/image-lightbox";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  clearImageTaskHistory,
  createImageEditTask,
  createImageGenerationTask,
  deleteImageTaskConversation,
  fetchImageTasks,
  type ImageTask,
} from "@/lib/api";
import { useAuthGuard } from "@/lib/use-auth-guard";
import {
  clearImageConversations,
  deleteImageConversation,
  getImageConversationStats,
  listImageConversations,
  saveImageConversation,
  saveImageConversations,
  type ImageConversation,
  type ImageConversationMode,
  type ImageTurn,
  type StoredImage,
  type StoredReferenceImage,
} from "@/store/image-conversations";

const ACTIVE_CONVERSATION_STORAGE_KEY = "chatgpt2api:image_active_conversation_id";
const IMAGE_SIZE_STORAGE_KEY = "chatgpt2api:image_last_size";
const IMAGE_COUNT_STORAGE_KEY = "chatgpt2api:image_last_count";

function clampImageCount(value: string) {
  return String(Math.min(10, Math.max(1, Math.floor(Number(value) || 1))));
}

function buildConversationTitle(prompt: string) {
  const trimmed = prompt.trim();
  if (trimmed.length <= 12) {
    return trimmed;
  }
  return `${trimmed.slice(0, 12)}...`;
}

function formatConversationTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取参考图失败"));
    reader.readAsDataURL(file);
  });
}

function dataUrlToFile(dataUrl: string, fileName: string, mimeType?: string) {
  const [header, content] = dataUrl.split(",", 2);
  const matchedMimeType = header.match(/data:(.*?);base64/)?.[1];
  const binary = atob(content || "");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], fileName, { type: mimeType || matchedMimeType || "image/png" });
}

function buildReferenceImageFromResult(image: StoredImage, fileName: string): StoredReferenceImage | null {
  if (!image.b64_json) {
    return null;
  }

  return {
    name: fileName,
    type: "image/png",
    dataUrl: `data:image/png;base64,${image.b64_json}`,
  };
}

async function fetchImageAsFile(url: string, fileName: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("读取结果图失败");
  }
  const blob = await response.blob();
  return new File([blob], fileName, { type: blob.type || "image/png" });
}

async function buildReferenceImageFromStoredImage(image: StoredImage, fileName: string) {
  const direct = buildReferenceImageFromResult(image, fileName);
  if (direct) {
    return {
      referenceImage: direct,
      file: dataUrlToFile(direct.dataUrl, direct.name, direct.type),
    };
  }

  if (!image.url) {
    return null;
  }
  const file = await fetchImageAsFile(image.url, fileName);
  return {
    referenceImage: {
      name: file.name,
      type: file.type || "image/png",
      dataUrl: await readFileAsDataUrl(file),
    },
    file,
  };
}

function sortImageConversations(conversations: ImageConversation[]) {
  return [...conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function pickFallbackConversationId(conversations: ImageConversation[]) {
  const activeConversation = conversations.find((conversation) =>
    conversation.turns.some((turn) => turn.status === "queued" || turn.status === "generating"),
  );
  return activeConversation?.id ?? conversations[0]?.id ?? null;
}

function applyTaskToTurn(turn: ImageTurn, task: ImageTask): ImageTurn {
  const targetTaskId = turn.taskId || turn.id;
  if (targetTaskId !== task.id) {
    return turn;
  }
  if (task.status === "success") {
    const items = task.data || [];
    if (items.length === 0) {
      if (Number(task.result_count || 0) > 0) {
        return {
          ...turn,
          taskId: task.id,
          status: "success",
          error: undefined,
          images: Array.from({ length: Math.max(turn.count, Number(task.result_count || 0)) }, (_, index) => ({
            id: `${turn.id}-${index}`,
            status: "loading",
          })),
        };
      }
      return {
        ...turn,
        taskId: task.id,
        status: "error",
        error: "未返回图片数据",
        images: Array.from({ length: turn.count }, (_, index) => ({
          id: `${turn.id}-${index}`,
          status: "error",
          error: "未返回图片数据",
        })),
      };
    }
    return {
      ...turn,
      taskId: task.id,
      status: "success",
      error: undefined,
      images: items.map((item, index) => ({
        id: `${turn.id}-${index}`,
        status: "success",
        b64_json: item.b64_json,
        url: item.url,
        revised_prompt: item.revised_prompt,
      })),
    };
  }
  if (task.status === "error") {
    const message = task.error || "生成失败";
    return {
      ...turn,
      taskId: task.id,
      status: "error",
      error: message,
      images: Array.from({ length: turn.count }, (_, index) => ({
        id: `${turn.id}-${index}`,
        status: "error",
        error: message,
      })),
    };
  }
  return {
    ...turn,
    taskId: task.id,
    status: task.status === "queued" ? "queued" : "generating",
    error: undefined,
    images: Array.from({ length: turn.count }, (_, index) => ({
      id: `${turn.id}-${index}`,
      status: "loading",
    })),
  };
}

function markTurnError(turn: ImageTurn, message: string): ImageTurn {
  return {
    ...turn,
    status: "error",
    error: message,
    images: Array.from({ length: turn.count }, (_, index) => ({
      id: `${turn.id}-${index}`,
      status: "error",
      error: message,
    })),
  };
}

function collectPendingTaskIds(conversations: ImageConversation[]) {
  return Array.from(
    new Set(
      conversations.flatMap((conversation) =>
        conversation.turns.flatMap((turn) =>
          (turn.status === "queued" || turn.status === "generating") && (turn.taskId || turn.id)
            ? [turn.taskId || turn.id]
            : [],
        ),
      ),
    ),
  );
}

function collectConversationHydrationTaskIds(conversation: ImageConversation | null) {
  if (!conversation) {
    return [];
  }
  return Array.from(
    new Set(
      conversation.turns.flatMap((turn) => {
        if (turn.status !== "success") {
          return [];
        }
        const taskId = turn.taskId || turn.id;
        const hasRenderableImage = turn.images.some((image) => Boolean(image.b64_json || image.url));
        if (!taskId || hasRenderableImage) {
          return [];
        }
        return [taskId];
      }),
    ),
  );
}

function buildTurnFromTask(task: ImageTask): ImageTurn {
  const requestedCount = Math.max(1, Number(task.n || 1));
  const resultCount = Math.max(0, Number(task.result_count || 0));
  const itemCount = Math.max(requestedCount, (task.data || []).length || resultCount || 0);
  const baseTurn: ImageTurn = {
    id: task.id,
    taskId: task.id,
    prompt: task.prompt || "",
    model: "gpt-image-2",
    mode: task.mode === "edit" ? "edit" : "generate",
    referenceImages: [],
    count: itemCount,
    size: task.size || "",
    createdAt: task.created_at,
    status: task.status === "queued" ? "queued" : task.status === "running" ? "generating" : task.status,
    images: Array.from({ length: itemCount }, (_, index) => ({
      id: `${task.id}-${index}`,
      status: task.status === "error" ? "error" : task.status === "success" ? "success" : "loading",
      error: task.status === "error" ? task.error || "生成失败" : undefined,
    })),
  };
  if (task.status === "success" && (!task.data || task.data.length === 0) && resultCount > 0) {
    return baseTurn;
  }
  return applyTaskToTurn(baseTurn, task);
}

function buildConversationsFromTasks(tasks: ImageTask[]) {
  const groups = new Map<string, ImageConversation>();
  const sortedTasks = [...tasks].sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const task of sortedTasks) {
    const conversationId = task.conversation_id || task.id;
    const current = groups.get(conversationId);
    const turn = buildTurnFromTask(task);
    if (!current) {
      groups.set(conversationId, {
        id: conversationId,
        title: task.conversation_title || buildConversationTitle(task.prompt || task.id),
        createdAt: task.created_at,
        updatedAt: task.updated_at,
        turns: [turn],
      });
      continue;
    }
    current.turns.push(turn);
    current.updatedAt = task.updated_at > current.updatedAt ? task.updated_at : current.updatedAt;
    if (!current.title && task.conversation_title) {
      current.title = task.conversation_title;
    }
  }
  return sortImageConversations(Array.from(groups.values()));
}

function mergeServerAndLocalConversations(serverItems: ImageConversation[], localItems: ImageConversation[]) {
  const serverIds = new Set(serverItems.map((item) => item.id));
  return sortImageConversations([
    ...serverItems,
    ...localItems.filter((item) => !serverIds.has(item.id)),
  ]);
}

function applyTaskUpdates(conversations: ImageConversation[], tasks: ImageTask[], missingIds: string[]) {
  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  const missingIdSet = new Set(missingIds);
  let changed = false;
  const nextItems = conversations.map((conversation) => {
    let conversationChanged = false;
    const nextTurns = conversation.turns.map((turn) => {
      const needsHydration =
        turn.status === "success"
        && turn.images.length > 0
        && turn.images.every((image) => !image.b64_json && !image.url && image.status !== "error");
      if (!needsHydration && turn.status !== "queued" && turn.status !== "generating") {
        return turn;
      }
      const taskId = turn.taskId || turn.id;
      if (!taskId) {
        const nextTurn = markTurnError(turn, "页面刷新前任务未完成，且未保存可恢复的任务 ID");
        conversationChanged = true;
        return nextTurn;
      }
      if (missingIdSet.has(taskId)) {
        const nextTurn = markTurnError(turn, "未找到对应图片任务，可能已过期或被清理");
        conversationChanged = true;
        return nextTurn;
      }
      const task = taskMap.get(taskId);
      if (!task) {
        return turn;
      }
      const nextTurn = applyTaskToTurn(turn, task);
      if (JSON.stringify(nextTurn) !== JSON.stringify(turn)) {
        conversationChanged = true;
      }
      return nextTurn;
    });
    if (!conversationChanged) {
      return conversation;
    }
    changed = true;
    return {
      ...conversation,
      turns: nextTurns,
      updatedAt: new Date().toISOString(),
    };
  });
  return { items: nextItems, changed };
}

async function recoverConversationHistory(items: ImageConversation[]) {
  let changed = false;
  const normalized = items.map((conversation) => {
    const turns = conversation.turns.map((turn) => {
      if ((turn.status !== "queued" && turn.status !== "generating") || turn.taskId || turn.id) {
        return turn;
      }
      changed = true;
      return markTurnError(turn, "页面刷新前任务未完成，且未保存可恢复的任务 ID");
    });
    if (!turns.some((turn, index) => turn !== conversation.turns[index])) {
      return conversation;
    }
    return {
      ...conversation,
      turns,
      updatedAt: new Date().toISOString(),
    };
  });
  if (changed) {
    await saveImageConversations(normalized);
  }
  const pendingTaskIds = collectPendingTaskIds(normalized);
  if (pendingTaskIds.length === 0) {
    return normalized;
  }
  try {
    const taskList = await fetchImageTasks(pendingTaskIds);
    return applyTaskUpdates(normalized, taskList.items, taskList.missing_ids).items;
  } catch {
    return normalized;
  }
}

function ImagePageContent() {
  const conversationsRef = useRef<ImageConversation[]>([]);
  const resultsViewportRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isSyncingRef = useRef(false);
  const isHydratingConversationRef = useRef(false);

  const [imagePrompt, setImagePrompt] = useState("");
  const [imageCount, setImageCount] = useState("1");
  const [imageSize, setImageSize] = useState("");
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [referenceImageFiles, setReferenceImageFiles] = useState<File[]>([]);
  const [referenceImages, setReferenceImages] = useState<StoredReferenceImage[]>([]);
  const [conversations, setConversations] = useState<ImageConversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [lightboxImages, setLightboxImages] = useState<ImageLightboxItem[]>([]);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: "one"; id: string } | { type: "all" } | null>(null);

  const parsedCount = useMemo(() => Number(clampImageCount(imageCount)), [imageCount]);
  const selectedConversation = useMemo(
    () => conversations.find((item) => item.id === selectedConversationId) ?? null,
    [conversations, selectedConversationId],
  );
  const activeTaskCount = useMemo(
    () =>
      conversations.reduce((sum, conversation) => {
        const stats = getImageConversationStats(conversation);
        return sum + stats.queued + stats.running;
      }, 0),
    [conversations],
  );
  const deleteConfirmTitle = deleteConfirm?.type === "all" ? "清空历史记录" : deleteConfirm?.type === "one" ? "删除对话" : "";
  const deleteConfirmDescription =
    deleteConfirm?.type === "all"
      ? "确认删除全部图片历史记录吗？删除后无法恢复。"
      : deleteConfirm?.type === "one"
        ? "确认删除这条图片对话吗？删除后无法恢复。"
        : "";
  const pendingTaskSignature = useMemo(() => collectPendingTaskIds(conversations).sort().join(","), [conversations]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  const replaceConversations = useCallback((items: ImageConversation[]) => {
    const nextItems = sortImageConversations(items);
    conversationsRef.current = nextItems;
    setConversations(nextItems);
  }, []);

  const syncPendingTasks = useCallback(async () => {
    if (isSyncingRef.current) {
      return;
    }
    const pendingTaskIds = collectPendingTaskIds(conversationsRef.current);
    if (pendingTaskIds.length === 0) {
      return;
    }
    isSyncingRef.current = true;
    try {
      const taskList = await fetchImageTasks(pendingTaskIds);
      const { items, changed } = applyTaskUpdates(conversationsRef.current, taskList.items, taskList.missing_ids);
      if (changed) {
        replaceConversations(items);
        await saveImageConversations(items);
      }
    } catch {
      // ignore and retry later
    } finally {
      isSyncingRef.current = false;
    }
  }, [replaceConversations]);

  useEffect(() => {
    let cancelled = false;

    const loadHistory = async () => {
      try {
        const storedSize = typeof window !== "undefined" ? window.localStorage.getItem(IMAGE_SIZE_STORAGE_KEY) : null;
        const storedCount = typeof window !== "undefined" ? window.localStorage.getItem(IMAGE_COUNT_STORAGE_KEY) : null;
        setImageSize(storedSize || "");
        setImageCount(storedCount ? clampImageCount(storedCount) : "1");

        let nextItems: ImageConversation[] = [];
        try {
          const serverTaskList = await fetchImageTasks([]);
          nextItems = buildConversationsFromTasks(serverTaskList.items);
          await saveImageConversations(nextItems);
        } catch {
          const localItems = await listImageConversations();
          nextItems = await recoverConversationHistory(localItems);
        }
        if (cancelled) {
          return;
        }
        replaceConversations(nextItems);
        const storedConversationId =
          typeof window !== "undefined" ? window.localStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY) : null;
        const nextSelectedConversationId =
          (storedConversationId && nextItems.some((conversation) => conversation.id === storedConversationId)
            ? storedConversationId
            : null) ?? pickFallbackConversationId(nextItems);
        setSelectedConversationId(nextSelectedConversationId);
      } catch (error) {
        const message = error instanceof Error ? error.message : "读取会话记录失败";
        toast.error(message);
      } finally {
        if (!cancelled) {
          setIsLoadingHistory(false);
        }
      }
    };

    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, [replaceConversations]);

  useEffect(() => {
    if (!pendingTaskSignature || typeof window === "undefined") {
      return;
    }
    void syncPendingTasks();
    const timer = window.setInterval(() => {
      void syncPendingTasks();
    }, 2000);
    return () => {
      window.clearInterval(timer);
    };
  }, [pendingTaskSignature, syncPendingTasks]);

  useEffect(() => {
    const taskIds = collectConversationHydrationTaskIds(selectedConversation);
    if (taskIds.length === 0 || isHydratingConversationRef.current) {
      return;
    }
    isHydratingConversationRef.current = true;
    void (async () => {
      try {
        const taskList = await fetchImageTasks(taskIds);
        const { items, changed } = applyTaskUpdates(conversationsRef.current, taskList.items, taskList.missing_ids);
        if (changed) {
          replaceConversations(items);
          await saveImageConversations(items);
        }
      } catch {
        // ignore and retry when user revisits the conversation
      } finally {
        isHydratingConversationRef.current = false;
      }
    })();
  }, [selectedConversation, replaceConversations]);

  useEffect(() => {
    if (!selectedConversation) {
      return;
    }
    resultsViewportRef.current?.scrollTo({
      top: resultsViewportRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [selectedConversation?.updatedAt, selectedConversation?.turns.length, selectedConversation]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (selectedConversationId) {
      window.localStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, selectedConversationId);
    } else {
      window.localStorage.removeItem(ACTIVE_CONVERSATION_STORAGE_KEY);
    }
  }, [selectedConversationId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (imageSize) {
      window.localStorage.setItem(IMAGE_SIZE_STORAGE_KEY, imageSize);
      return;
    }
    window.localStorage.removeItem(IMAGE_SIZE_STORAGE_KEY);
  }, [imageSize]);

  useEffect(() => {
    if (typeof window !== "undefined" && parsedCount > 0) {
      window.localStorage.setItem(IMAGE_COUNT_STORAGE_KEY, String(parsedCount));
    }
  }, [parsedCount]);

  useEffect(() => {
    if (selectedConversationId && !conversations.some((conversation) => conversation.id === selectedConversationId)) {
      setSelectedConversationId(pickFallbackConversationId(conversations));
    }
  }, [conversations, selectedConversationId]);

  const persistConversation = useCallback(async (conversation: ImageConversation) => {
    const nextConversations = sortImageConversations([
      conversation,
      ...conversationsRef.current.filter((item) => item.id !== conversation.id),
    ]);
    replaceConversations(nextConversations);
    await saveImageConversation(conversation);
  }, [replaceConversations]);

  const updateConversation = useCallback(
    async (conversationId: string, updater: (current: ImageConversation | null) => ImageConversation) => {
      const current = conversationsRef.current.find((item) => item.id === conversationId) ?? null;
      const nextConversation = updater(current);
      const nextConversations = sortImageConversations([
        nextConversation,
        ...conversationsRef.current.filter((item) => item.id !== conversationId),
      ]);
      replaceConversations(nextConversations);
      await saveImageConversation(nextConversation);
    },
    [replaceConversations],
  );

  const clearComposerInputs = useCallback(() => {
    setImagePrompt("");
    setReferenceImageFiles([]);
    setReferenceImages([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const handleCreateDraft = useCallback(() => {
    setSelectedConversationId(null);
    clearComposerInputs();
    textareaRef.current?.focus();
  }, [clearComposerInputs]);

  const handleDeleteConversation = useCallback(async (id: string) => {
    const nextConversations = conversationsRef.current.filter((item) => item.id !== id);
    replaceConversations(nextConversations);
    if (selectedConversationId === id) {
      setSelectedConversationId(pickFallbackConversationId(nextConversations));
      clearComposerInputs();
    }
    try {
      await Promise.all([
        deleteImageTaskConversation(id),
        deleteImageConversation(id),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "删除会话失败";
      toast.error(message);
      try {
        const [localItems, serverTaskList] = await Promise.all([
          listImageConversations(),
          fetchImageTasks([]),
        ]);
        replaceConversations(
          mergeServerAndLocalConversations(
            buildConversationsFromTasks(serverTaskList.items),
            localItems,
          ),
        );
      } catch {
        const items = await listImageConversations();
        replaceConversations(items);
      }
    }
  }, [clearComposerInputs, replaceConversations, selectedConversationId]);

  const handleClearHistory = useCallback(async () => {
    try {
      await Promise.all([
        clearImageTaskHistory(),
        clearImageConversations(),
      ]);
      replaceConversations([]);
      setSelectedConversationId(null);
      clearComposerInputs();
      toast.success("已清空历史记录");
    } catch (error) {
      const message = error instanceof Error ? error.message : "清空历史记录失败";
      toast.error(message);
    }
  }, [clearComposerInputs, replaceConversations]);

  const openDeleteConversationConfirm = useCallback((id: string) => {
    setIsHistoryOpen(false);
    setDeleteConfirm({ type: "one", id });
  }, []);

  const openClearHistoryConfirm = useCallback(() => {
    setIsHistoryOpen(false);
    setDeleteConfirm({ type: "all" });
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    const target = deleteConfirm;
    setDeleteConfirm(null);
    if (!target) {
      return;
    }
    if (target.type === "all") {
      await handleClearHistory();
      return;
    }
    await handleDeleteConversation(target.id);
  }, [deleteConfirm, handleClearHistory, handleDeleteConversation]);

  const appendReferenceImages = useCallback(async (files: File[]) => {
    if (files.length === 0) {
      return;
    }
    try {
      const previews = await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          type: file.type || "image/png",
          dataUrl: await readFileAsDataUrl(file),
        })),
      );
      setReferenceImageFiles((prev) => [...prev, ...files]);
      setReferenceImages((prev) => [...prev, ...previews]);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取参考图失败";
      toast.error(message);
    }
  }, []);

  const handleReferenceImageChange = useCallback(async (files: File[]) => {
    if (files.length === 0) {
      return;
    }
    await appendReferenceImages(files);
  }, [appendReferenceImages]);

  const handleRemoveReferenceImage = useCallback((index: number) => {
    setReferenceImageFiles((prev) => {
      const next = prev.filter((_, currentIndex) => currentIndex !== index);
      if (next.length === 0 && fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return next;
    });
    setReferenceImages((prev) => prev.filter((_, currentIndex) => currentIndex !== index));
  }, []);

  const handleContinueEdit = useCallback(async (conversationId: string, image: StoredImage | StoredReferenceImage) => {
    try {
      const nextReference =
        "dataUrl" in image
          ? {
              referenceImage: image,
              file: dataUrlToFile(image.dataUrl, image.name, image.type),
            }
          : await buildReferenceImageFromStoredImage(image, `conversation-${conversationId}-${Date.now()}.png`);
      if (!nextReference) {
        return;
      }

      setSelectedConversationId(conversationId);
      setReferenceImages((prev) => [...prev, nextReference.referenceImage]);
      setReferenceImageFiles((prev) => [...prev, nextReference.file]);
      setImagePrompt("");
      textareaRef.current?.focus();
      toast.success("已加入当前参考图，继续输入描述即可编辑");
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取结果图失败";
      toast.error(message);
    }
  }, []);

  const openLightbox = useCallback((images: ImageLightboxItem[], index: number) => {
    if (images.length === 0) {
      return;
    }
    setLightboxImages(images);
    setLightboxIndex(Math.max(0, Math.min(index, images.length - 1)));
    setLightboxOpen(true);
  }, []);

  const handleSubmit = useCallback(async () => {
    const prompt = imagePrompt.trim();
    if (!prompt) {
      toast.error("请输入提示词");
      return;
    }
    const effectiveImageMode: ImageConversationMode = referenceImageFiles.length > 0 ? "edit" : "generate";
    const targetConversation = selectedConversationId
      ? conversationsRef.current.find((conversation) => conversation.id === selectedConversationId) ?? null
      : null;
    const now = new Date().toISOString();
    const conversationId = targetConversation?.id ?? createId();
    const turnId = createId();
    const draftTurn: ImageTurn = {
      id: turnId,
      taskId: turnId,
      prompt,
      model: "gpt-image-2",
      mode: effectiveImageMode,
      referenceImages: effectiveImageMode === "edit" ? referenceImages : [],
      count: parsedCount,
      size: imageSize,
      images: Array.from({ length: parsedCount }, (_, index) => ({
        id: `${turnId}-${index}`,
        status: "loading",
      })),
      createdAt: now,
      status: "queued",
    };

    const baseConversation: ImageConversation = targetConversation
      ? {
          ...targetConversation,
          updatedAt: now,
          turns: [...targetConversation.turns, draftTurn],
        }
      : {
          id: conversationId,
          title: buildConversationTitle(prompt),
          createdAt: now,
          updatedAt: now,
          turns: [draftTurn],
        };

    setSelectedConversationId(conversationId);
    clearComposerInputs();
    await persistConversation(baseConversation);

    try {
      const conversationTitle = targetConversation?.title || buildConversationTitle(prompt);
      const task = effectiveImageMode === "edit"
        ? await createImageEditTask(turnId, referenceImageFiles, prompt, parsedCount, imageSize || undefined, conversationId, conversationTitle)
        : await createImageGenerationTask(turnId, prompt, parsedCount, imageSize || undefined, conversationId, conversationTitle);
      await updateConversation(conversationId, (current) => {
        const conversation = current ?? baseConversation;
        return {
          ...conversation,
          updatedAt: new Date().toISOString(),
          turns: conversation.turns.map((turn) => (turn.id === draftTurn.id ? applyTaskToTurn(turn, task) : turn)),
        };
      });
      if (!targetConversation) {
        toast.success("已创建新对话并开始处理");
      } else {
        toast.success("已发送到当前对话");
      }
      void syncPendingTasks();
    } catch (error) {
      const message = error instanceof Error ? error.message : "生成图片失败";
      await updateConversation(conversationId, (current) => {
        const conversation = current ?? baseConversation;
        return {
          ...conversation,
          updatedAt: new Date().toISOString(),
          turns: conversation.turns.map((turn) => (turn.id === draftTurn.id ? markTurnError(turn, message) : turn)),
        };
      });
      toast.error(message);
    }
  }, [imagePrompt, referenceImageFiles, selectedConversationId, referenceImages, parsedCount, imageSize, clearComposerInputs, persistConversation, updateConversation, syncPendingTasks]);

  return (
    <>
      <section className="mx-auto grid h-[calc(100dvh-6.25rem)] min-h-0 w-full max-w-[1380px] grid-cols-1 gap-2 px-0 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] sm:h-[calc(100dvh-5rem)] sm:gap-3 sm:px-3 sm:pb-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <div className="hidden h-full min-h-0 border-r border-stone-200/70 pr-3 lg:block">
          <ImageSidebar
            conversations={conversations}
            isLoadingHistory={isLoadingHistory}
            selectedConversationId={selectedConversationId}
            onCreateDraft={handleCreateDraft}
            onClearHistory={openClearHistoryConfirm}
            onSelectConversation={setSelectedConversationId}
            onDeleteConversation={openDeleteConversationConfirm}
            formatConversationTime={formatConversationTime}
          />
        </div>

        <Dialog open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
          <DialogContent className="flex h-[min(82dvh,760px)] w-[92vw] max-w-[460px] flex-col overflow-hidden rounded-[32px] border-white/80 bg-white p-0 shadow-[0_32px_110px_-38px_rgba(15,23,42,0.45)] sm:rounded-[36px]">
            <DialogHeader className="px-6 pb-4 pt-7 sm:px-8">
              <DialogTitle className="flex items-center gap-2 text-xl font-bold tracking-tight">
                <History className="size-5" />
                历史记录
              </DialogTitle>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8 sm:px-8">
              <ImageSidebar
                conversations={conversations}
                isLoadingHistory={isLoadingHistory}
                selectedConversationId={selectedConversationId}
                onCreateDraft={() => {
                  handleCreateDraft();
                  setIsHistoryOpen(false);
                }}
                onClearHistory={openClearHistoryConfirm}
                onSelectConversation={(id) => {
                  setSelectedConversationId(id);
                  setIsHistoryOpen(false);
                }}
                onDeleteConversation={openDeleteConversationConfirm}
                formatConversationTime={formatConversationTime}
                hideActionButtons
              />
            </div>
          </DialogContent>
        </Dialog>

        <div className="flex min-h-0 flex-col gap-2 sm:gap-4">
          <div className="flex items-center justify-between gap-2 px-1 lg:hidden">
            <Button
              variant="outline"
              className="h-10 flex-1 rounded-2xl border-stone-200 bg-white/90 text-stone-700 shadow-sm"
              onClick={() => setIsHistoryOpen(true)}
            >
              <History className="mr-2 size-4" />
              历史记录 ({conversations.length})
            </Button>
            <Button className="h-10 rounded-2xl bg-stone-950 text-white shadow-sm" onClick={handleCreateDraft}>
              <Plus className="size-4" />
              新建
            </Button>
            <Button
              variant="outline"
              className="h-10 rounded-2xl border-stone-200 bg-white/85 px-3 text-stone-600 shadow-sm"
              onClick={openClearHistoryConfirm}
              disabled={conversations.length === 0}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>

          <div ref={resultsViewportRef} className="hide-scrollbar min-h-0 flex-1 overflow-y-auto px-1 py-2 sm:px-4 sm:py-4">
            <ImageResults
              selectedConversation={selectedConversation}
              onOpenLightbox={openLightbox}
              onContinueEdit={handleContinueEdit}
              formatConversationTime={formatConversationTime}
            />
          </div>

          <ImageComposer
            prompt={imagePrompt}
            imageCount={imageCount}
            imageSize={imageSize}
            modelLabel="gpt-image-2"
            activeTaskCount={activeTaskCount}
            referenceImages={referenceImages}
            textareaRef={textareaRef}
            fileInputRef={fileInputRef}
            onPromptChange={setImagePrompt}
            onImageCountChange={(value) => setImageCount(value ? clampImageCount(value) : "")}
            onImageSizeChange={setImageSize}
            onSubmit={handleSubmit}
            onPickReferenceImage={() => fileInputRef.current?.click()}
            onReferenceImageChange={handleReferenceImageChange}
            onRemoveReferenceImage={handleRemoveReferenceImage}
          />
        </div>
      </section>

      <ImageLightbox
        images={lightboxImages}
        currentIndex={lightboxIndex}
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        onIndexChange={setLightboxIndex}
      />

      {deleteConfirm ? (
        <Dialog open onOpenChange={(open) => (!open ? setDeleteConfirm(null) : null)}>
          <DialogContent showCloseButton={false} className="rounded-2xl p-6">
            <DialogHeader className="gap-2">
              <DialogTitle>{deleteConfirmTitle}</DialogTitle>
              <DialogDescription className="text-sm leading-6">
                {deleteConfirmDescription}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
                取消
              </Button>
              <Button className="bg-rose-600 text-white hover:bg-rose-700" onClick={() => void handleConfirmDelete()}>
                确认删除
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

export default function ImagePage() {
  const { isCheckingAuth, session } = useAuthGuard();

  if (isCheckingAuth || !session) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoaderCircle className="size-5 animate-spin text-stone-400" />
      </div>
    );
  }

  return <ImagePageContent />;
}
