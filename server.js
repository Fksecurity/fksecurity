import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase 연결
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.use(cors());
app.use(express.json());
app.use(express.static("public")); // index.html 위치

// 바코드 요청 큐
const requestQueue = [];

async function processQueue() {
  if (requestQueue.length === 0) return;

  const { prefix, count, res, timeout } = requestQueue[0];
  const prefixKey = prefix.endsWith("-") ? prefix : prefix + "-";

  try {
    // Supabase에서 현재 last_number 조회
    const { data, error } = await supabase
      .from("barcode_sequences")
      .select("last_number")
      .eq("id", prefixKey)
      .single();

    if (error && error.code !== "PGRST116") throw error;

    const last = data?.last_number || 0;

    if (last + count > 999) {
      res.status(400).json({ error: "❌ 임의번호 999 초과, 새로운 주/야 코드를 설정하세요." });
      requestQueue.shift();
      clearTimeout(timeout);
      processQueue();
      return;
    }

    const nextStart = last + 1;
    const nextEnd = last + count;
    const barcodes = Array.from({ length: count }, (_, i) => `${prefixKey}${nextStart + i}`);

    // Supabase 업데이트
    const { error: upsertError } = await supabase
      .from("barcode_sequences")
      .upsert([{ id: prefixKey, last_number: nextEnd, updated_at: new Date().toISOString() }]);

    if (upsertError) throw upsertError;

    res.json({ barcodes });

  } catch (err) {
    console.error("❌ 큐 처리 중 에러:", err.message);
    res.status(500).json({ error: "서버 처리 오류" });
  } finally {
    clearTimeout(requestQueue[0].timeout);
    requestQueue.shift();
    processQueue();
  }
}

// 바코드 API
app.post("/next-barcode", (req, res) => {
  const { prefix, count = 1 } = req.body;
  if (!prefix || typeof count !== "number") {
    return res.status(400).json({ error: "Invalid prefix or count" });
  }

  const timeout = setTimeout(() => {
    console.warn("⏱️ 응답 타임아웃 발생 (큐 제거)");
    res.status(504).json({ error: "응답 지연으로 실패" });
    const idx = requestQueue.findIndex(q => q.res === res);
    if (idx !== -1) requestQueue.splice(idx, 1);
    processQueue();
  }, 10000);

  requestQueue.push({ prefix, count, res, timeout });
  if (requestQueue.length === 1) processQueue();
});

// 설정 저장
import fs from "fs-extra";
import path from "path";
const SETTINGS_FILE = path.join(process.cwd(), "load-settings.json");

app.post("/save-settings", async (req, res) => {
  try {
    const data = req.body;
    if (!data) return res.status(400).json({ error: "Invalid body" });

    await fs.writeJson(SETTINGS_FILE, data, { spaces: 2 });
    console.log("💾 설정 저장 완료");

    res.json({ status: "ok" });
  } catch (err) {
    console.error("❌ 설정 저장 실패:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/load-settings", async (req, res) => {
  try {
    const data = await fs.readJson(SETTINGS_FILE);
    res.json(data);
  } catch (err) {
    console.warn("⚠️ 설정 로드 실패 (기본값 사용)");
    res.json({});
  }
});

// 서버 실행
app.listen(PORT, () => {
  console.log(`✅ Supabase 바코드 서버 실행 중 - 포트 ${PORT}`);
});