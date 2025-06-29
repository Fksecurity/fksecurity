import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import fs from "fs-extra";
import path from "path";

const app = express();
const PORT = process.env.PORT || 3000;
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const SETTINGS_FILE = path.join(process.cwd(), "load-settings.json");

app.use(cors());
app.use(express.json());
app.use(express.static("public")); // index.html 위치

// ✅ 바코드 요청 큐
const requestQueue = [];

async function processQueue() {
  if (requestQueue.length === 0) return;

  const { prefix, count, res, modeLabel, week, timeout, idParts } = requestQueue[0];
  const prefixKey = prefix.endsWith("-") ? prefix : prefix + "-";

  try {
    console.log("📥 [REQ] 바코드 요청 받음 (큐)");
    console.log(" └─ Prefix:", prefix);
    console.log(" └─ Mode:", modeLabel);
    console.log(" └─ Count:", count);
    console.log(" └─ Week:", week);
    console.log(" └─ ID Parts:", idParts);

    const { data, error } = await supabase
      .from("barcode_sequence_v2")
      .select("*")
      .eq("id", prefix)
      .eq("week", week)
      .eq("mode", modeLabel)
      .order("daynightnum", { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== "PGRST116") throw error;

    if (!data) {
      const dayNightNum = modeLabel === "A" ? 0 : 5;
      const insert = await supabase
        .from("barcode_sequence_v2")
        .insert([{
          id: prefix,
          week,
          mode: modeLabel,
          daynightnum: dayNightNum,
          last_number: count,
          updated_at: new Date().toISOString()
        }]);

      if (insert.error) throw insert.error;

      const barcodes = Array.from({ length: count }, (_, i) =>
        `${prefix}-${week}${dayNightNum}-${i + 1}`
      );

      console.log("✅ 신규 바코드 생성:", barcodes);
      res.json({ barcodes });
      return;
    }

    let { daynightnum, last_number } = data;
    const dnMax = modeLabel === "A" ? 4 : 9;

    if (last_number + count <= 999) {
      const update = await supabase
        .from("barcode_sequence_v2")
        .update({
          last_number: last_number + count,
          updated_at: new Date().toISOString()
        })
        .eq("id", prefix)
        .eq("week", week)
        .eq("mode", modeLabel)
        .eq("daynightnum", daynightnum);

      if (update.error) throw update.error;

      const barcodes = Array.from({ length: count }, (_, i) =>
        `${prefix}-${week}${daynightnum}-${last_number + i + 1}`
      );

      console.log("✅ 이어서 바코드 생성:", barcodes);
      res.json({ barcodes });
      return;
    }

    const nextDN = daynightnum + 1;
    if (nextDN > dnMax) {
      console.error("🛑 주야코드 초과! 더 이상 생성 불가");
      res.status(409).json({ error: "주야코드 초과" });
      return;
    }

    await supabase
      .from("barcode_sequence_v2")
      .upsert({
        id: prefix,
        week,
        mode: modeLabel,
        daynightnum: nextDN,
        last_number: count,
        updated_at: new Date().toISOString()
      }, {
        onConflict: "id,week,mode,daynightnum"
      });

    const barcodes = Array.from({ length: count }, (_, i) =>
      `${prefix}-${week}${nextDN}-${i + 1}`
    );

    console.log("✅ 증가된 주야코드로 바코드 생성:", barcodes);
    res.json({ barcodes });

  } catch (e) {
    console.error("💣 큐 처리 실패:", e);
    res.status(500).json({ error: "서버 내부 오류" });
  } finally {
    clearTimeout(requestQueue[0].timeout);
    requestQueue.shift();
    processQueue();
  }
}

// ✅ 최종 엔드포인트
app.post("/dev-next-barcode", async (req, res) => {
  const { prefix, mode, count, week, idParts } = req.body;
  const timeout = setTimeout(() => {
    res.status(408).json({ error: "⏱️ 요청 타임아웃" });
    requestQueue.shift();
    processQueue();
  }, 10000);

  requestQueue.push({ prefix, count, res, modeLabel: mode, week, timeout, idParts });
  if (requestQueue.length === 1) processQueue();
});

// ✅ 설정 저장
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

// ✅ 서버 실행
app.listen(PORT, () => {
  console.log(`✅ Supabase 바코드 서버 실행 중 - 포트 ${PORT}`);
});