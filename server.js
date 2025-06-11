import express from "express";
import fs from "fs-extra";
import cors from "cors";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import simpleGit from "simple-git"; // ✅ 추가

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_FILE = join(__dirname, "barcodes.json");

const app = express();
const PORT = process.env.PORT;
const git = simpleGit(); // ✅ Git 인스턴스 생성

app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, "public")));

app.post("/next-barcode", async (req, res) => {
  const { prefix, count = 1 } = req.body;

  if (!prefix) {
    return res.status(400).json({ error: "prefix is required" });
  }

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

  // ✅ GitHub 자동 push
  try {
    await git.add(DB_FILE);
    await git.commit(`🔄 ${prefix} → ${db[prefix]} (Auto push at ${new Date().toISOString()})`);
    await git.push();
    console.log("✅ GitHub에 push 완료");
  } catch (err) {
    console.error("❌ GitHub push 실패:", err.message);
  }

  res.json({ barcodes: result });
});

app.listen(PORT, () => {
  console.log(`✅ Barcode server running on port ${PORT}`);
});

