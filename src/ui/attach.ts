// Getting material into a brief: files, photos and videos from the phone, a web link, or the clipboard.
// Everything is read on the phone. Text goes to every agent; images / PDFs / video go to an agent that can see them.
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";
import { type Attachment, htmlToText, kindOf, mimeFor, officeToText, utf8 } from "../core/material";

const MAX_BINARY = 18 * 1024 * 1024; // inline limit most vendors accept
const MAX_TEXT_FILE = 5 * 1024 * 1024;
const id = () => Math.random().toString(36).slice(2, 10);

async function bytesOf(uri: string): Promise<Uint8Array> {
  if (Platform.OS === "web") return new Uint8Array(await (await fetch(uri)).arrayBuffer());
  return await new File(uri).bytes();
}
async function base64Of(uri: string): Promise<string> {
  if (Platform.OS === "web") {
    const b = await bytesOf(uri);
    let s = "";
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
    return btoa(s);
  }
  return await new File(uri).base64();
}

async function read(name: string, mime: string, uri: string, size: number): Promise<Attachment> {
  const kind = kindOf(name, mime);
  const base = { id: id(), name, mime, kind, size };
  if (kind === "unsupported") return base;
  if (kind === "text") {
    if (size > MAX_TEXT_FILE) throw new Error(`${name} is too large (max 5 MB of text).`);
    return { ...base, text: utf8(await bytesOf(uri)) };
  }
  if (kind === "office") return { ...base, text: officeToText(await bytesOf(uri), name) };
  if (size > MAX_BINARY)
    throw new Error(`${name} is ${Math.round(size / 1e6)} MB — the limit is 18 MB. Trim it first.`);
  return { ...base, base64: await base64Of(uri) };
}

export async function pickFiles(): Promise<Attachment[]> {
  const r = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true, type: "*/*" });
  if (r.canceled) return [];
  const out: Attachment[] = [];
  for (const a of r.assets) out.push(await read(a.name, mimeFor(a.name, a.mimeType), a.uri, a.size || 0));
  return out;
}

export async function pickMedia(camera = false): Promise<Attachment[]> {
  // Android uses the system Photo Picker, which needs no permission; iOS asks once for the library.
  const perm = camera
    ? await ImagePicker.requestCameraPermissionsAsync()
    : Platform.OS === "android"
      ? { granted: true }
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error(camera ? "Allow camera access in Settings." : "Allow photo access in Settings.");
  const opts: ImagePicker.ImagePickerOptions = {
    mediaTypes: ["images", "videos"],
    allowsMultipleSelection: !camera,
    quality: 0.7,
    videoMaxDuration: 120,
  };
  const r = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (r.canceled) return [];
  const out: Attachment[] = [];
  for (const a of r.assets) {
    const isVideo = a.type === "video";
    const name = a.fileName || (isVideo ? `video-${id()}.mp4` : `photo-${id()}.jpg`);
    // The picker re-encodes photos to JPEG; HEIC is never sent.
    const mime = isVideo ? mimeFor(name, a.mimeType || "video/mp4") : "image/jpeg";
    out.push(await read(name, mime, a.uri, a.fileSize || 0));
  }
  return out;
}

export async function fromLink(url: string): Promise<Attachment> {
  const u = url.trim();
  if (!/^https?:\/\/\S+$/.test(u)) throw new Error("Paste a full link starting with https://");
  let r: Response;
  try {
    r = await fetch(u, { signal: AbortSignal.timeout(20000) });
  } catch {
    throw new Error("Could not open that link.");
  }
  if (!r.ok) throw new Error(`The page answered HTTP ${r.status}.`);
  const type = r.headers.get("content-type") || "";
  const body = (await r.text()).slice(0, 2_000_000);
  const page = /html/.test(type) ? htmlToText(body) : { title: "", text: body };
  return {
    id: id(),
    name: page.title ? `${page.title.slice(0, 60)} — ${new URL(u).hostname}` : u,
    mime: "text/plain",
    kind: "link",
    size: page.text.length,
    text: `Source: ${u}\nFetched: ${new Date().toISOString().slice(0, 10)}\n\n${page.text.slice(0, 40000)}`,
  };
}

export async function fromClipboard(): Promise<Attachment | null> {
  const t = (await Clipboard.getStringAsync()).trim();
  if (!t) return null;
  if (/^https?:\/\/\S+$/.test(t)) return fromLink(t);
  return {
    id: id(),
    name: `Pasted text (${t.length} chars)`,
    mime: "text/plain",
    kind: "text",
    size: t.length,
    text: t,
  };
}
