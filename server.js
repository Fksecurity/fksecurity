import express from "express";
import fs from "fs-extra";
import cors from "cors";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import simpleGit from "simple-git";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_FILE = join(__dirname, "barcodes.json");

// ✅ Git 초기화 및 사용자 정보 설정
const git = simpleGit();
await git.addConfig("user.name", "fksecurity-bot");
await git.addConfig("user.email", "fksecurity@render.com");

// ✅ GitHub Remote URL은 환경변수에서만 사용
const REMOTE_URL = process.env.GIT_REMOTE_URL;

// ✅ Git remote 등록 (없을 경우만)
const remotes = await git.getRemotes(true);
if (!remotes.find(r => r.name === "origin") && REMOTE_URL) {
  await git.addRemote("origin", REMOTE_URL);
  console.log("🔗 origin remote 연결 완료:", REMOTE_URL);
} else {
  console.log("📡 현재 Git remotes:", remotes.map(r => r.refs.fetch));
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, "public"))); // index.html 정적 제공

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

  // ✅ GitHub 자동 커밋/푸시
  try {
    if (REMOTE_URL) {
      await git.add(DB_FILE);
      const status = await git.status();
      if (status.files.length > 0) {
        console.log("📂 Git 변경사항 감지됨:", status.files.map(f => f.path));
        await git.commit(`🔄 ${prefix} → ${db[prefix]} (Auto push at ${new Date().toISOString()})`);
        await git.push("origin", "main");
        console.log("🚀 GitHub push 완료");
      } else {
        console.log("🟡 Git 변경사항 없음 → push 생략");
      }
    } else {
      console.warn("⚠️ REMOTE_URL 미설정 → GitHub push 생략됨");
    }
  } catch (err) {
    console.error("❌ GitHub push 실패:", err.message);
  }

  res.json({ barcodes: result });
});

// ✅ 서버 실행
app.listen(PORT, () => {
  console.log(`✅ Barcode server running on port ${PORT}`);
});
