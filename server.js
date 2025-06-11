import express from "express";
import fs from "fs-extra";
import cors from "cors";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";
import { Buffer } from "buffer";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_FILE = join(__dirname, "barcodes.json");
const SETTINGS_FILE = join(__dirname, "load-settings.json");

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = "Fksecurity/fksecurity";
const GITHUB_BRANCH = "main";
const BARCODES_GITHUB_FILE = "barcodes.json";
const SETTINGS_GITHUB_FILE = "load-settings.json";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, "public"))); // index.html 경로

// ✅ 바코드 생성 및 저장 API
app.post("/next-barcode", async (req, res) => {
  console.log("📥 [API] POST /next-barcode");

  const { prefix, count = 1 } = req.body;
  if (!prefix) {
    console.warn("⚠️ prefix 미입력");
    return res.status(400).json({ error: "prefix is required" });
  }

  const db = await fs.readJson(DB_FILE).catch(() => ({}));
  let current = db[prefix] || 0;
  const result = [];

  for (let i = 1; i <= count; i++) {
    const next = current + i;
    if (next > 999) {
      console.error("❌ 임의번호 999 초과");
      return res.status(400).json({ error: "❌ 임의번호 999 초과, 새로운 주/야 코드를 설정하세요." });
    }
    result.push(`${prefix}${next}`);
  }

  db[prefix] = current + count;
  await fs.writeJson(DB_FILE, db, { spaces: 2 });
  console.log("💾 barcodes.json 저장됨:", db);

  // ✅ GitHub 업로드
  await uploadToGitHub(BARCODES_GITHUB_FILE, DB_FILE, `📦 ${prefix} → ${db[prefix]}`);

  res.json({ barcodes: result });
});

// ✅ 설정 저장 API (+ GitHub 연동)
app.post("/save-settings", async (req, res) => {
  try {
    const data = req.body;
    if (!data) return res.status(400).json({ error: "Invalid body" });
    await fs.writeJson(SETTINGS_FILE, data, { spaces: 2 });
    console.log("💾 설정 저장 완료");

    await uploadToGitHub(SETTINGS_GITHUB_FILE, SETTINGS_FILE, `🛠️ Settings Updated`);

    res.json({ status: "ok" });
  } catch (err) {
    console.error("❌ 설정 저장 실패:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ 설정 불러오기
app.get("/load-settings", async (req, res) => {
  try {
    const data = await fs.readJson(SETTINGS_FILE);
    res.json(data);
  } catch (err) {
    console.warn("⚠️ 설정 로드 실패 (기본값 사용)");
    res.json({});
  }
});

// ✅ GitHub 업로드 함수
async function uploadToGitHub(filename, localPath, message) {
  try {
    const contentRaw = await fs.readFile(localPath, "utf-8");
    const contentEncoded = Buffer.from(contentRaw).toString("base64");

    const shaRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${filename}`, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json"
      }
    });

    let sha;
    if (shaRes.ok) {
      const json = await shaRes.json();
      sha = json.sha;
    }

    const uploadRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${filename}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        "Content-Type": "application/json",
        Accept: "application/vnd.github+json"
      },
      body: JSON.stringify({
        message: `${message} (at ${new Date().toISOString()})`,
        content: contentEncoded,
        branch: GITHUB_BRANCH,
        ...(sha ? { sha } : {})
      })
    });

    const result = await uploadRes.json();
    if (uploadRes.ok) {
      console.log(`✅ GitHub 업로드 성공: ${filename}`);
    } else {
      console.error(`❌ GitHub 업로드 실패 [${filename}]:`, result.message);
    }
  } catch (err) {
    console.error(`❌ GitHub 업로드 예외 [${filename}]:`, err.message);
  }
}

// ✅ 서버 실행
app.listen(PORT, () => {
  console.log(`✅ Barcode server running on port ${PORT}`);
});
