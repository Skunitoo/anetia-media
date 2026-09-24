import Busboy from "busboy";
import { put } from "@vercel/blob";

export const config = {
  api: { bodyParser: false }
};

function collectFile(req) {
  return new Promise((resolve, reject) => {
    const bb = Busboy({ headers: req.headers });

    let found = false;
    let fileBuffer = Buffer.alloc(0);
    let originalName = "upload.bin";
    let mimeType = "application/octet-stream";
    let folder = "uploads";
    let requestedName = "";

    bb.on("file", (fieldname, file, info) => {
      const { filename, mimeType: detectedMime } = info;

      if (fieldname !== "file") {
        file.resume();
        return;
      }

      found = true;
      originalName = filename || originalName;
      mimeType = detectedMime || mimeType;

      file.on("data", chunk => {
        fileBuffer = Buffer.concat([fileBuffer, chunk]);
      });
    });

    bb.on("field", (name, value) => {
      if (name === "folder" && value) folder = value;
      if (name === "filename" && value) requestedName = value;
    });

    bb.on("finish", () => {
      if (!found || fileBuffer.length === 0) {
        reject(new Error("No file field received"));
        return;
      }

      const safeName = (requestedName || originalName)
        .normalize("NFKD")
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "") || `upload-${Date.now()}`;

      resolve({
        buffer: fileBuffer,
        fileName: `${folder}/${Date.now()}-${safeName}`,
        mimeType
      });
    });

    bb.on("error", reject);
    req.pipe(bb);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const auth = req.headers.authorization || "";
    const expected = process.env.UPLOAD_TOKEN;

    if (!expected) {
      return res.status(500).json({ ok: false, error: "Missing UPLOAD_TOKEN env" });
    }

    if (auth !== `Bearer ${expected}`) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const { buffer, fileName, mimeType } = await collectFile(req);

    const blob = await put(fileName, buffer, {
      access: "public",
      contentType: mimeType,
      addRandomSuffix: false,
      token: process.env.ANETIA_READ_WRITE_TOKEN
    });

    return res.status(200).json({
      ok: true,
      url: blob.url,
      downloadUrl: blob.downloadUrl,
      pathname: blob.pathname,
      contentType: mimeType
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message || "Upload failed"
    });
  }
}
