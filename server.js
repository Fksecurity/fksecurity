import express from "express";
import fs from "fs-extra";
import cors from "cors";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import simpleGit from "simple-git";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_FILE = join(__dirname, "barcodes.json");

// ✅ Git 초기화
const git = simpleGit();
await git.addConfig("user.name", "fksecurity-bot");
await git.addConfig("user.email", "fksecurity@render.com");

const REMOTE_URL = process.env.GIT_REMOTE_URL;

// ✅ origin 연결 상태 로그
const remotes = await git.getRemotes(true);
console.log("📡 현재 Git remotes:", remotes);

if (!remotes.find(r => r.name === "origin") && REMOTE_URL) {
  await git.addRemote("origin", REMOTE_URL);
  console.log("🔗 origin remote 연결됨:", REMOTE_URL);
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, "public"))); // index.html 서빙

// ✅ 바코드 생성 API
app.post("/next-barcode", async (req, res) => {
  console.log("📥 [API 호출] POST /next-barcode");
  const { prefix, count = 1 } = req.body;
  console.log("📨 prefix:", prefix, "| count:", count);

  if (!prefix) {
    console.warn("⚠️ prefix 미입력");
    return res.status(400).json({ error: "prefix is required" });
  }

  const db = await fs.readJson(DB_FILE).catch(() => {
    console.log("📁 barcodes.json 없음 → 새로 생성");
    return {};
  });

  let current = db[prefix] || 0;
  const result = [];

  for (let i = 1; i <= count; i++) {
    const next = current + i;
    if (next > 999) {
      console.error("❌ 999 초과");
      return res.status(400).json({ error: "❌ 임의번호 999 초과, 새로운 주/야 코드를 설정하세요." });
    }
    result.push(`${prefix}${next}`);
  }

  db[prefix] = current + count;
  console.log("📦 저장될 barcodes.json 데이터:", db);

  try {
    await fs.writeJson(DB_FILE, db, { spaces: 2 });
    console.log("💾 barcodes.json 저장 완료");
  } catch (err) {
    console.error("❌ 파일 저장 실패:", err.message);
  }

  // ✅ GitHub push 시도
  try {
    if (REMOTE_URL) {
      await git.add(DB_FILE);
      await git.commit(`🔄 ${prefix} → ${db[prefix]} (Auto push at ${new Date().toISOString()})`);
      await git.push("origin", "main");
      console.log("🚀 GitHub에 push 완료");
    } else {
      console.warn("⚠️ REMOTE_URL 미설정 → push 생략");
    }
  } catch (err) {
    console.error("❌ GitHub push 실패:", err.message);
  }

  res.json({ barcodes: result });
});

// ✅ 서버 시작
app.listen(PORT, () => {
  console.log(`✅ Barcode server running on port ${PORT}`);
});
