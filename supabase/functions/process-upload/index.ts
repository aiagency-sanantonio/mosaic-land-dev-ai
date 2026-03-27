import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAX_TEXT_LENGTH = 50_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const userId = formData.get("user_id") as string | null;
    const threadId = formData.get("thread_id") as string | null;
    const fileName = formData.get("file_name") as string | null;

    if (!file || !userId || !fileName) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: file, user_id, file_name" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extract text based on file type
    const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
    let extractedText = "";

    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    if (ext === "txt") {
      extractedText = new TextDecoder("utf-8").decode(bytes);
    } else if (ext === "pdf") {
      extractedText = extractTextFromPdf(bytes);
    } else if (ext === "docx") {
      extractedText = await extractTextFromDocx(bytes);
    } else if (ext === "xlsx") {
      extractedText = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      // For XLSX (ZIP-based XML), try to pull shared strings
      extractedText = await extractTextFromXlsx(bytes);
    } else {
      // Fallback: try UTF-8 decode
      extractedText = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    }

    // Truncate
    if (extractedText.length > MAX_TEXT_LENGTH) {
      extractedText = extractedText.slice(0, MAX_TEXT_LENGTH);
    }

    // Upload file to storage
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const filePath = `${userId}/${threadId ?? "no-thread"}/${Date.now()}_${fileName}`;
    await supabase.storage.from("user-uploads").upload(filePath, bytes, {
      contentType: file.type || "application/octet-stream",
    });

    // Insert into user_uploads
    const { data, error } = await supabase
      .from("user_uploads")
      .insert({
        user_id: userId,
        thread_id: threadId || null,
        file_name: fileName,
        file_path: filePath,
        file_size_bytes: bytes.length,
        status: "ready",
        extracted_text: extractedText,
      })
      .select("id")
      .single();

    if (error) {
      console.error("DB insert error:", error);
      return new Response(
        JSON.stringify({ error: "Failed to save upload record" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        upload_id: data.id,
        preview: extractedText.slice(0, 200),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("process-upload error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

/**
 * Basic PDF text extraction — pulls text from stream objects.
 * Not a full PDF parser but handles most text-based PDFs.
 */
function extractTextFromPdf(bytes: Uint8Array): string {
  const raw = new TextDecoder("latin1").decode(bytes);
  const textParts: string[] = [];

  // Extract text between BT and ET operators (text objects)
  const btEtRegex = /BT\s([\s\S]*?)ET/g;
  let match;
  while ((match = btEtRegex.exec(raw)) !== null) {
    const block = match[1];
    // Extract text from Tj and TJ operators
    const tjRegex = /\(([^)]*)\)\s*Tj/g;
    let tjMatch;
    while ((tjMatch = tjRegex.exec(block)) !== null) {
      textParts.push(tjMatch[1]);
    }
    // TJ arrays
    const tjArrayRegex = /\[([^\]]*)\]\s*TJ/g;
    let arrMatch;
    while ((arrMatch = tjArrayRegex.exec(block)) !== null) {
      const inner = arrMatch[1];
      const strRegex = /\(([^)]*)\)/g;
      let strMatch;
      while ((strMatch = strRegex.exec(inner)) !== null) {
        textParts.push(strMatch[1]);
      }
    }
  }

  if (textParts.length === 0) {
    // Fallback: try to find any readable text sequences
    const readable = raw.replace(/[^\x20-\x7E\n\r\t]/g, " ").replace(/\s{3,}/g, " ").trim();
    return readable.slice(0, MAX_TEXT_LENGTH);
  }

  return textParts.join(" ").replace(/\\n/g, "\n").replace(/\\\(/g, "(").replace(/\\\)/g, ")");
}

/**
 * DOCX text extraction — unzips and reads document.xml
 */
async function extractTextFromDocx(bytes: Uint8Array): Promise<string> {
  try {
    // DOCX is a ZIP containing word/document.xml
    const entries = await unzipEntries(bytes);
    const docEntry = entries.find((e) => e.name === "word/document.xml");
    if (!docEntry) return "[Could not extract DOCX content]";

    const xml = new TextDecoder("utf-8").decode(docEntry.data);
    // Strip XML tags to get text
    return xml
      .replace(/<w:p[^>]*>/g, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } catch {
    return "[Could not extract DOCX content]";
  }
}

/**
 * XLSX text extraction — pulls shared strings from ZIP
 */
async function extractTextFromXlsx(bytes: Uint8Array): Promise<string> {
  try {
    const entries = await unzipEntries(bytes);
    const ssEntry = entries.find((e) => e.name === "xl/sharedStrings.xml");
    if (!ssEntry) return "[Could not extract XLSX content]";

    const xml = new TextDecoder("utf-8").decode(ssEntry.data);
    return xml
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return "[Could not extract XLSX content]";
  }
}

/**
 * Minimal ZIP decompression for DOCX/XLSX files.
 * Parses local file headers and extracts stored/deflated entries.
 */
async function unzipEntries(
  bytes: Uint8Array
): Promise<Array<{ name: string; data: Uint8Array }>> {
  const entries: Array<{ name: string; data: Uint8Array }> = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;

  while (offset < bytes.length - 4) {
    const sig = view.getUint32(offset, true);
    if (sig !== 0x04034b50) break; // Not a local file header

    const compressionMethod = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const uncompressedSize = view.getUint32(offset + 22, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);

    const nameBytes = bytes.slice(offset + 30, offset + 30 + nameLen);
    const name = new TextDecoder("utf-8").decode(nameBytes);

    const dataStart = offset + 30 + nameLen + extraLen;
    const rawData = bytes.slice(dataStart, dataStart + compressedSize);

    if (compressionMethod === 0) {
      // Stored
      entries.push({ name, data: rawData });
    } else if (compressionMethod === 8) {
      // Deflated
      try {
        const ds = new DecompressionStream("deflate-raw");
        const writer = ds.writable.getWriter();
        writer.write(rawData);
        writer.close();
        const reader = ds.readable.getReader();
        const chunks: Uint8Array[] = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        const total = chunks.reduce((a, c) => a + c.length, 0);
        const result = new Uint8Array(total);
        let pos = 0;
        for (const chunk of chunks) {
          result.set(chunk, pos);
          pos += chunk.length;
        }
        entries.push({ name, data: result });
      } catch {
        // Skip entries we can't decompress
      }
    }

    offset = dataStart + compressedSize;
  }

  return entries;
}
