import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Buffer } from "node:buffer";
import pdfParse from "npm:pdf-parse@1.1.1/lib/pdf-parse.js";

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

    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const ext = fileName.split(".").pop()?.toLowerCase() ?? "";

    let extractedText = "";

    if (ext === "txt") {
      extractedText = new TextDecoder("utf-8").decode(bytes);
    } else if (ext === "pdf") {
      extractedText = await extractPdfWithFallback(bytes, fileName);
    } else if (ext === "docx") {
      extractedText = await extractTextFromDocx(bytes);
    } else if (ext === "xlsx") {
      extractedText = await extractTextFromXlsx(bytes);
    } else {
      extractedText = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    }

    // Final quality check
    const trimmed = extractedText.trim();
    if (!trimmed || trimmed.length < 20) {
      extractedText = `[Uploaded file: ${fileName}] The document text could not be extracted from this file format. Please analyze based on any readable text available and note extraction limitations.`;
    } else {
      extractedText = trimmed;
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

    // Generate structured summary via fast LLM
    let extractedSummary: string | null = null;
    if (extractedText.length >= 50 && !extractedText.startsWith("[Uploaded file:")) {
      try {
        extractedSummary = await generateSummary(extractedText, fileName);
        console.log(`Summary generated: ${extractedSummary?.length ?? 0} chars for ${fileName}`);
      } catch (summaryErr) {
        console.error("Summary generation failed, using fallback:", summaryErr);
        extractedSummary = extractedText.slice(0, 5000);
      }
    }

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
        extracted_summary: extractedSummary,
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
 * Two-stage PDF extraction:
 * 1. Try native text extraction with pdf-parse
 * 2. If quality is poor (scanned PDF), fall back to Vision AI OCR
 */
/**
 * Generate a structured summary of extracted text using a fast LLM
 */
async function generateSummary(text: string, fileName: string): Promise<string> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) {
    console.warn("LOVABLE_API_KEY not set, falling back to truncated text");
    return text.slice(0, 5000);
  }

  // Send at most 40k chars to the summarizer
  const inputText = text.length > 40000 ? text.slice(0, 40000) : text;

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-lite",
      messages: [
        {
          role: "system",
          content: "You are a document summarization assistant. Extract structured summaries that preserve all quantitative data.",
        },
        {
          role: "user",
          content: `Extract a structured summary of this document (filename: ${fileName}). Include:
- Document type and title
- Key parties/entities mentioned
- All dollar amounts, costs, totals, and financial figures
- Important dates and deadlines
- Scope of work or key deliverables
- Notable terms, conditions, or warnings
- Any tables of data (preserve the numbers)

Be thorough with numbers and dates. Omit boilerplate, headers, and formatting.
Keep the summary under 4000 characters.

DOCUMENT TEXT:
${inputText}`,
        },
      ],
      max_tokens: 4000,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Summary API error ${response.status}: ${errText}`);
  }

  const result = await response.json();
  const summary = result.choices?.[0]?.message?.content || "";
  if (!summary || summary.length < 20) {
    return text.slice(0, 5000);
  }
  return summary;
}

async function extractPdfWithFallback(bytes: Uint8Array, fileName: string): Promise<string> {
  // Stage 1: Native extraction
  try {
    const data = await pdfParse(Buffer.from(bytes));
    const text = data.text || "";
    const letterCount = (text.match(/[a-zA-Z]/g) || []).length;

    console.log(`PDF native extraction: ${text.length} chars, ${letterCount} letters for ${fileName}`);

    if (text.length > 200 && letterCount > 50) {
      return text;
    }

    console.log("Native extraction quality poor, attempting Vision OCR fallback...");
  } catch (err) {
    console.error("pdf-parse failed:", err);
  }

  // Stage 2: Vision AI OCR fallback via Lovable AI Gateway
  try {
    return await extractPdfWithVisionAI(bytes, fileName);
  } catch (err) {
    console.error("Vision OCR fallback failed:", err);
    return `[Uploaded file: ${fileName}] PDF text extraction failed. The document may be image-based or encrypted.`;
  }
}

/**
 * Send PDF directly to Gemini via Lovable AI Gateway for OCR extraction
 */
async function extractPdfWithVisionAI(bytes: Uint8Array, fileName: string): Promise<string> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) {
    throw new Error("LOVABLE_API_KEY not configured");
  }

  // Convert PDF bytes to base64
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64Pdf = btoa(binary);

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Extract ALL text content from this PDF document verbatim. Preserve the document structure, headings, paragraphs, lists, and tables as closely as possible. Return only the extracted text, no commentary.",
            },
            {
              type: "image_url",
              image_url: {
                url: `data:application/pdf;base64,${base64Pdf}`,
              },
            },
          ],
        },
      ],
      max_tokens: 16000,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Vision API error ${response.status}: ${errText}`);
  }

  const result = await response.json();
  const extracted = result.choices?.[0]?.message?.content || "";

  console.log(`Vision OCR extracted ${extracted.length} chars for ${fileName}`);
  return extracted;
}

/**
 * DOCX text extraction — unzips and reads document.xml
 */
async function extractTextFromDocx(bytes: Uint8Array): Promise<string> {
  try {
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
