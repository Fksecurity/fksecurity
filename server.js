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
app.use(express.static(join(__dirname, "public"))); // index.html 위치

// --- GitHub 파일 업로드 함수 ---
async function uploadFileToGitHub(filepath, repoPath, commitMsg) {
  try {
    const contentRaw = await fs.readFile(filepath, "utf-8");
    const contentEncoded = Buffer.from(contentRaw).toString("base64");

    // 기존 sha 조회 (있으면 업데이트, 없으면 신규)
    let sha;
    const shaRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${repoPath}`, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json"
      }
    });
    if (shaRes.ok) {
      const json = await shaRes.json();
      sha = json.sha;
    }

    // 파일 업로드
    const uploadRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${repoPath}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        "Content-Type": "application/json",
        Accept: "application/vnd.github+json"
      },
      body: JSON.stringify({
        message: commitMsg,
        content: contentEncoded,
        branch: GITHUB_BRANCH,
        ...(sha ? { sha } : {})
      })
    });

    const uploadJson = await uploadRes.json();
    if (uploadRes.ok) {
      console.log(`✅ GitHub 업로드 성공: ${uploadJson.commit.html_url}`);
      return true;
    } else {
      console.error("❌ GitHub 업로드 실패:", uploadJson.message);
      return false;
    }
  } catch (err) {
    console.error("❌ GitHub 업로드 예외:", err.message);
    return false;
  }
}

// --- 바코드 생성 API ---
app.post("/next-barcode", async (req, res) => {
  console.log("📥 [API] POST /next-barcode");
  const { prefix, count = 1 } = req.body;
  if (!prefix) return res.status(400).json({ error: "prefix is required" });

  // prefix 끝 하이픈 자동 붙임 (프론트와 맞춤)
  const prefixWithHyphen = prefix.endsWith("-") ? prefix : prefix + "-";

  // db 읽기
  const db = await fs.readJson(DB_FILE).catch(() => ({}));
  let current = db[prefixWithHyphen] || 0;

  // 번호 생성 & 999 초과 체크
  if (current + count > 999) {
    return res.status(400).json({ error: "❌ 임의번호 999 초과, 새로운 주/야 코드를 설정하세요." });
  }

  const result = [];
  for (let i = 1; i <= count; i++) {
    result.push(`${prefixWithHyphen}${current + i}`);
  }

  db[prefixWithHyphen] = current + count;

  // db 저장
  await fs.writeJson(DB_FILE, db, { spaces: 2 });

  // GitHub 업로드
  await uploadFileToGitHub(DB_FILE, BARCODES_GITHUB_FILE, `📦 ${prefixWithHyphen} → ${db[prefixWithHyphen]} (API Upload at ${new Date().toISOString()})`);

  res.json({ barcodes: result });
});

// --- 설정 저장 API ---
app.post("/save-settings", async (req, res) => {
  try {
    const data = req.body;
    if (!data) return res.status(400).json({ error: "Invalid body" });

    await fs.writeJson(SETTINGS_FILE, data, { spaces: 2 });
    console.log("💾 설정 저장 완료");

    await uploadFileToGitHub(SETTINGS_FILE, SETTINGS_GITHUB_FILE, `🛠️ Settings Updated at ${new Date().toISOString()}`);

    res.json({ status: "ok" });
  } catch (err) {
    console.error("❌ 설정 저장 실패:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// --- 설정 불러오기 API ---
app.get("/load-settings", async (req, res) => {
  try {
    const data = await fs.readJson(SETTINGS_FILE);
    res.json(data);
  } catch (err) {
    console.warn("⚠️ 설정 로드 실패 (기본값 사용)");
    res.json({});
  }
});

// --- 서버 시작 ---
app.listen(PORT, () => {
  console.log(`✅ Barcode server running on port ${PORT}`);
});