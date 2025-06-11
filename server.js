import express from "express";
import fs from "fs-extra";
import cors from "cors";
import dotenv from "dotenv";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import simpleGit from "simple-git";

// ✅ Git 초기화
const git = simpleGit();

// ✅ 사용자 정보 세팅
await git.addConfig("user.name", "fksecurity-bot");
await git.addConfig("user.email", "fksecurity@render.com");

// ✅ 환경변수로부터 remote 주소 로드
const REMOTE_URL = process.env.GIT_REMOTE_URL;

// ✅ origin 연결이 없으면 자동 연결
const remotes = await git.getRemotes(true);
if (!remotes.find(r => r.name === "origin") && REMOTE_URL) {
  await git.addRemote("origin", REMOTE_URL);
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, "public"))); // index.html 서빙

// ✅ 바코드 생성 API
app.post("/next-barcode", async (req, res) => {
  const { prefix, count = 1 } = req.body;

  if (!prefix) return res.status(400).json({ error: "prefix is required" });

  const db = await fs.readJson(DB_FILE).catch(() => ({}));
  let current = db[prefix] || 0;
  const result = [];

  for (let i = 1; i <= count; i++) {
    const next = current + i;
    if (next > 999) {
      return res.status(400).json({ error: "❌ 임의번호 999 초과, 새로운 주/야 코드를 설정하세요." });
    }
    result.push(`${prefix}${next}`);
  }

  db[prefix] = current + count;
  await fs.writeJson(DB_FILE, db, { spaces: 2 });

  // ✅ GitHub push 시도
  try {
    if (REMOTE_URL) {
      await git.add(DB_FILE);
      await git.commit(`🔄 ${prefix} → ${db[prefix]} (Auto push at ${new Date().toISOString()})`);
      await git.push("origin", "main");
      console.log("✅ GitHub에 push 완료");
    } else {
      console.log("⚠️ REMOTE_URL이 설정되지 않아 push 생략");
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
