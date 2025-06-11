import express from "express";
import fs from "fs-extra";
import cors from "cors";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

// 📦 현재 파일 위치 기준 경로 계산
const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_FILE = join(__dirname, "barcodes.json");

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ 미들웨어 설정
app.use(cors());
app.use(express.json());

// ✅ 정적 파일 서빙 (public 폴더 안의 HTML, CSS, JS 등)
app.use(express.static(join(__dirname, "public")));

// ✅ 바코드 생성 API
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

  res.json({ barcodes: result });
});

// ✅ 서버 시작
app.listen(PORT, () => {
  console.log(`✅ Barcode server running on port ${PORT}`);
});
