import type { AppUserInput } from "../types/app-server";

export type ComposerImageAttachment = {
  id: string;
  name: string;
  mimeType: string;
  base64: string;
  uri?: string;
};

export function buildComposerInput({
  text,
  images,
}: {
  text: string;
  images: ComposerImageAttachment[];
}): AppUserInput[] {
  const input: AppUserInput[] = [];
  const trimmedText = text.trim();

  if (trimmedText) {
    input.push({ type: "text", text: trimmedText, text_elements: [] });
  }

  for (const image of images) {
    input.push({ type: "image", url: createImageDataUrl(image) });
  }

  return input;
}

export function createImageDataUrl({
  mimeType,
  base64,
}: {
  mimeType: string | null | undefined;
  base64: string;
}) {
  const normalizedMimeType = mimeType?.trim() || "image/jpeg";
  return `data:${normalizedMimeType};base64,${base64}`;
}
